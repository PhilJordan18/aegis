#!/usr/bin/env bash
# The iOS technician journey on a real stack (#46, #50, #67): the real app in the iOS simulator against a real API,
# PostgreSQL and Mosquitto, with the hub simulator playing the demo locker.
#
#   IOS_DESTINATION='id=<simulator>' apps/ios/scripts/live-journey.sh     # from anywhere in the repository, ~15 min
#
# One disposable Compose project (aegis-ios-journey) on its own ports and volumes, never the developer stack; the hub
# simulator has its own device files and the API its own MQTT client id. The API is built from the checked-out commit.
#
# AegisMobileUITests/OperationLiveUITests drives the app. This script answers it through a bridge directory:
#   qr                       the URI of the QR the hub currently displays, decrypted here from the sealed row with the
#                            display key drawn for this run (mode 600, removed once the challenge ends); the test
#                            pastes it into the Debug-only code entry
#   request.<step> → done.<step>   asset-ready, stop-api, start-api, acknowledge-anomaly, rotate-password, and
#                            diagnose (read only: when the loan does not list RETURN yet, the server state is kept in
#                            diagnose.txt and a NOTE line reports it before the test taps « Actualiser » once)
# The QR token is never printed. A SHA-256 of each token served is kept, and at the end every log, the xcodebuild
# output and the test activities are searched for any of them.
#
# The hub plays five unlocks in order: checkout, return without the asset (ANOMALY at the deadline), Q2 return,
# checkout with the door held open 45 s (lost API, background), return with the door held open 30 s (relaunch).
# The shipped preparation ceiling is kept: the journey makes five preparations. The locker closes at 23:59
# America/Toronto, so the script refuses to start after 23:15 there.
# Exit code: number of FAIL lines. Needs docker compose, Java 21, Node 22.18+, python3, openssl, Xcode.
# Overrides: IOS_JOURNEY_DB_PORT (58753), IOS_JOURNEY_MQTT_PORT (55154), IOS_JOURNEY_API_PORT (19601).
set -euo pipefail

root=$(git rev-parse --show-toplevel)
cd "$root"
project=aegis-ios-journey
work=$(mktemp -d "${TMPDIR:-/tmp}/aegis-ios-journey.XXXXXX")
bridge="$work/bridge"
scenarios=$(mktemp -d tools/hub-simulator/.ios-journey.XXXXXX)
db_port=${IOS_JOURNEY_DB_PORT:-58753}
mqtt_port=${IOS_JOURNEY_MQTT_PORT:-55154}
api_port=${IOS_JOURNEY_API_PORT:-19601}
destination=${IOS_DESTINATION:-"platform=iOS Simulator,name=iPhone 17,OS=latest"}
derived=${IOS_DERIVED_DATA:-apps/ios/build/DerivedData}
results=${IOS_RESULTS_DIR:-apps/ios/build/results}
locker=d46a74ae-39dc-460b-8af0-38fc791b376a
tag=E20034120123456789000001

