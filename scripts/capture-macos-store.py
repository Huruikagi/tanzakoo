#!/usr/bin/env python3
"""Interactive capture of an installed Tanzakoo window. Python standard library only."""

import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import platform
import plistlib
import re
import subprocess
import sys
import tempfile
import time

HERE = Path(__file__).resolve().parent
SIZES = {(1280, 800), (1440, 900), (2560, 1600), (2880, 1800)}
APP_IDS = {"dev.huruikagi.tanzakoo", "dev.huruikagi.tanzakoo.sandbox-test"}
SCENES = {
    "board": "AIチャットを閉じ、撮影用ボードの4列とカード詳細を表示。ペイン境界を動かして4列を収めます。",
    "proposal": "撮影用カードの保留提案と会話を表示。差分・適用ボタンが見える位置へスクロール。まだ適用しません。",
    "export": "「決めたこと」にカードを置き、エクスポートの確認画面を開きます。保存先ダイアログは開きません。",
}
RESIZE_SCRIPT = """
on run argv
  set targetPID to (item 1 of argv) as integer
  set targetX to (item 2 of argv) as integer
  set targetY to (item 3 of argv) as integer
  set targetWidth to (item 4 of argv) as integer
  set targetHeight to (item 5 of argv) as integer
  tell application "System Events"
    tell first application process whose unix id is targetPID
      if (count of windows) is not 1 then error "Close extra windows and native dialogs first."
      set frontmost to true
      set position of window 1 to {targetX, targetY}
      set size of window 1 to {targetWidth, targetHeight}
    end tell
  end tell
end run
"""


def command(arguments, *, timeout=30):
    result = subprocess.run(
        [str(value) for value in arguments], check=True, capture_output=True,
        text=True, timeout=timeout, env={**os.environ, "LC_ALL": "C"},
    )
    return result.stdout.strip()


def app_info(path):
    path = path.expanduser().resolve(strict=True)
    with (path / "Contents/Info.plist").open("rb") as stream:
        info = plistlib.load(stream)
    if info.get("CFBundleIdentifier") not in APP_IDS:
        raise ValueError("TanzakooまたはTanzakoo Sandboxの.appを指定してください。")
    executable_name = info.get("CFBundleExecutable", "")
    if not executable_name or Path(executable_name).name != executable_name:
        raise ValueError("Invalid CFBundleExecutable")
    executable = (path / "Contents/MacOS" / executable_name).resolve(strict=True)
    if path not in executable.parents or not executable.is_file():
        raise ValueError("Executable is outside the app bundle")
    return path, {
        "bundleID": info["CFBundleIdentifier"],
        "version": str(info.get("CFBundleShortVersionString", "")),
        "build": str(info.get("CFBundleVersion", "")),
        "executableSHA256": hashlib.sha256(executable.read_bytes()).hexdigest(),
    }


def select_window(state):
    candidates = [w for w in state["windows"] if w["layer"] == 0 and w["width"] >= 400 and w["height"] >= 300]
    if len(candidates) != 1:
        raise ValueError("Tanzakooの通常ウィンドウを1枚だけ表示し、最小化・全画面表示・別のダイアログを解除してください。")
    return candidates[0]


def placement(window, displays, width, height):
    def overlap(display):
        x = max(0, min(window["x"] + window["width"], display["x"] + display["width"]) - max(window["x"], display["x"]))
        y = max(0, min(window["y"] + window["height"], display["y"] + display["height"]) - max(window["y"], display["y"]))
        return x * y
    display = max(displays, key=overlap)
    if overlap(display) == 0 or display["width"] < width or display["height"] < height:
        raise ValueError(f"このディスプレイの作業領域に{width}×{height}が収まりません。ウィンドウを広い画面へ移すか、ディスプレイ設定で表示領域を広げてください。")
    return round(display["x"] + (display["width"] - width) / 2), round(display["y"] + (display["height"] - height) / 2)


def inspect(path, info, action="inspect"):
    return json.loads(command(["/usr/bin/osascript", "-l", "JavaScript", HERE / "macos-capture-window.js", info["bundleID"], path, action]))


def prepare_window(path, info, width, height):
    inspect(path, info, "activate")
    time.sleep(0.3)
    state = inspect(path, info)
    window = select_window(state)
    x, y = placement(window, state["displays"], width, height)
    command(["/usr/bin/osascript", "-e", RESIZE_SCRIPT, state["pid"], x, y, width, height])
    time.sleep(0.5)
    state = inspect(path, info)
    window = select_window(state)
    if (window["width"], window["height"]) != (width, height):
        raise ValueError("ウィンドウが指定サイズになりませんでした。全画面表示を解除して再試行してください。")
    return state, window


def parse_image_info(text):
    values = dict(re.findall(r"^\s+(pixelWidth|pixelHeight|format|hasAlpha):\s*(\S+)\s*$", text, flags=re.MULTILINE))
    if values.get("format") != "jpeg" or values.get("hasAlpha") != "no":
        raise ValueError("不透明なJPEGとして保存できませんでした。画像を確認してください。")
    size = (int(values["pixelWidth"]), int(values["pixelHeight"]))
    if size not in SIZES:
        raise ValueError(f"Apple指定外の画像サイズ: {size}。拡大・引き伸ばしは行いません。")
    return size


