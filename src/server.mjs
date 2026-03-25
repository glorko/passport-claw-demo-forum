import http from "node:http";
import { isAgentRequest, humanPostBody } from "./boardLogic.mjs";

const posts = [];
let seq = 1;

function env(name, def = "") {
  const v = process.env[name];
  return v != null && String(v).trim() !== "" ? String(v).trim() : def;
}

const PORT = Number(env("PORT", "8080"));
const VERIFIER_BASE = env("VERIFIER_BASE_URL", "http://127.0.0.1:8082").replace(/\/$/, "");
const VERIFIER_KEY = env("VERIFIER_API_KEY", "dev_verifier_key_local");
const DOCS_URL = env("PASSPORT_DOCS_URL", "http://127.0.0.1:8080/api/info");
const CHALLENGE_TYPE = "https://passport.claw/errors/missing-presentation";

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

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url || "/", `http://${req.headers.host}`);

  if (req.method === "GET" && u.pathname === "/healthz") {
    res.writeHead(200);
    return res.end("ok");
  }

  if (req.method === "GET" && u.pathname === "/api/info") {
    return json(res, 200, humanPostBody("Passport Claw demo board"));
  }

  if (req.method === "GET" && u.pathname === "/api/posts") {
    return json(res, 200, { posts: [...posts] });
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

    const agent = isAgentRequest(req.headers);

    if (!agent) {
      return json(res, 200, humanPostBody(text));
    }

    const pres =
      req.headers["x-passport-presentation"] || req.headers["X-Passport-Presentation"] || "";
    if (!pres || String(pres).trim() === "") {
      return problem(res, 401, CHALLENGE_TYPE, "Passport presentation required", {
        passport_docs_url: DOCS_URL,
        verifier_url: VERIFIER_BASE,
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

  res.writeHead(404);
  res.end();
});

server.listen(PORT, () => {
  console.error(`demo-forum http://127.0.0.1:${PORT}`);
});
