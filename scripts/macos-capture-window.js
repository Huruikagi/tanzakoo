// Run with macOS JavaScript for Automation, not Node.js.
/* global ObjC, $ */
ObjC.import("AppKit");
ObjC.import("CoreGraphics");

// eslint-disable-next-line no-unused-vars -- Entry point invoked by osascript.
function run(argv) {
  const [bundleID, expectedPath, action] = argv;
  if (!bundleID || !expectedPath) throw new Error("Missing application identity");
  const running = $.NSRunningApplication.runningApplicationsWithBundleIdentifier(bundleID);
  if (running.count !== 1) throw new Error("Keep exactly one copy of the selected app running.");
  const app = running.objectAtIndex(0);
  const path = ObjC.unwrap(app.bundleURL.path);
  if (path !== expectedPath) throw new Error("A different copy of this app is running: " + path);
  if (action === "activate") {
    app.activateWithOptions($.NSApplicationActivateIgnoringOtherApps);
    return "{}";
  }
  if (!$.CGPreflightScreenCaptureAccess()) {
    $.CGRequestScreenCaptureAccess();
    throw new Error(
      "Allow Screen Recording for your terminal, restart it if requested, and retry.",
    );
  }
  const windows = ObjC.deepUnwrap(
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
