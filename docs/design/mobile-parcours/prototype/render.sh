#!/bin/bash
# Renders the technician-flow prototype with the real iOS SDK and simulator.
# The prototype is compiled into a temporary copy of the iOS project (reusing
# its v3 colours and components), so the application sources are never
# modified.
#
#   IOS_APP_DIR         iOS project to copy (default: <repo>/apps/ios)
#   PROTO_DEVICE        reference simulator (default: iPhone 17, newest runtime)
#   PROTO_SMALL_DEVICE  small simulator (default: iPhone SE (3rd generation))
#   PROTO_SMALL_OS      its runtime (default: 17.5, the minimum target's major)
#   OUT_DIR             captures directory (default: ../captures)
#
# The simulator's language and region stand for the user's own settings; the
# prototype does not force a locale.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
repo=$(git -C "$here" rev-parse --show-toplevel)
app_dir=${IOS_APP_DIR:-$repo/apps/ios}
device=${PROTO_DEVICE:-iPhone 17}
small_device=${PROTO_SMALL_DEVICE:-iPhone SE (3rd generation)}
small_os=${PROTO_SMALL_OS:-17.5}
out=${OUT_DIR:-$here/../captures}
bundle_id=com.example.aegis.proto.mobile

if [[ ! -f "$app_dir/AegisMobile.xcodeproj/project.pbxproj" ]]; then
    echo "error: no iOS project in $app_dir; set IOS_APP_DIR" >&2
    exit 1
fi

# Prints the UDID of an available simulator, on the given runtime or the newest.
find_udid() {
    xcrun simctl list devices available -j | python3 -c '
import json, sys
name, wanted = sys.argv[1], sys.argv[2]
devices = json.load(sys.stdin)["devices"]
version = lambda rt: [int(p) for p in rt.rsplit("iOS-", 1)[1].split("-")]
matches = [(version(rt), d["udid"]) for rt, ds in devices.items() if ".iOS-" in rt for d in ds if d["name"] == name]
if wanted:
    matches = [m for m in matches if m[0][:len(wanted.split("."))] == [int(p) for p in wanted.split(".")]]
if not matches:
    sys.exit(f"error: no available simulator named {name} {wanted}".rstrip())
print(max(matches)[1])
' "$1" "${2:-}"
}

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
rsync -a --exclude build --exclude docs "$app_dir/" "$work/ios/"
# The app's own entry point steps aside; its views and colours stay available.
sed -i '' 's/^@main$//' "$work/ios/AegisMobile/App/AegisMobileApp.swift"
cp "$here/FlowsPrototype.swift" "$work/ios/AegisMobile/App/"

udid=$(find_udid "$device")
small_udid=$(find_udid "$small_device" "$small_os")

xcodebuild build -quiet \
    -project "$work/ios/AegisMobile.xcodeproj" -scheme AegisMobile -configuration Debug \
    -destination "platform=iOS Simulator,id=$udid" -derivedDataPath "$work/DerivedData" \
    AEGIS_BUNDLE_ID_PREFIX=com.example.aegis.proto

app="$work/DerivedData/Build/Products/Debug-iphonesimulator/AegisMobile.app"
mkdir -p "$out"

# render <udid> <file suffix> <list of "language screen theme content-size">
render() {
    local target=$1 tag=$2 list=$3
    xcrun simctl boot "$target" 2>/dev/null || true
    xcrun simctl bootstatus "$target" -b >/dev/null
    xcrun simctl install "$target" "$app"
    echo "$list" | while read -r lang screen theme size; do
        [[ -n "$lang" ]] || continue
        xcrun simctl terminate "$target" "$bundle_id" 2>/dev/null || true
        xcrun simctl ui "$target" appearance "$theme"
        xcrun simctl ui "$target" content_size "$size"
        locale=fr_CA
        [[ "$lang" == en ]] && locale=en_CA
        SIMCTL_CHILD_AEGIS_PROTO_SCREEN="$screen" \
            xcrun simctl launch "$target" "$bundle_id" -AppleLanguages "($lang)" -AppleLocale "$locale" >/dev/null
        sleep 6
        suffix=$theme
        [[ "$size" == large ]] || suffix="$theme-ax"
        file="$out/$lang-$screen-$suffix$tag.png"
        xcrun simctl io "$target" screenshot "$file" >/dev/null 2>&1
        sips --resampleWidth 600 "$file" >/dev/null
        echo "$file"
    done
    xcrun simctl terminate "$target" "$bundle_id" 2>/dev/null || true
    xcrun simctl ui "$target" appearance light
    xcrun simctl ui "$target" content_size large
}

# language screen theme content-size
render "$udid" "" "
fr catalogue light large
fr catalogue dark large
en catalogue light large
fr catalogue light accessibility-extra-extra-extra-large
fr catalogue-chargement light large
fr catalogue-vide light large
fr catalogue-hors-ligne dark large
en catalogue-hors-ligne light large
fr fiche-prete light large
fr fiche-bloquee light large
en fiche-bloquee dark large
fr reserver light large
en reserver light large
fr reserver-casier-ferme dark large
fr activite-vide light large
fr activite-reservation light large
en activite-reservation dark large
fr activite-pret-retard light large
fr activite-casier-hors-ligne light large
en activite-casier-hors-ligne dark large
fr activite-retrait-a-reessayer light large
fr activite-operation-en-cours light large
fr operation-code-en-attente light large
fr scan dark large
fr scan-camera-refusee light large
fr operation-autorisee light large
fr operation-deverrouillage dark large
en operation-deverrouillage light large
fr operation-deverrouillage light accessibility-extra-extra-extra-large
fr operation-reseau-perdu light large
en operation-reseau-perdu dark large
fr operation-reseau-perdu light accessibility-extra-extra-extra-large
fr retour-porte-ouverte light large
fr operation-confirmee light large
fr operation-expiree light large
fr operation-anomalie dark large
"

render "$small_udid" "-se" "
fr reserver light large
fr fiche-bloquee light large
fr operation-deverrouillage light large
"
