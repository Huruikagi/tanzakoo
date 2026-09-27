"""Fetch a successful Store build and verify its package before Apple receives it."""

import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys


def select_artifact(run, artifacts, repository, run_id):
    if not (
        str(run["id"]) == run_id
        and run["path"] == ".github/workflows/macos-store.yml"
        and run["event"] == "workflow_dispatch"
        and run["conclusion"] == "success"
        and run["head_branch"] == "main"
        and run["head_repository"]["full_name"] == repository
        and re.fullmatch(r"[0-9a-f]{40}", run["head_sha"])
    ):
        raise ValueError("Expected a successful Store package workflow on this repository's main.")
    candidates = [a for a in artifacts if not a["expired"] and re.fullmatch(
        rf'Tanzakoo-macos-store-{run["head_sha"]}-[1-9][0-9]{{0,3}}(?:\.[0-9]{{1,2}}){{0,2}}', a["name"]
    )]
    if len(candidates) != 1:
        raise ValueError("Expected exactly one unexpired Store package artifact.")
    return candidates[0]


def verify_package(folder, run, artifact):
    files = list(folder.iterdir())
    packages = list(folder.glob("*.pkg"))
    if len(packages) != 1 or len(files) != 3 or any(p.is_symlink() or not p.is_file() for p in files):
        raise ValueError("Expected only one package, its checksum and provenance.")
    pkg = packages[0]
    provenance = json.loads((folder / "provenance.json").read_text())
    build = artifact["name"].removeprefix(f'Tanzakoo-macos-store-{run["head_sha"]}-')
    if not (
        provenance["commit"] == run["head_sha"]
        and provenance["run"] == str(run["id"])
        and provenance["buildNumber"] == build
        and provenance["reviewAccess"] in ("true", "false")
        and re.fullmatch(rf"Tanzakoo_[0-9]+\.[0-9]+\.[0-9]+_{re.escape(build)}_aarch64\.pkg", pkg.name)
    ):
        raise ValueError("Package provenance does not match the selected Store build.")
    checksum = (folder / (pkg.name + ".sha256")).read_text().strip()
    with pkg.open("rb") as stream:
        digest = hashlib.file_digest(stream, "sha256").hexdigest()
    if checksum != f"{digest}  {pkg.name}":
        raise ValueError("Package SHA-256 does not match.")
    return pkg, digest


def main():
    repository = os.environ["GITHUB_REPOSITORY"]
    run_id = os.environ["SOURCE_RUN_ID"]
    if not re.fullmatch(r"[1-9][0-9]*", run_id):
        raise ValueError("Source run ID must be numeric.")
    api = f"repos/{repository}/actions/runs/{run_id}"
    def get(endpoint):
        return json.loads(subprocess.check_output(["gh", "api", endpoint], text=True))
    run = get(api)
    artifacts = get(api + "/artifacts?per_page=100")
    artifact = select_artifact(run, artifacts["artifacts"], repository, run_id)
    folder = Path(os.environ["RUNNER_TEMP"]) / "store-upload-package"
    folder.mkdir(mode=0o700)
    subprocess.run(["gh", "run", "download", run_id, "--repo", repository,
                    "--name", artifact["name"], "--dir", str(folder)], check=True)
    pkg, digest = verify_package(folder, run, artifact)
    print(f'Verified {pkg.name}; source {run["head_sha"]}; SHA-256 {digest}')
    with open(os.environ["GITHUB_OUTPUT"], "a") as output:
        output.write(f"package={pkg}\n")
    with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as summary:
        summary.write(f'Package: `{pkg.name}`\n\nSource: `{run["head_sha"]}`\n\nSHA-256: `{digest}`\n\n')


if __name__ == "__main__":
    main()
