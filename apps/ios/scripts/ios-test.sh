#!/bin/bash
# Reproducible iOS test recipes, shared by developers and CI.
#
#   standalone  Unit and UI tests that need no backend, then the String Catalog
#               check. Live tests are excluded, not skipped, and any skipped
#               test fails the recipe.
#   live        Tests against a running Aegis Control with demo accounts. Fails
#               when a variable is missing, the API is unreachable, or a live
#               test is skipped.
#
# Environment:
#   IOS_DESTINATION          xcodebuild destination
#                            (default: platform=iOS Simulator,name=iPhone 17,OS=latest)
#   IOS_DERIVED_DATA         derived data under apps/ios/build (default: build/DerivedData)
#   IOS_RESULTS_DIR          result bundles (default: build/results)
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
    "AegisMobileUITests/HealthScreenUITests/testLiveServiceShowsHealth"
    "AegisMobileUITests/SignInLiveUITests"
)
# 1 health + 4 authentication client tests, 1 health + 2 sign-in UI tests.
LIVE_TEST_COUNT=8

usage() {
    echo "usage: $0 standalone|live" >&2
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
check_results() {
    local bundle=$1 expected=${2:-}
    xcrun xcresulttool get test-results summary --path "$bundle" |
        python3 -c '
import json, sys
expected = sys.argv[1]
s = json.load(sys.stdin)
total, passed = s["totalTestCount"], s["passedTests"]
failed, skipped = s["failedTests"], s["skippedTests"]
print(f"tests: {total} total, {passed} passed, {failed} failed, {skipped} skipped")
problems = []
if s["result"] != "Passed" or failed:
    problems.append("failures")
if skipped:
    problems.append("skipped tests are not accepted")
if total == 0:
    problems.append("no test ran")
if expected and passed != int(expected):
    problems.append(f"expected {expected} passing tests")
if problems:
    sys.exit("error: " + "; ".join(problems))
' "$expected"
}

standalone() {
    local bundle="$RESULTS_DIR/standalone.xcresult" status=0
    run_tests "$bundle" "${LIVE_TESTS[@]/#/-skip-testing:}" || status=$?
    check_results "$bundle"
    python3 scripts/check-strings.py "$DERIVED_DATA"
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
    check_results "$bundle" "$LIVE_TEST_COUNT"
    return "$status"
}

case "${1:-}" in
    standalone) standalone ;;
    live) live ;;
    *) usage ;;
esac
