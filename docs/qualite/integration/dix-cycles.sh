#!/usr/bin/env bash
# Ten consecutive simulated checkouts and ten returns (#67 QA mandate, item 5), on ONE stack and ONE hub boot, without
# any manual SQL: every state change goes through the real REST routes, the real QR scan and the simulated hub.
#
#   docs/qualite/integration/dix-cycles.sh     # from the repository root of the integration ref, ~15-40 minutes
#
# Each cycle: reserve AEG-DEMO-001, prepare the checkout (the same Idempotency-Key replayed returns the same operation),
# scan the displayed QR (a second scan is refused, no second command), take the asset, close: CONFIRMED and one ACTIVE
# loan. Then prepare the return (replayed likewise), scan, put the asset back, close: CONFIRMED and the loan COMPLETED.
# After each checkout and each return, the technician routes the mobile app reads (/me/loan, /loans/{id}) and the admin
# routes the Manager reads (/admin/loans, /admin/locker-operations, /admin/reservations) must agree.
# At the end: 10 loans COMPLETED, 10 reservations FULFILLED, 20 operations CONFIRMED, exactly one command per
# operation, no anomaly, one OPERATION_CONFIRMED per operation and one LOAN_COMPLETED per loan, asset READY again.
#
# The shipped preparation ceiling (6 per user and locker per 10 minutes) is kept: a 429 LOCAL_PROOF_RATE_LIMITED is
# expected after six preparations and the script waits for its Retry-After, which makes the run longer. Set
# QA_CYCLES_MAX_PER_WINDOW to raise the ceiling for a faster run; the report then states it.
# The script only reads the database (SELECT); it never writes to it. The hub is simulated: no hardware claim.
# Exit code = number of FAIL lines. Overrides: QA_CYCLES (10), QA_CYC_DB_PORT (58603), QA_CYC_MQTT_PORT (55054),
# QA_CYC_API_PORT (19451).
set -euo pipefail

root=$(git rev-parse --show-toplevel)
cd "$root"
project=aegis-qa-cycles
work=$(mktemp -d "${TMPDIR:-/tmp}/aegis-qa-cycles.XXXXXX")
scenarios=$(mktemp -d tools/hub-simulator/.qa-cyc.XXXXXX)
db_port=${QA_CYC_DB_PORT:-58603}
mqtt_port=${QA_CYC_MQTT_PORT:-55054}
api_port=${QA_CYC_API_PORT:-19451}
cycles=${QA_CYCLES:-10}
locker=d46a74ae-39dc-460b-8af0-38fc791b376a
tag=E20034120123456789000001
foreign=E20034120123456789000099


sed -e "s/^AEGIS_DB_PORT=.*/AEGIS_DB_PORT=$db_port/" -e "s/^AEGIS_MQTT_PORT=.*/AEGIS_MQTT_PORT=$mqtt_port/" \
  infra/docker/.env.example >"$work/env"
compose=(docker compose -p "$project" --env-file "$work/env" -f infra/docker/compose.yaml)
sql() { docker exec -i "$project-postgres-1" psql -U aegis -d aegis -tA -c "$1"; }

api_pid= hub_pid=
stop_api() {
  [[ -z "$api_pid" ]] || { kill "$api_pid" 2>/dev/null || true; wait "$api_pid" 2>/dev/null || true; }
  api_pid=
}
# The simulator keeps its process alive during a scenario "wait" after SIGTERM: bound the stop to 10 s.
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
  rm -rf "$scenarios"
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

# A stale jar would silently test another revision: always build the checked-out commit.
(cd services/api && ./mvnw -B -q -ntp -DskipTests package >"$work/build.log" 2>&1)
jar=$(ls services/api/target/aegis-control-*.jar | head -1)
echo "api: $jar, repository at $(git rev-parse --short HEAD)"
(cd tools/hub-simulator && { [[ -d node_modules ]] || npm ci --ignore-scripts >/dev/null; })

