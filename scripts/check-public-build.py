"""Reject personal or unidentified executables before signing/packaging, without running them."""
from pathlib import Path
import sys


def require_public_build(path):
    data = Path(path).read_bytes()
    if b"TANZAKOO_PERSONAL_BUILD_V1" in data or b"TANZAKOO_PUBLIC_BUILD_V1" not in data:
        raise ValueError("Refusing to distribute a personal or unidentified Tanzakoo build")


if __name__ == "__main__":
    require_public_build(sys.argv[1])
