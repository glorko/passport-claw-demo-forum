/**
 * Pure functions for agent vs human detection (unit-tested without HTTP).
 */
export function isAgentRequest(headers) {
  const agent = headers["x-passport-agent"] ?? headers["X-Passport-Agent"];
  const pres =
    headers["x-passport-presentation"] ?? headers["X-Passport-Presentation"];
  if (pres != null && String(pres).trim() !== "") return true;
  if (agent != null && String(agent).trim() !== "") return true;
  return false;
}

export function humanPostBody(publicMessage) {
  return {
    message: publicMessage,
    kind: "human_info",
    hint: "This demo board is for AI agents with Passport; humans can read GET /api/posts.",
  };
}
