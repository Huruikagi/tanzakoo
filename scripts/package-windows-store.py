"""Stage a self-contained x64 MSIX using the Windows SDK; never sign or submit it."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import struct
import subprocess
import sys
from urllib.parse import unquote
import xml.etree.ElementTree as ET
import zipfile

ROOT = Path(__file__).resolve().parent.parent
FOUNDATION = "http://schemas.microsoft.com/appx/manifest/foundation/windows10"
UAP = "http://schemas.microsoft.com/appx/manifest/uap/windows10"
RESCAP = "http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities"
ET.register_namespace("", FOUNDATION)
ET.register_namespace("uap", UAP)
ET.register_namespace("rescap", RESCAP)
VALIDATION_IDENTITY = {
    "name": "Tanzakoo.LocalPackagingValidation",
    "publisher": "CN=Tanzakoo Local Packaging Validation",
    "publisherDisplayName": "Local packaging validation only",
}


def identity_values(data):
    if set(data) != {"name", "publisher", "publisherDisplayName"}:
        raise ValueError("Identity must contain name, publisher and publisherDisplayName from Partner Center")
    if not isinstance(data["name"], str) or not re.fullmatch(r"[A-Za-z0-9.-]{3,50}", data["name"]):
        raise ValueError("Invalid Partner Center package identity name")
    for key in ("publisher", "publisherDisplayName"):
        value = data[key]
        if not isinstance(value, str) or not value.strip() or len(value) > 8192 or any(ord(c) < 32 for c in value):
            raise ValueError(f"Missing or invalid {key}")
    if not data["publisher"].startswith("CN="):
        raise ValueError("Publisher must be the exact CN= identity from Partner Center")
    return data


def package_version(value):
    if not re.fullmatch(r"(0|[1-9][0-9]{0,4})(\.(0|[1-9][0-9]{0,4})){3}", value):
        raise ValueError("Package version must have four numeric components")
    parts = [int(p) for p in value.split(".")]
    if parts[0] == 0 or any(p > 65535 for p in parts) or parts[3] != 0:
        raise ValueError("Store version requires a nonzero major and a zero fourth component")
    return value


def require_x64(path):
    with path.open("rb") as stream:
        header = stream.read(64)
        if len(header) != 64 or header[:2] != b"MZ":
            raise ValueError(f"Not a PE executable: {path.name}")
        stream.seek(struct.unpack_from("<I", header, 60)[0])
        signature = stream.read(6)
        if signature != b"PE\0\0\x64\x86":
            raise ValueError(f"Expected a Windows x64 PE executable: {path.name}")


def manifest(identity, version, validation=False):
    identity_values(identity)
    package_version(version)
    def child(parent, name, **attrs):
        return ET.SubElement(parent, f"{{{FOUNDATION}}}{name}", attrs)
    package = ET.Element(f"{{{FOUNDATION}}}Package", {"IgnorableNamespaces": "uap rescap"})
    child(package, "Identity", Name=identity["name"], Publisher=identity["publisher"], Version=version, ProcessorArchitecture="x64")
    props = child(package, "Properties")
    name = "Tanzakoo Packaging Validation" if validation else "Tanzakoo"
    for key, value in {"DisplayName": name, "PublisherDisplayName": identity["publisherDisplayName"], "Logo": "Assets/StoreLogo.png"}.items():
        child(props, key).text = value
    deps = child(package, "Dependencies")
    child(deps, "TargetDeviceFamily", Name="Windows.Desktop", MinVersion="10.0.19041.0", MaxVersionTested="10.0.26100.0")
    resources = child(package, "Resources")
    for language in ("en-US", "ja-JP"):
        child(resources, "Resource", Language=language)
    apps = child(package, "Applications")
    app = child(apps, "Application", Id="Tanzakoo", Executable="tanzakoo.exe", EntryPoint="Windows.FullTrustApplication")
    ET.SubElement(app, f"{{{UAP}}}VisualElements", {
        "DisplayName": name, "Description": "Explore ideas and keep decisions with Tanzakoo",
        "BackgroundColor": "transparent", "Square150x150Logo": "Assets/Square150x150Logo.png",
        "Square44x44Logo": "Assets/Square44x44Logo.png",
    })
    capabilities = child(package, "Capabilities")
    ET.SubElement(capabilities, f"{{{RESCAP}}}Capability", {"Name": "runFullTrust"})
    ET.indent(package)
    return ET.tostring(package, encoding="utf-8", xml_declaration=True)


def safe_runtime(path):
    path = path.resolve(strict=True)
    metadata = json.loads((path / "runtime.json").read_text(encoding="utf-8"))
    if metadata.get("platform") != "win32" or metadata.get("arch") != "x64":
        raise ValueError("Stage the Windows x64 runtime with pnpm runtime:stage first")
    for name in ("bin/node.exe", "codex.mjs", "plan-cli.mjs", "plan/oauth.mjs", "plan/store.mjs", "NODE-LICENSE.txt", "TANZAKOO-LICENSE.txt", "licenses/CODEX-LICENSE.txt", "licenses/CODEX-NOTICE.txt"):
        if not (path / name).is_file():
            raise ValueError(f"Stale or incomplete bundled runtime: missing {name}")
    require_x64(path / "bin/node.exe")
    for item in path.rglob("*"):
        if item.is_symlink() or getattr(item, "is_junction", lambda: False)():
            raise ValueError("Runtime must be a materialized deployment without links")
        if item.name in {"auth.json", "accounts.json", ".env"}:
            raise ValueError("Runtime must not contain local credentials")
    return metadata


def find_makeappx():
    sdk = Path(os.environ.get("ProgramFiles(x86)", "C:/Program Files (x86)")) / "Windows Kits/10/bin"
    versions = sorted((p for p in sdk.glob("10.*") if re.fullmatch(r"[0-9.]+", p.name)), key=lambda p: tuple(map(int, p.name.split("."))), reverse=True)
    for version in versions:
        executable = version / "x64/makeappx.exe"
        if executable.is_file():
            return executable
    raise ValueError("Install the Windows SDK with MakeAppx.exe")


def verify_payload(package, files):
    with zipfile.ZipFile(package) as archive:
        names = {unquote(name): name for name in archive.namelist()}
        if len(names) != len(archive.namelist()):
            raise ValueError("Package contains duplicate decoded paths")
        for name, expected in files.items():
            if name not in names or hashlib.sha256(archive.read(names[name])).hexdigest() != expected:
                raise ValueError(f"Packaged payload mismatch: {name}")


def build(args):
    if sys.platform != "win32":
        raise ValueError("Package on Windows with the Windows SDK installed")
    identity = VALIDATION_IDENTITY if args.validation_only else identity_values(json.loads(args.identity.read_text(encoding="utf-8-sig")))
    if not args.validation_only and identity["name"] == VALIDATION_IDENTITY["name"]:
        raise ValueError("Validation identity cannot be used for a Store package")
    version = package_version(args.package_version)
    executable = args.exe.resolve(strict=True)
    runtime = args.runtime.resolve(strict=True)
    require_x64(executable)
    metadata = safe_runtime(runtime)
    makeappx = find_makeappx()
    output = args.output.resolve()
    # An entirely new output directory prevents mixing old builds or credentials.
    if output.exists() or output == runtime or runtime in output.parents:
        raise ValueError("Choose a new output directory outside the runtime")
    output.mkdir(parents=True)
    stage = output / "payload"
    stage.mkdir()
    shutil.copyfile(executable, stage / "tanzakoo.exe")
    shutil.copytree(runtime, stage / "agent-runtime")
    shutil.copyfile(ROOT / "LICENSE", stage / "LICENSE.txt")
    (stage / "Assets").mkdir()
    for name in ("StoreLogo.png", "Square44x44Logo.png", "Square150x150Logo.png"):
        shutil.copyfile(ROOT / "src-tauri/icons" / name, stage / "Assets" / name)
    (stage / "AppxManifest.xml").write_bytes(manifest(identity, version, args.validation_only))
    suffix = "-VALIDATION-ONLY" if args.validation_only else ""
    package = output / f"Tanzakoo-{version}-x64{suffix}.msix"
    with (output / "makeappx.log").open("w", encoding="utf-8") as log:
        subprocess.run([str(makeappx), "pack", "/d", str(stage), "/p", str(package), "/o"], stdout=log, stderr=subprocess.STDOUT, check=True)
    files = {p.relative_to(stage).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(stage.rglob("*")) if p.is_file()}
    verify_payload(package, files)
    digest = hashlib.sha256(package.read_bytes()).hexdigest()
    (output / (package.name + ".sha256")).write_text(f"{digest}  {package.name}\n", encoding="utf-8")
    commit = subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT, capture_output=True, text=True, check=True).stdout.strip()
    dirty = bool(subprocess.run(["git", "status", "--porcelain"], cwd=ROOT, capture_output=True, text=True, check=True).stdout.strip())
    provenance = {
        "kind": "windows-msix-validation-only" if args.validation_only else "windows-msix-submission-candidate",
        "identity": identity, "packageVersion": version, "architecture": "x64", "runtime": metadata,
        "checkoutAtPackaging": {"commit": commit, "dirty": dirty, "isBuildProvenance": False},
        "payloadVerified": True, "signed": False, "installedAndTested": False, "storeValidated": False,
        "package": package.name, "sha256": digest, "payloadSHA256": files,
        "requirements": ["WebView2 Runtime on the target device", "Store identity and packaged install testing", "Windows App Certification Kit"],
    }
    (output / "provenance.json").write_text(json.dumps(provenance, indent=2) + "\n", encoding="utf-8")
    print(f"Created unsigned package: {package}")
    print("Validation identity only; DO NOT SUBMIT." if args.validation_only else "Not installed, certified or submitted. Review provenance before use.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--identity", type=Path, help="JSON with exact Partner Center identity values")
    mode.add_argument("--validation-only", action="store_true", help="Use a clearly non-Store identity for packaging checks only")
    parser.add_argument("--package-version", required=True)
    parser.add_argument("--exe", type=Path, default=ROOT / "src-tauri/target/release/tanzakoo.exe")
    parser.add_argument("--runtime", type=Path, default=ROOT / "src-tauri/resources/agent-runtime")
    parser.add_argument("--output", type=Path, required=True)
    build(parser.parse_args())


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        sys.exit(f"Packaging failed: {error}. See makeappx.log in the output directory if present.")
