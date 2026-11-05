#!/bin/bash
# Captures the real app's session screens reachable at launch, through the
# Debug UI-test scenarios (scripted API answers, in-memory session). States
# that need an interaction (errors, busy, rate limit) are captured by the UI
# tests. Visual evidence only: the live recipe proves the integration.
#
#   IOS_SIM_DEVICE  simulator name (default: iPhone 17, newest runtime)
#   OUT_DIR         destination (default: docs/evidence/sign-in)
set -euo pipefail

cd "$(dirname "$0")/.."

device=${IOS_SIM_DEVICE:-iPhone 17}
out=${OUT_DIR:-docs/evidence/sign-in}
derived=build/DerivedData-captures
bundle_id=com.example.aegis.mobile

udid=$(xcrun simctl list devices available -j | python3 -c '
import json, sys
name = sys.argv[1]
devices = json.load(sys.stdin)["devices"]
matches = [(rt, d["udid"]) for rt, ds in devices.items() if "iOS" in rt for d in ds if d["name"] == name]
if not matches:
    sys.exit(f"error: no available simulator named {name}")
version = lambda rt: [int(p) for p in rt.rsplit("iOS-", 1)[1].split("-")]
print(max(matches, key=lambda m: version(m[0]))[1])
' "$device")

xcodebuild build -quiet -project AegisMobile.xcodeproj -scheme AegisMobile -configuration Debug \
    -destination "platform=iOS Simulator,id=$udid" -derivedDataPath "$derived"

xcrun simctl boot "$udid" 2>/dev/null || true
xcrun simctl bootstatus "$udid" -b >/dev/null
xcrun simctl spawn "$udid" defaults write com.apple.Preferences DidShowContinuousPathIntroduction -bool true
xcrun simctl install "$udid" "$derived/Build/Products/Debug-iphonesimulator/AegisMobile.app"
mkdir -p "$out"

# name language scenario theme content-size [focus]
captures="
fr-signin-dark fr none dark large
fr-signin-light fr none light large
en-signin-dark en none dark large
en-signin-light en none light large
fr-keyboard-dark fr none dark large password
fr-signin-light-ax fr none light accessibility-extra-extra-extra-large
fr-restoring-light fr resume-slow light large
fr-offline-dark fr resume-offline dark large
en-offline-light en resume-offline light large
fr-expired-light fr resume-expired light large
fr-account-dark fr signed-in dark large
en-account-light en signed-in light large
"

echo "$captures" | while read -r name lang scenario theme size focus; do
    [ -n "$name" ] || continue
    xcrun simctl terminate "$udid" "$bundle_id" 2>/dev/null || true
    xcrun simctl ui "$udid" appearance "$theme"
    xcrun simctl ui "$udid" content_size "$size"
    locale=fr_CA
    [ "$lang" = en ] && locale=en_CA
    env_scenario=""
    [ "$scenario" = none ] || env_scenario="$scenario"
    # A signed-in technician lands on the catalogue: account captures open
    # the Account tab directly.
    start_tab=""
    case "$name" in *-account-*) start_tab=account ;; esac
    # Without a scenario the real Keychain is used: start from no session.
    SIMCTL_CHILD_AEGIS_UI_SCENARIO="$env_scenario" SIMCTL_CHILD_AEGIS_UI_FOCUS="${focus:-}" \
        SIMCTL_CHILD_AEGIS_RESET_SESSION=1 SIMCTL_CHILD_AEGIS_START_TAB="$start_tab" \
        xcrun simctl launch "$udid" "$bundle_id" -AppleLanguages "($lang)" -AppleLocale "$locale" >/dev/null
    sleep 6
    xcrun simctl io "$udid" screenshot "$out/$name.png" >/dev/null 2>&1
    sips --resampleWidth 600 "$out/$name.png" >/dev/null
    echo "$out/$name.png"
done

xcrun simctl terminate "$udid" "$bundle_id" 2>/dev/null || true
xcrun simctl ui "$udid" appearance light
xcrun simctl ui "$udid" content_size large
