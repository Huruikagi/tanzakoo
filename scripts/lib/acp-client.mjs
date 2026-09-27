import { spawn, execFileSync } from "node:child_process";
import { createInterface } from "node:readline";

function killTree(pid) {
  if (process.platform === "win32")
    execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
  else process.kill(-pid, "SIGKILL");
}

// taskkill can report a tree member's exit race after terminating the adapter.
// Accept that only after the child's close event (including its pipes), never
// merely because taskkill returned a particular Windows/localized status code.
export async function stopAcpProcess(child, closed, terminate = killTree) {
  if (child.pid && child.exitCode === null) {
    try {
      terminate(child.pid);
    } catch (error) {
      let timer;
      try {
        const didClose = await Promise.race([
          closed.then(() => true),
          new Promise((resolve) => {
            timer = setTimeout(() => resolve(false), 1000);
          }),
        ]);
        if (!didClose) throw error;
      } finally {
        clearTimeout(timer);
      }
    }
  }
  await closed;
}

// Test-only client for the real, pinned adapter. Never prints provider diagnostics.
export function startAcp({ entry, home, cwd, env = {}, onRequest = () => null }) {
  const childEnv = { ...process.env, ...env, CODEX_HOME: home, INITIAL_AGENT_MODE: "read-only" };
  for (const key of [
    "OPENAI_API_KEY",
    "CODEX_API_KEY",
    "CODEX_ACCESS_TOKEN",
    "OPENAI_BASE_URL",
    "CODEX_CONFIG",
    "MODEL_PROVIDER",
    "DEFAULT_AUTH_REQUEST",
    "APP_SERVER_LOGS",
    "NODE_OPTIONS",
    "CODEX_PATH",
  ])
    delete childEnv[key];
  const child = spawn(process.execPath, [entry], {
    cwd,
    env: childEnv,
    windowsHide: true,
    detached: process.platform !== "win32",
    stdio: ["pipe", "pipe", "pipe"],
  });
  const pending = new Map();
  const notifications = [];
  let next = 0;
  let stderr = "";
  let stopped = false;
  child.stderr.on("data", (chunk) => {
    stderr = (stderr + chunk).slice(-32_000);
  });
  const fail = () => {
    for (const entry of pending.values()) entry.reject(new Error("ACP process closed"));
    pending.clear();
  };
  const closed = new Promise((done) =>
    child.once("close", () => {
      fail();
      done();
    }),
  );
  child.on("error", fail);
  child.stdin.on("error", fail);
  const send = (message) =>
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\n");
  const lines = createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    try {
      const message = JSON.parse(line);
      if (message.method && message.id !== undefined) {
        Promise.resolve(onRequest(message))
          .then((result) => {
            send({ id: message.id, result });
          })
          .catch(() =>
            send({ id: message.id, error: { code: -32603, message: "Fixture rejected request" } }),
          );
      } else if (message.id !== undefined) {
        const entry = pending.get(message.id);
        pending.delete(message.id);
        if (message.error)
          entry?.reject(new Error(`ACP error ${message.error.code}: ${message.error.message}`));
        else entry?.resolve(message.result);
      } else notifications.push(message);
    } catch {
      fail();
    }
  });
  return {
    notifications,
    diagnostics: () => stderr,
    notify: (method, params) => send({ method, params }),
    request(method, params, timeoutMs = 25_000) {
      return new Promise((resolve, reject) => {
        const id = ++next;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`ACP ${method} timed out`));
        }, timeoutMs);
        pending.set(id, {
          resolve: (value) => {
            clearTimeout(timer);
            resolve(value);
          },
          reject: (error) => {
            clearTimeout(timer);
            reject(error);
          },
        });
        send({ id, method, params });
      });
    },
    async stop() {
      if (stopped) return;
      stopped = true;
      lines.close();
      await stopAcpProcess(child, closed);
    },
  };
}
