#!/bin/bash
# Reproducible iOS test recipes, shared by developers and CI.
#
#   standalone  Unit and UI tests that need no backend, then the String Catalog
#               check. Live tests are excluded, not skipped, and any skipped
#               test fails the recipe.
#   live        Tests against a running Aegis Control. Fails when the address is
#               missing, the API is unreachable, or a live test is skipped.
#
# Environment:
#   IOS_DESTINATION          xcodebuild destination
#                            (default: platform=iOS Simulator,name=iPhone 17,OS=latest)
#   IOS_DERIVED_DATA         derived data path (default: build/DerivedData)
#   IOS_RESULTS_DIR          result bundles (default: build/results)
#   AEGIS_LIVE_API_BASE_URL  live only, e.g. http://localhost:8080/api/v1
set -euo pipefail

cd "$(dirname "$0")/.."

DESTINATION=${IOS_DESTINATION:-"platform=iOS Simulator,name=iPhone 17,OS=latest"}
DERIVED_DATA=${IOS_DERIVED_DATA:-build/DerivedData}
RESULTS_DIR=${IOS_RESULTS_DIR:-build/results}

LIVE_UNIT_TESTS="AegisMobileTests/LiveAPIIntegrationTests"
LIVE_UI_TESTS="AegisMobileUITests/HealthScreenUITests/testLiveServiceShowsHealth"
LIVE_TEST_COUNT=2

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
    if [ ! -d "$bundle" ]; then
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
    run_tests "$bundle" \
        "-skip-testing:$LIVE_UNIT_TESTS" \
        "-skip-testing:$LIVE_UI_TESTS" || status=$?
    check_results "$bundle"
    python3 scripts/check-strings.py "$DERIVED_DATA"
    return "$status"
}

live() {
    if [ -z "${AEGIS_LIVE_API_BASE_URL:-}" ]; then
        echo "error: AEGIS_LIVE_API_BASE_URL is required, e.g. http://localhost:8080/api/v1" >&2
        exit 1
    fi
    if ! curl -fsS --max-time 10 "$AEGIS_LIVE_API_BASE_URL/system/health" >/dev/null; then
        echo "error: Aegis Control is unreachable at $AEGIS_LIVE_API_BASE_URL" >&2
        exit 1
    fi
    export TEST_RUNNER_AEGIS_LIVE_API_BASE_URL="$AEGIS_LIVE_API_BASE_URL"
    local bundle="$RESULTS_DIR/live.xcresult" status=0
    run_tests "$bundle" \
        "-only-testing:$LIVE_UNIT_TESTS" \
        "-only-testing:$LIVE_UI_TESTS" || status=$?
    check_results "$bundle" "$LIVE_TEST_COUNT"
    return "$status"
}

case "${1:-}" in
    standalone) standalone ;;
    live) live ;;
    *) usage ;;
esac