# The locker closes at 23:59 (America/Toronto) and both reservations need a quarter-hour end at
# least five minutes ahead: a journey started after 23:15 would meet a closed sheet, not a defect.
lab_minutes=$(( 10#$(TZ=America/Toronto date +%H) * 60 + 10#$(TZ=America/Toronto date +%M) ))
if (( lab_minutes >= 23 * 60 + 15 )); then
  echo "FAIL BLOCKED clock: $(TZ=America/Toronto date +%H:%M) in America/Toronto, start after midnight"; exit 2
fi
: >"$work/served-token-hashes"

sed -e "s/^AEGIS_DB_PORT=.*/AEGIS_DB_PORT=$db_port/" -e "s/^AEGIS_MQTT_PORT=.*/AEGIS_MQTT_PORT=$mqtt_port/" \
  infra/docker/.env.example >"$work/env"
compose=(docker compose -p "$project" --env-file "$work/env" -f infra/docker/compose.yaml)
sql() { docker exec -i "$project-postgres-1" psql -U aegis -d aegis -tA -c "$1"; }

api_pid= hub_pid= test_pid=
stop_api() {
  [[ -z "$api_pid" ]] || { kill "$api_pid" 2>/dev/null || true; wait "$api_pid" 2>/dev/null || true; }
  api_pid=
}
stop_hub() {
  if [[ -n "$hub_pid" ]]; then
    kill "$hub_pid" 2>/dev/null || true
    for _ in $(seq 1 10); do kill -0 "$hub_pid" 2>/dev/null || break; sleep 1; done
    kill -0 "$hub_pid" 2>/dev/null && kill -9 "$hub_pid"
    wait "$hub_pid" 2>/dev/null || true
  fi
  hub_pid=
}
cleanup() {
  [[ -z "$test_pid" ]] || kill "$test_pid" 2>/dev/null || true
  rm -rf "$scenarios" "$bridge"
  stop_api
  stop_hub
  "${compose[@]}" down -v >/dev/null 2>&1 || true
  rm -f "$work/keys"
  echo "logs: $work"
}
trap cleanup EXIT

for image in $(grep -E '^\s+image:' infra/docker/compose.yaml | awk '{print $2}' | sort -u); do
  docker image inspect "$image" >/dev/null 2>&1 && continue
  if ! docker pull -q "$image" >/dev/null 2>&1; then
    repo=${image%%:*} digest=${image#*@}
    docker pull -q "mirror.gcr.io/library/$repo@$digest" >/dev/null
    docker tag "mirror.gcr.io/library/$repo@$digest" "${image%@*}"
  fi
done

(cd services/api && ./mvnw -B -q -ntp -DskipTests package >"$work/build.log" 2>&1)
jar=$(ls services/api/target/aegis-control-*.jar | head -1)
echo "api: $jar, repository at $(git rev-parse --short HEAD)"
(cd tools/hub-simulator && { [[ -d node_modules ]] || npm ci --ignore-scripts >/dev/null; })

umask 077
mkdir "$bridge"
printf 'K1=%s\n' "$(openssl rand -base64 32)" >"$work/keys"
# shellcheck disable=SC1091
. "$work/keys"
set -a
# shellcheck disable=SC1091
. "$work/env"
AEGIS_JWT_SECRET=$(openssl rand -base64 48)
AEGIS_DEMO_ACCOUNTS_ENABLED=true
AEGIS_DEMO_LOCKER_ENABLED=true
AEGIS_DEMO_ADMIN_PASSWORD=ios-journey-admin-$(openssl rand -hex 8)
AEGIS_DEMO_TECHNICIAN_PASSWORD=ios-journey-tech-$(openssl rand -hex 8)
AEGIS_MQTT_ENABLED=true
AEGIS_MQTT_URL=tcp://127.0.0.1:$mqtt_port
AEGIS_MQTT_CLIENT_ID=aegis-api-ios-journey
AEGIS_DISPLAY_ENABLED=true
AEGIS_DISPLAY_KEYS=k1:$K1
AEGIS_DISPLAY_ACTIVE_KEY_ID=k1
AEGIS_DISPLAY_DISPATCHER_ENABLED=true
AEGIS_COMMAND_DISPATCHER_ENABLED=true
SERVER_PORT=$api_port
AEGIS_API_URL=http://127.0.0.1:$api_port/api/v1
set +a
api=$AEGIS_API_URL
initial_password=$AEGIS_DEMO_TECHNICIAN_PASSWORD

failures=0
pass() { echo "PASS $*"; }
fail() { echo "FAIL $*"; failures=$((failures + 1)); }
json() { python3 -c "import json,sys; d=json.load(sys.stdin); print($1)"; }

start_api() {
  java -jar "$jar" >>"$work/api.log" 2>&1 &
  api_pid=$!
  for _ in $(seq 1 90); do
    curl -fs "$api/system/health" >/dev/null 2>&1 && return 0
    kill -0 "$api_pid" 2>/dev/null || { api_pid=; return 1; }
    sleep 1
  done
  return 1
}
login() {
  curl -fs -H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"password\":\"$2\"}" "$api/auth/login" |
    json 'd["accessToken"]'
}

# publish_qr: the URI of the newest displayed, unconsumed challenge, or no file. The token stays in this function.
served=
publish_qr() {
  local row uri
  row=$(sql "SELECT d.challenge_id || ' ' || d.id || ' ' || d.locker_id || ' ' || d.operation_id || ' ' ||
                    d.display_revision || ' ' || d.encryption_key_id || ' ' || encode(d.encrypted_payload, 'base64')
             FROM aegis.hub_display_outbox d JOIN aegis.local_access_challenges c ON c.id = d.challenge_id
             WHERE d.message_type = 'DISPLAY_ACCESS_CHALLENGE' AND d.encrypted_payload IS NOT NULL
               AND c.displayed_at IS NOT NULL AND c.consumed_at IS NULL AND c.closed_at IS NULL
             ORDER BY c.created_at DESC LIMIT 1" 2>/dev/null | tr -d '\n') || return 0
  if [[ -z "$row" ]]; then rm -f "$bridge/qr"; served=; return 0; fi
  [[ "${row%% *}" == "$served" ]] && return 0
  # AES-256-GCM as sealed by the API (nonce, then ciphertext and tag), with Node's built-in crypto.
  uri=$(printf '%s' "$row" | K1=$K1 node -e '
const crypto = require("node:crypto");
const [challenge, row, locker, operation, revision, keyId, payload] = require("node:fs").readFileSync(0, "utf8").split(" ");
const envelope = Buffer.from(payload, "base64");
const decipher = crypto.createDecipheriv("aes-256-gcm", Buffer.from(process.env[keyId.toUpperCase()], "base64"), envelope.subarray(0, 12));
decipher.setAAD(Buffer.from(`aegis-display-aad/v1\n${row}\n${locker}\n${operation}\n${revision}`));
decipher.setAuthTag(envelope.subarray(envelope.length - 16));
const plain = JSON.parse(Buffer.concat([decipher.update(envelope.subarray(12, envelope.length - 16)), decipher.final()]).toString("utf8"));
process.stdout.write(`aegis://local-access?v=1&challengeId=${challenge}&operationId=${operation}&lockerId=${locker}&token=${plain.payload.token}`);')
  printf '%s' "${uri##*token=}" | shasum -a 256 | cut -d' ' -f1 >>"$work/served-token-hashes"
  printf '%s' "$uri" >"$bridge/qr.tmp" && mv "$bridge/qr.tmp" "$bridge/qr"
  unset uri
  served=${row%% *}
}

# answer <step>: one request of the test; an empty done file is a success, otherwise it holds the reason.
answer() {
  local reason= admin anomaly
  case $1 in
    stop-api) stop_api ;;
    start-api) start_api || reason="the API did not restart" ;;
    asset-ready)
      local readiness= token
      token=$(login technician@aegis.demo "$AEGIS_DEMO_TECHNICIAN_PASSWORD") || token=
      local asset
      asset=$(curl -fs -H "Authorization: Bearer $token" "$api/assets?q=AEG-DEMO-001&page=0&size=10" |
        json '[a for a in d["items"] if a["assetCode"] == "AEG-DEMO-001"][0]["id"]') || asset=unknown
      for _ in $(seq 1 60); do
        readiness=$(curl -fs -H "Authorization: Bearer $token" "$api/assets/$asset" |
          json 'd["readiness"]["result"]') || readiness=unreadable
        [[ $readiness == READY ]] && break
        sleep 2
      done
      [[ $readiness == READY ]] || reason="readiness $readiness" ;;
    acknowledge-anomaly)
      admin=$(login admin@aegis.demo "$AEGIS_DEMO_ADMIN_PASSWORD") || admin=
      anomaly=$(sql "SELECT id FROM aegis.anomalies WHERE status = 'OPEN' ORDER BY detected_at DESC LIMIT 1") ||
        anomaly=
      if [[ -z "$anomaly" ]]; then reason="no OPEN anomaly"; else
        curl -fs -o /dev/null -X POST -H "Authorization: Bearer $admin" -H 'Content-Type: application/json' \
          -H "Idempotency-Key: $(python3 -c 'import uuid; print(uuid.uuid4())')" \
          -d '{"note":"Retour vérifié sur place : équipement absent de la cellule, nouvelle tentative admise."}' \
          "$api/admin/anomalies/$anomaly/acknowledge" || reason="acknowledgement refused"
      fi ;;
    diagnose) # Read only: why the server did not list RETURN, appended to the run's evidence.
      { echo "== diagnose $(date -u +%FT%TZ)"
        sql "SELECT 'cell', code, enabled, connection_status, rfid_reader_status, door_state, lock_state
               FROM aegis.compartments" || true
        sql "SELECT 'locker', status, last_seen_at, now() FROM aegis.lockers" || true
        sql "SELECT 'operation', type, status, coalesce(failure_reason, '-'), terminal_at
               FROM aegis.locker_operations ORDER BY created_at" || true
        sql "SELECT 'anomaly', type, status FROM aegis.anomalies" || true
        sql "SELECT 'loan', status FROM aegis.loans" || true
        token=$(login technician@aegis.demo "$AEGIS_DEMO_TECHNICIAN_PASSWORD") &&
          curl -fs -H "Authorization: Bearer $token" "$api/me/loan" |
          json '"loan.availableActions " + ",".join(d["availableActions"]) + " status " + d["status"]' || true
      } >>"$work/diagnose.txt" 2>&1
      echo "NOTE the server did not list RETURN at first; see $work/diagnose.txt" ;;
    rotate-password)
      stop_api
      AEGIS_DEMO_TECHNICIAN_PASSWORD=ios-journey-tech-$(openssl rand -hex 8)
      export AEGIS_DEMO_TECHNICIAN_PASSWORD
      printf '%s' "$AEGIS_DEMO_TECHNICIAN_PASSWORD" >"$bridge/technician-password"
      start_api || reason="the API did not restart" ;;
    *) reason="unknown step" ;;
  esac
  echo "  step $1: ${reason:-done}"
  printf '%s' "$reason" >"$bridge/done.$1"
}

