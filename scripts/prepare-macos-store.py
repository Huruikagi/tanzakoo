"""Validate a decoded Mac App Store profile and derive signing entitlements.

Uses only Python's standard library. The caller decodes the signed CMS with
security cms, then embeds the original CMS, never this decoded plist.
"""

import argparse
import datetime
import hashlib
import plistlib
import re
from pathlib import Path


def signing_entitlements(profile, bundle_id, certificate_sha1, template, now=None):
    now = now or datetime.datetime.now(datetime.timezone.utc)
    expiry = profile.get("ExpirationDate")
    if not isinstance(expiry, datetime.datetime):
        raise ValueError("Profile expiration is missing")
    if expiry.replace(tzinfo=datetime.timezone.utc) <= now:
        raise ValueError("Profile has expired")
    if "OSX" not in profile.get("Platform", []):
        raise ValueError("Expected a macOS provisioning profile")
    if "ProvisionedDevices" in profile or profile.get("ProvisionsAllDevices"):
        raise ValueError("Expected Mac App Store Connect distribution profile")
    allowed = profile.get("Entitlements", {})
    if allowed.get("get-task-allow") or allowed.get("com.apple.security.get-task-allow"):
        raise ValueError("Development/debug profiles are not accepted")
    teams = profile.get("TeamIdentifier", [])
    if len(teams) != 1 or not re.fullmatch(r"[A-Z0-9]{10}", teams[0]):
        raise ValueError("Expected one Team ID")
    team = teams[0]
    if allowed.get("com.apple.developer.team-identifier") != team:
        raise ValueError("Profile Team ID does not match its entitlements")
    app_id = allowed.get("com.apple.application-identifier", "")
    prefixes = profile.get("ApplicationIdentifierPrefix", [])
    if not any(app_id == f"{prefix}.{bundle_id}" for prefix in prefixes):
        raise ValueError("Profile must explicitly match the application Bundle ID")
    if "*" in app_id:
        raise ValueError("Wildcard App IDs are not accepted")
    hashes = {hashlib.sha1(cert).hexdigest().upper() for cert in profile.get("DeveloperCertificates", [])}
    if certificate_sha1.upper() not in hashes:
        raise ValueError("Signing certificate is not authorized by this profile")
    # A profile authorizes restricted entitlements, not every Sandbox file/network
    # entitlement. Preserve the reviewed parent template; do not import all grants.
    if template.get("com.apple.security.app-sandbox") is not True:
        raise ValueError("Parent must enable App Sandbox")
    if template.get("com.apple.security.inherit"):
        raise ValueError("Parent must not inherit a child's sandbox")
    return {
        **template,
        "com.apple.application-identifier": app_id,
        "com.apple.developer.team-identifier": team,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("profile", type=Path)
    parser.add_argument("bundle_id")
    parser.add_argument("certificate_sha1")
    parser.add_argument("template", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    try:
        entitlements = signing_entitlements(
            plistlib.loads(args.profile.read_bytes()), args.bundle_id,
            args.certificate_sha1, plistlib.loads(args.template.read_bytes()),
        )
    except (ValueError, TypeError, KeyError) as error:
        parser.exit(1, f"Provisioning validation failed: {error}\n")
    args.output.write_bytes(plistlib.dumps(entitlements))
    print("Provisioning profile matches the app, team, expiration and signing certificate.")


if __name__ == "__main__":
    main()
