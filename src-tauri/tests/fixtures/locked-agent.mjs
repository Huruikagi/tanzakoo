import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { setTimeout } from "node:timers/promises";
import { waitForProcessJob } from "../../../packages/agent-runtime/process-gate.mjs";

waitForProcessJob();
const [directory, mode] = process.argv.slice(2);
const locked = join(directory, "locked.txt");
const ready = join(directory, "lock.pid");
writeFileSync(locked, "fixture");
// Hold a real Windows handle that forbids deletion, independently of the adapter.
spawn(
  "powershell.exe",
  [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    "$held = [System.IO.File]::Open($env:TANZAKOO_LOCK_FILE, 'Open', 'Read', 'Read'); " +
      "[System.IO.File]::WriteAllText($env:TANZAKOO_LOCK_PID, [string]$PID); " +
      "Start-Sleep -Seconds 120; $held.Dispose()",
  ],
  {
    env: { ...process.env, TANZAKOO_LOCK_FILE: locked, TANZAKOO_LOCK_PID: ready },
    windowsHide: true,
    stdio: "ignore",
  },
);
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