umask 077
printf 'K1=%s\n' "$(openssl rand -base64 32)" >"$work/keys"
# shellcheck disable=SC1091
. "$work/keys"
set -a
# shellcheck disable=SC1091
. "$work/env"
AEGIS_JWT_SECRET=$(openssl rand -base64 48)
AEGIS_DEMO_ACCOUNTS_ENABLED=true
AEGIS_DEMO_LOCKER_ENABLED=true
AEGIS_DEMO_ADMIN_PASSWORD=qa-cyc-admin-$(openssl rand -hex 8)
AEGIS_DEMO_TECHNICIAN_PASSWORD=qa-cyc-tech-$(openssl rand -hex 8)
AEGIS_MQTT_ENABLED=true
AEGIS_MQTT_URL=tcp://127.0.0.1:$mqtt_port
AEGIS_MQTT_CLIENT_ID=aegis-api-qa-cycles
AEGIS_DISPLAY_ENABLED=true
AEGIS_DISPLAY_KEYS=k1:$K1
AEGIS_DISPLAY_ACTIVE_KEY_ID=k1
AEGIS_DISPLAY_DISPATCHER_ENABLED=true
AEGIS_COMMAND_DISPATCHER_ENABLED=true
SERVER_PORT=$api_port
AEGIS_API_URL=http://127.0.0.1:$api_port/api/v1
set +a
api=$AEGIS_API_URL

failures=0
pass() { echo "PASS $*"; }
fail() { echo "FAIL $*"; failures=$((failures + 1)); }
obs() { echo "OBS  $*"; }
uuid() { python3 -c 'import uuid; print(uuid.uuid4())'; }
json() { python3 -c "import json,sys; d=json.load(sys.stdin); print($1)"; }

start_api() {
  local log=$1
  shift
  env "$@" java -jar "$jar" >>"$work/$log" 2>&1 &
  api_pid=$!
  for _ in $(seq 1 90); do
    curl -fs "$api/system/health" >/dev/null 2>&1 && return 0
    kill -0 "$api_pid" 2>/dev/null || { api_pid=; return 1; }
    sleep 1
  done
  return 1
}

