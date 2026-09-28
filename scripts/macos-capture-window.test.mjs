// Check target selection and permission handling without controlling a desktop.
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

function inspectionContext(granted, imported = false) {
  const ctx = context([app(22, "/clone/tanzakoo")]);
  const calls = { bindings: [], requests: 0, windowReads: 0 };
  const native = {
    CGPreflightScreenCaptureAccess: () => granted,
    CGRequestScreenCaptureAccess: () => {
      calls.requests++;
      return true;
    },
  };
  ctx.ObjC.bindFunction = (name, signature) => {
    assert.deepEqual(JSON.parse(JSON.stringify(signature)), ["bool", []]);
    assert.ok(Object.hasOwn(native, name));
    calls.bindings.push(name);
    ctx.$[name] = native[name];
  };
  if (imported) Object.assign(ctx.$, native);
  ctx.ObjC.deepUnwrap = (value) => value;
  ctx.$.CGWindowListCopyWindowInfo = () => {
    calls.windowReads++;
    return [22, 33].map((pid) => ({
      kCGWindowOwnerPID: pid,
      kCGWindowNumber: pid * 10,
      kCGWindowLayer: 0,
      kCGWindowBounds: { X: 0, Y: 25, Width: 1280, Height: 800 },
    }));
  };
  const frame = { origin: { x: 0, y: 0 }, size: { width: 1440, height: 900 } };
  ctx.$.NSScreen = {
    screens: { count: 1, objectAtIndex: () => ({ frame, visibleFrame: frame }) },
  };
  return { ctx, calls };
}

test("inspection binds the missing preflight API and returns only target windows", () => {
  const { ctx, calls } = inspectionContext(true);
  const result = JSON.parse(ctx.run(["executable", "", "/clone/tanzakoo", "inspect", "22"]));
  assert.deepEqual(calls.bindings, ["CGPreflightScreenCaptureAccess"]);
  assert.equal(calls.requests, 0);
  assert.equal(result.windows.length, 1);
  assert.equal(result.windows[0].id, 220);
  assert.equal(result.displays[0].width, 1440);
});

test("inspection keeps APIs that are already imported", () => {
  const { ctx, calls } = inspectionContext(true, true);
  ctx.run(["executable", "", "/clone/tanzakoo", "inspect", "22"]);
  assert.deepEqual(calls.bindings, []);
  assert.equal(calls.windowReads, 1);
});

test("denied permission requests access and stops before reading windows", () => {
  const { ctx, calls } = inspectionContext(false);
  assert.throws(
    () => ctx.run(["executable", "", "/clone/tanzakoo", "inspect", "22"]),
    /Allow Screen Recording/,
  );
  assert.deepEqual(calls.bindings, [
    "CGPreflightScreenCaptureAccess",
    "CGRequestScreenCaptureAccess",
  ]);
  assert.equal(calls.requests, 1);
  assert.equal(calls.windowReads, 0);
});

test("native binding failure is not treated as granted permission", () => {
  const { ctx, calls } = inspectionContext(true);
  ctx.ObjC.bindFunction = () => {
    throw new Error("Native symbol unavailable");
  };
  assert.throws(
    () => ctx.run(["executable", "", "/clone/tanzakoo", "inspect", "22"]),
    /Native symbol unavailable/,
  );
  assert.equal(calls.windowReads, 0);
});
