import { createInterface } from "node:readline";
import { appendFileSync } from "node:fs";
import { join } from "node:path";

let model = process.env.TANZAKOO_PLAN_MODEL || "model-a";
let effort = "medium";
let authenticated = false;
const options = () => [
  {
    id: "model",
    name: "Model",
    type: "select",
    currentValue: model,
    options: ["model-a", "model-b"].map((value) => ({ value, name: value })),
  },
  ...(model === "unknown-model"
    ? []
    : [
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
      ]),
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
      if (process.env.TANZAKOO_PLAN_MODEL && !authenticated) {
        response.error = { code: -32000, message: "Authenticate before discovery" };
        break;
      }
      response.result = { sessionId: "test-session", configOptions: options() };
      break;
    case "authenticate":
      authenticated = request.params.methodId === "gateway";
      response.result = {};
      break;
    case "session/load":
      response.result = { configOptions: options() };
      break;
    case "session/set_config_option": {
      const { configId, value } = request.params;
      if (
        !(configId === "model" && value === model) &&
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
