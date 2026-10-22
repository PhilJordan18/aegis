#!/bin/bash
# Renders the sign-in prototype (direction v3) with the real iOS SDK and
# simulator. The prototype and the provisional mark are compiled into a
# temporary copy of the iOS project, so the application sources are never
# modified.
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

# Provisional mark as a vector asset with a dark-appearance variant: the
# replaceable unit the application will use under the same name.
mark="$work/ios/AegisMobile/Assets.xcassets/AegisMark.imageset"
mkdir -p "$mark"
cp "$here/../marque/aegis-core-mark.svg" "$here/../marque/aegis-core-mark-dark.svg" "$mark/"
cat > "$mark/Contents.json" <<'JSON'
{
  "images" : [
    { "filename" : "aegis-core-mark.svg", "idiom" : "universal" },
    {
      "appearances" : [ { "appearance" : "luminosity", "value" : "dark" } ],
      "filename" : "aegis-core-mark-dark.svg",
      "idiom" : "universal"
    }
  ],
  "info" : { "author" : "xcode", "version" : 1 },
  "properties" : { "preserves-vector-representation" : true }
}
JSON

xcodebuild build -quiet \
    -project "$work/ios/AegisMobile.xcodeproj" -scheme AegisMobile -configuration Debug \
    -destination "platform=iOS Simulator,id=$udid" -derivedDataPath "$work/DerivedData" \
    AEGIS_BUNDLE_ID_PREFIX=com.example.aegis.proto

xcrun simctl boot "$udid" 2>/dev/null || true
xcrun simctl bootstatus "$udid" -b >/dev/null
# Skip the one-time keyboard tip so the keyboard capture shows the keyboard.
xcrun simctl spawn "$udid" defaults write com.apple.Preferences DidShowContinuousPathIntroduction -bool true
xcrun simctl spawn "$udid" defaults write com.apple.keyboard.preferences DidShowContinuousPathIntroduction -bool true
xcrun simctl install "$udid" "$work/DerivedData/Build/Products/Debug-iphonesimulator/AegisMobile.app"
mkdir -p "$out"

# language state theme content-size (large-contrast = large + Increase Contrast)
renders="
fr inactif dark large
fr inactif light large
en inactif dark large
en inactif light large
fr identifiants-refuses dark large
en identifiants-refuses light large
fr clavier dark large
fr inactif light accessibility-extra-large
fr trop-de-tentatives light large
fr envoi dark large
fr reprise-hors-ligne dark large
en reprise-hors-ligne light large
fr validation light large
fr service-injoignable dark large
fr session-expiree light large
fr inactif light large-contrast
"

rm -f "$out"/*.png
echo "$renders" | while read -r lang state theme size; do
    [ -n "$lang" ] || continue
    xcrun simctl terminate "$udid" "$bundle_id" 2>/dev/null || true
    xcrun simctl ui "$udid" appearance "$theme"
    contrast=disabled
    if [ "$size" = large-contrast ]; then contrast=enabled; size=large; fi
    xcrun simctl ui "$udid" increase_contrast "$contrast"
    xcrun simctl ui "$udid" content_size "$size"
    SIMCTL_CHILD_AEGIS_PROTO_STATE="$state" SIMCTL_CHILD_AEGIS_PROTO_LANG="$lang" \
        xcrun simctl launch "$udid" "$bundle_id" -AppleLanguages "($lang)" >/dev/null
    sleep 6
    suffix=$theme
    [ "$size" = large ] || suffix="$theme-ax"
    [ "$contrast" = disabled ] || suffix="$theme-contrast"
    file="$out/$lang-$state-$suffix.png"
    xcrun simctl io "$udid" screenshot "$file" >/dev/null 2>&1
    sips --resampleWidth 600 "$file" >/dev/null
    echo "$file"
done

xcrun simctl terminate "$udid" "$bundle_id" 2>/dev/null || true
xcrun simctl ui "$udid" appearance light
xcrun simctl ui "$udid" content_size large
xcrun simctl ui "$udid" increase_contrast disabled
