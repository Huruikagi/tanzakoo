import { createInterface } from "node:readline";
import { appendFileSync, existsSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";

// Arguments: `hang`, `--trace=<file>`, and `claude=<kind>[:late]` to mimic
// claude-agent-acp, which offers no auth method to a client without terminal
// auth and pushes `_auth/status_update` instead of refusing session creation.
const option = (name) =>
  process.argv.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1);
const home = process.env.CODEX_HOME;
const authenticated = home && join(home, "fake-authenticated");
const trace = option("--trace") ?? join(home, "fake-trace.jsonl");
const claude = option("claude");
const [kind, timing] = (claude ?? "").split(":");
const send = (message) =>
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\n");
const pushAuth = () => {
  if (kind === "silent") return;
  const labels = { none: "Not logged in", account: "Claude Max", api_key: "Anthropic API key" };
  send({
    method: "_auth/status_update",
    params: {
      authStatus: {
        kind,
        label: labels[kind] ?? kind,
        account: { email: "PRIVATE_EMAIL@example.com" },
      },
    },
  });
};
createInterface({ input: process.stdin }).on("line", (line) => {
  const request = JSON.parse(line);
  appendFileSync(trace, JSON.stringify(request) + "\n");
  if (process.argv.includes("hang") || request.id === undefined) return;
  const reply = { id: request.id };
  if (request.method === "initialize")
    reply.result = {
      protocolVersion: 1,
      agentCapabilities: {},
      authMethods: claude ? [] : [{ id: "chat-gpt", name: "Mock login" }],
    };
  else if (claude && request.method === "session/new") reply.result = { sessionId: "mock-claude" };
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
  send(reply);
  if (claude && request.method === (timing === "late" ? "session/new" : "initialize")) {
    // A late push arrives after session creation, like the adapter's CLI probe.
    if (timing === "late") setTimeout(pushAuth, 200);
    else pushAuth();
  }
});
