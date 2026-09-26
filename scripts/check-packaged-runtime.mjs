// Run with the signed, bundled Node, including from the mounted read-only DMG.
// Check ACP initialization only: never log in or send a model request.
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";

const runtime = resolve(process.argv[2]);
const manifest = JSON.parse(readFileSync(join(runtime, "runtime.json"), "utf8"));
assert.equal(
  realpathSync(process.execPath),
  realpathSync(join(runtime, "bin", process.platform === "win32" ? "node.exe" : "node")),
  "Run this check with the bundled Node",
);
assert.equal(manifest.platform, process.platform);
assert.equal(manifest.arch, process.arch);
assert.equal(manifest.node, process.versions.node);
// Exercise V8's JIT under the signed Node's hardened runtime.
const calculate = new Function("n", "let x = 0; for (let i = 0; i < n; i++) x += i; return x;");
assert.equal(calculate(1_000_000), 499_999_500_000);
const require = createRequire(join(runtime, "package.json"));
const codex = join(dirname(require.resolve("@openai/codex/package.json")), "bin/codex.js");
const version = execFileSync(process.execPath, [codex, "--version"], {
  encoding: "utf8",
  timeout: 30_000,
}).trim();
assert.ok(version.includes(manifest.codex), `Unexpected Codex version: ${version}`);
const home = mkdtempSync(join(tmpdir(), "tanzakoo-acp-check-"));
const child = spawn(process.execPath, [join(runtime, "codex.mjs")], {
  env: { ...process.env, CODEX_HOME: home },
  stdio: ["pipe", "pipe", "pipe"],
  detached: true,
});
const closed = new Promise((resolveClosed) => child.once("close", resolveClosed));
async function stopChild() {
  if (child.pid) {
    try {
      if (process.platform === "win32") {
        execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      } else {
        process.kill(-child.pid, "SIGKILL");
      }
    } catch (error) {
      if (error.code !== "ESRCH" && !(process.platform === "win32" && error.status === 128)) {
        throw error;
      }
    }
  }
  await closed;
}
// Drain stderr without printing possible provider diagnostics into release logs.
child.stderr.resume();
const lines = createInterface({ input: child.stdout });
try {
  await new Promise((resolveReady, reject) => {
    const timeout = setTimeout(() => reject(new Error("ACP initialize timed out")), 30_000);
    const finish = (error) => {
      clearTimeout(timeout);
      if (error) reject(error);
      else resolveReady();
    };
    child.on("error", finish);
    child.stdin.on("error", finish);
    child.on("exit", (code) => finish(new Error(`ACP exited before cleanup (${code})`)));
    lines.on("line", (line) => {
      try {
        const message = JSON.parse(line);
        if (message.id !== 1) return;
        assert.equal(message.error, undefined, "ACP initialize returned an error");
        assert.equal(message.result?.protocolVersion, 1);
        assert.ok(message.result.authMethods?.some((method) => method.id === "chat-gpt"));
        finish();
      } catch (error) {
        finish(error);
      }
    });
    child.stdin.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: 1,
          clientInfo: { name: "tanzakoo-package-check", version: "1" },
        },
      }) + "\n",
    );
  });
} finally {
  lines.close();
  await stopChild();
  rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
console.log(`Packaged Node ${manifest.node}, Codex ${manifest.codex} and ACP initialize passed.`);
