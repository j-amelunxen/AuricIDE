#!/usr/bin/env bash
#
# Builds AuricIDE as a real macOS application and installs it, so the IDE can be
# kept in the Dock and started like anything else instead of only through
# `pnpm tauri:dev`.
#
# The installed app deliberately shares its data with the dev build. Everything
# the backend stores — recent projects, starred projects, the notification
# inbox, the webview preferences — resolves from `app_data_dir()`, which Tauri
# derives from the `identifier` in `tauri.conf.json`. That is one string, the
# same in both builds, so both land in
# ~/Library/Application Support/com.auricide.ide. This script checks that the
# bundle it just produced really carries that identifier: get it wrong and the
# app opens looking like a fresh install with no projects in it.
#
# Usage:
#   scripts/build-production.sh [--no-install] [--dmg] [--open]
#
#   --no-install  build only, leave the bundle in src-tauri/target/release
#   --dmg         also produce a .dmg next to the .app
#   --open        launch the installed app when the build finishes

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

INSTALL_DIR="/Applications"
APP_NAME="AuricIDE.app"
BUNDLE_DIR="$REPO_ROOT/src-tauri/target/release/bundle/macos"
BUILT_APP="$BUNDLE_DIR/$APP_NAME"
INSTALLED_APP="$INSTALL_DIR/$APP_NAME"

do_install=1
do_open=0
bundles="app"

while [ $# -gt 0 ]; do
    case "$1" in
        --no-install) do_install=0 ;;
        --open) do_open=1 ;;
        --dmg) bundles="app,dmg" ;;
        -h | --help)
            sed -n '3,22p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
            exit 0
            ;;
        *)
            echo "Unknown option: $1" >&2
            echo "Usage: scripts/build-production.sh [--no-install] [--dmg] [--open]" >&2
            exit 2
            ;;
    esac
    shift
done

step() { printf '\n\033[1;36m▸ %s\033[0m\n' "$1"; }
fail() {
    printf '\n\033[1;31m✗ %s\033[0m\n' "$1" >&2
    exit 1
}
ok() { printf '\033[0;32m  ✓ %s\033[0m\n' "$1"; }

[ "$(uname -s)" = "Darwin" ] || fail "This script builds a macOS .app bundle; it needs macOS."

for tool in pnpm cargo; do
    command -v "$tool" >/dev/null 2>&1 || fail "$tool is not on PATH."
done

# The identifier in the config is what every stored file is keyed on. Read it
# here so the check after the build compares against the real source, not a
# copy of it that could drift.
CONFIG_IDENTIFIER="$(
    python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["identifier"])' \
        "$REPO_ROOT/src-tauri/tauri.conf.json"
)"
[ -n "$CONFIG_IDENTIFIER" ] || fail "No identifier in src-tauri/tauri.conf.json."

# Replacing the bundle underneath a running copy leaves that process reading
# files that are no longer there.
if pgrep -f "$INSTALLED_APP/Contents/MacOS/" >/dev/null 2>&1; then
    fail "$APP_NAME is running. Quit it (⌘Q) and run this again."
fi

step "Building the release bundle (this compiles Rust in release mode)"
pnpm tauri build --bundles "$bundles"

[ -d "$BUILT_APP" ] || fail "Expected a bundle at $BUILT_APP, found none."
ok "built $BUILT_APP"

step "Checking the bundle shares its data with the dev build"
BUNDLE_IDENTIFIER="$(
    /usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$BUILT_APP/Contents/Info.plist"
)"
if [ "$BUNDLE_IDENTIFIER" != "$CONFIG_IDENTIFIER" ]; then
    fail "The bundle says $BUNDLE_IDENTIFIER but the config says $CONFIG_IDENTIFIER.
   The app would read a different data directory and open with no projects."
fi
ok "identifier $BUNDLE_IDENTIFIER"

APP_DATA_DIR="$HOME/Library/Application Support/$BUNDLE_IDENTIFIER"
if [ -f "$APP_DATA_DIR/recent-projects.json" ]; then
    ok "shared data directory exists: $APP_DATA_DIR"
else
    printf '  · no data directory yet at %s — it is created on first run\n' "$APP_DATA_DIR"
fi

# The linker leaves an ad-hoc signature that binds neither the Info.plist nor
# the resources. Sealing the bundle properly keeps LaunchServices from treating
# a rebuild as a different app, which is what makes the Dock icon stick.
step "Signing the bundle ad-hoc"
codesign --force --sign - --timestamp=none "$BUILT_APP" >/dev/null 2>&1 ||
    fail "codesign refused to sign $BUILT_APP."
codesign --verify --deep --strict "$BUILT_APP" >/dev/null 2>&1 ||
    fail "The signature did not verify."
ok "signed and verified"

if [ "$do_install" -eq 0 ]; then
    step "Done (not installed)"
    printf '  %s\n' "$BUILT_APP"
    exit 0
fi

step "Installing to $INSTALL_DIR"
if [ -d "$INSTALLED_APP" ]; then
    rm -rf "$INSTALLED_APP" || fail "Could not remove the previous $INSTALLED_APP."
fi
cp -R "$BUILT_APP" "$INSTALLED_APP" || fail "Could not copy the bundle into $INSTALL_DIR."
# A locally built app is not quarantined, but a previous copy may have picked
# the flag up from a download or an archive.
xattr -dr com.apple.quarantine "$INSTALLED_APP" 2>/dev/null || true
ok "installed $INSTALLED_APP"

step "Verifying the installed copy"
[ -x "$INSTALLED_APP/Contents/MacOS/auric-ide" ] || fail "The installed bundle has no executable."
INSTALLED_IDENTIFIER="$(
    /usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$INSTALLED_APP/Contents/Info.plist"
)"
[ "$INSTALLED_IDENTIFIER" = "$CONFIG_IDENTIFIER" ] ||
    fail "The installed bundle carries $INSTALLED_IDENTIFIER, expected $CONFIG_IDENTIFIER."
codesign --verify --deep --strict "$INSTALLED_APP" >/dev/null 2>&1 ||
    fail "The installed bundle does not verify."
ok "$INSTALLED_APP is ready"

if [ "$do_open" -eq 1 ]; then
    step "Launching"
    open "$INSTALLED_APP"
fi

printf '\n\033[1;32mAuricIDE is installed.\033[0m\n'
printf 'Open it from Launchpad or Spotlight, then right-click its Dock icon →\n'
printf 'Options → Keep in Dock.\n\n'
printf 'It reads the same data as the dev build:\n'
printf '  %s\n' "$APP_DATA_DIR"
