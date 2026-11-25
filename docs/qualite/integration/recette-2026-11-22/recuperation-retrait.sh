#!/usr/bin/env bash
# Independent QA scenario for the recovery of an uncertain checkout (#200, Refs #67): a checkout whose door opens and
# closes while the closing scan still sees the asset ends in ANOMALY (INCONSISTENT_PHYSICAL_STATE); the anomaly may only
# be resolved by NEW stable presence evidence, never by the attempt's own scan.
#
#   docs/qualite/integration/recette-2026-11-22/recuperation-retrait.sh   # from the repository root, ~10 minutes
#
#   K1  the uncertain checkout: operation ANOMALY, anomaly OPEN, no loan, reservation held, new checkout refused (422)
#   K2  the attempt's own closing scan, received before detection, resolves nothing across scheduled passes
#   K3  a new hub session whose boot scan shows an EMPTY cell resolves nothing
#   K4  a new hub session with the asset back resolves it: RESOLVED / ASSET_PRESENT, one ANOMALY_RESOLVED, no loan,
#       the operation stays ANOMALY
#   K5  the reservation offers CHECKOUT again
#   K6  a new checkout through the real QR scan is CONFIRMED: one loan, reservation FULFILLED
#   K7  at most one command per operation
#
# Real PostgreSQL, Mosquitto (with its ACL) and Spring on a disposable Compose project (aegis-qa-cka); the Node
# simulator plays the hub, explicitly separate from any real hub. No manual SQL changes state (SELECT only). QR tokens
# are decrypted from the sealed rows into shell variables and never written or printed. Exit code = number of FAIL
# lines. Needs: docker with compose, Java 21, Node 22.18+, python3 with cryptography, openssl, curl.
# Overrides: QA_CKA_DB_PORT (58653), QA_CKA_MQTT_PORT (55104), QA_CKA_API_PORT (19501), QA_CKA_PROJECT (aegis-qa-cka).
set -euo pipefail

root=$(git rev-parse --show-toplevel)
cd "$root"
project=${QA_CKA_PROJECT:-aegis-qa-cka}
work=$(mktemp -d "${TMPDIR:-/tmp}/aegis-qa-cka.XXXXXX")
scenarios=$(mktemp -d tools/hub-simulator/.qa-cka.XXXXXX)
db_port=${QA_CKA_DB_PORT:-58653}
mqtt_port=${QA_CKA_MQTT_PORT:-55104}
api_port=${QA_CKA_API_PORT:-19501}
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
AEGIS_DEMO_ADMIN_PASSWORD=qa-cka-admin-$(openssl rand -hex 8)
AEGIS_DEMO_TECHNICIAN_PASSWORD=qa-cka-tech-$(openssl rand -hex 8)
AEGIS_MQTT_ENABLED=true
AEGIS_MQTT_URL=tcp://127.0.0.1:$mqtt_port
AEGIS_MQTT_CLIENT_ID=aegis-api-qa-cka
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
device_session() { sql "SELECT coalesce(device_session_id::text, '-') FROM aegis.locker_devices WHERE locker_id = '$locker'"; }

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
prepare_return() {
  local key=${2:-$(uuid)}
  curl -s -o "$1" -D "$1.headers" -w '%{http_code}' -X POST -H "Authorization: Bearer $token" \
    -H "Idempotency-Key: $key" "$api/loans/$loan/return"
}
# invariant <case>: at most one command per operation, one loan, COMPLETED only through a CONFIRMED return.
invariant() {
  local worst confirmed
  worst=$(sql "SELECT coalesce(max(n), 0) FROM (SELECT count(*) n FROM aegis.command_outbox GROUP BY operation_id) c")
  confirmed=$(sql "SELECT count(*) FROM aegis.locker_operations WHERE type = 'RETURN' AND status = 'CONFIRMED'")
  if [[ $worst -le 1 && $(sql "SELECT count(*) FROM aegis.loans") == 1 &&
        ( ($(loan_status) == COMPLETED && $confirmed == 1) || ($(loan_status) != COMPLETED && $confirmed == 0) ) ]]; then
    return 0
  fi
  fail "$1 invariant: commands per operation up to $worst, loans $(sql "SELECT count(*) FROM aegis.loans"), loan" \
    "$(loan_status), confirmed returns $confirmed"
}
hub_env=()

