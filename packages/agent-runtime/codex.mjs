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
// Start with the relay-authorized model: ACP rejects switching to a model that
// is absent from its bundled catalog, but accepts a configured current model.
const reviewModel = process.env.TANZAKOO_REVIEW_MODEL;
delete process.env.TANZAKOO_REVIEW_MODEL;
if (reviewModel && !/^[a-zA-Z0-9._-]{1,100}$/.test(reviewModel))
  throw new Error("Invalid review model");
process.env.CODEX_CONFIG = JSON.stringify({
  ...referencePolicy,
  ...(reviewModel ? { model: reviewModel } : {}),
});
await import("@agentclientprotocol/codex-acp");
