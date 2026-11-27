#!/bin/sh
# Blocks a Release archive whose identity, API address or environment is
# missing, a placeholder, or not the approved target. Run by the "Check
# Release Identity" build phase of the app target, after the Info.plist is
# processed; Debug builds, tests and simulator runs are never affected, so a
# local Debug signing stays possible.
#
# The API address, the environment and the Bundle ID are read from the
# processed Info.plist: the values the archive really carries, after
# Shared.xcconfig, Release.xcconfig and the untracked Local.xcconfig. The
# team, which the Info.plist does not hold, is the effective build setting.
# The approved address of each environment is written here, not in an
# xcconfig, so that a local override cannot also change the expected value.
# Passing this check does not prove that the Team and Bundle ID are
# registered in App Store Connect; confirm that before any upload.
#
# Can also be run by hand with the same variables, for example:
#   ACTION=install CONFIGURATION=Release INFO_PLIST=path/to/Info.plist \
#   DEVELOPMENT_TEAM=... scripts/check-release-identity.sh
set -u

if [ "${ACTION:-}" != "install" ] || [ "${CONFIGURATION:-}" != "Release" ]; then
    exit 0
fi

# The staging API of #230 and #235. No production address is approved yet:
# a production archive stays blocked until one is decided and written here.
staging_url="https://aegis-api-staging-239f.up.railway.app/api/v1"

failed=0
fail() {
    echo "error: Release archive blocked: $1"
    failed=1
}

plist="${INFO_PLIST:-${TARGET_BUILD_DIR:-}/${INFOPLIST_PATH:-}}"
integrated() {
    /usr/libexec/PlistBuddy -c "Print :$1" "$plist" 2>/dev/null
}
if [ ! -f "$plist" ]; then
    fail "no processed Info.plist at \"$plist\"; the integrated values cannot be checked."
    exit 1
fi

bundle="$(integrated CFBundleIdentifier)"
case "$bundle" in
    "") fail "the archive carries no Bundle ID. Set AEGIS_APP_BUNDLE_ID in Config/Local.xcconfig." ;;
    com.example.* | *.example.* | *yourname*)
        fail "the Bundle ID \"$bundle\" is a placeholder. Set the identifier registered in App Store Connect as AEGIS_APP_BUNDLE_ID in Config/Local.xcconfig." ;;
esac

team="${DEVELOPMENT_TEAM:-}"
case "$team" in
    "") fail "DEVELOPMENT_TEAM is empty. Set the Apple Developer team used for TestFlight in Config/Local.xcconfig." ;;
    ABCDE12345) fail "DEVELOPMENT_TEAM is the example value of Local.xcconfig.example." ;;
    *)
        if ! printf '%s' "$team" | grep -Eq '^[A-Z0-9]{10}$'; then
            fail "DEVELOPMENT_TEAM \"$team\" is not a ten-character Apple team identifier."
        fi ;;
esac

environment="$(integrated AegisEnvironment)"
url="$(integrated AegisAPIBaseURL)"
case "$environment" in
    staging) expected="$staging_url" ;;
    production)
        expected=""
        fail "no production API address is approved; a production archive needs that decision first." ;;
    "")
        expected=""
        fail "the archive names no environment (AegisEnvironment); Account would show an unnamed server. Release names staging." ;;
    *)
        expected=""
        fail "the archive's environment \"$environment\" is neither staging nor production." ;;
esac
if [ -n "$expected" ] && [ "$url" != "$expected" ]; then
    if [ -z "$url" ]; then
        fail "the archive carries no API address; the $environment target is $expected."
    else
        fail "the archive carries the API address \"$url\", not the $environment target $expected. A Config/Local.xcconfig value overrides Release: limit it to Debug (AEGIS_API_BASE_URL[config=Debug] = ...) or remove it."
    fi
fi

if [ "$failed" -ne 0 ]; then
    exit 1
fi

echo "note: Release archive identity: bundle $bundle, team $team, environment $environment" \
     "(shown in Account as « Recette (staging) »), API $url," \
     "version ${MARKETING_VERSION:-?} (${CURRENT_PROJECT_VERSION:-?}). Confirm the App Store Connect record before upload."
