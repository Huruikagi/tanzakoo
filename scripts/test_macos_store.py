"""Failure-boundary tests without Apple credentials or macOS tools."""

import copy
import datetime
import hashlib
import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("prepare", Path(__file__).with_name("prepare-macos-store.py"))
prepare = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prepare)


class ProvisioningTests(unittest.TestCase):
    def setUp(self):
        self.now = datetime.datetime(2026, 9, 27, tzinfo=datetime.timezone.utc)
        self.bundle = "dev.huruikagi.tanzakoo"
        self.cert = b"fixture certificate, not a real signing identity"
        self.digest = hashlib.sha1(self.cert).hexdigest()
        self.template = {"com.apple.security.app-sandbox": True, "com.apple.security.network.client": True}
        self.profile = {
            "ExpirationDate": datetime.datetime(2027, 9, 27),
            "Platform": ["OSX"],
            "TeamIdentifier": ["TEAM123456"],
            # Legacy App ID prefixes can differ from Team ID.
            "ApplicationIdentifierPrefix": ["OLD1234567"],
            "DeveloperCertificates": [self.cert],
            "Entitlements": {
                "com.apple.application-identifier": f"OLD1234567.{self.bundle}",
                "com.apple.developer.team-identifier": "TEAM123456",
                "get-task-allow": False,
            },
        }

    def validate(self, profile=None):
        return prepare.signing_entitlements(
            profile or self.profile, self.bundle, self.digest, self.template, self.now,
        )

    def test_preserves_prefix_and_only_requested_grants(self):
        self.profile["Entitlements"]["keychain-access-groups"] = ["*"]
        result = self.validate()
        self.assertEqual(result["com.apple.application-identifier"], f"OLD1234567.{self.bundle}")
        self.assertEqual(result["com.apple.developer.team-identifier"], "TEAM123456")
        self.assertNotIn("keychain-access-groups", result)
        self.assertTrue(result["com.apple.security.network.client"])

    def test_rejects_expired_other_platform_and_device_profiles(self):
        for key, value in [
            ("ExpirationDate", self.now), ("Platform", ["iOS"]),
            ("ProvisionedDevices", []), ("ProvisionsAllDevices", True),
            ("DeveloperCertificates", [b"another certificate"]),
            ("TeamIdentifier", ["OTHER12345"]),
        ]:
            with self.subTest(key=key):
                profile = copy.deepcopy(self.profile)
                profile[key] = value
                with self.assertRaises(ValueError):
                    self.validate(profile)

    def test_rejects_wrong_app_wildcard_debug_and_team(self):
        for key, value in [
            ("com.apple.application-identifier", "OLD1234567.dev.other.app"),
            ("com.apple.application-identifier", "OLD1234567.*"),
            ("get-task-allow", True), ("com.apple.security.get-task-allow", True),
            ("com.apple.developer.team-identifier", "OTHER12345"),
        ]:
            with self.subTest(key=key, value=value):
                profile = copy.deepcopy(self.profile)
                profile["Entitlements"][key] = value
                with self.assertRaises(ValueError):
                    self.validate(profile)

    def test_rejects_missing_sandbox_or_parent_inheritance(self):
        self.template["com.apple.security.app-sandbox"] = False
        with self.assertRaises(ValueError):
            self.validate()
        self.template["com.apple.security.app-sandbox"] = True
        self.template["com.apple.security.inherit"] = True
        with self.assertRaises(ValueError):
            self.validate()


if __name__ == "__main__":
    unittest.main()