steps='{ "do": "waitOnline", "timeoutMs": 15000 }, { "do": "setScreen", "available": true }, { "wait": 3000 },
  { "do": "putTag", "code": "A1", "identifier": "'$tag'" }, { "do": "scanRfid", "code": "A1" }'
# The door opens within the lock's 15 s window and stays open for <open ms>: the long holds keep it
# open while the API is stopped or the app relaunched, so the hub's events wait in the API's session.
unlock() { # unlock <open ms> <tag step or empty>
  steps+=', { "do": "waitUnlocked", "code": "A1", "timeoutMs": 1800000 }, { "wait": 1000 },
  { "do": "openDoor", "code": "A1" }'"${2:+, $2}"', { "wait": '$1' }, { "do": "closeDoor", "code": "A1" }'
}
unlock 1500 '{ "do": "takeTag", "code": "A1", "identifier": "'$tag'" }'
unlock 1500 ''
unlock 1500 '{ "do": "putTag", "code": "A1", "identifier": "'$tag'" }'
unlock 45000 '{ "do": "takeTag", "code": "A1", "identifier": "'$tag'" }'
unlock 30000 '{ "do": "putTag", "code": "A1", "identifier": "'$tag'" }'
printf '{ "steps": [ %s, { "wait": 1800000 }, { "do": "stop" } ] }\n' "$steps" >"$scenarios/journey.json"
python3 -c 'import json,sys; json.load(open(sys.argv[1]))' "$scenarios/journey.json"