# hub <name> <steps JSON>: one simulator boot playing the given steps, then idle.
hub() {
  local name=$1 steps=$2 before
  stop_hub
  cat >"$scenarios/$name.json" <<JSON
{ "steps": [
  { "do": "waitOnline", "timeoutMs": 15000 }, { "do": "setScreen", "available": true }, { "wait": 3000 },
  $steps,
  { "wait": 900000 }, { "do": "stop" } ] }
JSON
  before=$(device_session)
  env AEGIS_MQTT_DEVICE_PASSWORD="$AEGIS_MQTT_DEVICE_PASSWORD" AEGIS_MQTT_URL="mqtt://127.0.0.1:$mqtt_port" \
    AEGIS_SIM_BOOT_COUNT_FILE="$work/boot.json" AEGIS_SIM_COMMAND_JOURNAL_FILE="$work/journal.json" \
    bash -c "cd tools/hub-simulator && exec node src/cli.ts --scenario ${scenarios##*/}/$name.json" \
    >>"$work/simulator-$name.log" 2>&1 &
  hub_pid=$!
  for _ in $(seq 1 40); do
    [[ $(device_session) != "$before" &&
       $(sql "SELECT connection_status FROM aegis.locker_devices WHERE locker_id = '$locker'") == ONLINE ]] && return 0
    sleep 1
  done
  return 1
}
scans_this_session() {
  sql "SELECT count(*) FROM aegis.inbound_device_messages m JOIN aegis.locker_devices d
       ON d.id = m.locker_device_id AND m.device_session_id = d.device_session_id
       WHERE d.locker_id = '$locker' AND m.message_type = 'RFID_SCAN_COMPLETED'"
}
wait_scans() { for _ in $(seq 1 40); do [[ $(scans_this_session) -ge $1 ]] && return 0; sleep 1; done; return 1; }
anomaly_state() { sql "SELECT coalesce(string_agg(a.type || '/' || a.status || '/' || coalesce(p.type, '-'), ','), '-')
  FROM aegis.anomalies a LEFT JOIN aegis.physical_observations p ON p.id = a.resolution_evidence_observation_id
  WHERE a.locker_operation_id = '$1'"; }
res_view() { curl -fs -H "Authorization: Bearer $token" "$api/reservations/$reservation" |
  json '" ".join([d["status"], ",".join(d.get("availableActions") or []) or "-"])'; }
resolved_audits() { sql "SELECT count(*) FROM aegis.audit_events WHERE event_type = 'ANOMALY_RESOLVED'"; }
nloans() { sql "SELECT count(*) FROM aegis.loans"; }
prepare_checkout() { curl -s -o "$1" -w '%{http_code}' -X POST -H "Authorization: Bearer $token" \
  -H "Idempotency-Key: $(uuid)" "$api/reservations/$reservation/checkout"; }
cell() { sql "SELECT door_state || ' ' || lock_state FROM aegis.compartments c JOIN aegis.lockers l ON l.id = c.locker_id
  WHERE l.id = '$locker' AND c.code = 'A1'"; }

"${compose[@]}" down -v >/dev/null 2>&1 || true
"${compose[@]}" up -d --wait --pull never >/dev/null 2>&1
start_api api.log || { fail "BLOCKED the API did not start"; exit 1; }
python3 -I services/api/scripts/seed-demo-catalog.py >"$work/seed.log" 2>&1
admin=$(curl -fs -H 'Content-Type: application/json' \
  -d "{\"email\":\"admin@aegis.demo\",\"password\":\"$AEGIS_DEMO_ADMIN_PASSWORD\"}" "$api/auth/login" | json 'd["accessToken"]')
token=$(curl -fs -H 'Content-Type: application/json' \
  -d "{\"email\":\"technician@aegis.demo\",\"password\":\"$AEGIS_DEMO_TECHNICIAN_PASSWORD\"}" "$api/auth/login" | json 'd["accessToken"]')
python3 -c 'import json; print(json.dumps({"timeZone": "America/Toronto", "windows": [
  {"dayOfWeek": d, "enabled": True, "opensAt": "00:00", "closesAt": "23:59"} for d in
  ["MONDAY","TUESDAY","WEDNESDAY","THURSDAY","FRIDAY","SATURDAY","SUNDAY"]]}))' |
  curl -fs -X PUT -H "Authorization: Bearer $admin" -H 'Content-Type: application/json' --data-binary @- \
    "$api/admin/lockers/$locker/operating-schedule" >/dev/null

