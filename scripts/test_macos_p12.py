"""Exercise P12 conversion using a disposable identity, never user credentials."""

import importlib.util
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("p12", Path(__file__).with_name("macos-store-p12.py"))
p12 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p12)


class P12Tests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.folder = tempfile.TemporaryDirectory(prefix="tanzakoo-p12-test-")
        cls.root = Path(cls.folder.name)
        cls.openssl = p12.openssl_path()
        if not cls.openssl and os.name == "nt":
            cls.openssl = "C:/Program Files/Git/usr/bin/openssl.exe"
        cls.password_env = "TANZAKOO_P12_TEST_PASSWORD"
        cls.environment = patch.dict(os.environ, {cls.password_env: "test-only-p12-password"})
        cls.environment.start()
        cls.addClassCleanup(cls.environment.stop)
        cls.addClassCleanup(cls.folder.cleanup)
        (cls.root / "empty.cnf").write_text("", encoding="utf-8")
        cls.run_openssl("req", "-x509", "-newkey", "rsa:2048", "-noenc",
                        "-config", str(cls.root / "empty.cnf"), "-subj", "/CN=Tanzakoo Disposable Test",
                        "-keyout", str(cls.root / "key.pem"), "-out", str(cls.root / "cert.pem"))
        cls.run_openssl("req", "-x509", "-newkey", "rsa:2048", "-noenc",
                        "-config", str(cls.root / "empty.cnf"), "-subj", "/CN=Tanzakoo Extra Chain Fixture",
                        "-keyout", str(cls.root / "extra.key.pem"), "-out", str(cls.root / "extra.cert.pem"))
        cls.run_openssl("pkcs12", "-export", "-inkey", str(cls.root / "key.pem"),
                        "-in", str(cls.root / "cert.pem"), "-out", str(cls.root / "source.p12"),
                        "-certfile", str(cls.root / "extra.cert.pem"),
                        "-passout", f"env:{cls.password_env}")

    @classmethod
    def run_openssl(cls, *args):
        return subprocess.run([cls.openssl, *args], capture_output=True, check=True)

    def test_conversion_preserves_identity_and_uses_mac_compatible_algorithms(self):
        output = self.root / "converted.p12"
        p12.prepare_p12(self.root / "source.p12", self.password_env, output, self.openssl)
        info = self.run_openssl("pkcs12", "-in", str(output), "-passin", f"env:{self.password_env}", "-info", "-noout")
        self.assertIn(b"MAC: sha1", info.stderr)
        self.assertIn(b"pbeWithSHA1And3-KeyTripleDES-CBC", info.stderr)
        contents = self.run_openssl("pkcs12", "-in", str(output), "-passin", f"env:{self.password_env}", "-noenc")
        self.assertIn((self.root / "cert.pem").read_bytes().strip(), contents.stdout)
        self.assertIn((self.root / "extra.cert.pem").read_bytes().strip(), contents.stdout)
        self.assertIn((self.root / "key.pem").read_bytes().strip(), contents.stdout)
        self.assertEqual(list(self.root.glob("p12-convert-*")), [])

    def test_wrong_password_fails_before_creating_output(self):
        output = self.root / "bad-password.p12"
        with patch.dict(os.environ, {self.password_env: "wrong-test-password"}):
            with self.assertRaisesRegex(ValueError, "could not process"):
                p12.prepare_p12(self.root / "source.p12", self.password_env, output, self.openssl)
        self.assertFalse(output.exists())
        self.assertEqual(list(self.root.glob("p12-convert-*")), [])

    def test_check_only_does_not_extract_a_key(self):
        before = set(self.root.iterdir())
        p12.prepare_p12(self.root / "source.p12", self.password_env, openssl=self.openssl)
        self.assertEqual(set(self.root.iterdir()), before)

    def test_existing_output_is_preserved(self):
        output = self.root / "existing.p12"
        output.write_bytes(b"keep this file")
        with self.assertRaisesRegex(ValueError, "overwrite"):
            p12.prepare_p12(self.root / "source.p12", self.password_env, output, self.openssl)
        self.assertEqual(output.read_bytes(), b"keep this file")


if __name__ == "__main__":
    unittest.main()
