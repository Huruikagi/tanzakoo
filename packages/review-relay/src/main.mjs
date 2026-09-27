import { Ledger } from "./ledger.mjs";
import { createRelay } from "./server.mjs";

// HTTPS termination is the host's responsibility. Bind locally by default.
const path = process.env.TANZAKOO_RELAY_DB;
if (!path) throw new Error("Set TANZAKOO_RELAY_DB to a persistent database path");
const ledger = new Ledger(path);
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
