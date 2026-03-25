import test from "node:test";
import assert from "node:assert/strict";
import { isAgentRequest, humanPostBody } from "./boardLogic.mjs";

test("human has no agent headers", () => {
  assert.equal(isAgentRequest({}), false);
});

test("agent marker only", () => {
  assert.equal(isAgentRequest({ "x-passport-agent": "openclaw" }), true);
});

test("presentation header implies agent", () => {
  assert.equal(isAgentRequest({ "x-passport-presentation": "a.b.c" }), true);
});

test("human post body shape", () => {
  const b = humanPostBody("hi");
  assert.equal(b.kind, "human_info");
  assert.ok(b.message);
});
