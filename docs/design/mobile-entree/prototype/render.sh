#!/bin/bash
# Renders the sign-in prototype with the real iOS SDK and simulator.
# The prototype is compiled into a temporary copy of the iOS project, so the
# application sources are never modified.
#
#   IOS_APP_DIR   iOS project to copy (default: <repo>/apps/ios)
#   PROTO_DEVICE  simulator name (default: iPhone 17)
#   OUT_DIR       captures directory (default: ../captures)
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
repo=$(git -C "$here" rev-parse --show-toplevel)
app_dir=${IOS_APP_DIR:-$repo/apps/ios}
device=${PROTO_DEVICE:-iPhone 17}
out=${OUT_DIR:-$here/../captures}
bundle_id=com.example.aegis.proto.mobile

if [ ! -f "$app_dir/AegisMobile.xcodeproj/project.pbxproj" ]; then
    echo "error: no iOS project in $app_dir; set IOS_APP_DIR" >&2
    exit 1
fi

# Newest available runtime that has the requested device.
udid=$(xcrun simctl list devices available -j | python3 -c '
import json, sys
name = sys.argv[1]
devices = json.load(sys.stdin)["devices"]
matches = [(rt, d["udid"]) for rt, ds in devices.items() if "iOS" in rt for d in ds if d["name"] == name]
if not matches:
    sys.exit(f"error: no available simulator named {name}")
def version(rt):
    return [int(p) for p in rt.rsplit("iOS-", 1)[1].split("-")]
print(max(matches, key=lambda m: version(m[0]))[1])
' "$device")

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
rsync -a --exclude build --exclude docs "$app_dir/" "$work/ios/"
rm "$work/ios/AegisMobile/App/AegisMobileApp.swift"
cp "$here/SignInPrototype.swift" "$work/ios/AegisMobile/App/"

xcodebuild build -quiet \
    -project "$work/ios/AegisMobile.xcodeproj" -scheme AegisMobile -configuration Debug \
    -destination "platform=iOS Simulator,id=$udid" -derivedDataPath "$work/DerivedData" \
    AEGIS_BUNDLE_ID_PREFIX=com.example.aegis.proto

xcrun simctl boot "$udid" 2>/dev/null || true
xcrun simctl bootstatus "$udid" -b >/dev/null
xcrun simctl install "$udid" "$work/DerivedData/Build/Products/Debug-iphonesimulator/AegisMobile.app"
mkdir -p "$out"

# state theme content-size
renders="
reprise light large
inactif light large
validation light large
envoi light large
identifiants-refuses light large
trop-de-tentatives light large
service-injoignable light large
erreur-service light large
session-expiree light large
session-invalide light large
deconnecte light large
role-non-autorise light large
inactif dark large
role-non-autorise dark large
session-expiree dark large
trop-de-tentatives dark large
identifiants-refuses light accessibility-extra-large
"

echo "$renders" | while read -r state theme size; do
    [ -n "$state" ] || continue
    xcrun simctl terminate "$udid" "$bundle_id" 2>/dev/null || true
    xcrun simctl ui "$udid" appearance "$theme"
    xcrun simctl ui "$udid" content_size "$size"
    SIMCTL_CHILD_AEGIS_PROTO_STATE="$state" xcrun simctl launch "$udid" "$bundle_id" >/dev/null
    sleep 5
    suffix=$theme
    [ "$size" = large ] || suffix="$theme-ax"
    file="$out/$state-$suffix.png"
    xcrun simctl io "$udid" screenshot "$file" >/dev/null 2>&1
    sips --resampleWidth 600 "$file" >/dev/null
    echo "$file"
done

xcrun simctl terminate "$udid" "$bundle_id" 2>/dev/null || true
xcrun simctl ui "$udid" appearance light
xcrun simctl ui "$udid" content_size large
