"""Check an OpenSSL P12 and normalize its encryption for macOS Security import.

Passwords remain in the named environment variable. Unencrypted key material is
confined to a mode-0700 temporary directory and removed before returning.
"""

import argparse
import os
from pathlib import Path
import shutil
import subprocess
import tempfile


def openssl_path():
    brewed = Path("/opt/homebrew/opt/openssl@3/bin/openssl")
    return str(brewed) if brewed.is_file() else shutil.which("openssl")


def prepare_p12(source, password_env, destination=None, openssl=None):
    openssl = openssl or openssl_path()
    if not openssl:
        raise ValueError("OpenSSL is required")
    if not os.environ.get(password_env):
        raise ValueError(f"Missing {password_env}")
    password = f"env:{password_env}"

    def run(*args):
        result = subprocess.run([openssl, *args], capture_output=True)
        if result.returncode:
            # Never emit credential contents or inherited environment values.
            raise ValueError("OpenSSL could not process the P12; check the file, export password and OpenSSL version")

    run("pkcs12", "-in", str(source), "-passin", password, "-noout")
    if destination is None:
        return
    destination = Path(destination)
    if destination.exists():
        raise ValueError("Refusing to overwrite an existing P12")
    with tempfile.TemporaryDirectory(prefix="p12-convert-", dir=destination.parent) as directory:
        pem = Path(directory) / "identity.pem"
        run("pkcs12", "-in", str(source), "-passin", password, "-noenc", "-out", str(pem))
        run("pkcs12", "-export", "-in", str(pem), "-out", str(destination),
            "-passout", password, "-keypbe", "PBE-SHA1-3DES", "-certpbe", "PBE-SHA1-3DES",
            "-macalg", "sha1", "-iter", "100000")
        run("pkcs12", "-in", str(destination), "-passin", password, "-noout")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("password_env")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    os.umask(0o077)
    try:
        prepare_p12(args.source, args.password_env, args.output)
    except ValueError as error:
        parser.exit(1, f"P12 validation failed: {error}\n")
    print("P12 password and integrity verified." if args.output is None else "Mac-compatible P12 prepared and verified.")


if __name__ == "__main__":
    main()
