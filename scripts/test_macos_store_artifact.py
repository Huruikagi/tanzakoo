import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("artifact", Path(__file__).with_name("fetch-macos-store-artifact.py"))
artifact = importlib.util.module_from_spec(spec)
spec.loader.exec_module(artifact)


class StoreArtifactTests(unittest.TestCase):
    def setUp(self):
        self.run = {"id": 123, "path": ".github/workflows/macos-store.yml", "event": "workflow_dispatch",
                    "conclusion": "success", "head_branch": "main", "head_sha": "a" * 40,
                    "head_repository": {"full_name": "example/app"}}
        self.artifact = {"name": f'Tanzakoo-macos-store-{self.run["head_sha"]}-1', "expired": False}

    def test_only_successful_repository_store_build_is_accepted(self):
        self.assertEqual(artifact.select_artifact(self.run, [self.artifact], "example/app", "123"), self.artifact)
        for key, value in [("path", ".github/workflows/macos-dmg.yml"), ("conclusion", "failure"),
                           ("head_branch", "other"), ("event", "pull_request"),
                           ("head_repository", {"full_name": "other/app"}), ("id", 456)]:
            with self.subTest(key=key), self.assertRaises(ValueError):
                artifact.select_artifact({**self.run, key: value}, [self.artifact], "example/app", "123")

    def test_missing_expired_wrong_source_or_ambiguous_artifact_is_rejected(self):
        for entries in [[], [{**self.artifact, "expired": True}], [self.artifact, self.artifact],
                        [{**self.artifact, "name": "Tanzakoo-macos-store-wrong-1"}]]:
            with self.subTest(entries=entries), self.assertRaises(ValueError):
                artifact.select_artifact(self.run, entries, "example/app", "123")

    def test_checksum_provenance_and_unexpected_files(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            pkg = folder / "Tanzakoo_0.1.0_1_aarch64.pkg"
            pkg.write_bytes(b"fixture, not an Apple package")
            digest = hashlib.sha256(pkg.read_bytes()).hexdigest()
            checksum = folder / (pkg.name + ".sha256")
            checksum.write_text(f"{digest}  {pkg.name}\n")
            provenance = {"commit": self.run["head_sha"], "run": "123", "buildNumber": "1", "reviewAccess": "true"}
            record = folder / "provenance.json"
            record.write_text(json.dumps(provenance))
            self.assertEqual(artifact.verify_package(folder, self.run, self.artifact), (pkg, digest))
            for key, value in [("commit", "b" * 40), ("run", "456"), ("buildNumber", "2"), ("reviewAccess", "unknown")]:
                changed = copy.copy(provenance)
                changed[key] = value
                record.write_text(json.dumps(changed))
                with self.subTest(key=key), self.assertRaises(ValueError):
                    artifact.verify_package(folder, self.run, self.artifact)
            record.write_text(json.dumps(provenance))
            pkg.write_bytes(b"tampered")
            with self.assertRaises(ValueError):
                artifact.verify_package(folder, self.run, self.artifact)
            (folder / "unexpected.p8").write_text("fixture")
            with self.assertRaises(ValueError):
                artifact.verify_package(folder, self.run, self.artifact)


if __name__ == "__main__":
    unittest.main()
