#!/bin/bash
# Run only after Tauri has assembled an unsigned release .app.
# No --deep signing: every Mach-O is signed before the enclosing application.
set +x
set -euo pipefail

[[ $# == 2 ]] || { echo 'Usage: package-macos.sh APP OUTPUT_DIRECTORY' >&2; exit 2; }
[[ $(uname -s) == Darwin && $(uname -m) == arm64 ]] || {
  echo 'Use an Apple Silicon macOS runner.' >&2; exit 1;
}
for name in APPLE_CERTIFICATE APPLE_CERTIFICATE_PASSWORD APPLE_API_KEY APPLE_API_ISSUER APPLE_API_KEY_CONTENT RUNNER_TEMP; do
  [[ -n ${!name:-} ]] || { echo "Missing $name" >&2; exit 1; }
done
root=$(cd "$(dirname "$0")/.." && pwd)
app=$(cd "$1" && pwd)
mkdir -p "$2"
output=$(cd "$2" && pwd)
[[ $app == */Tanzakoo.app ]] || { echo 'Expected Tanzakoo.app' >&2; exit 1; }
[[ -z $(find "$output" -mindepth 1 -maxdepth 1 -print -quit) ]] || {
  echo 'Output directory must be empty.' >&2; exit 1;
}
runtime="$app/Contents/Resources/agent-runtime"
node="$runtime/bin/node"
[[ -x $node && -f "$runtime/codex.mjs" ]] || { echo 'Bundled runtime missing' >&2; exit 1; }
[[ $(/usr/libexec/PlistBuddy -c 'Print :LSMinimumSystemVersion' "$app/Contents/Info.plist") == 26.0 ]] || {
  echo 'Unexpected minimum macOS version' >&2; exit 1;
}
version=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$app/Contents/Info.plist")
[[ $version =~ ^[0-9]+\.[0-9]+\.[0-9]+([.+-][A-Za-z0-9.-]+)?$ ]] || {
  echo 'Invalid bundle version' >&2; exit 1;
}

work=$(mktemp -d "$RUNNER_TEMP/tanzakoo-signing.XXXXXX")
keychain="$work/signing.keychain-db"
mounted=false
cleanup() {
  if [[ $mounted == true ]]; then hdiutil detach "$work/mount" -quiet || true; fi
  security delete-keychain "$keychain" >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT
umask 077
printf '%s' "$APPLE_CERTIFICATE" | /usr/bin/base64 --decode > "$work/certificate.p12"
printf '%s' "$APPLE_API_KEY_CONTENT" > "$work/AuthKey.p8"
notary_auth=(--key "$work/AuthKey.p8" --key-id "$APPLE_API_KEY" --issuer "$APPLE_API_ISSUER")
keychain_password=$(openssl rand -hex 32)
security create-keychain -p "$keychain_password" "$keychain"
security set-keychain-settings -lut 7200 "$keychain"
security unlock-keychain -p "$keychain_password" "$keychain"
# codesign's private-key lookup also needs the user search list, even with --keychain.
keychains=("$keychain")
while IFS= read -r existing_keychain; do
  if [[ $existing_keychain != "$keychain" ]]; then keychains+=("$existing_keychain"); fi
done < <(security list-keychains -d user | sed -E 's/^[[:space:]]*"(.*)"[[:space:]]*$/\1/')
security list-keychains -d user -s "${keychains[@]}"
security import "$work/certificate.p12" -k "$keychain" -P "$APPLE_CERTIFICATE_PASSWORD" -T /usr/bin/codesign >/dev/null
# Include Apple's public G2 intermediate even when the runner has never signed before.
curl --fail --silent --show-error --location --output "$work/DeveloperIDG2CA.cer" \
  https://www.apple.com/certificateauthority/DeveloperIDG2CA.cer
security import "$work/DeveloperIDG2CA.cer" -k "$keychain" >/dev/null
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$keychain_password" "$keychain" >/dev/null
identity=$(security find-identity -v -p codesigning "$keychain" | awk '/"Developer ID Application:/ {print $2}')
[[ $identity =~ ^[A-Fa-f0-9]{40}$ ]] || { echo 'Expected exactly one valid Developer ID Application identity' >&2; exit 1; }
echo 'Developer ID keychain is ready.'
unset APPLE_CERTIFICATE APPLE_CERTIFICATE_PASSWORD APPLE_API_KEY_CONTENT APPLE_API_KEY APPLE_API_ISSUER keychain_password
umask 022

cat > "$work/empty.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict/></plist>
PLIST
# Fail if new dependencies introduce bundles that need their own inside-out signing.
if [[ -n $(find "$app/Contents" -type d \( -name '*.app' -o -name '*.framework' -o -name '*.xpc' -o -name '*.bundle' \) -print -quit) ]]; then
  echo 'Nested bundles require an explicit signing plan.' >&2; exit 1;
fi
count=0
while IFS= read -r -d '' binary; do
  description=$(/usr/bin/file -b "$binary")
  [[ $description == *Mach-O* ]] || continue
  /usr/bin/lipo "$binary" -verify_arch arm64
  entitlements="$work/empty.plist"
  if [[ $binary == "$node" ]]; then entitlements="$root/src-tauri/Entitlements.node.plist"; fi
  # Keep the array nonempty: macOS ships Bash 3.2, whose nounset rejects empty arrays.
  options=(--force --timestamp --sign "$identity" --keychain "$keychain")
  if [[ $description == *executable* ]]; then
    options+=(--options runtime --entitlements "$entitlements")
  fi
  codesign "${options[@]}" "$binary"
  codesign --verify --strict "$binary"
  count=$((count + 1))
done < <(find "$app/Contents" -type f -print0)
[[ $count -ge 3 ]] || { echo 'Expected app, Node and Codex native binaries.' >&2; exit 1; }
codesign --force --timestamp --options runtime --entitlements "$work/empty.plist" \
  --sign "$identity" --keychain "$keychain" "$app"
codesign --verify --deep --strict --verbose=2 "$app"
echo "Signed and verified $count Mach-O files and the application bundle."

# Test the signed runtimes before paying the cost of notarization. No developer PATH,
# inherited AI credentials, login, model request or project content is used.
mkdir "$work/home"
env -i HOME="$work/home" TMPDIR="$work/" PATH=/usr/bin:/bin:/usr/sbin:/sbin \
  "$node" "$root/scripts/check-packaged-runtime.mjs" "$runtime"

dmg="$output/Tanzakoo_${version}_aarch64.dmg"
mkdir "$work/image"
ditto "$app" "$work/image/Tanzakoo.app"
ln -s /Applications "$work/image/Applications"
hdiutil create -volname Tanzakoo -srcfolder "$work/image" -format UDZO "$dmg"
codesign --force --timestamp --sign "$identity" --keychain "$keychain" "$dmg"
codesign --verify --strict "$dmg"

# Submit once. A timeout or Invalid result must never reach the DMG upload step.
notary_exit=0
echo 'Submitting signed DMG for notarization (up to 30 minutes).'
xcrun notarytool submit "$dmg" "${notary_auth[@]}" --wait --timeout 30m \
  --output-format json > "$output/notarization.json" || notary_exit=$?
submission_id=$(/usr/bin/plutil -extract id raw -o - "$output/notarization.json" 2>/dev/null || true)
status=$(/usr/bin/plutil -extract status raw -o - "$output/notarization.json" 2>/dev/null || true)
if [[ -n $submission_id ]]; then
  echo "Notarization submission: $submission_id ($status)"
  xcrun notarytool log "$submission_id" "${notary_auth[@]}" "$output/notarization-log.json" || true
fi
[[ $notary_exit == 0 && $status == Accepted ]] || {
  echo 'Notarization was not accepted. See diagnostics; no distribution artifact will be uploaded.' >&2; exit 1;
}
xcrun stapler staple "$dmg"
xcrun stapler validate "$dmg"
spctl --assess --type open --context context:primary-signature --verbose=2 "$dmg"

# Verify the copy actually shipped on the read-only disk image.
mkdir "$work/mount"
hdiutil attach "$dmg" -readonly -nobrowse -mountpoint "$work/mount" -quiet
mounted=true
codesign --verify --deep --strict --verbose=2 "$work/mount/Tanzakoo.app"
spctl --assess --type execute --verbose=2 "$work/mount/Tanzakoo.app"
env -i HOME="$work/home" TMPDIR="$work/" PATH=/usr/bin:/bin:/usr/sbin:/sbin \
  "$work/mount/Tanzakoo.app/Contents/Resources/agent-runtime/bin/node" \
  "$root/scripts/check-packaged-runtime.mjs" "$work/mount/Tanzakoo.app/Contents/Resources/agent-runtime"
hdiutil detach "$work/mount" -quiet
mounted=false
(cd "$output" && shasum -a 256 "$(basename "$dmg")" > "$(basename "$dmg").sha256")
echo "Verified DMG: $dmg"
