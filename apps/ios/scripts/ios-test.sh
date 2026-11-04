#!/bin/bash
# Reproducible iOS test recipes, shared by developers and CI.
#
#   standalone  Unit and UI tests that need no backend, then the String Catalog
#               check. Live tests are excluded, not skipped, and any skipped
#               test fails the recipe.
#   pr          The fast pull request subset: every unit test (contracts,
#               decoding, strings, view models), one UI test per critical path,
#               then the String Catalog check.
#   extended    The remaining UI tests: both languages, both appearances,
#               largest text sizes and accessibility audits. pr and extended
#               together run exactly the standalone tests.
#   live        Tests against a running Aegis Control with demo accounts. Fails
#               when a variable is missing, the API is unreachable, or a live
#               test is skipped.
#
# Environment:
#   IOS_DESTINATION          xcodebuild destination
#                            (default: platform=iOS Simulator,name=iPhone 17,OS=latest)
#   IOS_DERIVED_DATA         derived data under apps/ios/build (default: build/DerivedData)
#   IOS_RESULTS_DIR          result bundles and <recipe>-summary.json
#                            (default: build/results)
#   GITHUB_STEP_SUMMARY      set by GitHub Actions: a Markdown summary is appended
#   AEGIS_LIVE_API_BASE_URL         live only, e.g. http://localhost:8080/api/v1
#   AEGIS_LIVE_TECHNICIAN_PASSWORD  live only, demo technician password
#   AEGIS_LIVE_ADMIN_PASSWORD       live only, demo administrator password
#   AEGIS_LIVE_TECHNICIAN_EMAIL, AEGIS_LIVE_ADMIN_EMAIL
#                                   optional, default technician@ / admin@aegis.demo
set -euo pipefail

cd "$(dirname "$0")/.."

DESTINATION=${IOS_DESTINATION:-"platform=iOS Simulator,name=iPhone 17,OS=latest"}
DERIVED_DATA=${IOS_DERIVED_DATA:-build/DerivedData}
RESULTS_DIR=${IOS_RESULTS_DIR:-build/results}

LIVE_TESTS=(
    "AegisMobileTests/LiveAPIIntegrationTests"
    "AegisMobileTests/LiveAuthIntegrationTests"
    "AegisMobileTests/LiveCatalogIntegrationTests"
    "AegisMobileTests/LiveReservationIntegrationTests"
    "AegisMobileUITests/HealthScreenUITests/testLiveServiceShowsHealth"
    "AegisMobileUITests/SignInLiveUITests"
    "AegisMobileUITests/ReservationLiveUITests"
)
# 1 health + 4 authentication + 1 catalogue + 3 reservation client tests, 1 health + 3 sign-in and
# catalogue + 1 reservation UI tests.
LIVE_TEST_COUNT=14

# One UI test per critical path, in one language. Every other standalone UI
# test runs in extended, so no test is dropped by the split.
PR_UI_TESTS=(
    "AegisMobileUITests/HealthScreenUITests/testUnreachableServiceShowsErrorAndRetryInFrench"
    "AegisMobileUITests/SignInUITests/testSignInAndSignOutInFrench"
    "AegisMobileUITests/SignInUITests/testRejectedCredentialsKeepTheAddressInBothLanguages"
    "AegisMobileUITests/SignInUITests/testAdministratorAccountIsRefused"
    "AegisMobileUITests/SignInUITests/testRefusedStoredTokenEndsTheSession"
    "AegisMobileUITests/CatalogUITests/testEveryCardStatesItsStatusInWords"
    "AegisMobileUITests/CatalogUITests/testNextPageIsReadWhenTheLastCardIsReached"
    "AegisMobileUITests/CatalogUITests/testOfflineRefreshKeepsTheLastListThenTryAgainRecovers"
    "AegisMobileUITests/CatalogUITests/testRemovedAssetOffersTheWayBack"
    "AegisMobileUITests/ReservationUITests/testTheProductionRefusalReadsAsARefusal"
    "AegisMobileUITests/ReservationUITests/testALostAnswerIsRetriedAsTheSameIntent"
    "AegisMobileUITests/ReservationUITests/testAClosedLockerCannotBeConfirmed"
    "AegisMobileUITests/ReservationUITests/testMyOwnReservationReplacesReserveOnTheSheet"
    "AegisMobileUITests/ReservationUITests/testARefusedCancelFollowsTheNewRead"
)

usage() {
    echo "usage: $0 standalone|pr|extended|live" >&2
    exit 64
}