"${compose[@]}" down -v >/dev/null 2>&1 || true
"${compose[@]}" up -d --wait --pull never >/dev/null 2>&1 ||
  { echo "FAIL BLOCKED environment: the Compose stack did not start (is Docker running?)"; exit 2; }
start_api || { echo "FAIL BLOCKED api"; tail -20 "$work/api.log"; exit 1; }
python3 -I services/api/scripts/seed-demo-catalog.py >"$work/seed.log" 2>&1
admin=$(login admin@aegis.demo "$AEGIS_DEMO_ADMIN_PASSWORD")
python3 -c 'import json; print(json.dumps({"timeZone": "America/Toronto", "windows": [
  {"dayOfWeek": d, "enabled": True, "opensAt": "00:00", "closesAt": "23:59"} for d in
  ["MONDAY","TUESDAY","WEDNESDAY","THURSDAY","FRIDAY","SATURDAY","SUNDAY"]]}))' |
  curl -fs -X PUT -H "Authorization: Bearer $admin" -H 'Content-Type: application/json' --data-binary @- \
    "$api/admin/lockers/$locker/operating-schedule" >/dev/null
env AEGIS_MQTT_DEVICE_PASSWORD="$AEGIS_MQTT_DEVICE_PASSWORD" AEGIS_MQTT_URL="mqtt://127.0.0.1:$mqtt_port" \
  AEGIS_SIM_BOOT_COUNT_FILE="$work/boot.json" AEGIS_SIM_COMMAND_JOURNAL_FILE="$work/journal.json" \
  bash -c "cd tools/hub-simulator && exec node src/cli.ts --scenario ${scenarios##*/}/journey.json" \
  >>"$work/simulator.log" 2>&1 &
hub_pid=$!
for _ in $(seq 1 40); do
  [[ $(sql "SELECT connection_status FROM aegis.locker_devices WHERE locker_id = '$locker'") == ONLINE ]] && break
  sleep 1
