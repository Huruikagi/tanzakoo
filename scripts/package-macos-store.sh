#!/bin/bash
# Produce a Store-signed PKG artifact only. No upload, installation or notarization.
set +x
set -euo pipefail
[[ $# == 2 ]] || { echo 'Usage: package-macos-store.sh APP OUTPUT_DIRECTORY' >&2; exit 2; }
[[ $(uname -s) == Darwin && $(uname -m) == arm64 ]] || {
  echo 'Use an Apple Silicon macOS runner.' >&2; exit 1;
}
for name in MAS_APP_CERTIFICATE MAS_APP_CERTIFICATE_PASSWORD MAS_INSTALLER_CERTIFICATE MAS_INSTALLER_CERTIFICATE_PASSWORD MAS_PROVISION_PROFILE RUNNER_TEMP; do
  [[ -n ${!name:-} ]] || { echo "Missing $name" >&2; exit 1; }
done
root=$(cd "$(dirname "$0")/.." && pwd)
app=$(cd "$1" && pwd)
[[ $app == */Tanzakoo.app ]] || { echo 'Expected Tanzakoo.app' >&2; exit 1; }
plist="$app/Contents/Info.plist"
bundle_id=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$plist")
[[ $bundle_id == dev.huruikagi.tanzakoo ]] || { echo 'Unexpected Bundle ID' >&2; exit 1; }
[[ $(/usr/libexec/PlistBuddy -c 'Print :LSMinimumSystemVersion' "$plist") == 26.0 ]] || exit 1
[[ $(/usr/libexec/PlistBuddy -c 'Print :LSApplicationCategoryType' "$plist") == public.app-category.productivity ]] || exit 1
version=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$plist")
build=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$plist")
[[ $version =~ ^[0-9]+\.[0-9]+\.[0-9]+$ && $build =~ ^[1-9][0-9]{0,3}(\.[0-9]{1,2}){0,2}$ ]] || {
  echo 'Expected Store version and numeric build number' >&2; exit 1;
}
[[ ! -e "$app/Contents/Resources/sandbox-check" ]] || {
  echo 'Store app must not include Sandbox validation fixtures.' >&2; exit 1;
}
runtime="$app/Contents/Resources/agent-runtime"
node="$runtime/bin/node"
[[ -x $node && -f "$runtime/codex.mjs" ]] || { echo 'Bundled runtime missing' >&2; exit 1; }
if [[ -n $(find "$app/Contents" -type d \( -name '*.app' -o -name '*.framework' -o -name '*.xpc' -o -name '*.bundle' \) -print -quit) ]]; then
  echo 'Nested bundles require an explicit signing plan.' >&2; exit 1;
fi
mkdir -p "$2"
output=$(cd "$2" && pwd)
[[ -z $(find "$output" -mindepth 1 -maxdepth 1 -print -quit) ]] || {
  echo 'Output directory must be empty.' >&2; exit 1;
}

work=$(mktemp -d "$RUNNER_TEMP/tanzakoo-store.XXXXXX")
keychain="$work/signing.keychain-db"
original_keychains=()
while IFS= read -r existing; do original_keychains+=("$existing"); done < <(
  security list-keychains -d user | sed -E 's/^[[:space:]]*"(.*)"[[:space:]]*$/\1/'
)
[[ ${#original_keychains[@]} -gt 0 ]] || { echo 'Cannot read keychain search list' >&2; exit 1; }
cleanup() {
  security list-keychains -d user -s "${original_keychains[@]}" || true
  security delete-keychain "$keychain" >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT
umask 077
printf '%s' "$MAS_APP_CERTIFICATE" | /usr/bin/base64 --decode > "$work/app.p12"
printf '%s' "$MAS_INSTALLER_CERTIFICATE" | /usr/bin/base64 --decode > "$work/installer.p12"
printf '%s' "$MAS_PROVISION_PROFILE" | /usr/bin/base64 --decode > "$work/store.provisionprofile"
python3 "$root/scripts/macos-store-p12.py" "$work/app.p12" MAS_APP_CERTIFICATE_PASSWORD --output "$work/app-import.p12"
python3 "$root/scripts/macos-store-p12.py" "$work/installer.p12" MAS_INSTALLER_CERTIFICATE_PASSWORD --output "$work/installer-import.p12"
keychain_password=$(openssl rand -hex 32)
security create-keychain -p "$keychain_password" "$keychain"
security set-keychain-settings -lut 7200 "$keychain"
security unlock-keychain -p "$keychain_password" "$keychain"
security list-keychains -d user -s "$keychain" "${original_keychains[@]}"
security import "$work/app-import.p12" -k "$keychain" -P "$MAS_APP_CERTIFICATE_PASSWORD" -T /usr/bin/codesign >/dev/null
security import "$work/installer-import.p12" -k "$keychain" -P "$MAS_INSTALLER_CERTIFICATE_PASSWORD" -T /usr/bin/productbuild -T /usr/bin/productsign >/dev/null
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$keychain_password" "$keychain" >/dev/null
unset MAS_APP_CERTIFICATE MAS_APP_CERTIFICATE_PASSWORD MAS_INSTALLER_CERTIFICATE MAS_INSTALLER_CERTIFICATE_PASSWORD MAS_PROVISION_PROFILE keychain_password

# Installer certificates are not code-signing identities; query the basic policy.
app_identity=$(security find-identity -v -p codesigning "$keychain" | awk '/"(Apple Distribution:|3rd Party Mac Developer Application:)/ {print $2}')
installer_identity=$(security find-identity -v -p basic "$keychain" | awk '/"3rd Party Mac Developer Installer:/ {print $2}')
[[ $app_identity =~ ^[A-Fa-f0-9]{40}$ && $installer_identity =~ ^[A-Fa-f0-9]{40}$ ]] || {
  echo 'Expected one Store application identity and one Mac Installer Distribution identity, including their intermediate certificates.' >&2; exit 1;
}
security cms -D -i "$work/store.provisionprofile" -o "$work/profile.plist"
python3 "$root/scripts/prepare-macos-store.py" "$work/profile.plist" "$bundle_id" "$app_identity" \
  "$root/src-tauri/Entitlements.sandbox.plist" "$work/parent.plist"
team=$(/usr/libexec/PlistBuddy -c 'Print :com.apple.developer.team-identifier' "$work/parent.plist")
# Match the installer's team before creating an artifact signed by two teams.
installer_name=$(security find-identity -v -p basic "$keychain" | awk -F '"' '/"3rd Party Mac Developer Installer:/ {print $2}')
[[ $installer_name == *" ($team)" ]] || { echo 'Installer certificate belongs to a different team.' >&2; exit 1; }
umask 022
cp "$work/store.provisionprofile" "$app/Contents/embedded.provisionprofile"
chmod 644 "$app/Contents/embedded.provisionprofile"
cp "$app/Contents/MacOS/tanzakoo" "$app/Contents/MacOS/tanzakoo-mcp"
chmod 755 "$app/Contents/MacOS/tanzakoo-mcp"
count=0
while IFS= read -r -d '' binary; do
  description=$(/usr/bin/file -b "$binary")
  [[ $description == *Mach-O* ]] || continue
  /usr/bin/lipo "$binary" -verify_arch arm64
  options=(--force --timestamp --sign "$app_identity" --keychain "$keychain")
  if [[ $description == *executable* ]]; then
    entitlements="$root/src-tauri/Entitlements.sandbox-child.plist"
    if [[ $binary == "$app/Contents/MacOS/tanzakoo" ]]; then
      entitlements="$work/parent.plist"
    elif [[ $binary == "$node" || $binary == "$runtime"/node_modules/*/vendor/aarch64-apple-darwin/bin/codex-code-mode-host ]]; then
      entitlements="$root/src-tauri/Entitlements.sandbox-jit-child.plist"
    fi
    options+=(--options runtime --entitlements "$entitlements")
  fi
  if [[ $binary == "$app/Contents/MacOS/tanzakoo-mcp" ]]; then options+=(--identifier "$bundle_id"); fi
  codesign "${options[@]}" "$binary"
  codesign --verify --strict "$binary"
  count=$((count + 1))
done < <(find "$app/Contents" -type f -print0)
[[ $count -ge 3 ]] || { echo 'Expected app, Node and Codex native binaries.' >&2; exit 1; }
codesign --force --timestamp --options runtime --entitlements "$work/parent.plist" \
  --sign "$app_identity" --keychain "$keychain" "$app"
# Runtime resources may retain private download/extraction permissions. Installed
# app files must be readable by every user so the signature can be verified.
# Only normalize the public app bundle; credentials stay in the private work dir.
echo 'Bundle entries requiring public read/traverse permissions:'
find "$app" \( -type f ! -perm -004 -o -type d ! -perm -005 \) -print
chmod -R a+rX "$app"
[[ -z $(find "$app" \( -type f ! -perm -004 -o -type d ! -perm -005 \) -print -quit) ]] || {
  echo 'Bundle contains files that non-root users cannot read.' >&2; exit 1;
}
codesign --verify --deep --strict --verbose=2 "$app"
codesign -d --entitlements :- "$app" > "$work/signed-entitlements.plist" 2>/dev/null
cmp -s "$work/parent.plist" "$work/signed-entitlements.plist" || {
  # codesign may serialize equivalent plist XML differently.
  python3 -c 'import plistlib,sys; sys.exit(0 if plistlib.load(open(sys.argv[1], "rb")) == plistlib.load(open(sys.argv[2], "rb")) else 1)' \
    "$work/parent.plist" "$work/signed-entitlements.plist"
}
[[ $(codesign -dv "$app" 2>&1 | sed -n 's/^TeamIdentifier=//p') == "$team" ]] || exit 1
pkg="$output/Tanzakoo_${version}_${build}_aarch64.pkg"
xcrun productbuild --sign "$installer_name" --keychain "$keychain" --component "$app" /Applications "$pkg"
pkgutil --check-signature "$pkg"
(cd "$output" && shasum -a 256 "$(basename "$pkg")" > "$(basename "$pkg").sha256")
echo "Verified signatures of $count Mach-O files, app and PKG. No Store upload performed."
# Store distribution signatures are not a direct-install runtime test. Validate
# the processed app through TestFlight/Store separately once upload is authorized.
