import assert from "node:assert/strict";
import test from "node:test";
import { stopAcpProcess } from "./lib/acp-client.mjs";

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
