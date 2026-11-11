#!/usr/bin/env bash
# Independent QA checks for the preparation and authorization of a loan return and its conclusion at the deadline
# (#50, RET-01): rows T1, T3, T4 and T5 of docs/qualite/integration/matrice-retrait-retour.md that #50 can already show,
# against document 06 §13.1 (with its RET-01 order), document 09 §8.10 and §15.2, and document 05 §7.
#
#   docs/qualite/return-preparation/run.sh     # #50 only, from the repository root, about 30 minutes
#   QA_RET_CASES="D1 D3 D4 D5 D6 D7 D8 E1 E2 E3 E4 E5 E6" docs/qualite/return-preparation/run.sh   # with #51
#
# Real PostgreSQL, Mosquitto (with its ACL) and Spring on a disposable Compose project (aegis-qa-return), recreated for
# each case. The Node simulator plays the hub. Each case first goes through a real checkout (#43, #44, #46, #47) to get
# an ACTIVE loan, then through the real return preparation, display and QR scan; QR tokens are decrypted from the
# sealed rows into shell variables, sent on stdin and never written or printed.
#   D1 T1       borrowed asset not READY, loan made overdue (injected): RETURN offered, preparation accepted, loan
#               still ACTIVE until the scan, idempotent replay, second preparation refused; after the scan the loan is
#               RETURN_PENDING with one command; the door never opens: EXPIRED at expiresAt, loan ACTIVE again
#   D2 T3/T5    the asset is put back and the door closed: no early conclusion; at expiresAt ANOMALY, loan stays
#               RETURN_PENDING (the positive proof is #51), and a new return is refused
#   D3          the door is opened and left open: ANOMALY DOOR_NOT_CLOSED_BEFORE_EXPIRY, loan RETURN_PENDING
#   D4          uncertain hub refusal (LOCK_ACTUATION_FAILED): ANOMALY, loan RETURN_PENDING
#   D5          safe hub refusal (CLOCK_NOT_SYNCHRONIZED): FAILED at expiresAt, not at reception; loan ACTIVE again
#   D6          the hub is lost after acknowledging the unlock: ANOMALY DEVICE_OFFLINE_DURING_OPERATION, RETURN_PENDING
#   D7          the return challenge is never scanned: the operation ends, the loan never left ACTIVE, no command
#   D8          ceiling shared with checkouts (1 per window): the return preparation gets 429 with Retry-After
# With #51 (RET-02, PR #177), D2 no longer applies (the deposit is proven) and the E cases do:
#   E1 T2       nominal return: CONFIRMED before expiresAt, loan COMPLETED, returnedAt = confirmedAt; replays add nothing
#   E2 T3, T5   door closed without the asset: ANOMALY EXPECTED_ASSET_NOT_OBSERVED at expiresAt; the tag in a later
#               inventory scan does not complete the loan
#   E3          another asset read 3 times instead: ANOMALY UNEXPECTED_ASSET_OBSERVED at once
#   E4 T4       rule 2: FAULTED reader at the closing scan, asset put back: ANOMALY at once, loan not completed
#   E5          the expected tag read once only: no proof, ANOMALY at the deadline
#   E6 T5       the scan that sees the asset is received after expiresAt: no completion
# Every case also asserts at most one command per operation, one loan, and COMPLETED only through a CONFIRMED return.
# Exit
# code = number of FAIL lines. OBS lines are observations for the contract owner. The hub is simulated: this proves
# nothing about real hardware.
#
# Needs: docker with compose, Java 21, Node 22.18+, python3 with cryptography, openssl, curl.
# Overrides: QA_RET_DB_PORT (58553), QA_RET_MQTT_PORT (55004), QA_RET_API_PORT (19401), QA_RET_CASES ("D1 ... D8", E1-E6 on request),
#   QA_RET_PROJECT (aegis-qa-return).
set -euo pipefail

root=$(git rev-parse --show-toplevel)
cd "$root"
project=${QA_RET_PROJECT:-aegis-qa-return}
work=$(mktemp -d "${TMPDIR:-/tmp}/aegis-qa-return.XXXXXX")
scenarios=$(mktemp -d tools/hub-simulator/.qa-ret.XXXXXX)
db_port=${QA_RET_DB_PORT:-58553}
mqtt_port=${QA_RET_MQTT_PORT:-55004}
api_port=${QA_RET_API_PORT:-19401}
cases=${QA_RET_CASES:-D1 D2 D3 D4 D5 D6 D7 D8}
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
AEGIS_DEMO_ADMIN_PASSWORD=qa-ret-admin-$(openssl rand -hex 8)
AEGIS_DEMO_TECHNICIAN_PASSWORD=qa-ret-tech-$(openssl rand -hex 8)
AEGIS_MQTT_ENABLED=true
AEGIS_MQTT_URL=tcp://127.0.0.1:$mqtt_port
AEGIS_MQTT_CLIENT_ID=aegis-api-qa-ret
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

