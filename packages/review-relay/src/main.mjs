import { Ledger } from "./ledger.mjs";
import { createRelay } from "./server.mjs";
import { databasePath } from "./config.mjs";

// HTTPS termination is the host's responsibility. Bind locally by default.
process.umask(0o077);
const ledger = new Ledger(databasePath());
const app = createRelay({
  ledger,
  apiKey: process.env.OPENAI_API_KEY,
  models: (process.env.TANZAKOO_RELAY_MODELS ?? "").split(",").filter(Boolean),
});
app.addHook("onClose", async () => ledger.close());
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    void app.close();
  });
await app.listen({
  host: process.env.TANZAKOO_RELAY_HOST ?? "127.0.0.1",
  port: Number(process.env.PORT ?? 8787),
});
console.log("Tanzakoo review relay listening. Request logging is disabled.");