run_tests() {
    local bundle=$1
    shift
    rm -rf "$bundle"
    mkdir -p "$(dirname "$bundle")"
    local status=0
    xcodebuild test \
        -project AegisMobile.xcodeproj \
        -scheme AegisMobile \
        -configuration Debug \
        -destination "$DESTINATION" \
        -derivedDataPath "$DERIVED_DATA" \
        -resultBundlePath "$bundle" \
        -parallel-testing-enabled NO \
        -quiet \
        "$@" || status=$?
    if [[ ! -d "$bundle" ]]; then
        echo "error: xcodebuild produced no result bundle (exit $status)" >&2
        exit 1
    fi
    return "$status"
}

# Fails unless every test ran and passed; optionally requires an exact count.
# Also records <recipe>-summary.json and, under GitHub Actions, a step summary.
check_results() {
    local bundle=$1 recipe=$2 expected=${3:-}
    xcrun xcresulttool get test-results summary --path "$bundle" |
        RESULTS_DIR="$RESULTS_DIR" DESTINATION="$DESTINATION" \
        XCODE="$(xcodebuild -version | tr '\n' ' ' | sed 's/ *$//')" \
        SDK="$(xcrun --sdk iphonesimulator --show-sdk-version)" \
        python3 scripts/summarize-results.py "$recipe" "$expected"
}

standalone() {
    local bundle="$RESULTS_DIR/standalone.xcresult" status=0
    run_tests "$bundle" "${LIVE_TESTS[@]/#/-skip-testing:}" || status=$?
    check_results "$bundle" standalone
    python3 scripts/check-strings.py "$DERIVED_DATA"
    return "$status"
}

pr() {
    local bundle="$RESULTS_DIR/pr.xcresult" status=0
    run_tests "$bundle" -only-testing:AegisMobileTests "${PR_UI_TESTS[@]/#/-only-testing:}" \
        "${LIVE_TESTS[@]/#/-skip-testing:}" || status=$?
    check_results "$bundle" pr
    python3 scripts/check-strings.py "$DERIVED_DATA"
    return "$status"
}

extended() {
    local bundle="$RESULTS_DIR/extended.xcresult" status=0
    run_tests "$bundle" -only-testing:AegisMobileUITests "${PR_UI_TESTS[@]/#/-skip-testing:}" \
        "${LIVE_TESTS[@]/#/-skip-testing:}" || status=$?
    check_results "$bundle" extended
    return "$status"
}

live() {
    local name
    for name in AEGIS_LIVE_API_BASE_URL AEGIS_LIVE_TECHNICIAN_PASSWORD AEGIS_LIVE_ADMIN_PASSWORD; do
        if [[ -z "${!name:-}" ]]; then
            echo "error: $name is required for the live recipe" >&2
            exit 1
        fi
    done
    if ! curl -fsS --max-time 10 "$AEGIS_LIVE_API_BASE_URL/system/health" >/dev/null; then
        echo "error: Aegis Control is unreachable at $AEGIS_LIVE_API_BASE_URL" >&2
        exit 1
    fi
    # Passed to the test runners only; never printed.
    export TEST_RUNNER_AEGIS_LIVE_API_BASE_URL="$AEGIS_LIVE_API_BASE_URL"
    export TEST_RUNNER_AEGIS_LIVE_TECHNICIAN_PASSWORD="$AEGIS_LIVE_TECHNICIAN_PASSWORD"
    export TEST_RUNNER_AEGIS_LIVE_ADMIN_PASSWORD="$AEGIS_LIVE_ADMIN_PASSWORD"
    [[ -z "${AEGIS_LIVE_TECHNICIAN_EMAIL:-}" ]] || export TEST_RUNNER_AEGIS_LIVE_TECHNICIAN_EMAIL="$AEGIS_LIVE_TECHNICIAN_EMAIL"
    [[ -z "${AEGIS_LIVE_ADMIN_EMAIL:-}" ]] || export TEST_RUNNER_AEGIS_LIVE_ADMIN_EMAIL="$AEGIS_LIVE_ADMIN_EMAIL"
    local bundle="$RESULTS_DIR/live.xcresult" status=0
    run_tests "$bundle" "${LIVE_TESTS[@]/#/-only-testing:}" || status=$?
    check_results "$bundle" live "$LIVE_TEST_COUNT"
    return "$status"
}

case "${1:-}" in
    standalone) standalone ;;
    pr) pr ;;
    extended) extended ;;
    live) live ;;
    *) usage ;;
esac
