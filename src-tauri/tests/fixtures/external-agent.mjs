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
    claudeExecutable: process.env.CLAUDE_CODE_EXECUTABLE,
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
const claudeAuth =
  process.argv.find((a) => a.startsWith("--claude-auth="))?.split("=")[1] ??
  (process.env.TANZAKOO_TEST_PERSONAL === "1" ? "account" : undefined);
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
// `--config-options` mimics claude-agent-acp's pickers: ids differ from Codex,
// categories identify them, and the effort choices depend on the model.
const pickers = process.argv.includes("--config-options");
let model = "opus";
let effort = "medium";
const efforts = () => ({ opus: ["low", "medium", "high"], sonnet: ["low", "high"] })[model];
const select = (id, category, currentValue, values) => ({
  id,
  name: id,
  category,
  type: "select",
  currentValue,
  options: values.map((value) => ({ value, name: value.toUpperCase() })),
});
const configOptions = () =>
  pickers
    ? [
        select("mode", "mode", "default", ["default", "plan"]),
        select("model", "model", model, ["opus", "sonnet", "haiku"]),
        ...(efforts() ? [select("effort", "thought_level", effort, efforts())] : []),
      ]
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
      result = { sessionId: "external-session", configOptions: configOptions() };
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
      result = { configOptions: configOptions() };
      break;
    case "session/set_config_option": {
      if (process.argv.includes("--fail-config")) {
        send({ id: request.id, error: { code: -32603, message: "Mock connection failure" } });
        return;
      }
      const { configId, value } = request.params;
      if (
        process.argv.includes("--reject-current-model") &&
        configId === "model" &&
        value === model
      ) {
        send({
          id: request.id,
          error: { code: -32002, message: "Model cannot be selected again" },
        });
        return;
      }
      const option = configOptions()?.find((o) => o.id === configId);
      if (!option?.options.some((o) => o.value === value)) {
        send({ id: request.id, error: { code: -32602, message: "Unsupported selection" } });
        return;
      }
      if (configId === "model") {
        model = value;
        if (!efforts()?.includes(effort)) effort = efforts()?.[0];
      } else if (configId === "effort") effort = value;
      result = { configOptions: configOptions() };
      break;
    }
    case "session/prompt":
      if (process.argv.includes("--fail-prompt")) {
        send({ id: request.id, error: { code: -32603, message: "Mock connection failure" } });
        return;
      }
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
      if (process.argv.includes("--wait-prompt")) return;
      result = { stopReason: "end_turn" };
      break;
    default:
      send({ id: request.id, error: { code: -32601, message: "Unexpected request" } });
      return;
  }
  send({ id: request.id, result });
});
