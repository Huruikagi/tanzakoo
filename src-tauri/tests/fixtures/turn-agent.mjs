import { createInterface } from "node:readline";
import { appendFileSync } from "node:fs";
import { join } from "node:path";

const mode = process.argv[2];
const send = (message) =>
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\n");
const delta = (sessionId, text) =>
  send({
    method: "session/update",
    params: {
      sessionId,
      update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } },
    },
  });

createInterface({ input: process.stdin }).on("line", (line) => {
  const request = JSON.parse(line);
  appendFileSync(join(process.env.CODEX_HOME, "turn-trace.jsonl"), line + "\n");
  if (request.id === undefined) return;
  const response = { id: request.id };
  switch (request.method) {
    case "initialize":
      response.result = {
        protocolVersion: 1,
        agentCapabilities: { loadSession: mode !== "no-load" },
        authMethods: [],
      };
      break;
    case "session/new":
      response.result = { sessionId: "turn-session" };
      break;
    case "session/load":
      delta(request.params.sessionId, "REPLAYED HISTORY");
      response.result = {};
      break;
    case "session/prompt":
      delta(request.params.sessionId, "途中の回答");
      if (mode === "cancel") return;
      if (mode === "fail") {
        response.error = { code: -32603, message: "Mock turn failure" };
      } else {
        delta(request.params.sessionId, "です。");
        response.result = {
          stopReason: ["cancelled", "max_tokens", "max_turn_requests", "refusal"].includes(mode)
            ? mode
            : "end_turn",
        };
      }
      break;
    default:
      response.error = { code: -32601, message: "Method not found" };
  }
  send(response);
});
