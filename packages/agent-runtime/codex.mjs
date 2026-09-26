// The managed runtime uses app-owned credentials and its pinned Codex dependency.
// Do not silently inherit another application's API key, gateway or executable.
import referencePolicy from "./reference-policy.json" with { type: "json" };
for (const key of [
  "CODEX_API_KEY",
  "OPENAI_API_KEY",
  "CODEX_ACCESS_TOKEN",
  "CODEX_PATH",
  "CODEX_CONFIG",
  "DEFAULT_AUTH_REQUEST",
  "MODEL_PROVIDER",
  "OPENAI_BASE_URL",
  "OPENAI_ORG_ID",
  "OPENAI_ORGANIZATION",
  "OPENAI_PROJECT_ID",
  "NODE_OPTIONS",
])
  delete process.env[key];
if (!process.env.CODEX_HOME) throw new Error("Tanzakoo must provide CODEX_HOME");
process.env.CODEX_CONFIG = JSON.stringify(referencePolicy);
await import("@agentclientprotocol/codex-acp");