# Boot 1: the asset in A1, a presence scan, then a checkout whose door opens and closes WITHOUT the asset being taken:
# the closing scan still sees it (EXPECTED_ASSET_STILL_PRESENT), an uncertain checkout.
hub boot1 '{ "do": "putTag", "code": "A1", "identifier": "'"$tag"'" }, { "do": "scanRfid", "code": "A1" },
  { "do": "waitUnlocked", "code": "A1", "timeoutMs": 600000 }, { "wait": 1000 }, { "do": "openDoor", "code": "A1" },
  { "wait": 1500 }, { "do": "closeDoor", "code": "A1" }' || { fail "BLOCKED boot1 offline"; exit 1; }
wait_scans 1 || { fail "BLOCKED no presence scan on boot1"; exit 1; }
asset=$(curl -fs -H "Authorization: Bearer $token" "$api/assets?q=AEG-DEMO-001&page=0&size=10" |
  json '[a for a in d["items"] if a["assetCode"] == "AEG-DEMO-001"][0]["id"]')
until=$(python3 -c 'import datetime; print((datetime.datetime.now(datetime.timezone.utc)
  + datetime.timedelta(minutes=30)).strftime("%Y-%m-%dT%H:%M:%SZ"))')
code=$(curl -s -o "$work/reserve.body" -w '%{http_code}' -H "Authorization: Bearer $token" -H 'Content-Type: application/json' \
  -H "Idempotency-Key: $(uuid)" -d "{\"assetId\":\"$asset\",\"reservedUntil\":\"$until\"}" "$api/reservations")
[[ $code == 201 || $code == 200 ]] || { fail "BLOCKED reservation $code $(cat "$work/reserve.body")"; exit 1; }
reservation=$(json 'd["id"]' <"$work/reserve.body")
code=$(prepare_checkout "$work/c1.body"); [[ $code == 202 ]] || { fail "BLOCKED checkout 1 preparation $code"; exit 1; }
op1=$(json 'd["id"]' <"$work/c1.body")
displayed "$op1" || { fail "BLOCKED checkout 1 not displayed"; exit 1; }
code=$(authorize "$op1" "$work/c1-auth.body"); [[ $code == 202 ]] || { fail "BLOCKED checkout 1 authorization $code"; exit 1; }
end1=$(wait_terminal "$op1" 200)
a1=$(anomaly_state "$op1")
if [[ $end1 == ANOMALY* && $a1 == *"/OPEN/-"* ]]; then pass "K1 uncertain checkout: '$end1', anomaly '$a1', loans $(nloans)"
else fail "K1 expected an ANOMALY checkout with an OPEN anomaly: '$end1', anomaly '$a1'"; fi
[[ $(nloans) == 0 ]] || fail "K1 a loan exists after an uncertain checkout"
v=$(res_view); [[ $v == "ACTIVE -" ]] && pass "K1 the reservation is held: '$v'" || obs "K1 reservation view '$v'"
code=$(prepare_checkout "$work/c1b.body")
[[ $code != 202 ]] && pass "K1 a new checkout while the anomaly is OPEN is refused ($code $(json 'd.get("code","-")' <"$work/c1b.body" 2>/dev/null))" ||
  fail "K1 a new checkout was accepted while the anomaly is OPEN"
