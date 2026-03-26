import test from "node:test";
import assert from "node:assert/strict";
import {
  isAgentRequest,
  humanPostBody,
  parseCookieHeader,
  looksLikeAutomationFromHeaders,
  listPostsQuery,
  COOKIE_WEBDRIVER,
  COOKIE_RC,
} from "./boardLogic.mjs";

test("human has no agent headers", () => {
  assert.equal(isAgentRequest({}), false);
});

test("agent marker only", () => {
  assert.equal(isAgentRequest({ "x-passport-agent": "openclaw" }), true);
});

test("presentation header implies agent", () => {
  assert.equal(isAgentRequest({ "x-passport-presentation": "a.b.c" }), true);
});

test("HeadlessChrome in User-Agent implies agent (HTTP heuristic)", () => {
  assert.equal(
    isAgentRequest({
      "user-agent":
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0.0.0 Safari/537.36",
    }),
    true,
  );
});

test("sec-ch-ua with HeadlessChrome implies agent", () => {
  assert.equal(
    isAgentRequest({
      "sec-ch-ua": `"HeadlessChrome";v="120"`,
    }),
    true,
  );
});

test("cookie pc_wd=1 implies agent", () => {
  assert.equal(isAgentRequest({}, `${COOKIE_WEBDRIVER}=1`), true);
});

test("cookie pc_rc=1 implies agent", () => {
  assert.equal(isAgentRequest({}, `${COOKIE_RC}=1`), true);
});

test("parseCookieHeader", () => {
  assert.equal(parseCookieHeader("a=1; b=two").a, "1");
  assert.equal(parseCookieHeader("a=1; b=two").b, "two");
  assert.deepEqual(parseCookieHeader(""), {});
});

test("looksLikeAutomationFromHeaders false for normal Chrome UA", () => {
  assert.equal(
    looksLikeAutomationFromHeaders({
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    }),
    false,
  );
});

test("human post body shape", () => {
  const b = humanPostBody("hi");
  assert.equal(b.kind, "human_info");
  assert.ok(b.message);
});

test("human post body includes local URLs when ctx set", () => {
  const b = humanPostBody("hi", {
    setupGuideUrl: "http://127.0.0.1:19173/passport-local.html",
    issuerUrl: "http://127.0.0.1:19081",
    boardApiUrl: "http://127.0.0.1:19080",
    verifierUrl: "http://127.0.0.1:19082",
    passportHelpUrl: "http://127.0.0.1:19080/api/passport-help",
  });
  assert.equal(b.local_setup_guide_url, "http://127.0.0.1:19173/passport-local.html");
  assert.equal(b.passport_help_url, "http://127.0.0.1:19080/api/passport-help");
});

const samplePosts = [
  { id: "1", body: "alpha", created_at: "2026-01-01T10:00:00.000Z" },
  { id: "2", body: "beta hello", created_at: "2026-01-02T10:00:00.000Z" },
  { id: "3", body: "gamma", created_at: "2026-01-03T10:00:00.000Z" },
];

test("listPostsQuery newest first and pagination", () => {
  const u = new URL("http://x/?limit=2&offset=0");
  const out = listPostsQuery(samplePosts, u.searchParams);
  assert.equal(out.total, 3);
  assert.equal(out.posts.length, 2);
  assert.equal(out.posts[0].id, "3");
  assert.equal(out.posts[1].id, "2");
});

test("listPostsQuery search q", () => {
  const u = new URL("http://x/?q=HELLO");
  const out = listPostsQuery(samplePosts, u.searchParams);
  assert.equal(out.total, 1);
  assert.equal(out.posts[0].id, "2");
});

test("listPostsQuery offset page 2", () => {
  const u = new URL("http://x/?limit=1&offset=1");
  const out = listPostsQuery(samplePosts, u.searchParams);
  assert.equal(out.posts[0].id, "2");
});