# ready: the presence scan of the current hub session is stored (presence is unknown after each boot until then).
ready() {
  for _ in $(seq 1 30); do
    [[ $(sql "SELECT count(*) FROM aegis.inbound_device_messages m JOIN aegis.locker_devices d
              ON d.id = m.locker_device_id AND m.device_session_id = d.device_session_id
              WHERE d.locker_id = '$locker' AND m.message_type = 'RFID_SCAN_COMPLETED'") -ge 1 ]] &&
      sleep 1 && return 0
    sleep 1
  done
  return 1
}
# challenge <operation> <field>: one field of the decrypted display payload (token or action); never printed by callers
# for the token.
challenge() {
  sql "SELECT id || ' ' || locker_id || ' ' || operation_id || ' ' || display_revision || ' ' || encryption_key_id
              || ' ' || encode(encrypted_payload, 'base64') FROM aegis.hub_display_outbox
       WHERE operation_id = '$1' AND message_type = 'DISPLAY_ACCESS_CHALLENGE' AND encrypted_payload IS NOT NULL" |
    tr -d '\n' | K1=$K1 FIELD=$2 python3 -I -c '
import base64, json, os, sys
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
row, locker, operation, revision, key_id, payload = sys.stdin.read().split(" ", 5)
envelope = base64.b64decode(payload)
aad = f"aegis-display-aad/v1\n{row}\n{locker}\n{operation}\n{revision}".encode()
plain = json.loads(AESGCM(base64.b64decode(os.environ[key_id.upper()])).decrypt(envelope[:12], envelope[12:], aad))
print(plain["payload"].get(os.environ["FIELD"], "-"))'
}
displayed() {
  for _ in $(seq 1 20); do
    [[ $(sql "SELECT displayed_at IS NOT NULL FROM aegis.local_access_challenges WHERE operation_id = '$1'") == t ]] &&
      return 0
    sleep 1
  done
  return 1
}
# authorize <operation> <body file>: the real QR scan of the operation's displayed challenge; prints the HTTP code.
authorize() {
  local ch secret
  ch=$(sql "SELECT challenge_id FROM aegis.hub_display_outbox WHERE operation_id = '$1' AND challenge_id IS NOT NULL
            LIMIT 1")
  secret=$(challenge "$1" token)
  printf '{"challengeId":"%s","token":"%s"}' "$ch" "$secret" |
    curl -s -o "$2" -w '%{http_code}' -X POST --data-binary @- \
      -H 'Content-Type: application/json' -H "Authorization: Bearer $token" -H "Idempotency-Key: $(uuid)" \
      "$api/locker-operations/$1/authorize-local"
  unset secret
}
op_state() { sql "SELECT status || ' ' || coalesce(failure_reason, '-') FROM aegis.locker_operations WHERE id = '$1'"; }
wait_terminal() {
  local s
  for _ in $(seq 1 "$2"); do
    s=$(op_state "$1")
    [[ $s =~ ^(CONFIRMED|EXPIRED|ANOMALY|FAILED|CANCELLED)\  ]] && { echo "$s"; return; }
    sleep 1
  done
  echo "$s"
}
vs_deadline() { sql "SELECT round(extract(epoch FROM terminal_at - expires_at)::numeric, 1) FROM aegis.locker_operations WHERE id = '$1'"; }
commands() { sql "SELECT count(*) FROM aegis.command_outbox WHERE operation_id = '$1'"; }
anomalies() { sql "SELECT count(*) || ' ' || coalesce(string_agg(type || '/' || status, ','), '-') FROM aegis.anomalies WHERE locker_operation_id = '$1'"; }
loan_status() { sql "SELECT status FROM aegis.loans WHERE id = '$loan'"; }
reverted() { sql "SELECT count(*) FROM aegis.audit_events WHERE event_type = 'LOAN_RETURN_REVERTED_SAFE' AND subject_id = '$loan'"; }
loan_view() {
  curl -fs -H "Authorization: Bearer $token" "$api/loans/$loan" |
    json '" ".join([d["status"], str(d["overdue"]).lower(), ",".join(d["availableActions"]) or "-"])'
}
# prepare_return [file]: POST /loans/{id}/return with a new key; prints the HTTP code, the body goes to the file.

login() {
  curl -fs -H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"password\":\"$2\"}" "$api/auth/login" |
    json 'd["accessToken"]'
}
cell() {
  sql "SELECT door_state || ' ' || lock_state FROM aegis.compartments c JOIN aegis.asset_placements p
       ON p.compartment_id = c.id AND p.removed_at IS NULL WHERE p.asset_id = '$asset'"
}
# settled: the cell projection follows heartbeats (about 10 s), so wait until it shows the door closed and locked.
settled() {
  for _ in $(seq 1 60); do [[ $(cell) == "CLOSED LOCKED" ]] && return 0; sleep 0.5; done
  return 1
}
# post_prepare <url> <key> <body file>: a preparation that waits out 429 LOCAL_PROOF_RATE_LIMITED (shipped ceiling).
post_prepare() {
  local code wait
  for _ in 1 2 3 4; do
    code=$(curl -s -o "$3" -D "$3.headers" -w '%{http_code}' -X POST -H "Authorization: Bearer $token" \
      -H "Idempotency-Key: $2" "$1")
    [[ $code == 429 ]] || { echo "$code"; return; }
    wait=$(grep -i '^retry-after:' "$3.headers" | tr -dc '0-9')
    echo 429 >>"$work/ceiling-waits"  # post_prepare runs in a command substitution: count through a file
    echo "  ceiling reached, Retry-After ${wait:-60} s" >&2
    sleep $(( ${wait:-60} + 2 ))
  done
  echo "$code"
}
# scan <operation> <label>: the real QR scan (202), then the same secret with a new key must be refused (the challenge
# is consumed and its sealed payload purged), with no new command. The secret lives in a shell variable only.
scan() {
  local code again ch secret
  displayed "$1" || { fail "$2 challenge never displayed"; return 1; }
  ch=$(sql "SELECT challenge_id FROM aegis.hub_display_outbox WHERE operation_id = '$1' AND challenge_id IS NOT NULL LIMIT 1")
  secret=$(challenge "$1" token)
  send() {
    printf '{"challengeId":"%s","token":"%s"}' "$ch" "$secret" |
      curl -s -o "$1" -w '%{http_code}' -X POST --data-binary @- -H 'Content-Type: application/json' \
        -H "Authorization: Bearer $token" -H "Idempotency-Key: $(uuid)" "$api/locker-operations/$2/authorize-local"
  }
  code=$(send "$work/scan.body" "$1")
  again=$(send "$work/scan-again.body" "$1")
  unset secret
  [[ $code == 202 ]] || { fail "$2 scan $code $(cat "$work/scan.body")"; return 1; }
  [[ $again == 409 && $(json 'd["code"]' <"$work/scan-again.body") == LOCAL_PROOF_ALREADY_USED &&
     $(commands "$1") == 1 ]] || { fail "$2 second scan $again, commands $(commands "$1")"; return 1; }
}

# crosscheck <label> <expected mobile /me/loan> <loan status>: what the mobile app (technician routes) and the Manager
# (admin routes) read for the same loan, operations and reservation must agree with the database.
crosscheck() {
  local me mobile manager ops res
  me=$(curl -s -o "$work/me.body" -w '%{http_code}' -H "Authorization: Bearer $token" "$api/me/loan")
  [[ $me == 200 ]] && me="200 $(json 'd["id"] == "'"$loan"'" and d["status"]' <"$work/me.body")" ||
    me="$me $(json 'd.get("code", "-")' <"$work/me.body")"
  mobile=$(curl -fs -H "Authorization: Bearer $token" "$api/loans/$loan" | json 'd["status"]')
  manager=$(curl -fs -H "Authorization: Bearer $admin" "$api/admin/loans/$loan" | json 'd["status"]')
  ops=$(for o in "$@"; do curl -fs -H "Authorization: Bearer $admin" "$api/admin/locker-operations/$o" | json 'd["status"]'; done | tr '\n' ' ')
  res=$(curl -fs -H "Authorization: Bearer $admin" "$api/admin/reservations/$reservation" | json 'd["status"]')
  echo "$me|$mobile|$manager|${ops% }|$res"
}

# The hub: one boot, presence scan, then for each cycle a checkout (take the asset) and a return (put it back).
steps='{ "do": "waitOnline", "timeoutMs": 15000 }, { "do": "setScreen", "available": true }, { "wait": 3000 },
  { "do": "putTag", "code": "A1", "identifier": "'$tag'" }, { "do": "scanRfid", "code": "A1" }'
for _ in $(seq 1 "$cycles"); do
  steps+=', { "do": "waitUnlocked", "code": "A1", "timeoutMs": 1800000 }, { "wait": 1000 },
  { "do": "openDoor", "code": "A1" }, { "do": "takeTag", "code": "A1", "identifier": "'$tag'" }, { "wait": 1500 },
  { "do": "closeDoor", "code": "A1" },
  { "do": "waitUnlocked", "code": "A1", "timeoutMs": 1800000 }, { "wait": 1000 },
  { "do": "openDoor", "code": "A1" }, { "do": "putTag", "code": "A1", "identifier": "'$tag'" }, { "wait": 1500 },
  { "do": "closeDoor", "code": "A1" }'
done
printf '{ "steps": [ %s, { "wait": 1800000 }, { "do": "stop" } ] }\n' "$steps" >"$scenarios/cycles.json"
python3 -c 'import json,sys; json.load(open(sys.argv[1]))' "$scenarios/cycles.json"

"${compose[@]}" down -v >/dev/null 2>&1 || true
"${compose[@]}" up -d --wait --pull never >/dev/null 2>&1 ||
  { echo "FAIL BLOCKED environment: the Compose stack did not start (is Docker running?)"; exit 2; }
api_env=()
[[ -z ${QA_CYCLES_MAX_PER_WINDOW:-} ]] || api_env=(AEGIS_PREPARATION_MAX_PER_WINDOW="$QA_CYCLES_MAX_PER_WINDOW")
start_api api.log "${api_env[@]}" || { echo "FAIL BLOCKED api"; exit 1; }
echo "ceiling: ${QA_CYCLES_MAX_PER_WINDOW:-shipped default} preparations per window"
python3 -I services/api/scripts/seed-demo-catalog.py >"$work/seed.log" 2>&1
admin=$(login admin@aegis.demo "$AEGIS_DEMO_ADMIN_PASSWORD")
python3 -c 'import json; print(json.dumps({"timeZone": "America/Toronto", "windows": [
  {"dayOfWeek": d, "enabled": True, "opensAt": "00:00", "closesAt": "23:59"} for d in
  ["MONDAY","TUESDAY","WEDNESDAY","THURSDAY","FRIDAY","SATURDAY","SUNDAY"]]}))' |
  curl -fs -X PUT -H "Authorization: Bearer $admin" -H 'Content-Type: application/json' --data-binary @- \
    "$api/admin/lockers/$locker/operating-schedule" >/dev/null
