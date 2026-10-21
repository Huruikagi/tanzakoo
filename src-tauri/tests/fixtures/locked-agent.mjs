import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { setTimeout } from "node:timers/promises";
import { waitForProcessJob } from "../../../packages/agent-runtime/process-gate.mjs";

waitForProcessJob();
const [directory, mode, executable] = process.argv.slice(2);
const locked = join(directory, "locked.txt");
const ready = join(directory, "lock.pid");
writeFileSync(locked, "fixture");
// Re-exec the compiled Rust test helper: no PowerShell startup, profiles, or
// external runtime is needed to hold a Windows handle that forbids deletion.
const holder = spawn(
  executable,
  ["--ignored", "--exact", "acp_process::tests::locked_descendant", "--nocapture"],
  {
    env: { ...process.env, TANZAKOO_LOCK_DIRECTORY: directory },
    windowsHide: true,
    stdio: ["ignore", "ignore", "pipe"],
  },
);
holder.stderr.pipe(process.stderr);
holder.on("error", (error) => {
  throw error;
});
holder.on("exit", (code) => {
  if (!existsSync(ready)) throw new Error(`Lock holder exited before readiness: ${code}`);
});
const deadline = Date.now() + 10_000;
while (!existsSync(ready)) {
  if (Date.now() > deadline) throw new Error("Lock holder did not start");
  await setTimeout(10);
}
writeFileSync(
  join(directory, "tree.json"),
  JSON.stringify({ adapter: process.pid, descendant: Number(readFileSync(ready, "utf8")) }),
);
while (!existsSync(join(directory, "release"))) await setTimeout(10);
if (mode === "exit") process.exit(17);
createInterface({ input: process.stdin }).on("line", (line) => {
  const request = JSON.parse(line);
  if (mode !== "cancel")
    process.stdout.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: request.id,
        result: { protocolVersion: 1, agentCapabilities: {}, authMethods: [] },
      }) + "\n",
    );
});
// Deliberately ignore stdin EOF, like a stuck adapter with a live descendant.
setInterval(() => {}, 1000);
