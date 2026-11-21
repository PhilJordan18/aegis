#!/usr/bin/env bash
# Independent QA reproduction of doc 06 §6.5 / doc 05 §5.4 ("garde devenue invalide") at scan time, on the #44 scan
# route (PR #173). Backend decision ledger item 3 (#67 comment 7063175563) classifies the current behaviour as a
# DEFECT and leaves the reason value to Philippe: this script reproduces it, it does not choose the value.
#
#   docs/qualite/hub-challenge/guard-at-scan.sh     # from the repository root of the commit under test, ~4 minutes
#
#   G0 revoking the expected RFID identifier during the attempt is refused (doc 09 §12.3).
#   G1 definitive guard: an administrator sets the asset to MAINTENANCE (the real admin route, no SQL) between the
#      preparation and a scan with the right secret, so readiness is no longer READY. Expected by doc 05 §5.4 l.271 and doc 06 §6.5: the
#      attempt ends now (operation FAILED, challenge INVALIDATED, refusal audited, screen cleared), no command.
#      Any FAILED reason is accepted: the value is PENDING-HUMAN (ledger questions 3-4).
#   G2 the same right secret again: still refused, no command.
#   G3 what the unrevised code does instead: operation and challenge state until expiry (reported as OBS).
# Same disposable stack and conventions as run.sh (own Compose project and ports). Exit code = number of FAIL lines.
set -euo pipefail

root=$(git rev-parse --show-toplevel)
cd "$root"
project=aegis-qa-guard-scan
work=$(mktemp -d "${TMPDIR:-/tmp}/aegis-qa-hub.XXXXXX")
scenarios=$(mktemp -d tools/hub-simulator/.qa-hub.XXXXXX)
db_port=${QA_GUARD_DB_PORT:-58543}
mqtt_port=${QA_GUARD_MQTT_PORT:-54994}
api_port=${QA_GUARD_API_PORT:-19391}
locker=d46a74ae-39dc-460b-8af0-38fc791b376a

sed -e "s/^AEGIS_DB_PORT=.*/AEGIS_DB_PORT=$db_port/" -e "s/^AEGIS_MQTT_PORT=.*/AEGIS_MQTT_PORT=$mqtt_port/" \
  infra/docker/.env.example >"$work/env"
compose=(docker compose -p "$project" --env-file "$work/env" -f infra/docker/compose.yaml)
sql() { docker exec -i "$project-postgres-1" psql -U aegis -d aegis -tA -c "$1"; }

