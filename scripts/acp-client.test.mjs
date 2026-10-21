import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout } from "node:timers/promises";
import test from "node:test";
import { stopAcpProcess } from "./lib/acp-client.mjs";

test("managed startup gate leaves ACP bytes untouched after a partial preamble", async () => {
  const gate = new URL("../packages/agent-runtime/process-gate.mjs", import.meta.url).href;
  const source = `import { waitForProcessJob } from ${JSON.stringify(gate)};
    import { readFileSync } from 'node:fs';
    waitForProcessJob();
    if (process.env.TANZAKOO_ACP_PROCESS_GATE) throw new Error('gate leaked');
    process.stdout.write(readFileSync(0));`;
  for (const input of ["valid", "invalid", "eof", "disabled"]) {
    const child = spawn(process.execPath, ["--input-type=module", "-e", source], {
      env: { ...process.env, TANZAKOO_ACP_PROCESS_GATE: input === "disabled" ? "" : "1" },
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const closed = once(child, "close");
    let output = "";
    child.stdout.on("data", (data) => {
      output += data;
    });
    child.stderr.resume();
    child.stdin.on("error", () => {});
    const frame = '{"jsonrpc":"2.0","id":1}\n';
    if (input === "valid") {
      child.stdin.write("tanzakoo-");
      await setTimeout(25);
      child.stdin.end(`process-ready\n${frame}`);
    } else
      child.stdin.end(input === "invalid" ? "x".repeat(22) : input === "disabled" ? frame : "");
    const [code] = await closed;
    assert.equal(code === 0, input === "valid" || input === "disabled", input);
    assert.equal(output, code === 0 ? frame : "", input);
  }
});

test("ACP cleanup accepts taskkill failure only when the process and pipes close", async () => {
  let close;
  const closed = new Promise((resolve) => {
    close = resolve;
  });
  const child = { pid: 123, exitCode: null };
  await stopAcpProcess(child, closed, (pid) => {
    assert.equal(pid, child.pid);
    // Reproduce a synchronous taskkill failure before Node delivers close.
    setImmediate(close);
    throw Object.assign(new Error("taskkill exit race"), { status: 255 });
  });
});

test("ACP cleanup preserves termination failures when the process does not close", async () => {
  const error = Object.assign(new Error("taskkill failed"), { status: 128 });
  await assert.rejects(
    stopAcpProcess({ pid: 123, exitCode: null }, new Promise(() => {}), () => {
      throw error;
    }),
    (actual) => actual === error,
  );
});

test("ACP cleanup waits for pipe closure without killing an already exited process", async () => {
  let close;
  const closed = new Promise((resolve) => {
    close = resolve;
  });
  let finished = false;
  const stopping = stopAcpProcess({ pid: 123, exitCode: 0 }, closed, () => {
    assert.fail("must not signal an exited process");
  }).then(() => {
    finished = true;
  });
  await Promise.resolve();
  assert.equal(finished, false);
  close();
  await stopping;
  assert.equal(finished, true);
});
