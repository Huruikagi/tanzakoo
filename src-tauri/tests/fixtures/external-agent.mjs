import { createInterface } from "node:readline";
import { appendFileSync } from "node:fs";
import { spawn } from "node:child_process";
const trace = process.argv[2];
const send = (m) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...m }) + "\n");
appendFileSync(
  trace,
  JSON.stringify({
    cwd: process.cwd(),
    home: process.env.CODEX_HOME,
    args: process.argv.slice(3),
  }) + "\n",
);
if (process.argv.includes("--descendant")) {
  const child = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
    stdio: "inherit",
    windowsHide: true,
  });
  appendFileSync(trace, JSON.stringify({ pid: process.pid, descendant: child.pid }) + "\n");
}
// `--claude-auth=<kind>` mimics claude-agent-acp's auth report; with
// `--hide-claude-auth` it refuses session creation unless an API credential pays.
const claudeAuth = process.argv.find((a) => a.startsWith("--claude-auth="))?.split("=")[1];
const claudeRefusal =
  claudeAuth &&
  process.argv.includes("--hide-claude-auth") &&
  ["account", "none"].includes(claudeAuth)
    ? {
        code: -32000,
        message: "Authentication required",
        ...(claudeAuth === "account" && { data: { reason: "claude_subscription_not_supported" } }),
      }
    : undefined;
createInterface({ input: process.stdin }).on("line", (line) => {
  const request = JSON.parse(line);
  appendFileSync(trace, line + "\n");
  if (request.id === undefined) return;
  let result;
  switch (request.method) {
    case "initialize":
      result = { protocolVersion: 1, agentCapabilities: { loadSession: true }, authMethods: [] };
      break;
    case "session/new":
      if (claudeRefusal) {
        send({ id: request.id, error: claudeRefusal });
        return;
      }
      result = { sessionId: "external-session" };
      if (claudeAuth) {
        send({ id: request.id, result });
        send({
          method: "_auth/status_update",
          params: { authStatus: { kind: claudeAuth, label: "user@example.com" } },
        });
        return;
      }
      break;
    case "session/load":
      result = {};
      break;
    case "session/prompt":
      send({
        method: "session/update",
        params: {
          sessionId: request.params.sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "EXTERNAL_ACP_OK" },
          },
        },
      });
      result = { stopReason: "end_turn" };
      break;
    default:
      send({ id: request.id, error: { code: -32601, message: "Unexpected request" } });
      return;
  }
  send({ id: request.id, result });
});