api_pid= hub_pid=
stop_api() {
  [[ -z "$api_pid" ]] || { kill "$api_pid" 2>/dev/null || true; wait "$api_pid" 2>/dev/null || true; }
  api_pid=
}
# The simulator publishes its clean OFFLINE on SIGTERM but its process stays alive while a scenario "wait" step is
# pending: bound the stop to 10 s, then kill it.
stop_hub() {
  if [[ -n "$hub_pid" ]]; then
    kill "$hub_pid" 2>/dev/null || true
    for _ in $(seq 1 10); do kill -0 "$hub_pid" 2>/dev/null || break; sleep 1; done
    kill -0 "$hub_pid" 2>/dev/null && { echo "  simulator still alive 10 s after SIGTERM: killed"; kill -9 "$hub_pid"; }
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
"${compose[@]}" down -v >/dev/null 2>&1 || true
"${compose[@]}" up -d --wait --pull never >/dev/null 2>&1

# A stale jar would silently test another revision: always build the checked-out commit.
(cd services/api && ./mvnw -B -q -ntp -DskipTests package >"$work/build.log" 2>&1)
jar=$(ls services/api/target/aegis-control-*.jar | head -1)
echo "api: $jar, repository at $(git rev-parse --short HEAD)"

umask 077
printf 'K1=%s\nK2=%s\n' "$(openssl rand -base64 32)" "$(openssl rand -base64 32)" >"$work/keys"
# shellcheck disable=SC1091
. "$work/keys"
set -a
# shellcheck disable=SC1091
. "$work/env"
AEGIS_JWT_SECRET=$(openssl rand -base64 48)
AEGIS_DEMO_ACCOUNTS_ENABLED=true
AEGIS_DEMO_LOCKER_ENABLED=true
AEGIS_DEMO_ADMIN_PASSWORD=qa-hub-admin-$(openssl rand -hex 8)
AEGIS_DEMO_TECHNICIAN_PASSWORD=qa-hub-tech-$(openssl rand -hex 8)
AEGIS_MQTT_ENABLED=true
AEGIS_MQTT_URL=tcp://127.0.0.1:$mqtt_port
AEGIS_MQTT_CLIENT_ID=aegis-api-qa-guard
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

# start_api <log> <env...>: returns 0 once healthy, 1 if the process exits or never becomes healthy.
start_api() {
  local log=$1
  shift
  env "$@" java -jar "$jar" >>"$work/$log" 2>&1 &
  api_pid=$!
  for _ in $(seq 1 60); do
    curl -fs "$api/system/health" >/dev/null 2>&1 && return 0
    kill -0 "$api_pid" 2>/dev/null || { api_pid=; return 1; }
    sleep 1
  done
  return 1
}

# start_hub <name> <screenAvailable>: a simulator process; each process is a new boot, so a new deviceSessionId.
start_hub() {
  cat >"$scenarios/$1.json" <<EOF
{ "steps": [
  { "do": "waitOnline", "timeoutMs": 15000 },
  { "do": "setScreen", "available": $2 },
  { "wait": 3000 },
  { "do": "putTag", "code": "A1", "identifier": "E20034120123456789000001" },
  { "do": "scanRfid", "code": "A1" },
  { "wait": 900000 },
  { "do": "stop" } ] }
EOF
  AEGIS_MQTT_DEVICE_PASSWORD=$AEGIS_MQTT_DEVICE_PASSWORD AEGIS_MQTT_URL=mqtt://127.0.0.1:$mqtt_port \
  AEGIS_SIM_BOOT_COUNT_FILE="$work/boot.json" AEGIS_SIM_COMMAND_JOURNAL_FILE="$work/journal.json" \
    bash -c "cd tools/hub-simulator && exec node src/cli.ts --scenario ${scenarios##*/}/$1.json" \
    >>"$work/simulator-$1.log" 2>&1 &
  hub_pid=$!
  local before
  before=$(device_session)
  for _ in $(seq 1 40); do
    [[ $(device_session) != "$before" &&
       $(sql "SELECT connection_status FROM aegis.locker_devices WHERE locker_id = '$locker'") == ONLINE ]] &&
      sleep 3 && return 0
    sleep 1
  done
  return 1
}
device_session() { sql "SELECT coalesce(device_session_id::text, '-') FROM aegis.locker_devices WHERE locker_id = '$locker'"; }

start_api api.log AEGIS_DISPLAY_ENABLED=true AEGIS_DISPLAY_KEYS="k1:$K1" AEGIS_DISPLAY_ACTIVE_KEY_ID=k1 AEGIS_DISPLAY_DISPATCHER_ENABLED=true ||
  { echo "FAIL BLOCKED environment: the API did not start"; tail -20 "$work/api.log"; exit 1; }
python3 -I services/api/scripts/seed-demo-catalog.py >"$work/seed.log" 2>&1
login() {
  curl -fs -H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"password\":\"$2\"}" "$api/auth/login" |
    json 'd["accessToken"]'
}
admin=$(login admin@aegis.demo "$AEGIS_DEMO_ADMIN_PASSWORD")
token=$(login technician@aegis.demo "$AEGIS_DEMO_TECHNICIAN_PASSWORD")
windows=$(python3 -c 'import json; print(json.dumps({"timeZone": "America/Toronto", "windows": [
  {"dayOfWeek": d, "enabled": True, "opensAt": "00:00", "closesAt": "23:59"} for d in
  ["MONDAY","TUESDAY","WEDNESDAY","THURSDAY","FRIDAY","SATURDAY","SUNDAY"]]}))')