# start_hub <case> <steps after the checkout, JSON>: one simulator boot that places the expected tag, scans once for
# presence, plays a real checkout (open, take the tag, close), then the physical steps of the return case.
start_hub() {
  local name=$1 steps=$2
  cat >"$scenarios/$name.json" <<EOF
{ "steps": [
  { "do": "waitOnline", "timeoutMs": 15000 },
  { "do": "setScreen", "available": true },
  { "wait": 3000 },
  { "do": "putTag", "code": "A1", "identifier": "$tag" },
  { "do": "scanRfid", "code": "A1" },
  { "do": "waitUnlocked", "code": "A1", "timeoutMs": 600000 },
  { "wait": 1000 }, { "do": "openDoor", "code": "A1" },
  { "do": "takeTag", "code": "A1", "identifier": "$tag" }, { "wait": 1500 }, { "do": "closeDoor", "code": "A1" },
  { "wait": 6000 },
  { "do": "replay", "type": "HEARTBEAT" },
  $steps,
  { "wait": 900000 },
  { "do": "stop" } ] }
EOF
  env "${hub_env[@]}" AEGIS_MQTT_DEVICE_PASSWORD="$AEGIS_MQTT_DEVICE_PASSWORD" AEGIS_MQTT_URL="mqtt://127.0.0.1:$mqtt_port" \
    AEGIS_SIM_BOOT_COUNT_FILE="$work/boot.json" AEGIS_SIM_COMMAND_JOURNAL_FILE="$work/journal.json" \
    bash -c "cd tools/hub-simulator && exec node src/cli.ts --scenario ${scenarios##*/}/$name.json" \
    >>"$work/simulator-$name.log" 2>&1 &
  hub_pid=$!
  local before
  before=$(device_session)
  for _ in $(seq 1 40); do
    [[ $(device_session) != "$before" &&
       $(sql "SELECT connection_status FROM aegis.locker_devices WHERE locker_id = '$locker'") == ONLINE ]] && return 0
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
wanted() { [[ " $cases " == *" $1 "* ]]; }
max_lag=0
hub_env=()

# setup <case> <hub steps after the checkout> [api env...]: a fresh stack, the API, the demo set, the hub, a reservation
# checked out through the real QR flow until CONFIRMED. Sets $loan; returns 1 with a BLOCKED line otherwise.
setup() {
  local name=$1 steps=$2 code reservation op end
  shift 2
  stop_hub
  stop_api
  "${compose[@]}" down -v >/dev/null 2>&1 || true
  "${compose[@]}" up -d --wait --pull never >/dev/null 2>&1
  start_api "api-$name.log" "$@" || { fail "BLOCKED $name: the API did not start"; return 1; }
  python3 -I services/api/scripts/seed-demo-catalog.py >"$work/seed-$name.log" 2>&1
  admin=$(curl -fs -H 'Content-Type: application/json' \
    -d "{\"email\":\"admin@aegis.demo\",\"password\":\"$AEGIS_DEMO_ADMIN_PASSWORD\"}" "$api/auth/login" |
    json 'd["accessToken"]')
  token=$(curl -fs -H 'Content-Type: application/json' \
    -d "{\"email\":\"technician@aegis.demo\",\"password\":\"$AEGIS_DEMO_TECHNICIAN_PASSWORD\"}" "$api/auth/login" |
    json 'd["accessToken"]')
  python3 -c 'import json; print(json.dumps({"timeZone": "America/Toronto", "windows": [
    {"dayOfWeek": d, "enabled": True, "opensAt": "00:00", "closesAt": "23:59"} for d in
    ["MONDAY","TUESDAY","WEDNESDAY","THURSDAY","FRIDAY","SATURDAY","SUNDAY"]]}))' |
    curl -fs -X PUT -H "Authorization: Bearer $admin" -H 'Content-Type: application/json' --data-binary @- \
      "$api/admin/lockers/$locker/operating-schedule" >/dev/null
  start_hub "$name" "$steps" || { fail "BLOCKED $name: the simulator did not come online"; return 1; }
  ready || { fail "BLOCKED $name: no presence scan for the hub session"; return 1; }
  asset=$(curl -fs -H "Authorization: Bearer $token" "$api/assets?q=AEG-DEMO-001&page=0&size=10" |
    json '[a for a in d["items"] if a["assetCode"] == "AEG-DEMO-001"][0]["id"]')
  local until
  until=$(python3 -c 'import datetime; print((datetime.datetime.now(datetime.timezone.utc)
    + datetime.timedelta(minutes=40)).strftime("%Y-%m-%dT%H:%M:%SZ"))')
  for _ in 1 2 3 4 5 6; do
    code=$(curl -s -o "$work/$name-reserve.body" -w '%{http_code}' -H "Authorization: Bearer $token" \
      -H 'Content-Type: application/json' -H "Idempotency-Key: $(uuid)" \
      -d "{\"assetId\":\"$asset\",\"reservedUntil\":\"$until\"}" "$api/reservations")
    [[ $code == 201 || $code == 200 ]] && break
    sleep 5
  done
  [[ $code == 201 || $code == 200 ]] || { fail "BLOCKED $name: reservation $code"; return 1; }
  reservation=$(json 'd["id"]' <"$work/$name-reserve.body")
  code=$(curl -s -o "$work/$name-checkout.body" -w '%{http_code}' -X POST -H "Authorization: Bearer $token" \
    -H "Idempotency-Key: $(uuid)" "$api/reservations/$reservation/checkout")
  [[ $code == 202 ]] || { fail "BLOCKED $name: checkout preparation $code"; return 1; }
  op=$(json 'd["id"]' <"$work/$name-checkout.body")
  displayed "$op" || { fail "BLOCKED $name: checkout challenge never displayed"; return 1; }
  code=$(authorize "$op" "$work/$name-checkout-authorize.body")
  [[ $code == 202 ]] || { fail "BLOCKED $name: checkout authorization $code"; return 1; }
  end=$(wait_terminal "$op" 40)
  [[ $end == "CONFIRMED -" ]] || { fail "BLOCKED $name: checkout ended '$end'"; return 1; }
  loan=$(sql "SELECT id FROM aegis.loans WHERE checkout_operation_id = '$op'")
  [[ -n $loan ]] || { fail "BLOCKED $name: no loan after the checkout"; return 1; }
  # The cell projection follows heartbeats (every 10 s), not LOCK_LOCKED: a return prepared right after the checkout
  # may still see the lock UNLOCKED and get 409 COMPARTMENT_STATE_UNSAFE. Wait for the projection, and time the lag.
  local cell started
  started=$(date +%s.%N)
  for _ in $(seq 1 30); do
    cell=$(sql "SELECT c.door_state || ' ' || c.lock_state FROM aegis.compartments c
                JOIN aegis.locker_operations o ON o.compartment_id = c.id WHERE o.id = '$op'")
    [[ $cell == "CLOSED LOCKED" ]] && break
    sleep 0.5
  done
  [[ $cell == "CLOSED LOCKED" ]] || { fail "BLOCKED $name: cell projection '$cell' after the checkout"; return 1; }
  projection_lag=$(python3 -c "print(round($(date +%s.%N) - $started, 1))")
  max_lag=$(python3 -c "print(max($max_lag, $projection_lag))")
  # The case steps (an armed fault, for instance) follow the hub's harmless heartbeat replay: a return authorized
  # before that marker would reach a hub that has not armed them yet.
  for _ in $(seq 1 30); do
    grep -q '"event":"replayed"' "$work/simulator-$name.log" && return 0
    sleep 0.5
  done
  fail "BLOCKED $name: the hub never reached the case steps"; return 1
}
# start_return <case>: prepare, display and authorize the return. Sets $rop; returns 1 with a BLOCKED line otherwise.
start_return() {
  local name=$1 code
  code=$(prepare_return "$work/$name-return.body")
  [[ $code == 202 ]] || { fail "BLOCKED $name: return preparation $code $(cat "$work/$name-return.body")"; return 1; }
  rop=$(json 'd["id"]' <"$work/$name-return.body")
  displayed "$rop" || { fail "BLOCKED $name: return challenge never displayed"; return 1; }
  code=$(authorize "$rop" "$work/$name-return-authorize.body")
  [[ $code == 202 ]] || { fail "BLOCKED $name: return authorization $code $(cat "$work/$name-return-authorize.body")"; return 1; }
}

