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
      result = { sessionId: "external-session" };
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