curl -fs -X PUT -H "Authorization: Bearer $admin" -H 'Content-Type: application/json' -d "$windows" \
  "$api/admin/lockers/$locker/operating-schedule" >/dev/null
(cd tools/hub-simulator && { [[ -d node_modules ]] || npm ci --ignore-scripts >/dev/null; })
start_hub boot1 true || { echo "simulator did not come online"; exit 1; }

asset=$(curl -fs -H "Authorization: Bearer $token" "$api/assets?q=AEG-DEMO-001&page=0&size=10" |
  json '[a for a in d["items"] if a["assetCode"] == "AEG-DEMO-001"][0]["id"]')
# ready: the boot scan of the current hub session is stored, at most 30 s after the hub came online. Presence is
# unknown after each boot until that scan; the readiness endpoint cannot show it once the asset is reserved.
ready() {
  for _ in $(seq 1 30); do
    [[ $(sql "SELECT count(*) FROM aegis.inbound_device_messages m JOIN aegis.locker_devices d
              ON d.id = m.locker_device_id AND m.device_session_id = d.device_session_id
              WHERE d.locker_id = '$locker' AND m.message_type = 'RFID_SCAN_COMPLETED'") -ge 1 ]] &&
      sleep 1 && return 0
    sleep 1
  done
  echo "BLOCKED setup: no RFID scan stored for the current hub session 30 s after it came online"
  return 1
}
reserve() {
  local until
  until=$(python3 -c 'import datetime; print((datetime.datetime.now(datetime.timezone.utc)
    + datetime.timedelta(minutes=40)).strftime("%Y-%m-%dT%H:%M:%SZ"))')
  local code
  for _ in 1 2 3 4 5 6; do
    code=$(curl -s -o "$work/reserve.body" -w '%{http_code}' -H "Authorization: Bearer $token" \
      -H 'Content-Type: application/json' -H "Idempotency-Key: $(uuid)" \
      -d "{\"assetId\":\"$asset\",\"reservedUntil\":\"$until\"}" "$api/reservations")
    [[ $code == 201 || $code == 200 ]] && { json 'd["id"]' <"$work/reserve.body"; return; }
    echo "  reservation refused ($code): $(cut -c1-200 "$work/reserve.body")" >&2
    sleep 5
  done
  return 1
}
# prepare <name> <reservation>: prints the HTTP status; headers and body stay in the work directory.
prepare() {
  curl -s -o "$work/$1.body" -D "$work/$1.headers" -w '%{http_code}' -X POST \
    -H "Authorization: Bearer $token" -H "Idempotency-Key: $(uuid)" "$api/reservations/$2/checkout"
}
operation_of() { json 'd.get("id", "")' <"$work/$1.body"; }
state() {
  curl -fs -H "Authorization: Bearer $token" "$api/locker-operations/$1" |
    json '" ".join(str(d[k]) for k in ("status", "failureReason", "localProofDisplayedAt"))'
}
# wait_terminal <operation> <seconds>: the REST state once it leaves AWAITING_LOCAL_PROOF.
wait_terminal() {
  local s
  for _ in $(seq 1 "$2"); do
    s=$(state "$1")
    [[ $s == AWAITING_LOCAL_PROOF* ]] || { echo "$s"; return; }
    sleep 1
  done
  echo "$s"
}
row() {
  sql "SELECT d.status || ' ' || d.encryption_key_id || ' ' || coalesce(octet_length(d.encrypted_payload)::text, 'purged')
         || ' ' || c.status || ' ' || (c.displayed_at IS NOT NULL)
       FROM aegis.hub_display_outbox d JOIN aegis.local_access_challenges c ON c.id = d.challenge_id
       WHERE d.operation_id = '$1' AND d.message_type = 'DISPLAY_ACCESS_CHALLENGE'"
}
commands() { sql "SELECT count(*) FROM aegis.command_outbox WHERE operation_id = '$1'"; }
loans() { sql "SELECT count(*) FROM aegis.loans"; }
# Q10: scan and authorization (#44, matrix rows #44 Q1-Q4), only where the route exists. The token is decrypted here
# from the sealed row, kept in a shell variable, sent on stdin and never written or printed.
token_of() {
  sql "SELECT id || ' ' || locker_id || ' ' || operation_id || ' ' || display_revision || ' ' || encryption_key_id
              || ' ' || encode(encrypted_payload, 'base64') FROM aegis.hub_display_outbox
       WHERE operation_id = '$1' AND message_type = 'DISPLAY_ACCESS_CHALLENGE' AND encrypted_payload IS NOT NULL" |
    tr -d '\n' | K1=$K1 K2=$K2 python3 -I -c '
import base64, json, os, sys
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
row, locker, operation, revision, key_id, payload = sys.stdin.read().split(" ", 5)
envelope = base64.b64decode(payload)
aad = f"aegis-display-aad/v1\n{row}\n{locker}\n{operation}\n{revision}".encode()
plain = json.loads(AESGCM(base64.b64decode(os.environ[key_id.upper()])).decrypt(envelope[:12], envelope[12:], aad))
print(plain["payload"]["token"])'
}
# authorize <name> <operation> <challengeId> <token> [bearer]: prints the HTTP status; the body goes to stdin.
authorize() {
  printf '{"challengeId":"%s","token":"%s"}' "$3" "$4" |
    curl -s -o "$work/$1.body" -D "$work/$1.headers" -w '%{http_code}' -X POST --data-binary @- \
      -H 'Content-Type: application/json' -H "Authorization: Bearer ${5:-$token}" -H "Idempotency-Key: $(uuid)" \
      "$api/locker-operations/$2/authorize-local"
}
challenge_of() { sql "SELECT challenge_id FROM aegis.hub_display_outbox WHERE operation_id = '$1' AND challenge_id IS NOT NULL LIMIT 1"; }
wrong_token=$(python3 -c 'import base64, os; print(base64.urlsafe_b64encode(os.urandom(32)).rstrip(b"=").decode())')
probe=$(authorize g-probe "$(uuid)" "$(uuid)" "$wrong_token")
probe_code=$(json 'd.get("code", "")' <"$work/g-probe.body" 2>/dev/null || true)
if [[ $probe == 405 || ($probe == 404 && $probe_code != OPERATION_NOT_FOUND) ]]; then
  echo "FAIL BLOCKED setup: no authorize-local route on this commit ($probe ${probe_code:-})"; exit 1
fi

ready || exit 1
reservation=$(reserve) || { echo "FAIL BLOCKED setup: reservation refused"; exit 1; }
code=$(prepare g1 "$reservation"); op=$(operation_of g1)
[[ $code == 202 ]] || { echo "FAIL BLOCKED setup: preparation $code $(cut -c1-200 "$work/g1.body")"; exit 1; }
for _ in $(seq 1 20); do [[ $(row "$op") =~ true$ ]] && break; sleep 1; done
[[ $(row "$op") =~ true$ ]] || { echo "FAIL BLOCKED setup: challenge never displayed ($(row "$op"))"; exit 1; }
ch=$(challenge_of "$op"); secret=$(token_of "$op")

# G0: revoking the identifier an operation relies on is refused (doc 09 §12.3): that route cannot invalidate the guard.
ident=$(curl -fs -H "Authorization: Bearer $admin" "$api/admin/assets/$asset/identifiers" |
  json '[i["id"] for i in d if i["active"]][0]')
rv=$(curl -s -o "$work/g-revoke.body" -w '%{http_code}' -X POST -H "Authorization: Bearer $admin" \
  -H "Idempotency-Key: $(uuid)" "$api/admin/assets/$asset/identifiers/$ident/revoke")
rvcode=$(json 'd.get("code","")' <"$work/g-revoke.body" 2>/dev/null || true)
[[ $rv == 409 && $rvcode == ASSET_OPERATION_IN_PROGRESS ]] &&
  pass "G0 revoking the expected RFID identifier during the attempt is refused ($rv $rvcode)" ||
  fail "G0 identifier revoke during the attempt: $rv $rvcode (doc 09 §12.3 expects a refusal)"
# The guard is invalidated instead by an ordinary administrative update (doc 09 §12.2, no operation check): the asset
# goes to MAINTENANCE, so its readiness is no longer READY (a definitive guard in the Backend ledger, item 3).
curl -fs -H "Authorization: Bearer $admin" "$api/admin/assets/$asset" >"$work/g-asset.json"
python3 - "$work/g-asset.json" >"$work/g-update.json" <<'P'
import json, sys
a = json.load(open(sys.argv[1]))
print(json.dumps({"assetModelId": a["model"]["id"], "assetCode": a["assetCode"],
  "serialNumber": a.get("serialNumber"), "requiredAccessLevel": a["requiredAccessLevel"],
  "operationalStatus": "MAINTENANCE", "calibrationRequired": a["calibration"]["required"],
  "calibrationDueAt": a["calibration"].get("dueAt")}))
P
up=$(curl -s -o "$work/g-update.body" -w '%{http_code}' -X PUT -H "Authorization: Bearer $admin" \
  -H 'Content-Type: application/json' -H "Idempotency-Key: $(uuid)" --data-binary @"$work/g-update.json" \
  "$api/admin/assets/$asset")
if [[ $up != 200 ]]; then
  echo "FAIL BLOCKED setup: the MAINTENANCE update was refused ($up $(cut -c1-200 "$work/g-update.body"))"; exit 1
fi
obs "G0b an administrator can set the asset to MAINTENANCE while its checkout waits for the scan ($up)"
audit_before=$(sql "SELECT count(*) FROM aegis.audit_events")

g1=$(authorize g1-scan "$op" "$ch" "$secret"); g1code=$(json 'd.get("code", "")' <"$work/g1-scan.body" 2>/dev/null || true)
sleep 2
s1=$(state "$op")
c1=$(sql "SELECT status || ' ' || failed_attempts FROM aegis.local_access_challenges WHERE operation_id = '$op'")
audit_after=$(sql "SELECT count(*) FROM aegis.audit_events")
echo "  G1 scan $g1 $g1code; operation '$s1'; challenge '$c1'; audit events +$((audit_after - audit_before))"
if [[ $g1 != 202 && $s1 == FAILED* && $c1 == INVALIDATED* && $audit_after -gt $audit_before && $(commands "$op") == 0 ]]; then
  pass "G1 definitive guard (asset set to MAINTENANCE) at scan: $g1 $g1code, operation '$s1', challenge '$c1', audited, no command"
else
  fail "G1 DEFECT (doc 06 §6.5, doc 05 §5.4 l.271): scan $g1 $g1code, operation '$s1', challenge '$c1'," \
    "audit +$((audit_after - audit_before)), commands $(commands "$op"); expected FAILED + INVALIDATED + audit, no command"
fi
g2=$(authorize g2-scan "$op" "$ch" "$secret")
[[ $g2 != 202 && $(commands "$op") == 0 ]] && pass "G2 the right secret again: $g2 $(json 'd.get("code","")' <"$work/g2-scan.body" 2>/dev/null), no command" ||
  fail "G2 second scan $g2, commands $(commands "$op")"
unset secret
if [[ $s1 != FAILED* ]]; then
  end=$(wait_terminal "$op" 150)
  obs "G3 without the §6.5 ending, the attempt stays open until expiry and then ends '$end'; challenge '$(sql "SELECT status FROM aegis.local_access_challenges WHERE operation_id = '$op'")'"
fi
[[ $(loans) == 0 ]] && pass "INV no loan" || fail "INV $(loans) loan(s)"
echo
echo "QA GUARD AT SCAN: $failures failed"
exit "$failures"