def capture(path, info, output, width, height):
    state, window = prepare_window(path, info, width, height)
    # Reserve a new filename. Never overwrite an existing capture.
    output.touch(exist_ok=False)
    try:
        command(["/usr/sbin/screencapture", "-x", "-o", "-t", "jpg", "-l", window["id"], output])
        size = parse_image_info(command(["/usr/bin/sips", "-g", "pixelWidth", "-g", "pixelHeight", "-g", "format", "-g", "hasAlpha", output]))
        if size not in {(width, height), (width * 2, height * 2)}:
            raise ValueError("ウィンドウの論理サイズと画像のピクセルサイズが対応しません。")
        return {
            "file": output.name, "pixels": list(size), "windowPoints": [width, height],
            "windowID": window["id"], "pid": state["pid"],
            "sha256": hashlib.sha256(output.read_bytes()).hexdigest(),
            "capturedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        }
    except BaseException:
        # Keep failed output for diagnosis, but never present it as a valid shot.
        output.rename(output.with_suffix(".rejected.jpg"))
        raise


def save_manifest(directory, manifest):
    temporary = directory / "manifest.json.tmp"
    temporary.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(directory / "manifest.json")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--app", type=Path, required=True, help="Installed .app, e.g. /Applications/Tanzakoo.app")
    parser.add_argument("--languages", nargs="+", choices=["ja", "en"], default=["ja", "en"])
    parser.add_argument("--scenes", nargs="+", choices=list(SCENES), default=list(SCENES))
    parser.add_argument("--size", choices=["1280x800", "1440x900"], default="1280x800", help="Logical window size, no resampling")
    parser.add_argument("--output", type=Path, default=HERE.parent / ".local/mac-store-captures", help="Parent directory; each run creates a new subdirectory")
    parser.add_argument("--expected-version")
    parser.add_argument("--expected-build")
    args = parser.parse_args()
    if platform.system() != "Darwin":
        parser.error("この撮影スクリプトはMac専用です。")
    if not sys.stdin.isatty():
        parser.error("Terminalから対話形式で実行してください。")
    path, info = app_info(args.app)
    for key, expected in [("version", args.expected_version), ("build", args.expected_build)]:
        if expected is not None and info[key] != expected:
            parser.error(f"対象の{key}が違います: expected {expected}, actual {info[key]}")
    if len(set(args.languages)) != len(args.languages) or len(set(args.scenes)) != len(args.scenes):
        parser.error("同じ言語・画面を重複指定しないでください。")
    width, height = map(int, args.size.split("x"))
    args.output.mkdir(parents=True, exist_ok=True)
    directory = Path(tempfile.mkdtemp(prefix=dt.datetime.now().strftime("%Y%m%d-%H%M%S-"), dir=args.output.resolve()))
    sandbox = info["bundleID"].endswith(".sandbox-test")
    manifest = {
        "app": info, "macOS": platform.mac_ver(), "kind": "sandbox-preview" if sandbox else "native-capture",
        "contentReview": "pending", "submissionBuildMatch": "not-verified",
        "note": "Real installed app window. The capture script does not inject data, call AI, or resample images. Inspect images and match the final submission build before use.",
        "status": "in-progress", "captures": [],
    }
    save_manifest(directory, manifest)
    print(f"対象: {path}\nVersion {info['version']} / Build {info['build']}\n保存先: {directory}", flush=True)
    print("普段のプロジェクトではなく、撮影用プロジェクトを画面で用意してください。DB・認証・アプリ本体は変更しません。")
    print("Macから求められた場合、Terminalの画面収録・アクセシビリティ・System Eventsの操作を許可してください。")
    if sandbox:
        print("Sandbox検証版のため、画像名にsandbox-previewを付けます。提出用ビルドの画像としては扱いません。")
    try:
        command(["/usr/bin/open", "-a", path])
        input("アプリが開いたらEnter。Ctrl+Cで中止できます: ")
        prepare_window(path, info, width, height)
        for language in args.languages:
            display_language = "日本語" if language == "ja" else "English"
            print(f"\n設定の表示言語を {display_language} にし、同じ言語の撮影用プロジェクトを選んでください。")
            for scene in args.scenes:
                index = list(SCENES).index(scene) + 1
                print(f"\n{language} {index}: {SCENES[scene]}")
                print("個人情報・審査コード・エラー・開発用表示が写らないことを確認してください。")
                input("画面を整えたら、このTerminalに戻ってEnterで撮影: ")
                suffix = "-sandbox-preview" if sandbox else ""
                output = directory / f"{language}-{index:02d}-{scene}{suffix}.jpg"
                shot = capture(path, info, output, width, height)
                manifest["captures"].append({**shot, "language": language, "scene": scene})
                save_manifest(directory, manifest)
                print(f"保存: {output.name} ({shot['pixels'][0]}×{shot['pixels'][1]})", flush=True)
        manifest["status"] = "captured-awaiting-visual-review"
        save_manifest(directory, manifest)
        print(f"\n撮影完了: {directory}\n画像を目視し、最終提出ビルドとの一致を確認してください。アップロードはしていません。")
        command(["/usr/bin/open", directory])
    except BaseException:
        manifest["status"] = "incomplete"
        save_manifest(directory, manifest)
        raise


if __name__ == "__main__":
    try:
        main()
    except (KeyboardInterrupt, EOFError):
        print("\n撮影を中止しました。保存済み画像とアプリのデータは残しています。", file=sys.stderr)
        sys.exit(130)
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        detail = getattr(error, "stderr", None) or str(error)
        print(f"撮影できませんでした: {detail}\n権限を許可した後にTerminalを再起動し、アプリの全画面表示を解除して再試行してください。", file=sys.stderr)
        sys.exit(1)
