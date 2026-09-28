// Check target selection without controlling a real desktop or mocking screenshots.
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import assert from "node:assert/strict";

const source = readFileSync(new URL("./macos-capture-window.js", import.meta.url), "utf8");
function context(entries) {
  const array = { count: entries.length, objectAtIndex: (i) => entries[i] };
  const ctx = vm.createContext({
    ObjC: { import() {}, unwrap: (value) => value },
    $: {
      NSWorkspace: { sharedWorkspace: { runningApplications: array } },
      NSRunningApplication: { runningApplicationsWithBundleIdentifier: () => array },
      NSApplicationActivateIgnoringOtherApps: 2,
    },
  });
  vm.runInContext(source, ctx);
  return ctx;
}
function app(pid, executable, bundle = null) {
  const url = (path) => ({ isNil: () => path === null, URLByResolvingSymlinksInPath: { path } });
  return {
    processIdentifier: pid,
    executableURL: url(executable),
    bundleURL: url(bundle),
    activateWithOptions() {
      this.activated = true;
    },
  };
}

test("local target matches the exact executable even without a bundle", () => {
  const other = app(11, "/Applications/Tanzakoo.app/Contents/MacOS/tanzakoo");
  const local = app(22, "/clone/src-tauri/target/debug/tanzakoo");
  const ctx = context([other, local]);
  assert.equal(
    JSON.parse(
      ctx.run(["executable", "", "/clone/src-tauri/target/debug/tanzakoo", "activate", ""]),
    ).pid,
    22,
  );
  assert.equal(local.activated, true);
  assert.equal(other.activated, undefined);
});

test("missing, duplicate, and restarted target are rejected before activation", () => {
  const local = app(22, "/clone/tanzakoo");
  assert.throws(
    () => context([local]).run(["executable", "", "/other/tanzakoo", "activate", ""]),
    /exactly one/,
  );
  assert.throws(
    () =>
      context([local, app(23, "/clone/tanzakoo")]).run([
        "executable",
        "",
        "/clone/tanzakoo",
        "activate",
        "",
      ]),
    /exactly one/,
  );
  assert.throws(
    () => context([local]).run(["executable", "", "/clone/tanzakoo", "activate", "21"]),
    /restarted/,
  );
  assert.equal(local.activated, undefined);
});

test("installed mode still selects its bundle path", () => {
  const selected = app(
    22,
    "/Applications/Tanzakoo.app/Contents/MacOS/tanzakoo",
    "/Applications/Tanzakoo.app",
  );
  const ctx = context([app(11, "/clone/tanzakoo"), selected]);
  assert.equal(
    JSON.parse(
      ctx.run(["bundle", "dev.huruikagi.tanzakoo", "/Applications/Tanzakoo.app", "activate", ""]),
    ).pid,
    22,
  );
});
