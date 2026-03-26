/**
 * Defaults below are for **local** Crux (127.0.0.1 ports). Production/staging sets
 * ISSUER_BASE_URL, VERIFIER_BASE_URL, BOARD_* via env (see README “Public staging”).
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  isAgentRequest,
  humanPostBody,
  COOKIE_WEBDRIVER,
  COOKIE_RC,
  listPostsQuery,
} from "./boardLogic.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** Vite output when `npm run build` has run (e.g. Railway). */
const WEB_DIST = path.join(__dirname, "..", "web", "dist");

const posts = [];
let seq = 1;

function env(name, def = "") {
  const v = process.env[name];
  return v != null && String(v).trim() !== "" ? String(v).trim() : def;
}

const PORT = Number(env("PORT", "19080"));
const VERIFIER_BASE = env("VERIFIER_BASE_URL", "http://127.0.0.1:19082").replace(/\/$/, "");
const VERIFIER_KEY = env("VERIFIER_API_KEY", "dev_verifier_key_local");
const ISSUER_BASE = env("ISSUER_BASE_URL", "http://127.0.0.1:19081").replace(/\/$/, "");
/** Public base URL of this board API (for links in JSON). Default matches PORT. */
const BOARD_API_PUBLIC = env("BOARD_API_PUBLIC_URL", `http://127.0.0.1:${PORT}`).replace(/\/$/, "");
/** Human-facing URL for challenge body + setup guide (Vite dev server in local stack). */
const FRONTEND_ORIGIN = env("BOARD_FRONTEND_ORIGIN", "http://127.0.0.1:19173").replace(/\/$/, "");
const DOCS_URL = env("PASSPORT_DOCS_URL", `${FRONTEND_ORIGIN}/passport-local.html`);
const CHALLENGE_TYPE = "https://passport.claw/errors/missing-presentation";
/** Absolute filesystem path to `passport-claw-openclaw-plugin` on this machine (optional; overrides git clone). */
const PASSPORT_PLUGIN_INSTALL_PATH = env("PASSPORT_PLUGIN_INSTALL_PATH", "");
/** Public git URL — repo root is the plugin package (default: published plugin on GitHub). */
const DEFAULT_PASSPORT_PLUGIN_GIT_URL = "https://github.com/glorko/passport-claw-openclaw-plugin.git";
const PASSPORT_PLUGIN_GIT_URL = env("PASSPORT_PLUGIN_GIT_URL", DEFAULT_PASSPORT_PLUGIN_GIT_URL);

function buildPluginInstallCommands() {
  const pkg = "passport-claw-openclaw-plugin";
  if (PASSPORT_PLUGIN_INSTALL_PATH) {
    const p = PASSPORT_PLUGIN_INSTALL_PATH.replace(/\/$/, "");
    return [
      `cd "${p}" && npm ci && npm run build && openclaw plugins install -l "${p}"`,
    ];
  }
  const u = PASSPORT_PLUGIN_GIT_URL.replace(/\/$/, "");
  return [
    `git clone ${u} ${pkg} && cd ${pkg} && npm ci && npm run build && openclaw plugins install -l "$(pwd)"`,
  ];
}

function passportHelpDoc() {
  const help = `${BOARD_API_PUBLIC}/api/passport-help`;
  const openclaw = {
    plugin_package_dir: "passport-claw-openclaw-plugin",
    install_commands: buildPluginInstallCommands(),
    commands: {
      passport_info: "/passport",
      passport_revoke: "/passport revoke",
    },
    operator_guidance: [
      "Install and enable the passport-claw OpenClaw plugin so the operator can read passport info and revoke from chat (/passport, /passport revoke).",
      "Default install_commands clone plugin_git_url, then npm ci, npm run build, and openclaw plugins install -l \"$(pwd)\". Set PASSPORT_PLUGIN_INSTALL_PATH on the board process only if you want a local checkout path instead of cloning.",
      "Do not use this help payload to walk operators through raw issuer HTTP; enrollment without the plugin gives operators no in-chat visibility.",
    ],
    env_notes: [
      "ISSUER_BASE_URL overrides the default issuer URL (plugin / gateway environment).",
      "PASSPORT_PLUGIN_GIT_URL (default): public git URL; install_commands use git clone when PASSPORT_PLUGIN_INSTALL_PATH is unset.",
      "PASSPORT_PLUGIN_INSTALL_PATH (optional): absolute path to passport-claw-openclaw-plugin on this host; overrides clone-based install_commands when set.",
    ],
  };
  if (PASSPORT_PLUGIN_INSTALL_PATH) {
    openclaw.plugin_install_path = PASSPORT_PLUGIN_INSTALL_PATH.replace(/\/$/, "");
  } else {
    openclaw.plugin_git_url = PASSPORT_PLUGIN_GIT_URL.replace(/\/$/, "");
  }
  return {
    environment: "local-dev",
    setup_guide_url: DOCS_URL,
    frontend_origin: FRONTEND_ORIGIN,
    issuer_url: ISSUER_BASE,
    board_api_url: BOARD_API_PUBLIC,
    verifier_url: VERIFIER_BASE,
    passport_help_url: help,
    endpoints: {
      posts: `${BOARD_API_PUBLIC}/api/posts`,
      info: `${BOARD_API_PUBLIC}/api/info`,
    },
    openclaw,
  };
}

