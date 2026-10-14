import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("public_build", Path(__file__).with_name("check-public-build.py"))
policy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(policy)


class PublicBuildTests(unittest.TestCase):
    def test_personal_unknown_and_mixed_binaries_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            binary = Path(directory) / "app"
            for data in (b"unknown", b"TANZAKOO_PERSONAL_BUILD_V1", b"TANZAKOO_PUBLIC_BUILD_V1 TANZAKOO_PERSONAL_BUILD_V1"):
                binary.write_bytes(data)
                with self.assertRaises(ValueError):
                    policy.require_public_build(binary)
            binary.write_bytes(b"header TANZAKOO_PUBLIC_BUILD_V1 trailer")
            policy.require_public_build(binary)
