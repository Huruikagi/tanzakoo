#!/usr/bin/env bash
# Validate or upload an already verified Store package; never submit for review.
set -euo pipefail
umask 077
[[ $# == 2 && $(uname -s) == Darwin ]] || exit 1
pkg=$1
mode=$2
[[ -f $pkg && ( $mode == validate || $mode == upload ) ]] || exit 1
for name in APPLE_API_KEY APPLE_API_ISSUER APPLE_API_KEY_CONTENT RUNNER_TEMP; do
  [[ -n ${!name:-} ]] || { echo "Missing $name" >&2; exit 1; }
done
[[ $APPLE_API_KEY =~ ^[A-Za-z0-9]+$ ]] || exit 1
work=$(mktemp -d "$RUNNER_TEMP/tanzakoo-store-upload.XXXXXX")
trap 'rm -rf "$work"' EXIT
mkdir "$work/private_keys"
printf '%s' "$APPLE_API_KEY_CONTENT" > "$work/private_keys/AuthKey_${APPLE_API_KEY}.p8"
unset APPLE_API_KEY_CONTENT
auth=(--apiKey "$APPLE_API_KEY" --apiIssuer "$APPLE_API_ISSUER")
# Use altool's documented private_keys search path without changing the user's home.
cd "$work"
pkgutil --check-signature "$pkg"
xcrun altool --validate-app -f "$pkg" --type macos "${auth[@]}" --output-format json
if [[ $mode == upload ]]; then
  # Submit once. A transport failure is not evidence that Apple rejected delivery.
  xcrun altool --upload-app -f "$pkg" --type macos "${auth[@]}" --output-format json
  echo 'Upload command succeeded. Check Apple processing and export compliance in TestFlight.'
else
  echo 'Apple package validation succeeded. No build upload was requested.'
fi