function ctxForHuman() {
  return {
    setupGuideUrl: DOCS_URL,
    issuerUrl: ISSUER_BASE,
    boardApiUrl: BOARD_API_PUBLIC,
    verifierUrl: VERIFIER_BASE,
    passportHelpUrl: `${BOARD_API_PUBLIC}/api/passport-help`,
  };
}

/** Max-Age for agent-hint cookies (seconds). */
const AGENT_HINT_MAX_AGE = Number(env("AGENT_HINT_MAX_AGE", "3600"));

function json(res, status, obj) {
  const b = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(b),
  });
  res.end(b);
}

function problem(res, status, type, title, extra = {}) {
  const b = JSON.stringify({ type, title, status, ...extra });
  res.writeHead(status, {
    "Content-Type": "application/problem+json",
    "Content-Length": Buffer.byteLength(b),
  });
  res.end(b);
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
}

async function verifyPresentation(compact) {
  const url = `${VERIFIER_BASE}/v1/verify`;
  const ac = new AbortController();
  const to = setTimeout(() => ac.abort(), 15000);
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Passport-Verifier-Key": VERIFIER_KEY,
      },
      body: JSON.stringify({ presentation: compact }),
      signal: ac.signal,
    });
    return r;
  } finally {
    clearTimeout(to);
  }
}

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", FRONTEND_ORIGIN);
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, X-Passport-Agent, X-Passport-Presentation, Cookie",
  );
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Credentials", "true");
}

function setCookie(res, name, value, maxAgeSec = AGENT_HINT_MAX_AGE) {
  const part = `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}`;
  const prev = res.getHeader("Set-Cookie");
  if (prev == null) {
    res.setHeader("Set-Cookie", part);
  } else if (Array.isArray(prev)) {
    res.setHeader("Set-Cookie", [...prev, part]);
  } else {
    res.setHeader("Set-Cookie", [prev, part]);
  }
}

