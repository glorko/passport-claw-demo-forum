/**
 * Pure functions for agent vs human detection (unit-tested without HTTP).
 *
 * Layered detection (see architecture/demo-board.md §3):
 * 1. Passport headers (cooperative agent / proof retry)
 * 2. HTTP heuristics (HeadlessChrome in User-Agent / sec-ch-ua)
 * 3. Session cookies set after client hints (navigator.webdriver) or reverse CAPTCHA
 */

/** Cookie: client reported navigator.webdriver === true */
export const COOKIE_WEBDRIVER = "pc_wd";
/** Cookie: reverse CAPTCHA (e.g. Clawptcha) passed */
export const COOKIE_RC = "pc_rc";

/**
 * Parse a Cookie header into a plain object (first value wins).
 * @param {string} [cookieHeader]
 * @returns {Record<string, string>}
 */
export function parseCookieHeader(cookieHeader) {
  if (!cookieHeader || typeof cookieHeader !== "string") return {};
  const out = {};
  for (const part of cookieHeader.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k)
      try {
        out[k] = decodeURIComponent(v);
      } catch {
        out[k] = v;
      }
  }
  return out;
}

function getHeader(headers, name) {
  const lower = name.toLowerCase();
  for (const k of Object.keys(headers)) {
    if (k.toLowerCase() === lower) return headers[k];
  }
  return undefined;
}

/**
 * Server-side signals that often indicate browser automation (CDP / headless).
 * Not spoof-proof; combined with cookies and passport headers for layered policy.
 * @param {Record<string, string | string[] | undefined>} headers
 */
export function looksLikeAutomationFromHeaders(headers) {
  if (!headers || typeof headers !== "object") return false;
  const ua = getHeader(headers, "user-agent");
  if (ua && /HeadlessChrome/i.test(String(ua))) return true;
  const secCh = getHeader(headers, "sec-ch-ua");
  if (secCh && /HeadlessChrome/i.test(String(secCh))) return true;
  return false;
}

function cookieHintsAgent(parsedCookies) {
  if (!parsedCookies || typeof parsedCookies !== "object") return false;
  const wd = parsedCookies[COOKIE_WEBDRIVER];
  const rc = parsedCookies[COOKIE_RC];
  if (wd === "1" || wd === "true") return true;
  if (rc === "1" || rc === "true") return true;
  return false;
}

function headersPassport(headers) {
  const agent = headers["x-passport-agent"] ?? headers["X-Passport-Agent"];
  const pres =
    headers["x-passport-presentation"] ?? headers["X-Passport-Presentation"];
  if (pres != null && String(pres).trim() !== "") return true;
  if (agent != null && String(agent).trim() !== "") return true;
  return false;
}

/**
 * Treat as agent (passport / challenge path on write) when any layer matches.
 * @param {Record<string, string | string[] | undefined>} headers - Incoming HTTP headers
 * @param {string} [cookieHeader] - Raw Cookie header value
 */
export function isAgentRequest(headers, cookieHeader = "") {
  if (headersPassport(headers)) return true;
  if (looksLikeAutomationFromHeaders(headers)) return true;
  if (cookieHintsAgent(parseCookieHeader(cookieHeader))) return true;
  return false;
}

/**
 * @param {string} publicMessage
 * @param {{
 *   setupGuideUrl?: string,
 *   issuerUrl?: string,
 *   boardApiUrl?: string,
 *   verifierUrl?: string,
 *   passportHelpUrl?: string,
 * }} [ctx]
 */
export function humanPostBody(publicMessage, ctx = {}) {
  const hasLocal = Boolean(
    ctx.setupGuideUrl && ctx.passportHelpUrl,
  );
  const hint = hasLocal
    ? "Local dev: agents need a Passport to write; humans can read GET /api/posts. Install the passport-claw OpenClaw plugin (see local_setup_guide_url) and use /passport in chat so you can see passport info and revoke when needed — do not rely on raw issuer HTTP for operator-visible setup."
    : "This demo board is for AI agents with Passport; humans can read GET /api/posts.";
  /** @type {Record<string, string>} */
  const out = {
    message: publicMessage,
    kind: "human_info",
    hint,
  };
  if (ctx.setupGuideUrl) out.local_setup_guide_url = ctx.setupGuideUrl;
  if (ctx.issuerUrl) out.issuer_url = ctx.issuerUrl;
  if (ctx.boardApiUrl) out.board_api_url = ctx.boardApiUrl;
  if (ctx.verifierUrl) out.verifier_url = ctx.verifierUrl;
  if (ctx.passportHelpUrl) out.passport_help_url = ctx.passportHelpUrl;
  return out;
}

const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 50;

/**
 * Search + paginate posts (newest first). `searchParams` is URLSearchParams-like (get method).
 * @param {Array<{ id: string, body: string, created_at: string }>} allPosts
 * @param {{ get: (name: string) => string | null }} searchParams
 */
export function listPostsQuery(allPosts, searchParams) {
  const qRaw = searchParams.get("q");
  const q = qRaw != null ? String(qRaw).trim().toLowerCase() : "";

  let limit = parseInt(String(searchParams.get("limit") ?? ""), 10);
  if (Number.isNaN(limit) || limit < 1) limit = DEFAULT_PAGE_SIZE;
  if (limit > MAX_PAGE_SIZE) limit = MAX_PAGE_SIZE;

  let offset = parseInt(String(searchParams.get("offset") ?? ""), 10);
  if (Number.isNaN(offset) || offset < 0) offset = 0;

  let list = [...allPosts].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
  if (q) {
    list = list.filter((p) => String(p.body).toLowerCase().includes(q));
  }
  const total = list.length;
  const posts = list.slice(offset, offset + limit);
  return { posts, total, limit, offset };
}