done
answer asset-ready >/dev/null
[[ ! -s "$bridge/done.asset-ready" ]] || { echo "FAIL BLOCKED $(cat "$bridge/done.asset-ready")"; exit 1; }
rm -f "$bridge/done.asset-ready"

mkdir -p "$results"
bundle="$results/live-journey.xcresult"
rm -rf "$bundle"
(
  cd apps/ios
  TEST_RUNNER_AEGIS_LIVE_API_BASE_URL="http://127.0.0.1:$api_port/api/v1" \
  TEST_RUNNER_AEGIS_LIVE_TECHNICIAN_PASSWORD="$initial_password" \
  TEST_RUNNER_AEGIS_LIVE_BRIDGE_DIR="$bridge" \
    xcodebuild test-without-building -project AegisMobile.xcodeproj -scheme AegisMobile \
      -destination "$destination" -derivedDataPath "${derived#apps/ios/}" -resultBundlePath "${bundle#apps/ios/}" \
      -only-testing:AegisMobileUITests/OperationLiveUITests -parallel-testing-enabled NO
) >"$work/xcodebuild.log" 2>&1 &
test_pid=$!
started=$(date +%s)
while kill -0 "$test_pid" 2>/dev/null; do
  publish_qr
  for request in "$bridge"/request.*; do
    [[ -e "$request" ]] || continue
    rm -f "$request"
    answer "${request##*/request.}"
  done
  sleep 0.5
done
test_status=0
wait "$test_pid" || test_status=$?
test_pid=
echo "xcodebuild: exit $test_status after $(( $(date +%s) - started )) s"
summary=$(xcrun xcresulttool get test-results summary --path "$bundle" 2>/dev/null |
  json '" ".join(str(d[k]) for k in ["result", "totalTestCount", "passedTests", "failedTests", "skippedTests"])' ||
  echo "no result bundle")
[[ $summary == "Passed 1 1 0 0" ]] && pass "APP journey: $summary" || fail "APP journey: $summary"

# What the server recorded, read only. The anomaly was acknowledged, then resolved by the confirmed return.
totals=$(sql "SELECT (SELECT count(*) FROM aegis.loans) || ' ' ||
  (SELECT count(*) FROM aegis.loans WHERE status = 'COMPLETED') || ' ' ||
  (SELECT coalesce(string_agg(type || ':' || status || ':' || coalesce(failure_reason, '-'), ','
     ORDER BY created_at), '-') FROM aegis.locker_operations) || ' ' ||
  (SELECT coalesce(max(n), 0) FROM (SELECT count(*) n FROM aegis.command_outbox GROUP BY operation_id) x) || ' ' ||
  (SELECT coalesce(string_agg(status, ','), '-') FROM aegis.anomalies)")
expected="2 2 CHECKOUT:CONFIRMED:-,RETURN:ANOMALY:EXPECTED_ASSET_NOT_OBSERVED,RETURN:CONFIRMED:-,CHECKOUT:CONFIRMED:-,RETURN:CONFIRMED:- 1 RESOLVED"
[[ $totals == "$expected" ]] && pass "SERVER $totals" || fail "SERVER '$totals', expected '$expected'"

# Token secrecy: no served token in any log, the xcodebuild output or the test activities.
xcrun xcresulttool get test-results activities --path "$bundle" \
  --test-id 'OperationLiveUITests/testTechnicianCompletesTheJourneyAgainstTheRealStack()' \
  >"$work/activities.json" 2>/dev/null || true
served_count=$(wc -l <"$work/served-token-hashes" 2>/dev/null | tr -d ' ' || echo 0)
leaks=$(cat "$work"/api.log "$work"/simulator.log "$work"/xcodebuild.log "$work"/activities.json 2>/dev/null |
  grep -oE '[A-Za-z0-9_-]{43}' | sort -u | while read -r candidate; do printf '%s' "$candidate" | shasum -a 256 |
  cut -d' ' -f1; done | grep -cxF -f "$work/served-token-hashes" || true)
[[ ${served_count:-0} -ge 5 && ${leaks:-0} -eq 0 ]] &&
  pass "SECRECY $served_count tokens served, none in the API, simulator, xcodebuild or activity logs" ||
  fail "SECRECY $served_count tokens served, $leaks found in logs"

echo "IOS JOURNEY: $failures failed"
exit "$failures"