env AEGIS_MQTT_DEVICE_PASSWORD="$AEGIS_MQTT_DEVICE_PASSWORD" AEGIS_MQTT_URL="mqtt://127.0.0.1:$mqtt_port" \
  AEGIS_SIM_BOOT_COUNT_FILE="$work/boot.json" AEGIS_SIM_COMMAND_JOURNAL_FILE="$work/journal.json" \
  bash -c "cd tools/hub-simulator && exec node src/cli.ts --scenario ${scenarios##*/}/cycles.json" \
  >>"$work/simulator.log" 2>&1 &
hub_pid=$!
for _ in $(seq 1 40); do
  [[ $(sql "SELECT connection_status FROM aegis.locker_devices WHERE locker_id = '$locker'") == ONLINE ]] && break
  sleep 1
done
ready || { echo "FAIL BLOCKED the hub never reported its presence scan"; exit 1; }

rate_limited=0 done_cycles=0 started=$(date +%s)
for n in $(seq 1 "$cycles"); do
  c="C$n"
  token=$(login technician@aegis.demo "$AEGIS_DEMO_TECHNICIAN_PASSWORD")
  admin=$(login admin@aegis.demo "$AEGIS_DEMO_ADMIN_PASSWORD")
  asset=$(curl -fs -H "Authorization: Bearer $token" "$api/assets?q=AEG-DEMO-001&page=0&size=10" |
    json '[a for a in d["items"] if a["assetCode"] == "AEG-DEMO-001"][0]["id"]')
  settled || { fail "$c cell projection '$(cell)' before the checkout"; break; }
  until=$(python3 -c 'import datetime; print((datetime.datetime.now(datetime.timezone.utc)
    + datetime.timedelta(minutes=40)).strftime("%Y-%m-%dT%H:%M:%SZ"))')
  for _ in $(seq 1 12); do
    code=$(curl -s -o "$work/reserve.body" -w '%{http_code}' -H "Authorization: Bearer $token" \
      -H 'Content-Type: application/json' -H "Idempotency-Key: $(uuid)" \
      -d "{\"assetId\":\"$asset\",\"reservedUntil\":\"$until\"}" "$api/reservations")
    [[ $code == 201 ]] && break
    sleep 5
  done
  [[ $code == 201 ]] || { fail "$c reservation $code $(cat "$work/reserve.body")"; break; }
  reservation=$(json 'd["id"]' <"$work/reserve.body")
  key=$(uuid)
  code=$(post_prepare "$api/reservations/$reservation/checkout" "$key" "$work/checkout.body")
  [[ $code == 202 ]] || { fail "$c checkout preparation $code $(cat "$work/checkout.body")"; break; }
  op=$(json 'd["id"]' <"$work/checkout.body")
  code=$(post_prepare "$api/reservations/$reservation/checkout" "$key" "$work/checkout-replay.body")
  [[ $code == 202 && $(json 'd["id"]' <"$work/checkout-replay.body") == "$op" ]] ||
    { fail "$c checkout replay $code"; break; }
  scan "$op" "$c checkout" || break
  end=$(wait_terminal "$op" 60)
  loan=$(sql "SELECT id FROM aegis.loans WHERE checkout_operation_id = '$op'")
  [[ $end == "CONFIRMED -" && -n $loan && $(loan_status) == ACTIVE ]] ||
    { fail "$c checkout ended '$end', loan '${loan:-none}'"; break; }
  seen=$(crosscheck "$op")
  [[ $seen == "200 ACTIVE|ACTIVE|ACTIVE|CONFIRMED|FULFILLED" ]] ||
    { fail "$c after the checkout, mobile/Manager read '$seen'"; break; }
  settled || { fail "$c cell projection '$(cell)' before the return"; break; }
  key=$(uuid)
  code=$(post_prepare "$api/loans/$loan/return" "$key" "$work/return.body")
  [[ $code == 202 ]] || { fail "$c return preparation $code $(cat "$work/return.body")"; break; }
  rop=$(json 'd["id"]' <"$work/return.body")
  code=$(post_prepare "$api/loans/$loan/return" "$key" "$work/return-replay.body")
  [[ $code == 202 && $(json 'd["id"]' <"$work/return-replay.body") == "$rop" ]] ||
    { fail "$c return replay $code"; break; }
  scan "$rop" "$c return" || break
  end=$(wait_terminal "$rop" 60)
  [[ $end == "CONFIRMED -" && $(loan_status) == COMPLETED && $(anomalies "$op") == "0 -" &&
     $(anomalies "$rop") == "0 -" ]] ||
    { fail "$c return ended '$end', loan $(loan_status), anomalies '$(anomalies "$rop")'"; break; }
  seen=$(crosscheck "$op" "$rop")
  [[ $seen == "404 ACTIVE_LOAN_NOT_FOUND|COMPLETED|COMPLETED|CONFIRMED CONFIRMED|FULFILLED" ]] ||
    { fail "$c after the return, mobile/Manager read '$seen'"; break; }
  done_cycles=$n
  echo "  $c done at +$(( $(date +%s) - started )) s"
