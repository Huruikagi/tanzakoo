import { createInterface } from "node:readline";
import { appendFileSync, existsSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";

const home = process.env.CODEX_HOME;
const authenticated = join(home, "fake-authenticated");
const trace = join(home, "fake-trace.jsonl");
createInterface({ input: process.stdin }).on("line", (line) => {
  const request = JSON.parse(line);
  appendFileSync(trace, JSON.stringify(request) + "\n");
  if (process.argv.includes("hang")) return;
  const reply = { jsonrpc: "2.0", id: request.id };
  if (request.method === "initialize")
    reply.result = {
      protocolVersion: 1,
      agentCapabilities: {},
      authMethods: [{ id: "chat-gpt", name: "Mock login" }],
    };
  else if (request.method === "authenticate") {
    writeFileSync(authenticated, "mock");
    reply.result = {};
  } else if (request.method === "logout") {
    if (existsSync(authenticated)) unlinkSync(authenticated);
    reply.result = {};
  } else if (request.method === "session/new") {
    if (existsSync(authenticated)) reply.result = { sessionId: "mock-session" };
    else reply.error = { code: -32000, message: "Authentication required" };
  } else reply.error = { code: -32601, message: "Method not found" };
  process.stdout.write(JSON.stringify(reply) + "\n");
});
