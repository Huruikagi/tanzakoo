import importlib.util
import hashlib
from pathlib import Path
import tempfile
import unittest
import xml.etree.ElementTree as ET
import zipfile

spec = importlib.util.spec_from_file_location("windows_store", Path(__file__).with_name("package-windows-store.py"))
pack = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pack)


class WindowsStoreTests(unittest.TestCase):
    def test_store_identity_is_required_and_not_inferred(self):
        for identity in ({}, {"name": "Tanzakoo"}, {**pack.VALIDATION_IDENTITY, "publisher": None}, {**pack.VALIDATION_IDENTITY, "name": "../escape"}):
            with self.assertRaises(ValueError):
                pack.identity_values(identity)

    def test_xml_escapes_publisher_and_preserves_exact_identity(self):
        identity = {"name": "12345.Example", "publisher": "CN=Example & Company", "publisherDisplayName": "A & B"}
        root = ET.fromstring(pack.manifest(identity, "1.2.3.0"))
        ns = {"f": pack.FOUNDATION, "r": pack.RESCAP}
        self.assertEqual(root.find("f:Identity", ns).get("Publisher"), identity["publisher"])
        self.assertEqual(root.find("f:Applications/f:Application", ns).get("Executable"), "tanzakoo.exe")
        self.assertEqual(root.find("f:Capabilities/r:Capability", ns).get("Name"), "runFullTrust")

    def test_store_version_constraints(self):
        for version in ("0.1.0.0", "1.0.0", "1.0.0.1", "1.65536.0.0", "01.0.0.0", "1.0.-1.0"):
            with self.assertRaises(ValueError):
                pack.package_version(version)
        self.assertEqual(pack.package_version("1.2.3.0"), "1.2.3.0")

    def test_rejects_non_executable_and_wrong_architecture(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "app.exe"
            for data in (b"text", b"MZ" + bytes(62)):
                path.write_bytes(data)
                with self.assertRaises(ValueError):
                    pack.require_x64(path)

    def test_validation_package_is_visibly_distinct(self):
        data = pack.manifest(pack.VALIDATION_IDENTITY, "1.0.0.0", True)
        self.assertIn(b"Tanzakoo Packaging Validation", data)
        self.assertIn(b"LocalPackagingValidation", data)

    def test_payload_verification_decodes_opc_paths_and_rejects_changes(self):
        with tempfile.TemporaryDirectory() as folder:
            archive = Path(folder) / "example.msix"
            with zipfile.ZipFile(archive, "w") as stream:
                stream.writestr("agent-runtime/node_modules/%40openai/test", b"original")
            files = {"agent-runtime/node_modules/@openai/test": hashlib.sha256(b"original").hexdigest()}
            pack.verify_payload(archive, files)
            for bad in ({"missing": files[next(iter(files))]}, {next(iter(files)): "bad"}):
                with self.assertRaises(ValueError):
                    pack.verify_payload(archive, bad)


if __name__ == "__main__":
    unittest.main()
