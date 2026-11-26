#!/bin/sh
# Blocks a Release archive whose identity or API address is missing or still a
# placeholder. Run by the "Check Release Identity" build phase of the app
# target; Debug builds, tests and simulator runs are never affected, so a
# local Debug signing stays possible.
#
# The values are the effective build settings, after Shared.xcconfig,
# Release.xcconfig and the untracked Local.xcconfig. Passing this check does
# not prove that the Team and Bundle ID are registered in App Store Connect;
# confirm that before any upload.
#
# Can also be run by hand with the same variables, for example:
#   ACTION=install CONFIGURATION=Release PRODUCT_BUNDLE_IDENTIFIER=... \
#   DEVELOPMENT_TEAM=... AEGIS_API_BASE_URL=https://... scripts/check-release-identity.sh
set -u

if [ "${ACTION:-}" != "install" ] || [ "${CONFIGURATION:-}" != "Release" ]; then
    exit 0
fi

failed=0
fail() {
    echo "error: Release archive blocked: $1"
    failed=1
}

bundle="${PRODUCT_BUNDLE_IDENTIFIER:-}"
case "$bundle" in
    "") fail "PRODUCT_BUNDLE_IDENTIFIER is empty. Set AEGIS_APP_BUNDLE_ID in Config/Local.xcconfig." ;;
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

url="${AEGIS_API_BASE_URL:-}"
case "$url" in
    "") fail "AEGIS_API_BASE_URL is empty. Set the HTTPS address of the API in Config/Local.xcconfig." ;;
    https://localhost* | https://127.* | https://\[::1\]*)
        fail "AEGIS_API_BASE_URL points to this Mac; an iPhone cannot reach it." ;;
    https://*example.*) fail "AEGIS_API_BASE_URL \"$url\" is the example address." ;;
    https://?*) ;;
    *) fail "AEGIS_API_BASE_URL must start with https:// (found \"$url\")." ;;
esac

if [ "$failed" -ne 0 ]; then
    exit 1
fi

echo "note: Release archive identity: bundle $bundle, team $team, API $url," \
     "version ${MARKETING_VERSION:-?} (${CURRENT_PROJECT_VERSION:-?}). Confirm the App Store Connect record before upload."
