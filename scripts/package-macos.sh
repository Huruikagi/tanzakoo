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
sandbox=${SANDBOX:-false}
app_name=Tanzakoo
parent_entitlements="$root/src-tauri/Entitlements.sandbox.plist"
if [[ $sandbox == true ]]; then app_name='Tanzakoo Sandbox'; fi
[[ $app == */"$app_name.app" ]] || { echo "Expected $app_name.app" >&2; exit 1; }
bundle_id=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$app/Contents/Info.plist")
if [[ $sandbox == true ]]; then
  [[ $bundle_id == dev.huruikagi.tanzakoo.sandbox-test ]] || exit 1
  # The parent GUI and its MCP subprocess require different entitlement profiles.
  cp "$app/Contents/MacOS/tanzakoo" "$app/Contents/MacOS/tanzakoo-mcp"
fi
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
canary=''
cleanup() {
  if [[ $mounted == true ]]; then hdiutil detach "$work/mount" -quiet || true; fi
  security delete-keychain "$keychain" >/dev/null 2>&1 || true
  rm -rf "$work"
  if [[ -n $canary ]]; then rm -f "$canary"; fi
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
if [[ $sandbox != true ]]; then parent_entitlements="$work/empty.plist"; fi
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
  # The dedicated code-mode host executes tool calls in V8. Preserve JIT only
  # for this pinned helper (including pnpm's materialized copy), not all Codex binaries.
  if [[ $binary == "$runtime"/node_modules/*/vendor/aarch64-apple-darwin/bin/codex-code-mode-host ]]; then
    entitlements="$root/src-tauri/Entitlements.codex-code-mode-host.plist"
  fi
  if [[ $sandbox == true && $description == *executable* ]]; then
    if [[ $binary == "$app/Contents/MacOS/tanzakoo" ]]; then
      entitlements="$parent_entitlements"
    elif [[ $binary == "$node" || $binary == "$runtime"/node_modules/*/vendor/aarch64-apple-darwin/bin/codex-code-mode-host ]]; then
      entitlements="$root/src-tauri/Entitlements.sandbox-jit-child.plist"
    else
      entitlements="$root/src-tauri/Entitlements.sandbox-child.plist"
    fi
  fi
  # Keep the array nonempty: macOS ships Bash 3.2, whose nounset rejects empty arrays.
  options=(--force --timestamp --sign "$identity" --keychain "$keychain")
  if [[ $sandbox == true && $binary == "$app/Contents/MacOS/tanzakoo-mcp" ]]; then
    # App-scoped bookmarks belong to this signed application, including its helper.
    options+=(--identifier "$bundle_id")
  fi
  if [[ $description == *executable* ]]; then
    options+=(--options runtime --entitlements "$entitlements")
  fi
  codesign "${options[@]}" "$binary"
  codesign --verify --strict "$binary"
  count=$((count + 1))
done < <(find "$app/Contents" -type f -print0)
[[ $count -ge 3 ]] || { echo 'Expected app, Node and Codex native binaries.' >&2; exit 1; }
codesign --force --timestamp --options runtime --entitlements "$parent_entitlements" \
  --sign "$identity" --keychain "$keychain" "$app"
codesign --verify --deep --strict --verbose=2 "$app"
echo "Signed and verified $count Mach-O files and the application bundle."

# Test the signed runtimes before paying the cost of notarization. No developer PATH,
# inherited AI credentials, login, external model request or project content is used.
mkdir "$work/home"
# Exercise a real tool call too: ACP initialization alone cannot detect failures
# in the signed Codex tool host or in the packaged application's MCP subprocess.
check_board_tools() {
  local packaged_app="$1"
  local packaged_runtime="$packaged_app/Contents/Resources/agent-runtime"
  if [[ $sandbox == true ]]; then
    # An inherited child launched directly from this shell would not prove App Sandbox.
    "$packaged_app/Contents/MacOS/tanzakoo" --sandbox-check "$canary"
    return
  fi
  env -i HOME="$work/home" TMPDIR="$work/" PATH=/usr/bin:/bin:/usr/sbin:/sbin \
    "$packaged_runtime/bin/node" "$root/scripts/check-packaged-runtime.mjs" "$packaged_runtime"
  env -i HOME="$work/home" TMPDIR="$work/" PATH=/usr/bin:/bin:/usr/sbin:/sbin \
    TANZAKOO_TEST_RUNTIME_ENTRY="$packaged_runtime/codex.mjs" \
    TANZAKOO_TEST_MCP_BINARY="$packaged_app/Contents/MacOS/tanzakoo" \
    "$packaged_runtime/bin/node" --test --test-name-pattern='review gateway-board:' \
    "$root/scripts/review-connection.test.mjs"
}
if [[ $sandbox == true ]]; then
  canary=$(mktemp "$HOME/tanzakoo-sandbox-denied.XXXXXX")
  printf 'sandbox access must be denied\n' > "$canary"
fi
check_board_tools "$app"

dmg="$output/${app_name// /_}_${version}_aarch64.dmg"
mkdir "$work/image"
ditto "$app" "$work/image/$app_name.app"
ln -s /Applications "$work/image/Applications"
hdiutil create -volname "$app_name" -srcfolder "$work/image" -format UDZO "$dmg"
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
codesign --verify --deep --strict --verbose=2 "$work/mount/$app_name.app"
spctl --assess --type execute --verbose=2 "$work/mount/$app_name.app"
check_board_tools "$work/mount/$app_name.app"
hdiutil detach "$work/mount" -quiet
mounted=false
(cd "$output" && shasum -a 256 "$(basename "$dmg")" > "$(basename "$dmg").sha256")
echo "Verified DMG: $dmg"
