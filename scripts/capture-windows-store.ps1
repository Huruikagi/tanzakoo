#Requires -Version 7.0
# Capture the real Windows application; never render a browser mock or resize pixels.
[CmdletBinding()]
param(
    [string]$Executable = (Join-Path $PSScriptRoot '../src-tauri/target/release/tanzakoo.exe'),
    [ValidateSet('ja', 'en')][string[]]$Languages = @('ja', 'en'),
    [ValidateSet('board', 'proposal', 'memory', 'export')][string[]]$Scenes = @('board', 'proposal', 'export'),
    [ValidateRange(1366, 3840)][int]$Width = 1600,
    [ValidateRange(768, 2160)][int]$Height = 1000,
    [string]$Output = (Join-Path $PSScriptRoot '../.local/windows-store-captures'),
    [switch]$Ready,
    [switch]$CheckOnly
)
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'This script requires Windows.' }
if (($Languages | Select-Object -Unique).Count -ne $Languages.Count -or
    ($Scenes | Select-Object -Unique).Count -ne $Scenes.Count) { throw 'Duplicate languages or scenes.' }
if ($Ready -and ($Languages.Count -ne 1 -or $Scenes.Count -ne 1)) {
    throw '-Ready requires exactly one language and one scene, already prepared in the application.'
}
$captureExe = (Resolve-Path -LiteralPath $Executable).Path
if ([IO.Path]::GetFileName($captureExe) -ne 'tanzakoo.exe') { throw 'Select the exact tanzakoo.exe to capture.' }
$captureHash = (Get-FileHash -LiteralPath $captureExe -Algorithm SHA256).Hash.ToLowerInvariant()
Add-Type -AssemblyName System.Drawing
if (-not ('TanzakooStoreCapture' -as [type])) {
    $captureReferences = @('System.Drawing.Common', 'System.Drawing.Primitives', 'System.Collections', 'System.ComponentModel.Primitives', 'Microsoft.Win32.Primitives', 'System.Threading.Thread')
    # .NET 10 splits the Drawing interop types into these assemblies; older hosts do not have them.
    $captureReferences += @(Get-ChildItem (Join-Path $PSHOME 'System.Private.Windows*.dll') | ForEach-Object FullName)
    Add-Type -ReferencedAssemblies $captureReferences -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class TanzakooStoreCapture {
    [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] struct MonitorInfo { public int Size; public Rect Monitor, Work; public uint Flags; }
    public delegate bool EnumProc(IntPtr window, IntPtr param);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback, IntPtr param);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] static extern bool IsWindowEnabled(IntPtr window);
    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr window);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr window, StringBuilder text, int count);
    [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr window, uint command);
    [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr window, out Rect rect);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr window, int command);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll", SetLastError=true)] static extern bool SetWindowPos(IntPtr window, IntPtr after, int x, int y, int width, int height, uint flags);
    [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr window, uint flags);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern bool GetMonitorInfo(IntPtr monitor, ref MonitorInfo info);
    [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr window, IntPtr dc, uint flags);
    [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr window, int attribute, out Rect rect, int size);

    public static IntPtr Find(uint pid) {
        var windows = new List<IntPtr>();
        EnumWindows((window, _) => {
            uint owner; GetWindowThreadProcessId(window, out owner);
            var title = new StringBuilder(512); GetWindowText(window, title, title.Capacity);
            if (owner == pid && IsWindowVisible(window) && GetWindow(window, 4) == IntPtr.Zero && title.ToString() == "Tanzakoo") windows.Add(window);
            return true;
        }, IntPtr.Zero);
        if (windows.Count != 1) throw new InvalidOperationException("Expected exactly one visible Tanzakoo main window; found " + windows.Count);
        return windows[0];
    }
    static void Check(IntPtr window, uint pid) {
        uint actual; GetWindowThreadProcessId(window, out actual);
        if (!IsWindow(window) || actual != pid) throw new InvalidOperationException("The capture window or process changed.");
        if (!IsWindowEnabled(window)) throw new InvalidOperationException("Close the application's modal dialog before capturing.");
    }
    public static int[] Capture(IntPtr window, uint pid, string filename, int width, int height) {
        var previousDpi = SetThreadDpiAwarenessContext(new IntPtr(-4));
        try {
            Check(window, pid);
            ShowWindow(window, 9);
            var monitor = new MonitorInfo { Size = Marshal.SizeOf<MonitorInfo>() };
            if (!GetMonitorInfo(MonitorFromWindow(window, 2), ref monitor)) throw new Win32Exception();
            if (monitor.Work.Right-monitor.Work.Left < width || monitor.Work.Bottom-monitor.Work.Top < height)
                throw new InvalidOperationException("The monitor work area is too small. Choose a smaller capture size or a larger monitor; pixels will not be resampled.");
            var x = monitor.Work.Left + (monitor.Work.Right-monitor.Work.Left-width)/2;
            var y = monitor.Work.Top + (monitor.Work.Bottom-monitor.Work.Top-height)/2;
            if (!SetWindowPos(window, IntPtr.Zero, x, y, width, height, 0x0004)) throw new Win32Exception();
            SetForegroundWindow(window);
            Thread.Sleep(800);
            Check(window, pid);
            if (GetForegroundWindow() != window) throw new InvalidOperationException("Could not activate Tanzakoo. Activate it and retry.");
            Rect outer;
            if (!GetWindowRect(window, out outer)) throw new Win32Exception();
            // Exclude invisible DWM resize borders, preserving all visible window pixels.
            Rect visible;
            if (DwmGetWindowAttribute(window, 9, out visible, Marshal.SizeOf<Rect>()) != 0) visible = outer;
            var ow=outer.Right-outer.Left; var oh=outer.Bottom-outer.Top;
            var crop = new Rectangle(visible.Left-outer.Left, visible.Top-outer.Top, visible.Right-visible.Left, visible.Bottom-visible.Top);
            if (ow!=width || oh!=height || crop.X<0 || crop.Y<0 || crop.Right>ow || crop.Bottom>oh || crop.Width<1366 || crop.Height<768)
                throw new InvalidOperationException("Unexpected window bounds or capture smaller than 1366 x 768. Increase -Width/-Height slightly for window borders.");
            using (var full = new Bitmap(ow, oh, PixelFormat.Format24bppRgb)) {
                using (var graphics = Graphics.FromImage(full)) {
                    var dc = graphics.GetHdc();
                    try { if (!PrintWindow(window, dc, 2)) throw new InvalidOperationException("Windows could not capture the application."); }
                    finally { graphics.ReleaseHdc(dc); }
                }
                using (var result = full.Clone(crop, PixelFormat.Format24bppRgb)) {
                    int min=255, max=0;
                    for(int sy=50;sy<result.Height;sy+=40) for(int sx=20;sx<result.Width;sx+=40) {
                        var c=result.GetPixel(sx,sy); int l=(c.R+c.G+c.B)/3; min=Math.Min(min,l); max=Math.Max(max,l);
                    }
                    if (max-min<12) throw new InvalidOperationException("Capture is blank. No valid screenshot was saved.");
                    // CreateNew prevents replacing an existing image.
                    using(var file = new System.IO.FileStream(filename, System.IO.FileMode.CreateNew)) result.Save(file, ImageFormat.Png);
                    return new [] { result.Width, result.Height };
                }
            }
        } finally { SetThreadDpiAwarenessContext(previousDpi); }
    }
}
'@
}
if ($CheckOnly) { Write-Output 'Capture helper compiled; no window was inspected or changed.'; return }
$captureProcesses = @(Get-Process -Name tanzakoo -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $captureExe })
if ($captureProcesses.Count -ne 1) { throw "Expected one running process for $captureExe; found $($captureProcesses.Count)." }
$captureProcess = $captureProcesses[0]
$capturePid = $captureProcess.Id
$captureStarted = $captureProcess.StartTime.ToUniversalTime().ToString('o')
$captureWindow = [TanzakooStoreCapture]::Find($capturePid)
$parent = [IO.Path]::GetFullPath($Output)
$directory = Join-Path $parent ((Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [Guid]::NewGuid().ToString('N').Substring(0,8))
[IO.Directory]::CreateDirectory($directory) | Out-Null
$checkoutCommit = & git -C (Join-Path $PSScriptRoot '..') rev-parse HEAD 2>$null
$checkoutDirty = & git -C (Join-Path $PSScriptRoot '..') status --porcelain 2>$null
$manifest = [ordered]@{
    kind = 'windows-native-capture'; status = 'in-progress';
    executable = $captureExe; executableSHA256 = $captureHash; pid = $capturePid; processStartedAt = $captureStarted;
    windows = [Environment]::OSVersion.VersionString;
    checkoutAtStart = @{commit=$checkoutCommit; dirty=[bool]$checkoutDirty; isBuildProvenance=$false};
    contentReview = 'pending'; submissionBuildMatch = 'not-verified';
    note = 'Real Windows application. No mock rendering, AI injection, pixel resampling or automatic upload. Visible DWM frame only. Verify final submission build separately.';
    captures = @()
}
function Save-CaptureManifest {
    $json = $manifest | ConvertTo-Json -Depth 8
    [IO.File]::WriteAllText((Join-Path $directory 'manifest.json'), $json + "`n", [Text.UTF8Encoding]::new($false))
}
Save-CaptureManifest
$sceneNumbers = @{board=1; proposal=2; memory=2; export=3}
Write-Output "Capture target: $captureExe (PID $capturePid)`nOutput: $directory"
try {
    foreach ($language in $Languages) {
        foreach ($scene in $Scenes) {
            if (-not $Ready) { Read-Host "Prepare $language / $scene in the app using a public sample project, then press Enter here" | Out-Null }
            $current = Get-Process -Id $capturePid
            if ($current.Path -ne $captureExe -or $current.StartTime.ToUniversalTime().ToString('o') -ne $captureStarted -or
                (Get-FileHash -LiteralPath $captureExe -Algorithm SHA256).Hash.ToLowerInvariant() -ne $captureHash) {
                throw 'Process restarted or executable changed. Start a new capture session.'
            }
            $name = '{0}-{1:00}-{2}-windows.png' -f $language, $sceneNumbers[$scene], $scene
            $file = Join-Path $directory $name
            $pixels = [TanzakooStoreCapture]::Capture($captureWindow, $capturePid, $file, $Width, $Height)
            if ((Get-Item -LiteralPath $file).Length -ge 50MB) { throw 'PNG exceeds the 50 MB limit.' }
            $manifest.captures += @{file=$name; language=$language; scene=$scene; pixels=@($pixels); capturedAt=[DateTime]::UtcNow.ToString('o'); sha256=(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()}
            Save-CaptureManifest
            Write-Output "Saved $file ($($pixels -join 'x'))"
        }
    }
    $manifest.status = 'captured-awaiting-visual-review'
} catch {
    $manifest.status = 'incomplete'
    throw
} finally { Save-CaptureManifest }
Write-Output 'Capture complete. Review every image and compare with the final submission build before uploading.'