sleep 5
[[ $(anomaly_state "$op1") == *"/OPEN/-"* ]] && pass "K2 the attempt's own closing scan (before detection) resolves nothing after scheduled passes" ||
  fail "K2 resolved by the attempt's own scan: '$(anomaly_state "$op1")'"

# Boot 2: the hub restarts with the cell EMPTY: its boot scan is new but shows no asset; nothing must resolve.
hub boot2 '{ "do": "scanRfid", "code": "A1" }' || { fail "BLOCKED boot2 offline"; exit 1; }
wait_scans 1 || fail "K3 no scan on boot2"; sleep 6
[[ $(anomaly_state "$op1") == *"/OPEN/-"* && $(resolved_audits) == 0 ]] &&
  pass "K3 a new scan without the asset resolves nothing ('$(anomaly_state "$op1")')" ||
  fail "K3 resolved without the asset: '$(anomaly_state "$op1")'"

# Boot 3: the hub restarts with the asset back in A1, door closed: the boot scan resolves the anomaly, no loan.
hub boot3 '{ "do": "putTag", "code": "A1", "identifier": "'"$tag"'" }, { "do": "scanRfid", "code": "A1" },
  { "do": "waitUnlocked", "code": "A1", "timeoutMs": 600000 }, { "wait": 1000 }, { "do": "openDoor", "code": "A1" },
  { "do": "takeTag", "code": "A1", "identifier": "'"$tag"'" }, { "wait": 1500 }, { "do": "closeDoor", "code": "A1" }' ||
  { fail "BLOCKED boot3 offline"; exit 1; }
wait_scans 1 || fail "K4 no scan on boot3"
for _ in $(seq 1 20); do [[ $(anomaly_state "$op1") == *RESOLVED* ]] && break; sleep 1; done
a=$(anomaly_state "$op1")
if [[ $a == *"/RESOLVED/ASSET_PRESENT" && $(resolved_audits) == 1 && $(nloans) == 0 && $(op_state "$op1") == ANOMALY* ]]; then
  pass "K4 resolved by the new stable presence: '$a', ANOMALY_RESOLVED 1, loans 0, operation stays '$(op_state "$op1")'"
else fail "K4 '$a', ANOMALY_RESOLVED $(resolved_audits), loans $(nloans), operation '$(op_state "$op1")'"; fi
v=$(res_view); [[ $v == "ACTIVE CHECKOUT"* ]] && pass "K5 reservation usable again: '$v'" || fail "K5 reservation view '$v'"

# A new checkout through the real QR completes: CONFIRMED, one loan.
for _ in $(seq 1 30); do [[ $(cell) == "CLOSED LOCKED" ]] && break; sleep 1; done
code=$(prepare_checkout "$work/c2.body")
if [[ $code == 202 ]]; then
  op2=$(json 'd["id"]' <"$work/c2.body")
  if displayed "$op2" && [[ $(authorize "$op2" "$work/c2-auth.body") == 202 ]]; then
    end2=$(wait_terminal "$op2" 60)
    [[ $end2 == "CONFIRMED -" && $(nloans) == 1 ]] && pass "K6 new checkout '$end2', loans 1, reservation $(sql "SELECT status FROM aegis.reservations WHERE id = '$reservation'")" ||
      fail "K6 new checkout '$end2', loans $(nloans)"
  else fail "K6 new checkout not displayed or authorized"; fi
else fail "K6 new checkout preparation $code $(cat "$work/c2.body")"; fi
worst=$(sql "SELECT coalesce(max(n), 0) FROM (SELECT count(*) n FROM aegis.command_outbox GROUP BY operation_id) c")
[[ $worst -le 1 ]] && pass "K7 at most one command per operation ($worst)" || fail "K7 $worst commands for one operation"
echo "anomalies: $(sql "SELECT count(*) || ' ' || string_agg(status, ',') FROM aegis.anomalies")"
echo
[[ $failures -eq 0 ]] && echo "QA CHECKOUT ANOMALY RECOVERY: all checks passed" || echo "QA CHECKOUT ANOMALY RECOVERY: $failures failed"
exit "$failures"