# D1: T1 and the preparation contract, then a return whose door never opens.
if wanted D1 && setup D1 '{ "wait": 1000 }'; then
  readiness=$(curl -fs -H "Authorization: Bearer $token" "$api/assets/$asset" | json 'd["readiness"]["result"]')
  # Injected: the loan is made overdue in the disposable database (document 09 §8.10: overdue does not intervene).
  sql "UPDATE aegis.loans SET due_at = now() - interval '5 minutes' WHERE id = '$loan'" >/dev/null
  before=$(loan_view)
  key=$(uuid)
  code=$(prepare_return "$work/D1-return.body" "$key")
  rop=$(json 'd.get("id", "-")' <"$work/D1-return.body")
  row=$(sql "SELECT type || ' ' || status || ' ' || (loan_id = '$loan') || ' ' || (reservation_id IS NULL)
             FROM aegis.locker_operations WHERE id = '$rop'" 2>/dev/null || true)
  after=$(loan_view)
  if [[ $readiness != READY && $before == "ACTIVE true RETURN" && $code == 202 &&
        $row == "RETURN AWAITING_LOCAL_PROOF true true" && $after == "ACTIVE true -" && $(commands "$rop") == 0 ]]; then
    pass "T1 borrowed asset readiness '$readiness', overdue loan offers RETURN; preparation 202: '$row', loan view" \
      "'$after', no command before the scan"
  else
    fail "T1 preparation: readiness '$readiness', view before '$before', HTTP $code, operation '$row', view after" \
      "'$after', commands $(commands "$rop")"
  fi
  replay=$(prepare_return "$work/D1-replay.body" "$key")
  replay_id=$(json 'd.get("id", "-")' <"$work/D1-replay.body")
  second=$(prepare_return "$work/D1-second.body")
  second_code=$(json 'd.get("code", "-")' <"$work/D1-second.body")
  operations=$(sql "SELECT count(*) FROM aegis.locker_operations WHERE type = 'RETURN'")
  [[ $replay =~ ^20[02]$ && $replay_id == "$rop" && $second == 409 && $operations == 1 ]] &&
    pass "D1 same Idempotency-Key: $replay with the same operation; new key: 409 $second_code; one RETURN operation" ||
    fail "D1 replays: same key $replay ($replay_id), new key $second $second_code, RETURN operations $operations"
  displayed "$rop" || true
  action=$(challenge "$rop" action)
  code=$(authorize "$rop" "$work/D1-return-authorize.body")
  sleep 2
  window=$(sql "SELECT extract(epoch FROM expires_at - authorized_at)::int FROM aegis.locker_operations WHERE id = '$rop'")
  if [[ $code == 202 && $action == RETURN && $(loan_status) == RETURN_PENDING && $(commands "$rop") == 1 &&
        $window == 120 ]]; then
    pass "D1 challenge action '$action', scan 202: loan RETURN_PENDING, one command, expiresAt = authorizedAt + 120 s"
  else
    fail "D1 scan: action '$action', HTTP $code, loan $(loan_status), commands $(commands "$rop"), window $window s"
  fi
  sleep 60
  early=$(op_state "$rop")
  end=$(wait_terminal "$rop" 90)
  delay=$(vs_deadline "$rop")
  sleep 2
  if [[ $end == "EXPIRED OPERATION_EXPIRED" && $(loan_status) == ACTIVE && $(reverted) == 1 &&
        $(anomalies "$rop") == "0 -" && $(python3 -c "print(0 <= ${delay:-(-1)} <= 2.5)") == True &&
        $(loan_view) == "ACTIVE true RETURN" ]]; then
    pass "D1 door never opened: '$early' 60 s after the scan, then '$end' $delay s after expiresAt; loan ACTIVE," \
      "one LOAN_RETURN_REVERTED_SAFE audit, RETURN offered again"
  else
    fail "D1 door never opened: '$early', then '$end' at expiresAt + ${delay:-?} s, loan $(loan_status), reverted" \
      "audits $(reverted), anomalies '$(anomalies "$rop")', view '$(loan_view)'"
  fi
  invariant D1
fi

# D2: the asset is put back and the door closed; #50 alone has no positive proof.
if wanted D2 && setup D2 '{ "do": "waitUnlocked", "code": "A1", "timeoutMs": 600000 }, { "wait": 1000 },
  { "do": "openDoor", "code": "A1" }, { "do": "putTag", "code": "A1", "identifier": "'$tag'" }, { "wait": 1500 },
  { "do": "closeDoor", "code": "A1" }' && start_return D2; then
  sleep 20
  early=$(op_state "$rop")
  early_loan=$(loan_status)
  end=$(wait_terminal "$rop" 120)
  delay=$(vs_deadline "$rop")
  code=$(prepare_return "$work/D2-again.body")
  again=$(json 'd.get("code", "-")' <"$work/D2-again.body")
  if [[ ! $early =~ ^(EXPIRED|ANOMALY|FAILED|CONFIRMED) && $early_loan == RETURN_PENDING && $end == ANOMALY* &&
        $(loan_status) == RETURN_PENDING && $(anomalies "$rop") =~ ^1\ .*/OPEN$ &&
        $(python3 -c "print(0 <= ${delay:-(-1)} <= 2.5)") == True && $code == 409 && $again == LOAN_NOT_RETURNABLE &&
        $(loan_view) == "RETURN_PENDING false -" ]]; then
    pass "D2 asset put back, door closed: '$early' 20 s later, then '$end' $delay s after expiresAt; loan" \
      "RETURN_PENDING, anomaly '$(anomalies "$rop")', new return 409 $again, no action offered"
  else
    fail "D2 asset put back: '$early' (loan $early_loan), then '$end' at expiresAt + ${delay:-?} s, loan" \
      "$(loan_status), anomaly '$(anomalies "$rop")', new return $code $again, view '$(loan_view)'"
  fi
  [[ $end == "ANOMALY DEVICE_OFFLINE_DURING_OPERATION" ]] &&
    obs "D2 a complete, coherent deposit with the hub online ends 'DEVICE_OFFLINE_DURING_OPERATION' until #51 brings" \
      "the positive proof; the reason names a device loss that did not happen"
  invariant D2
fi

# D3: the door is opened and left open past the deadline.
if wanted D3 && setup D3 '{ "do": "waitUnlocked", "code": "A1", "timeoutMs": 600000 }, { "wait": 1000 },
  { "do": "openDoor", "code": "A1" }' && start_return D3; then
  end=$(wait_terminal "$rop" 140)
  delay=$(vs_deadline "$rop")
  [[ $end == "ANOMALY DOOR_NOT_CLOSED_BEFORE_EXPIRY" && $(loan_status) == RETURN_PENDING &&
     $(python3 -c "print(0 <= ${delay:-(-1)} <= 2.5)") == True ]] &&
    pass "D3 door left open: '$end' $delay s after expiresAt, loan RETURN_PENDING, anomaly '$(anomalies "$rop")'" ||
    fail "D3 door left open: '$end' at expiresAt + ${delay:-?} s, loan $(loan_status), anomaly '$(anomalies "$rop")'"
  invariant D3
fi

# D4: an uncertain refusal of the unlock (the lock may have moved).
if wanted D4 && setup D4 '{ "do": "armFault", "fault": "LOCK_ACTUATION_FAILED" }' && start_return D4; then
  sleep 10
  rejection=$(sql "SELECT parsed_payload ->> 'reason' FROM aegis.inbound_device_messages WHERE operation_id = '$rop'
                   AND message_type = 'COMMAND_REJECTED' LIMIT 1")
  early=$(op_state "$rop")
  end=$(wait_terminal "$rop" 130)
  delay=$(vs_deadline "$rop")
  if [[ $rejection == LOCK_ACTUATION_FAILED && $end == ANOMALY* && $(loan_status) == RETURN_PENDING &&
        $(anomalies "$rop") =~ ^1\  && $(reverted) == 0 ]]; then
    pass "D4 uncertain refusal '$rejection': '$early', then '$end' (expiresAt + $delay s), loan RETURN_PENDING," \
      "anomaly '$(anomalies "$rop")'"
  else
    fail "D4 uncertain refusal '${rejection:-none}': '$early', then '$end' at expiresAt + ${delay:-?} s, loan" \
      "$(loan_status), anomalies '$(anomalies "$rop")', reverted audits $(reverted)"
  fi
  invariant D4
fi

# D5: a safe refusal (unsynchronized hub clock). The clock is turned off after the return challenge is displayed: the
# scenario marks that moment with a harmless replay of its own heartbeat, which the script waits for.
if wanted D5 && setup D5 '{ "wait": 20000 }, { "do": "setClock", "synchronized": false },
  { "do": "replay", "type": "HEARTBEAT" }'; then
  code=$(prepare_return "$work/D5-return.body")
  rop=$(json 'd.get("id", "-")' <"$work/D5-return.body")
  if [[ $code == 202 ]] && displayed "$rop"; then
    for _ in $(seq 1 60); do (( $(grep -c '"event":"replayed"' "$work/simulator-D5.log") >= 2 )) && break; sleep 1; done
    sleep 1
    code=$(authorize "$rop" "$work/D5-return-authorize.body")
  else
    code="preparation $code"
  fi
  if [[ $code == 202 ]]; then
    sleep 10
    rejection=$(sql "SELECT parsed_payload ->> 'reason' FROM aegis.inbound_device_messages WHERE operation_id = '$rop'
                     AND message_type = 'COMMAND_REJECTED' LIMIT 1")
    early=$(op_state "$rop")
    early_loan=$(loan_status)
    end=$(wait_terminal "$rop" 130)
    delay=$(vs_deadline "$rop")
    sleep 2
    if [[ $rejection == CLOCK_NOT_SYNCHRONIZED && ! $early =~ ^(EXPIRED|ANOMALY|FAILED) &&
          $early_loan == RETURN_PENDING && $end == "FAILED COMMAND_REJECTED_CLOCK_NOT_SYNCHRONIZED" &&
          $(python3 -c "print(0 <= ${delay:-(-1)} <= 2.5)") == True && $(loan_status) == ACTIVE && $(reverted) == 1 &&
          $(anomalies "$rop") == "0 -" ]]; then
      pass "D5 safe refusal '$rejection': '$early' 10 s after it (loan $early_loan), then '$end' $delay s after" \
        "expiresAt; loan ACTIVE, one LOAN_RETURN_REVERTED_SAFE audit, no anomaly"
    else
      fail "D5 safe refusal '${rejection:-none}': '$early' (loan $early_loan), then '$end' at expiresAt + ${delay:-?} s," \
        "loan $(loan_status), reverted audits $(reverted), anomalies '$(anomalies "$rop")'"
    fi
  else
    obs "D5 not exercised: return scan with the hub clock unsynchronized gave $code" \
      "$(cat "$work/D5-return-authorize.body" 2>/dev/null)"
  fi
  invariant D5
fi

# D6: the hub is lost after acknowledging the unlock, before any door event.
if wanted D6 && setup D6 '{ "do": "waitUnlocked", "code": "A1", "timeoutMs": 600000 }, { "wait": 2000 },
  { "do": "crash" }' && start_return D6; then
  end=$(wait_terminal "$rop" 140)
  delay=$(vs_deadline "$rop")
  ack=$(sql "SELECT acknowledged_at IS NOT NULL FROM aegis.locker_operations WHERE id = '$rop'")
  [[ $ack == t && $end == "ANOMALY DEVICE_OFFLINE_DURING_OPERATION" && $(loan_status) == RETURN_PENDING &&
     $(python3 -c "print(0 <= ${delay:-(-1)} <= 2.5)") == True ]] &&
    pass "D6 hub lost after the acknowledged unlock: '$end' $delay s after expiresAt, loan RETURN_PENDING" ||
    fail "D6 hub lost after the unlock (acknowledged $ack): '$end' at expiresAt + ${delay:-?} s, loan $(loan_status)"
  invariant D6
fi

# D7: the return challenge is displayed and never scanned.
if wanted D7 && setup D7 '{ "wait": 1000 }'; then
  code=$(prepare_return "$work/D7-return.body")
  rop=$(json 'd.get("id", "-")' <"$work/D7-return.body")
  end=$(wait_terminal "$rop" 100)
  if [[ $code == 202 && $end =~ ^(EXPIRED|FAILED)\  && $(loan_status) == ACTIVE && $(commands "$rop") == 0 &&
        $(reverted) == 0 && $(loan_view) == "ACTIVE false RETURN" ]]; then
    pass "D7 return challenge never scanned: '$end', loan never left ACTIVE, no command, RETURN offered again"
  else
    fail "D7 challenge never scanned: HTTP $code, '$end', loan $(loan_status), commands $(commands "$rop")," \
      "reverted audits $(reverted), view '$(loan_view)'"
  fi
  invariant D7
fi

# D8: the preparation ceiling counts checkouts and returns of the same user-locker pair together.
if wanted D8 && setup D8 '{ "wait": 1000 }' AEGIS_PREPARATION_MAX_PER_WINDOW=1; then
  admin_code=$(curl -s -o "$work/D8-admin.body" -w '%{http_code}' -X POST -H "Authorization: Bearer $admin" \
    -H "Idempotency-Key: $(uuid)" "$api/loans/$loan/return")
  code=$(prepare_return "$work/D8-return.body")
  reason=$(json 'd.get("code", "-")' <"$work/D8-return.body")
  retry=$(awk 'tolower($1) == "retry-after:" {print $2}' "$work/D8-return.body.headers" | tr -d '\r')
  [[ $admin_code =~ ^40[34]$ ]] && pass "D8 administrator return preparation refused ($admin_code)" ||
    fail "D8 administrator return preparation: $admin_code"
  [[ $code == 429 && $reason == LOCAL_PROOF_RATE_LIMITED && $retry =~ ^[0-9]+$ && $(loan_status) == ACTIVE ]] &&
    pass "D8 one checkout already prepared, ceiling 1: return preparation 429 $reason, Retry-After $retry" ||
    fail "D8 shared ceiling: HTTP $code $reason, Retry-After '${retry:-none}', loan $(loan_status)"
  invariant D8
fi


# ---- #51 (RET-02): the positive proof of a return. Run these on a commit that contains #51 (PR #177). ----
deposit='{ "do": "waitUnlocked", "code": "A1", "timeoutMs": 600000 }, { "wait": 1000 },
  { "do": "openDoor", "code": "A1" }, { "do": "putTag", "code": "A1", "identifier": "'$tag'" }, { "wait": 1500 },
  { "do": "closeDoor", "code": "A1" }'
completed() { sql "SELECT count(*) FROM aegis.audit_events WHERE event_type = 'LOAN_COMPLETED' AND subject_id = '$loan'"; }

# E1: T2 nominal return, then the acknowledgement, door and scan messages replayed with their messageId.
if wanted E1 && setup E1 "$deposit, { \"wait\": 6000 },
  { \"do\": \"replay\", \"type\": \"COMMAND_ACKNOWLEDGED\" }, { \"do\": \"replay\", \"type\": \"DOOR_OPENED\" },
  { \"do\": \"replay\", \"type\": \"DOOR_CLOSED\" }, { \"do\": \"replay\", \"type\": \"RFID_SCAN_COMPLETED\" }" &&
   start_return E1; then
  end=$(wait_terminal "$rop" 40)
  delay=$(vs_deadline "$rop")
  sleep 12
  dates=$(sql "SELECT (l.returned_at = o.confirmed_at) || ' ' || (l.return_operation_id = o.id) FROM aegis.loans l
               JOIN aegis.locker_operations o ON o.id = '$rop' WHERE l.id = '$loan'")
  confirmed=$(sql "SELECT count(*) FROM aegis.audit_events WHERE event_type = 'OPERATION_CONFIRMED' AND subject_id = '$rop'")
  view=$(curl -fs -H "Authorization: Bearer $token" "$api/loans/$loan" |
    json '" ".join([d["status"], str(d["returnedAt"] is not None).lower(), ",".join(d["availableActions"]) or "-"])')
  availability=$(curl -fs -H "Authorization: Bearer $token" "$api/assets/$asset" | json 'd["availability"]')
  if [[ $end == "CONFIRMED -" && $(python3 -c "print(${delay:-0} < -60)") == True && $(loan_status) == COMPLETED &&
        $dates == "true true" && $confirmed == 1 && $(completed) == 1 && $view == "COMPLETED true -" &&
        $(anomalies "$rop") == "0 -" ]]; then
    pass "T2 asset put back: '$end' $delay s before expiresAt, loan COMPLETED with returnedAt = confirmedAt, one" \
      "OPERATION_CONFIRMED and one LOAN_COMPLETED audit after the replays; view '$view', asset availability" \
      "'$availability'"
  else
    fail "T2 nominal return: '$end' at expiresAt + ${delay:-?} s, loan $(loan_status), dates '$dates', audits" \
      "confirmed $confirmed completed $(completed), view '$view', anomalies '$(anomalies "$rop")'"
  fi
  invariant E1
fi

# E2: T3 the door opens and closes without the asset; then the tag reappears in an inventory scan after the deadline.
hub_env=(AEGIS_SIM_RFID_WINDOW_MS=3000)
if wanted E2 && setup E2 '{ "do": "waitUnlocked", "code": "A1", "timeoutMs": 600000 }, { "wait": 1000 },
  { "do": "openDoor", "code": "A1" }, { "wait": 1500 }, { "do": "closeDoor", "code": "A1" }, { "wait": 130000 },
  { "do": "putTag", "code": "A1", "identifier": "'$tag'" }, { "do": "scanRfid", "code": "A1" }' &&
   start_return E2; then
  sleep 15
  early=$(op_state "$rop")
  end=$(wait_terminal "$rop" 120)
  delay=$(vs_deadline "$rop")
  if [[ $early == "OBSERVATION_RECEIVED -" && $end == "ANOMALY EXPECTED_ASSET_NOT_OBSERVED" &&
        $(python3 -c "print(0 <= ${delay:-(-1)} <= 2.5)") == True && $(loan_status) == RETURN_PENDING ]]; then
    pass "T3 door closed without the asset: '$early' 15 s later, '$end' $delay s after expiresAt, loan RETURN_PENDING"
  else
    fail "T3 asset not put back: '$early', then '$end' at expiresAt + ${delay:-?} s, loan $(loan_status)"
  fi
  sleep 20
  late=$(sql "SELECT count(*) FROM aegis.physical_observations WHERE type = 'ASSET_PRESENT' AND identifier_value = '$tag'
              AND observed_at > (SELECT expires_at FROM aegis.locker_operations WHERE id = '$rop')")
  if [[ $late -ge 1 && $(loan_status) == RETURN_PENDING && $(op_state "$rop") == "$end" ]]; then
    pass "T5 the tag present in an inventory scan after the anomaly ($late observation): loan still RETURN_PENDING," \
      "operation unchanged"
  else
    obs "T5 late presence: $late ASSET_PRESENT observation(s) after expiresAt, loan $(loan_status), '$(op_state "$rop")'"
  fi
  invariant E2
fi
hub_env=()

# E3: another asset stably read instead of the expected one.
if wanted E3 && setup E3 '{ "do": "waitUnlocked", "code": "A1", "timeoutMs": 600000 }, { "wait": 1000 },
  { "do": "openDoor", "code": "A1" }, { "do": "putTag", "code": "A1", "identifier": "'$foreign'" }, { "wait": 1500 },
  { "do": "closeDoor", "code": "A1" }' && start_return E3; then
  end=$(wait_terminal "$rop" 40)
  delay=$(vs_deadline "$rop")
  [[ $end == "ANOMALY UNEXPECTED_ASSET_OBSERVED" && $(python3 -c "print(${delay:-0} < -60)") == True &&
     $(loan_status) == RETURN_PENDING ]] &&
    pass "E3 foreign tag instead of the asset: '$end' at once ($delay s before expiresAt), loan RETURN_PENDING" ||
    fail "E3 foreign tag: '$end' at expiresAt + ${delay:-?} s, loan $(loan_status), anomaly '$(anomalies "$rop")'"
  invariant E3
fi

# E4: T4 rule 2 on a return: FAULTED reader at the closing scan, the asset put back.
if wanted E4 && setup E4 '{ "do": "waitUnlocked", "code": "A1", "timeoutMs": 600000 }, { "wait": 1000 },
  { "do": "openDoor", "code": "A1" }, { "do": "putTag", "code": "A1", "identifier": "'$tag'" },
  { "do": "updateCompartment", "code": "A1", "patch": { "readerStatus": "FAULTED" } }, { "wait": 1500 },
  { "do": "closeDoor", "code": "A1" }' && start_return E4; then
  end=$(wait_terminal "$rop" 40)
  delay=$(vs_deadline "$rop")
  [[ $end == "ANOMALY INCONSISTENT_PHYSICAL_STATE" && $(python3 -c "print(${delay:-0} < -60)") == True &&
     $(loan_status) == RETURN_PENDING ]] &&
    pass "T4 rule 2 on a return: '$end' at once ($delay s before expiresAt), loan RETURN_PENDING, not completed" ||
    fail "T4 rule 2 on a return: '$end' at expiresAt + ${delay:-?} s, loan $(loan_status)"
  invariant E4
fi

# E5: the expected tag read only once (not a stable presence).
if wanted E5 && setup E5 '{ "do": "waitUnlocked", "code": "A1", "timeoutMs": 600000 }, { "wait": 1000 },
  { "do": "openDoor", "code": "A1" }, { "do": "putTag", "code": "A1", "identifier": "'$tag'", "readCount": 1 },
  { "wait": 1500 }, { "do": "closeDoor", "code": "A1" }' && start_return E5; then
  sleep 15
  early=$(op_state "$rop")
  end=$(wait_terminal "$rop" 120)
  [[ ! $early =~ ^(CONFIRMED|ANOMALY|EXPIRED|FAILED) && $end == ANOMALY* && $(loan_status) == RETURN_PENDING ]] &&
    pass "E5 one read of the expected tag: '$early', then '$end' at the deadline, loan RETURN_PENDING" ||
    fail "E5 one read of the expected tag: '$early', then '$end', loan $(loan_status)"
  invariant E5
fi

# E6: T5 the door closes 115 s after the unlock; the scan that sees the asset completes after expiresAt.
hub_env=(AEGIS_SIM_RFID_WINDOW_MS=10000)
if wanted E6 && setup E6 '{ "do": "waitUnlocked", "code": "A1", "timeoutMs": 600000 }, { "wait": 1000 },
  { "do": "openDoor", "code": "A1" }, { "do": "putTag", "code": "A1", "identifier": "'$tag'" }, { "wait": 112000 },
  { "do": "closeDoor", "code": "A1" }' && start_return E6; then
  end=$(wait_terminal "$rop" 150)
  sleep 15
  scan=$(sql "SELECT round(extract(epoch FROM m.received_at - o.expires_at)::numeric, 1) FROM aegis.inbound_device_messages m
              JOIN aegis.locker_operations o ON o.id = m.operation_id WHERE m.operation_id = '$rop'
              AND m.message_type = 'RFID_SCAN_COMPLETED' ORDER BY m.sequence DESC LIMIT 1")
  if [[ -n $scan && $(python3 -c "print($scan > 0)") == True && $end == ANOMALY* && $(op_state "$rop") == "$end" &&
        $(loan_status) == RETURN_PENDING ]]; then
    pass "T5 scan seeing the asset received $scan s after expiresAt: '$end', loan stays RETURN_PENDING"
  elif [[ -n $scan && $(python3 -c "print($scan > 0)") == True ]]; then
    fail "T5 late scan ($scan s after expiresAt): '$end', now '$(op_state "$rop")', loan $(loan_status)"
  else
    obs "T5 not conclusive: scan at expiresAt + ${scan:-none} s, '$end'"
  fi
  invariant E6
fi
hub_env=()

[[ $(python3 -c "print($max_lag > 1)") == True ]] &&
  obs "cell projection still showed the checkout's unlocked lock up to $max_lag s after CONFIRMED (heartbeat-driven);" \
    "a return prepared in that interval gets 409 COMPARTMENT_STATE_UNSAFE"

echo
if [[ $failures -eq 0 ]]; then echo "QA RETURN PREPARATION: all checks passed"; else
  echo "QA RETURN PREPARATION: $failures failed"; fi
exit "$failures"
