import openBrowser from "open";
import { operate } from "./plan/store.mjs";
import { PlanError } from "./plan/oauth.mjs";
const [directory, action, id] = process.argv.slice(2);
// No endpoint overrides, token arguments, or raw diagnostics in the production entrypoint.
try {
  if (!directory) throw new PlanError("storage");
  const result = await operate(directory, action, id || null, { openBrowser, fetcher: fetch });
  process.stdout.write(JSON.stringify({ result }));
} catch (error) {
  process.stdout.write(
    JSON.stringify({ error: error instanceof PlanError ? error.message : "storage" }),
  );
  process.exitCode = 1;
}