done

q() { sql "$1"; }
totals=$(q "SELECT (SELECT count(*) FROM aegis.loans) || ' ' ||
  (SELECT count(*) FROM aegis.loans WHERE status = 'COMPLETED') || ' ' ||
  (SELECT count(*) FROM aegis.reservations WHERE status = 'FULFILLED') || ' ' ||
  (SELECT count(*) FROM aegis.locker_operations WHERE status = 'CONFIRMED') || ' ' ||
  (SELECT count(*) FROM aegis.locker_operations) || ' ' ||
  (SELECT count(*) FROM aegis.command_outbox) || ' ' ||
  (SELECT coalesce(max(n), 0) FROM (SELECT count(*) n FROM aegis.command_outbox GROUP BY operation_id) x) || ' ' ||
  (SELECT count(*) FROM aegis.anomalies) || ' ' ||
  (SELECT count(*) FROM aegis.audit_events WHERE event_type = 'OPERATION_CONFIRMED') || ' ' ||
  (SELECT count(*) FROM aegis.audit_events WHERE event_type = 'LOAN_COMPLETED')")
expected="$cycles $cycles $cycles $((2 * cycles)) $((2 * cycles)) $((2 * cycles)) 1 0 $((2 * cycles)) $cycles"
token=$(login technician@aegis.demo "$AEGIS_DEMO_TECHNICIAN_PASSWORD")
readiness=$(curl -fs -H "Authorization: Bearer $token" "$api/assets/$asset" | json 'd["readiness"]["result"]')
if [[ $done_cycles == "$cycles" && $totals == "$expected" ]]; then
  pass "CYCLES $cycles checkouts and $cycles returns in $(( $(date +%s) - started )) s: loans/completed/fulfilled" \
    "reservations/confirmed operations/operations/commands/max commands per operation/anomalies/OPERATION_CONFIRMED/" \
    "LOAN_COMPLETED = '$totals'; ceiling waits $(cat "$work/ceiling-waits" 2>/dev/null | wc -l)"
else
  fail "CYCLES $done_cycles of $cycles cycles; totals '$totals', expected '$expected'"
fi
for _ in $(seq 1 30); do [[ $readiness == READY ]] && break; sleep 2
  readiness=$(curl -fs -H "Authorization: Bearer $token" "$api/assets/$asset" | json 'd["readiness"]["result"]'); done
[[ $readiness == READY ]] && pass "READY the asset is READY again after the last return, without any manual SQL" ||
  obs "READY readiness after the last return: '$readiness'"
echo "QA CYCLES: $failures failed"
exit "$failures"
