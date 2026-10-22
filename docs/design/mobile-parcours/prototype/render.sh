#!/bin/bash
# Renders the technician-flow prototype with the real iOS SDK and simulator.
# The prototype is compiled into a temporary copy of the iOS project (reusing
# its v3 colours and components), so the application sources are never
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

if [[ ! -f "$app_dir/AegisMobile.xcodeproj/project.pbxproj" ]]; then
    echo "error: no iOS project in $app_dir; set IOS_APP_DIR" >&2
    exit 1
fi

udid=$(xcrun simctl list devices available -j | python3 -c '
import json, sys
name = sys.argv[1]
devices = json.load(sys.stdin)["devices"]
matches = [(rt, d["udid"]) for rt, ds in devices.items() if ".iOS-" in rt for d in ds if d["name"] == name]
if not matches:
    sys.exit(f"error: no available simulator named {name}")
version = lambda rt: [int(p) for p in rt.rsplit("iOS-", 1)[1].split("-")]
print(max(matches, key=lambda m: version(m[0]))[1])
' "$device")

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
rsync -a --exclude build --exclude docs "$app_dir/" "$work/ios/"
# The app's own entry point steps aside; its views and colours stay available.
sed -i '' 's/^@main$//' "$work/ios/AegisMobile/App/AegisMobileApp.swift"
cp "$here/FlowsPrototype.swift" "$work/ios/AegisMobile/App/"

xcodebuild build -quiet \
    -project "$work/ios/AegisMobile.xcodeproj" -scheme AegisMobile -configuration Debug \
    -destination "platform=iOS Simulator,id=$udid" -derivedDataPath "$work/DerivedData" \
    AEGIS_BUNDLE_ID_PREFIX=com.example.aegis.proto

xcrun simctl boot "$udid" 2>/dev/null || true
xcrun simctl bootstatus "$udid" -b >/dev/null
xcrun simctl install "$udid" "$work/DerivedData/Build/Products/Debug-iphonesimulator/AegisMobile.app"
mkdir -p "$out"

# language screen theme content-size
renders="
fr catalogue light large
fr catalogue dark large
en catalogue light large
fr catalogue-chargement light large
fr catalogue-vide light large
fr catalogue-hors-ligne dark large
fr catalogue light accessibility-extra-extra-extra-large
fr fiche-prete light large
fr fiche-bloquee light large
en fiche-bloquee dark large
fr reserver light large
fr reserver-casier-ferme dark large
fr activite-vide light large
fr activite-reservation light large
en activite-reservation dark large
fr activite-pret-retard light large
fr activite-casier-hors-ligne light large
fr operation-code-en-attente light large
fr scan dark large
fr scan-camera-refusee light large
fr operation-autorisee light large
fr operation-deverrouillage dark large
en operation-deverrouillage light large
fr operation-deverrouillage light accessibility-extra-extra-extra-large
fr operation-reseau-perdu light large
fr retour-porte-ouverte light large
fr operation-confirmee light large
fr operation-expiree light large
fr operation-anomalie dark large
"

echo "$renders" | while read -r lang screen theme size; do
    [[ -n "$lang" ]] || continue
    xcrun simctl terminate "$udid" "$bundle_id" 2>/dev/null || true
    xcrun simctl ui "$udid" appearance "$theme"
    xcrun simctl ui "$udid" content_size "$size"
    locale=fr_CA
    [[ "$lang" == en ]] && locale=en_CA
    # Native pickers follow the app locale, not only the SwiftUI environment.
    SIMCTL_CHILD_AEGIS_PROTO_SCREEN="$screen" SIMCTL_CHILD_AEGIS_PROTO_LANG="$lang" \
        xcrun simctl launch "$udid" "$bundle_id" -AppleLanguages "($lang)" -AppleLocale "$locale" >/dev/null
    sleep 6
    suffix=$theme
    [[ "$size" == large ]] || suffix="$theme-ax"
    file="$out/$lang-$screen-$suffix.png"
    xcrun simctl io "$udid" screenshot "$file" >/dev/null 2>&1
    sips --resampleWidth 600 "$file" >/dev/null
    echo "$file"
done

xcrun simctl terminate "$udid" "$bundle_id" 2>/dev/null || true
xcrun simctl ui "$udid" appearance light
xcrun simctl ui "$udid" content_size large
