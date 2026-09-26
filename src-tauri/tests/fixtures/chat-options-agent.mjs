import { createInterface } from "node:readline";
import { appendFileSync } from "node:fs";
import { join } from "node:path";

let model = "model-a";
let effort = "medium";
const options = () => [
  {
    id: "model",
    name: "Model",
    type: "select",
    currentValue: model,
    options: ["model-a", "model-b"].map((value) => ({ value, name: value })),
  },
  {
    id: "reasoning_effort",
    name: "Effort",
    type: "select",
    currentValue: effort,
    options: (model === "model-a" ? ["medium", "high"] : ["low"]).map((value) => ({
      value,
      name: value,
    })),
  },
];
createInterface({ input: process.stdin }).on("line", (line) => {
  const request = JSON.parse(line);
  appendFileSync(join(process.env.CODEX_HOME, "options-trace.jsonl"), line + "\n");
  if (request.id === undefined || process.argv.includes("hang")) return;
  const response = { jsonrpc: "2.0", id: request.id };
  switch (request.method) {
    case "initialize":
      response.result = {
        protocolVersion: 1,
        agentCapabilities: { loadSession: true },
        authMethods: [],
      };
      break;
    case "session/new":
      response.result = { sessionId: "test-session", configOptions: options() };
      break;
    case "session/load":
      response.result = { configOptions: options() };
      break;
    case "session/set_config_option": {
      const { configId, value } = request.params;
      if (
        !options()
          .find((o) => o.id === configId)
          ?.options.some((o) => o.value === value)
      ) {
        response.error = { code: -32602, message: "Unsupported selection" };
      } else {
        if (configId === "model") {
          model = value;
          effort = model === "model-a" ? "medium" : "low";
        } else effort = value;
        response.result = { configOptions: options() };
      }
      break;
    }
    case "session/prompt":
      response.result = { stopReason: "end_turn" };
      break;
    default:
      response.error = { code: -32601, message: "Method not found" };
  }
  process.stdout.write(JSON.stringify(response) + "\n");
});
