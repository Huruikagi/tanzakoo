// Run with macOS JavaScript for Automation, not Node.js.
/* global ObjC, $ */
ObjC.import("AppKit");
ObjC.import("CoreGraphics");

function unwrapWindowList(value) {
  // CoreGraphics can return an opaque CFArrayRef instead of an NSArray bridge.
  // deepUnwrap alone leaves that reference intact on newer macOS versions.
  let windows = ObjC.deepUnwrap(value);
  if (!Array.isArray(windows)) windows = ObjC.deepUnwrap(ObjC.castRefToObject(value));
  if (!Array.isArray(windows))
    throw new Error("Could not convert the macOS window list to a JavaScript array.");
  return windows;
}

// eslint-disable-next-line no-unused-vars -- Entry point invoked by osascript.
function run(argv) {
  const [mode, bundleID, expectedPath, action, expectedPID] = argv;
  if (!expectedPath || !["bundle", "executable"].includes(mode))
    throw new Error("Missing application identity");
  const running =
    mode === "bundle"
      ? $.NSRunningApplication.runningApplicationsWithBundleIdentifier(bundleID)
      : $.NSWorkspace.sharedWorkspace.runningApplications;
  const matches = [];
  for (let i = 0; i < running.count; i++) {
    const candidate = running.objectAtIndex(i);
    const url = mode === "bundle" ? candidate.bundleURL : candidate.executableURL;
    if (url.isNil()) continue;
    const path = ObjC.unwrap(url.URLByResolvingSymlinksInPath.path);
    if (path === expectedPath) matches.push(candidate);
  }
  if (matches.length !== 1)
    throw new Error(
      "Keep exactly one app running from the specified path. For --running, start pnpm tauri dev first.",
    );
  const app = matches[0];
  if (expectedPID && app.processIdentifier !== Number(expectedPID))
    throw new Error("The app restarted during capture. Restart the capture script.");
  if (action === "activate") {
    app.activateWithOptions($.NSApplicationActivateIgnoringOtherApps);
    return JSON.stringify({ pid: app.processIdentifier });
  }
  // JXA's framework metadata can omit these newer C functions. Bind their
  // native bool(void) signatures explicitly when import did not expose them.
  if (typeof $.CGPreflightScreenCaptureAccess !== "function")
    ObjC.bindFunction("CGPreflightScreenCaptureAccess", ["bool", []]);
  if (!$.CGPreflightScreenCaptureAccess()) {
    if (typeof $.CGRequestScreenCaptureAccess !== "function")
      ObjC.bindFunction("CGRequestScreenCaptureAccess", ["bool", []]);
    $.CGRequestScreenCaptureAccess();
    throw new Error(
      "Allow Screen Recording for your terminal, restart it if requested, and retry.",
    );
  }
  const windows = unwrapWindowList(
    $.CGWindowListCopyWindowInfo($.kCGWindowListOptionOnScreenOnly, $.kCGNullWindowID),
  );
  const screens = $.NSScreen.screens;
  const primaryFrame = screens.objectAtIndex(0).frame;
  const top = primaryFrame.origin.y + primaryFrame.size.height;
  const displays = [];
  for (let i = 0; i < screens.count; i++) {
    const frame = screens.objectAtIndex(i).visibleFrame;
    displays.push({
      x: frame.origin.x,
      y: top - frame.origin.y - frame.size.height,
      width: frame.size.width,
      height: frame.size.height,
    });
  }
  // Return only this application's window metadata, never other apps' titles.
  return JSON.stringify({
    pid: app.processIdentifier,
    displays,
    windows: windows
      .filter((window) => window.kCGWindowOwnerPID === app.processIdentifier)
      .map((window) => ({
        id: window.kCGWindowNumber,
        layer: window.kCGWindowLayer,
        x: window.kCGWindowBounds.X,
        y: window.kCGWindowBounds.Y,
        width: window.kCGWindowBounds.Width,
        height: window.kCGWindowBounds.Height,
      })),
  });
}
