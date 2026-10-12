"""Capture guardrails testable without granting macOS screen access."""

import importlib.util
import json
from pathlib import Path
import plistlib
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("capture", Path(__file__).with_name("capture-macos-store.py"))
capture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(capture)


class CaptureTests(unittest.TestCase):
    def test_running_target_does_not_invent_bundle_version_or_build(self):
        with tempfile.TemporaryDirectory() as temporary:
            executable = Path(temporary) / "tanzakoo"
            executable.write_bytes(b"local executable fixture")
            path, info = capture.running_info(executable)
            self.assertEqual(path, executable.resolve())
            self.assertEqual(info["targetMode"], "executable")
            self.assertIsNone(info["bundleID"])
            self.assertIsNone(info["version"])
            self.assertIsNone(info["build"])
            with self.assertRaises(ValueError):
                capture.running_info(Path(temporary))
            other = Path(temporary) / "another-app"
            other.write_bytes(b"other")
            with self.assertRaises(ValueError):
                capture.running_info(other)

    def test_attach_only_and_reject_process_restart(self):
        info = {"targetMode": "executable", "bundleID": None}
        path = Path("clone/src-tauri/target/debug/tanzakoo")
        with patch.object(capture, "command", side_effect=['{"pid": 20}', '{"pid": 21}']) as run:
            capture.start_target(path, info)
            arguments = run.call_args.args[0]
            self.assertEqual(arguments[0], "/usr/bin/osascript")
            self.assertEqual(arguments[4:8], ["executable", "", path, "activate"])
            self.assertEqual(info["capturePID"], 20)
            with self.assertRaises(ValueError):
                capture.inspect(path, info)
            self.assertEqual(run.call_args.args[0][-1], 20)

    def test_rebuilt_local_executable_stops_before_capture(self):
        with tempfile.TemporaryDirectory() as temporary:
            executable = Path(temporary) / "tanzakoo"
            executable.write_bytes(b"first build")
            path, info = capture.running_info(executable)
            executable.write_bytes(b"new build")
            output = Path(temporary) / "image.jpg"
            with patch.object(capture, "prepare_window") as prepare:
                with self.assertRaises(ValueError):
                    capture.capture(path, info, output, 1280, 800)
                prepare.assert_not_called()
            self.assertFalse(output.exists())

    def test_missing_git_keeps_checkout_provenance_unknown(self):
        with patch.object(capture, "command", side_effect=FileNotFoundError("git")):
            self.assertIsNone(capture.checkout_context())
        with patch.object(capture, "command", side_effect=["a" * 40, " M src/App.tsx"]):
            self.assertEqual(capture.checkout_context(), {"commit": "a" * 40, "dirty": True, "isBuildProvenance": False})

    def test_refuses_wrong_app_and_executable_path_escape(self):
        with tempfile.TemporaryDirectory() as temporary:
            app = Path(temporary) / "Example.app"
            (app / "Contents/MacOS").mkdir(parents=True)
            (app / "Contents/MacOS/tanzakoo").write_bytes(b"fixture")
            plist = app / "Contents/Info.plist"
            base = {"CFBundleIdentifier": "dev.huruikagi.tanzakoo", "CFBundleExecutable": "tanzakoo", "CFBundleVersion": "2"}
            plist.write_bytes(plistlib.dumps(base))
            self.assertEqual(capture.app_info(app)[1]["build"], "2")
            for invalid in [{**base, "CFBundleIdentifier": "com.example.other"}, {**base, "CFBundleExecutable": "../outside"}]:
                plist.write_bytes(plistlib.dumps(invalid))
                with self.assertRaises(ValueError):
                    capture.app_info(app)

    def test_refuses_missing_or_ambiguous_main_window(self):
        main = {"id": 7, "layer": 0, "width": 1280, "height": 800}
        overlay = {"id": 8, "layer": 3, "width": 1280, "height": 800}
        self.assertEqual(capture.select_window({"windows": [main, overlay]})["id"], 7)
        for windows in [[], [main, {**main, "id": 9}]]:
            with self.assertRaises(ValueError):
                capture.select_window({"windows": windows})

    def test_placement_uses_current_monitor_and_rejects_insufficient_space(self):
        displays = [{"x": 0, "y": 25, "width": 1512, "height": 920}, {"x": -1920, "y": 25, "width": 1920, "height": 1055}]
        window = {"x": -1800, "y": 50, "width": 1440, "height": 900}
        self.assertEqual(capture.placement(window, displays, 1280, 800), (-1600, 152))
        with self.assertRaises(ValueError):
            capture.placement(window, [{"x": -1920, "y": 25, "width": 1280, "height": 775}], 1280, 800)

    def test_rejects_alpha_and_non_store_dimensions(self):
        valid = "image.jpg\n  pixelWidth: 2560\n  pixelHeight: 1600\n  format: jpeg\n  hasAlpha: no\n"
        self.assertEqual(capture.parse_image_info(valid), (2560, 1600))
        for text in [valid.replace("hasAlpha: no", "hasAlpha: yes"), valid.replace("2560", "1920"), valid.replace("jpeg", "png")]:
            with self.assertRaises(ValueError):
                capture.parse_image_info(text)

    def test_failed_capture_is_not_left_as_submission_image_and_existing_file_is_preserved(self):
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "ja-01-board.jpg"
            prepared = ({"pid": 99}, {"id": 7})
            with patch.object(capture, "prepare_window", return_value=prepared), patch.object(capture, "command", side_effect=OSError("denied")):
                with self.assertRaises(OSError):
                    capture.capture(Path("app"), {}, output, 1280, 800)
                self.assertFalse(output.exists())
                self.assertTrue(output.with_suffix(".rejected.jpg").exists())
                output.write_bytes(b"keep")
                with self.assertRaises(FileExistsError):
                    capture.capture(Path("app"), {}, output, 1280, 800)
                self.assertEqual(output.read_bytes(), b"keep")

    def test_records_native_dimensions_without_resampling_and_retains_review_status(self):
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "en-01-board.jpg"
            def run(arguments):
                if arguments[0] == "/usr/sbin/screencapture":
                    self.assertIn("-l", arguments)
                    output.write_bytes(b"capture fixture")
                    return ""
                self.assertEqual(arguments[0], "/usr/bin/sips")
                self.assertNotIn("-z", arguments)
                return "  pixelWidth: 2560\n  pixelHeight: 1600\n  format: jpeg\n  hasAlpha: no\n"
            with patch.object(capture, "prepare_window", return_value=({"pid": 99}, {"id": 7})), patch.object(capture, "command", side_effect=run):
                shot = capture.capture(Path("app"), {}, output, 1280, 800)
            self.assertEqual(shot["pixels"], [2560, 1600])
            manifest = {"contentReview": "pending", "captures": [shot]}
            capture.save_manifest(Path(temporary), manifest)
            self.assertEqual(json.loads((Path(temporary) / "manifest.json").read_text())["contentReview"], "pending")


if __name__ == "__main__":
    unittest.main()