function clearCookie(res, name) {
  const part = `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
  const prev = res.getHeader("Set-Cookie");
  if (prev == null) {
    res.setHeader("Set-Cookie", part);
  } else if (Array.isArray(prev)) {
    res.setHeader("Set-Cookie", [...prev, part]);
  } else {
    res.setHeader("Set-Cookie", [prev, part]);
  }
}

function mimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const map = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".mjs": "application/javascript; charset=utf-8",
    ".json": "application/json",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".png": "image/png",
    ".webp": "image/webp",
    ".woff2": "font/woff2",
  };
  return map[ext] || "application/octet-stream";
}

/** Serve built Vite assets from `web/dist` (path traversal–safe). */
function tryServeWebDist(res, pathname) {
  if (!fs.existsSync(WEB_DIST)) return false;
  const rel = pathname === "/" || pathname === "" ? "index.html" : pathname.replace(/^\/+/, "");
  const candidate = path.join(WEB_DIST, rel);
  const resolved = path.resolve(candidate);
  const rootResolved = path.resolve(WEB_DIST);
  if (!resolved.startsWith(rootResolved + path.sep) && resolved !== rootResolved) {
    return false;
  }
  if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
    const buf = fs.readFileSync(resolved);
    res.writeHead(200, { "Content-Type": mimeType(resolved), "Content-Length": buf.length });
    res.end(buf);
    return true;
  }
  return false;
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url || "/", `http://${req.headers.host}`);

  if (req.method === "OPTIONS") {
    cors(res);
    res.writeHead(204);
    return res.end();
  }

  cors(res);

  const cookieHeader = req.headers.cookie || "";

  if (req.method === "GET" && u.pathname === "/healthz") {
    res.writeHead(200);
    return res.end("ok");
  }

  if (req.method === "GET" && u.pathname === "/api/agent-detection") {
    return json(res, 200, {
      navigator_webdriver_hint: true,
      reverse_captcha_integration: true,
      cookie_names: { webdriver: COOKIE_WEBDRIVER, reverse_captcha: COOKIE_RC },
    });
  }

  if (req.method === "POST" && u.pathname === "/api/agent-hint") {
    let body;
    try {
      body = JSON.parse(await readBody(req) || "{}");
    } catch {
      return problem(res, 400, "https://passport.claw/errors/invalid-request", "Invalid JSON");
    }
    const wd = body.navigator_webdriver === true;
    if (wd) {
      setCookie(res, COOKIE_WEBDRIVER, "1");
    } else {
      clearCookie(res, COOKIE_WEBDRIVER);
    }
    return json(res, 200, { ok: true, navigator_webdriver_recorded: wd });
  }

  if (req.method === "POST" && u.pathname === "/api/reverse-captcha-token") {
    let body;
    try {
      body = JSON.parse(await readBody(req) || "{}");
    } catch {
      return problem(res, 400, "https://passport.claw/errors/invalid-request", "Invalid JSON");
    }
    const token = typeof body.token === "string" ? body.token.trim() : "";
    /** Demo: accept non-empty token; production should verify with provider API (e.g. Clawptcha). */
    if (token.length > 0) {
      setCookie(res, COOKIE_RC, "1");
      return json(res, 200, { ok: true, verified: true });
    }
    clearCookie(res, COOKIE_RC);
    return json(res, 200, { ok: true, verified: false });
  }

  if (req.method === "GET" && u.pathname === "/api/info") {
    return json(res, 200, humanPostBody("Passport Claw demo board", ctxForHuman()));
  }

  if (req.method === "GET" && u.pathname === "/api/passport-help") {
    return json(res, 200, passportHelpDoc());
  }

  if (req.method === "GET" && u.pathname === "/api/posts") {
    const out = listPostsQuery(posts, u.searchParams);
    return json(res, 200, out);
  }

  if (req.method === "POST" && u.pathname === "/api/posts") {
    let body;
    try {
      body = JSON.parse(await readBody(req) || "{}");
    } catch {
      return problem(res, 400, "https://passport.claw/errors/invalid-request", "Invalid JSON");
    }
    const text = body.body;
    if (typeof text !== "string") {
      return problem(res, 400, "https://passport.claw/errors/invalid-request", "body string required");
    }

    const agent = isAgentRequest(req.headers, cookieHeader);

    if (!agent) {
      return json(res, 200, humanPostBody(text, ctxForHuman()));
    }

    const pres =
      req.headers["x-passport-presentation"] || req.headers["X-Passport-Presentation"] || "";
    if (!pres || String(pres).trim() === "") {
      return problem(res, 401, CHALLENGE_TYPE, "Passport presentation required", {
        passport_docs_url: DOCS_URL,
        verifier_url: VERIFIER_BASE,
        issuer_url: ISSUER_BASE,
        board_api_url: BOARD_API_PUBLIC,
        passport_help_url: `${BOARD_API_PUBLIC}/api/passport-help`,
        operator_message:
          "Install the passport-claw OpenClaw plugin and use /passport (info) and /passport revoke (testing). " +
          "See setup_guide_url — avoid teaching operators raw issuer HTTP for enrollment.",
      });
    }

    let vr;
    try {
      vr = await verifyPresentation(String(pres).trim());
    } catch {
      return problem(res, 503, "https://passport.claw/errors/service-unavailable", "Verifier unavailable");
    }

    if (vr.status === 401) {
      return problem(res, 401, "https://passport.claw/errors/unauthorized", "Verifier rejected key");
    }

    if (vr.status !== 200) {
      let detail = "";
      try {
        detail = await vr.text();
      } catch {}
      const st = vr.status === 400 || vr.status === 403 ? vr.status : 503;
      return problem(res, st, "https://passport.claw/errors/invalid-proof", "Verify failed", { detail });
    }

    const post = {
      id: String(seq++),
      body: text,
      created_at: new Date().toISOString(),
    };
    posts.push(post);
    return json(res, 201, post);
  }

  if (req.method === "GET" && tryServeWebDist(res, u.pathname)) {
    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(PORT, () => {
  console.error(
    `demo-forum API ${BOARD_API_PUBLIC} | setup ${DOCS_URL} | issuer ${ISSUER_BASE} | help ${BOARD_API_PUBLIC}/api/passport-help`,
  );
});
