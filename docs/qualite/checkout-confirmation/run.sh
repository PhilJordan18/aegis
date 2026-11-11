#!/usr/bin/env bash
# Independent QA checks for the confirmation of an authorized checkout (#47): rows K1-K14 of
# docs/qualite/integration/matrice-retrait-retour.md, against the rules approved by Philippe on 11 November and the
# normative documents 05 §5.4-5.5 and 06 §10, §14.2.
#
#   docs/qualite/checkout-confirmation/run.sh     # from the repository root, about 25 minutes
#
# Real PostgreSQL, Mosquitto (with its ACL) and Spring on a disposable Compose project (aegis-qa-checkout) with its own
# ports, recreated for each case so that no loan, anomaly or reservation leaks into the next one. The Node simulator
# plays the hub: it receives the real UNLOCK_COMPARTMENT, acknowledges it and scripts the door, the tags and the
# reader. Each case goes through the real preparation, display and scan (#43, #44, #46): the QR token is decrypted
# from the sealed row into a shell variable, sent on stdin and never written or printed.
#   C1 K1, K9   nominal, then the acknowledgement, door and scan messages replayed with their messageId
#   C2 K2-K4    rule 1: the healthy scan still sees the expected tag; not terminal at expiresAt - 1 s, ANOMALY after
#   C3 K5       rule 2: FAULTED reader at the scan after the closing: ANOMALY at once, before expiresAt
#   C4 K6       rule 2: UNKNOWN reader at the scan after the closing
#   C5 K7       a FAULTED scan while the door is still open, then a healthy closing scan: no rule 2, CONFIRMED
#   C6 K8, K11  door closed, the scan completes only after expiresAt: ANOMALY at the deadline, the late healthy scan
#               without the tag changes nothing
#   C7          same physical sequence with a 5-minute evaluation interval: a proof received after expiresAt must not
#               confirm (document 05 §5.5: delivery never extends a deadline)
#   C8 K14      the expected tag removed and another tag left in the cell
#   C9          the hub crashes after the closing, before its scan: absence of a message is not a proof
# Every case also asserts at most one command and at most one loan, only for a CONFIRMED operation. Exit code =
# number of FAIL lines. OBS lines are observations for the contract owner. The hub is simulated: this proves nothing
# about real hardware.
#
# Needs: docker with compose, Java 21, Node 22.18+, python3 with cryptography, openssl, curl.
# Overrides: QA_CHK_DB_PORT (58543), QA_CHK_MQTT_PORT (54994), QA_CHK_API_PORT (19391), QA_CHK_CASES ("C1 ... C9").
set -euo pipefail

root=$(git rev-parse --show-toplevel)
cd "$root"
project=aegis-qa-checkout
work=$(mktemp -d "${TMPDIR:-/tmp}/aegis-qa-checkout.XXXXXX")
scenarios=$(mktemp -d tools/hub-simulator/.qa-chk.XXXXXX)
db_port=${QA_CHK_DB_PORT:-58543}
mqtt_port=${QA_CHK_MQTT_PORT:-54994}
api_port=${QA_CHK_API_PORT:-19391}
cases=${QA_CHK_CASES:-C1 C2 C3 C4 C5 C6 C7 C8 C9}
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
AEGIS_DEMO_ADMIN_PASSWORD=qa-chk-admin-$(openssl rand -hex 8)
AEGIS_DEMO_TECHNICIAN_PASSWORD=qa-chk-tech-$(openssl rand -hex 8)
AEGIS_MQTT_ENABLED=true
AEGIS_MQTT_URL=tcp://127.0.0.1:$mqtt_port
AEGIS_MQTT_CLIENT_ID=aegis-api-qa-chk
AEGIS_DISPLAY_ENABLED=true
AEGIS_DISPLAY_KEYS=k1:$K1
AEGIS_DISPLAY_ACTIVE_KEY_ID=k1
AEGIS_DISPLAY_DISPATCHER_ENABLED=true
AEGIS_COMMAND_DISPATCHER_ENABLED=true
AEGIS_PREPARATION_MAX_PER_WINDOW=50
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

# start_hub <case> <steps after the unlock, JSON> [extra env]: one simulator boot that places the expected tag, scans
# once for presence, then waits for the real unlock command of the case and plays its physical steps.
start_hub() {
  local name=$1 steps=$2
  shift 2
  cat >"$scenarios/$name.json" <<EOF
{ "steps": [
  { "do": "waitOnline", "timeoutMs": 15000 },
  { "do": "setScreen", "available": true },
  { "wait": 3000 },
  { "do": "putTag", "code": "A1", "identifier": "$tag" },
  { "do": "scanRfid", "code": "A1" },
  { "do": "waitUnlocked", "code": "A1", "timeoutMs": 600000 },
  $steps,
  { "wait": 900000 },
  { "do": "stop" } ] }
EOF
  env "$@" AEGIS_MQTT_DEVICE_PASSWORD="$AEGIS_MQTT_DEVICE_PASSWORD" AEGIS_MQTT_URL="mqtt://127.0.0.1:$mqtt_port" \
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
token_of() {
  sql "SELECT id || ' ' || locker_id || ' ' || operation_id || ' ' || display_revision || ' ' || encryption_key_id
              || ' ' || encode(encrypted_payload, 'base64') FROM aegis.hub_display_outbox
       WHERE operation_id = '$1' AND message_type = 'DISPLAY_ACCESS_CHALLENGE' AND encrypted_payload IS NOT NULL" |
    tr -d '\n' | K1=$K1 python3 -I -c '
import base64, json, os, sys
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
row, locker, operation, revision, key_id, payload = sys.stdin.read().split(" ", 5)
envelope = base64.b64decode(payload)
aad = f"aegis-display-aad/v1\n{row}\n{locker}\n{operation}\n{revision}".encode()
plain = json.loads(AESGCM(base64.b64decode(os.environ[key_id.upper()])).decrypt(envelope[:12], envelope[12:], aad))
print(plain["payload"]["token"])'
}

# setup <case> <hub steps> [api env...]: a fresh stack, the API, the demo set, the hub of the case, then a reservation
# prepared, displayed and authorized with the real QR. Sets $op and $until; returns 1 with a BLOCKED line otherwise.
setup() {
  local name=$1 steps=$2 secret code reservation ch
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
  start_hub "$name" "$steps" "${hub_env[@]}" || { fail "BLOCKED $name: the simulator did not come online"; return 1; }
  ready || { fail "BLOCKED $name: no presence scan for the hub session"; return 1; }
  asset=$(curl -fs -H "Authorization: Bearer $token" "$api/assets?q=AEG-DEMO-001&page=0&size=10" |
    json '[a for a in d["items"] if a["assetCode"] == "AEG-DEMO-001"][0]["id"]')
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
  code=$(curl -s -o "$work/$name-prepare.body" -w '%{http_code}' -X POST -H "Authorization: Bearer $token" \
    -H "Idempotency-Key: $(uuid)" "$api/reservations/$reservation/checkout")
  [[ $code == 202 ]] || { fail "BLOCKED $name: preparation $code"; return 1; }
  op=$(json 'd["id"]' <"$work/$name-prepare.body")
  for _ in $(seq 1 20); do
    [[ $(sql "SELECT displayed_at IS NOT NULL FROM aegis.local_access_challenges WHERE operation_id = '$op'") == t ]] &&
      break
    sleep 1
  done
  ch=$(sql "SELECT challenge_id FROM aegis.hub_display_outbox WHERE operation_id = '$op' AND challenge_id IS NOT NULL
            LIMIT 1")
  secret=$(token_of "$op")
  code=$(printf '{"challengeId":"%s","token":"%s"}' "$ch" "$secret" |
    curl -s -o "$work/$name-authorize.body" -w '%{http_code}' -X POST --data-binary @- \
      -H 'Content-Type: application/json' -H "Authorization: Bearer $token" -H "Idempotency-Key: $(uuid)" \
      "$api/locker-operations/$op/authorize-local")
  unset secret
  [[ $code == 202 ]] || { fail "BLOCKED $name: authorization $code"; return 1; }
}

# Facts of the operation under test, read from the database (the public view is checked once, in C1).
op_state() { sql "SELECT status || ' ' || coalesce(failure_reason, '-') FROM aegis.locker_operations WHERE id = '$op'"; }
# wait_terminal <seconds>: the state once terminal, or the last state seen.
wait_terminal() {
  local s
  for _ in $(seq 1 "$1"); do
    s=$(op_state)
    [[ $s =~ ^(CONFIRMED|EXPIRED|ANOMALY|FAILED|CANCELLED)\  ]] && { echo "$s"; return; }
    sleep 1
  done
  echo "$s"
}
# Seconds from expiresAt to terminalAt: negative before the deadline.
vs_deadline() { sql "SELECT round(extract(epoch FROM terminal_at - expires_at)::numeric, 1) FROM aegis.locker_operations WHERE id = '$op'"; }
loans() { sql "SELECT count(*) FROM aegis.loans WHERE checkout_operation_id = '$op'"; }
all_loans() { sql "SELECT count(*) FROM aegis.loans"; }
commands() { sql "SELECT count(*) FROM aegis.command_outbox WHERE operation_id = '$op'"; }
anomalies() { sql "SELECT count(*) || ' ' || coalesce(string_agg(type || '/' || (details ->> 'finding'), ','), '-') FROM aegis.anomalies WHERE locker_operation_id = '$op'"; }
message_at() {
  sql "SELECT round(extract(epoch FROM m.received_at - o.expires_at)::numeric, 1) FROM aegis.inbound_device_messages m
       JOIN aegis.locker_operations o ON o.id = m.operation_id
       WHERE m.operation_id = '$op' AND m.message_type = '$1' ORDER BY m.sequence DESC LIMIT 1"
}
# invariant <case>: at most one command; a loan only for a CONFIRMED operation, and then exactly one.
invariant() {
  local s
  s=$(op_state)
  if [[ $(commands) -le 1 && ( ($s == CONFIRMED* && $(all_loans) == 1) || ($s != CONFIRMED* && $(all_loans) == 0) ) ]]; then
    return 0
  fi
  fail "$1 invariant: '$s', commands $(commands), loans $(all_loans)"
}
wanted() { [[ " $cases " == *" $1 "* ]]; }
hub_env=()

open_take_close='{ "wait": 1000 }, { "do": "openDoor", "code": "A1" },
  { "do": "takeTag", "code": "A1", "identifier": "'$tag'" }, { "wait": 1500 }, { "do": "closeDoor", "code": "A1" }'

# C1: K1 nominal, then K9 replays of every proof message with its messageId.
if wanted C1 && setup C1 "$open_take_close, { \"wait\": 6000 },
  { \"do\": \"replay\", \"type\": \"COMMAND_ACKNOWLEDGED\" }, { \"do\": \"replay\", \"type\": \"DOOR_OPENED\" },
  { \"do\": \"replay\", \"type\": \"DOOR_CLOSED\" }, { \"do\": \"replay\", \"type\": \"RFID_SCAN_COMPLETED\" }"; then
  end=$(wait_terminal 40)
  sleep 12
  loan=$(sql "SELECT l.status || ' ' || (l.due_at = r.reserved_until) FROM aegis.loans l JOIN aegis.locker_operations o
              ON o.id = l.checkout_operation_id JOIN aegis.reservations r ON r.id = o.reservation_id
              WHERE l.checkout_operation_id = '$op'")
  resv=$(sql "SELECT r.status FROM aegis.reservations r JOIN aegis.locker_operations o ON o.reservation_id = r.id
              WHERE o.id = '$op'")
  view=$(curl -fs -H "Authorization: Bearer $token" "$api/locker-operations/$op" |
    json '" ".join(str(d.get(k)) for k in ("status", "failureReason"))')
  replays=$(sql "SELECT count(*) FROM aegis.inbound_device_messages WHERE operation_id = '$op'
                 AND message_type IN ('COMMAND_ACKNOWLEDGED', 'DOOR_OPENED', 'DOOR_CLOSED', 'RFID_SCAN_COMPLETED')")
  confirmed=$(sql "SELECT count(*) FROM aegis.audit_events WHERE event_type = 'OPERATION_CONFIRMED' AND subject_id = '$op'")
  if [[ $end == "CONFIRMED -" && $loan == "ACTIVE true" && $resv == FULFILLED && $view == "CONFIRMED None" &&
        $(loans) == 1 && $confirmed == 1 && $(commands) == 1 ]]; then
    pass "K1 nominal: CONFIRMED, reservation FULFILLED, one ACTIVE loan with dueAt = reservedUntil, REST '$view'"
  else
    fail "K1 nominal: '$end', loan '$loan', reservation $resv, REST '$view', loans $(loans), confirmed audits $confirmed"
  fi
  if [[ $(loans) == 1 && $confirmed == 1 && $(op_state) == "CONFIRMED -" ]]; then
    pass "K9 acknowledgement, door and scan messages replayed with their messageId: still one loan and one" \
      "OPERATION_CONFIRMED audit ($replays distinct proof messages stored)"
  else
    fail "K9 replays: loans $(loans), confirmed audits $confirmed, '$(op_state)'"
  fi
  invariant C1
fi

# C2: rule 1, the expected tag is still in the cell when the healthy scan runs.
if wanted C2 && setup C2 '{ "wait": 1000 }, { "do": "openDoor", "code": "A1" }, { "wait": 1500 },
  { "do": "closeDoor", "code": "A1" }'; then
  sleep 10
  observed=$(op_state)
  remaining=$(sql "SELECT extract(epoch FROM expires_at - now())::numeric(8,3) FROM aegis.locker_operations WHERE id = '$op'")
  python3 -c "import time; time.sleep(max(0, $remaining - 1.5))"
  before=$(op_state)
  pending=$(anomalies)
  loaned=$(loans)
  end=$(wait_terminal 15)
  [[ $observed == "OBSERVATION_RECEIVED -" && $before == "OBSERVATION_RECEIVED -" && $pending == "0 -" &&
     $loaned == 0 ]] &&
    pass "K2 rule 1: '$observed' after the scan and '$before' at expiresAt - 1.5 s, no loan, no anomaly" ||
    fail "K2 rule 1 before the deadline: '$observed', then '$before', anomalies '$pending', loans $loaned"
  delay=$(vs_deadline)
  if [[ $end == "ANOMALY INCONSISTENT_PHYSICAL_STATE" && $(python3 -c "print(0 <= $delay <= 2.5)") == True &&
        $(loans) == 0 && $(anomalies) =~ ^1\ INCONSISTENT_PHYSICAL_STATE/EXPECTED_ASSET_STILL_PRESENT ]]; then
    pass "K3 rule 1 at the deadline: '$end' $delay s after expiresAt, anomaly '$(anomalies)', no loan"
  else
    fail "K3 rule 1 at the deadline: '$end' at expiresAt + $delay s, anomaly '$(anomalies)', loans $(loans)"
  fi
  sleep 5
  created=$(sql "SELECT count(*) FROM aegis.audit_events WHERE event_type = 'ANOMALY_CREATED'
                 AND details ->> 'anomalyType' = 'INCONSISTENT_PHYSICAL_STATE'")
  [[ $(anomalies) =~ ^1\  && $created == 1 && $(op_state) == "$end" ]] &&
    pass "K4 the 1 s evaluation pass ran again after the deadline: one anomaly, one ANOMALY_CREATED audit" ||
    fail "K4 repeated passes: anomalies '$(anomalies)', ANOMALY_CREATED audits $created, '$(op_state)'"
  invariant C2
fi

# C3 and C4: rule 2, an unhealthy reader at the scan that follows the closing.
for reader in FAULTED UNKNOWN; do
  name=C3 row=K5
  [[ $reader == UNKNOWN ]] && name=C4 row=K6
  if wanted $name && setup $name '{ "wait": 1000 }, { "do": "openDoor", "code": "A1" },
    { "do": "takeTag", "code": "A1", "identifier": "'$tag'" },
    { "do": "updateCompartment", "code": "A1", "patch": { "readerStatus": "'$reader'" } }, { "wait": 1500 },
    { "do": "closeDoor", "code": "A1" }'; then
    end=$(wait_terminal 40)
    delay=$(vs_deadline)
    scan=$(sql "SELECT parsed_payload ->> 'readerStatus' FROM aegis.inbound_device_messages WHERE operation_id = '$op'
                AND message_type = 'RFID_SCAN_COMPLETED' ORDER BY sequence DESC LIMIT 1")
    if [[ $end == "ANOMALY INCONSISTENT_PHYSICAL_STATE" && $(python3 -c "print($delay < -60)") == True &&
          $(loans) == 0 && $scan == "$reader" ]]; then
      pass "$row rule 2: closing scan '$scan' -> '$end' at once ($delay s before expiresAt), anomaly '$(anomalies)'," \
        "no loan"
    else
      fail "$row rule 2 ($reader): closing scan '$scan', '$end' at expiresAt + $delay s, loans $(loans)"
    fi
    invariant $name
  fi
done

# C5: K7, a FAULTED scan while the door is still open, then a healthy scan after the closing.
if wanted C5 && setup C5 '{ "wait": 1000 }, { "do": "openDoor", "code": "A1" },
  { "do": "updateCompartment", "code": "A1", "patch": { "readerStatus": "FAULTED" } },
  { "do": "scanRfid", "code": "A1" }, { "wait": 1000 },
  { "do": "updateCompartment", "code": "A1", "patch": { "readerStatus": "HEALTHY" } },
  { "do": "takeTag", "code": "A1", "identifier": "'$tag'" }, { "wait": 1000 }, { "do": "closeDoor", "code": "A1" }'; then
  end=$(wait_terminal 40)
  early=$(sql "SELECT count(*) FROM aegis.inbound_device_messages WHERE operation_id = '$op'
               AND message_type = 'RFID_SCAN_COMPLETED' AND parsed_payload ->> 'readerStatus' = 'FAULTED'")
  if [[ $end == "CONFIRMED -" && $early -ge 1 && $(loans) == 1 ]]; then
    pass "K7 FAULTED scan while the door was open ($early stored with the operation): no rule 2, then '$end' on the" \
      "healthy closing scan"
  elif [[ $early == 0 ]]; then
    obs "K7 not exercised: the simulator did not attach the open-door scan to the operation ('$end')"
  else
    fail "K7 FAULTED scan before the closing: '$end', loans $(loans), anomaly '$(anomalies)'"
  fi
  invariant C5
fi

# C6 and C7: the door closes 115 s after the unlock and the 10 s scan completes after expiresAt.
late_close='{ "wait": 1000 }, { "do": "openDoor", "code": "A1" },
  { "do": "takeTag", "code": "A1", "identifier": "'$tag'" }, { "wait": 112000 }, { "do": "closeDoor", "code": "A1" }'
hub_env=(AEGIS_SIM_RFID_WINDOW_MS=10000)
if wanted C6 && setup C6 "$late_close"; then
  end=$(wait_terminal 150)
  delay=$(vs_deadline)
  sleep 15
  closed=$(message_at DOOR_CLOSED)
  scan=$(message_at RFID_SCAN_COMPLETED)
  if [[ $end == "ANOMALY DEVICE_OFFLINE_DURING_OPERATION" && $(python3 -c "print(0 <= $delay <= 2.5)") == True &&
        $(python3 -c "print(${closed:-1} < 0)") == True ]]; then
    pass "K8 door closed (received at expiresAt $closed s), no scan before the deadline, healthy reader: '$end'" \
      "$delay s after expiresAt"
  else
    fail "K8 no scan before the deadline: '$end' at expiresAt + $delay s, closing at expiresAt + ${closed:-?} s"
  fi
  if [[ -n $scan && $(python3 -c "print($scan > 0)") == True && $(op_state) == "$end" && $(loans) == 0 ]]; then
    pass "K11 healthy scan without the tag received $scan s after expiresAt, operation already terminal: unchanged" \
      "'$(op_state)', no loan"
  else
    obs "K11 late scan at expiresAt + ${scan:-none} s: '$(op_state)', loans $(loans)"
  fi
  invariant C6
fi
if wanted C7 && setup C7 "$late_close" AEGIS_OPERATIONS_EVALUATION_INTERVAL=PT5M; then
  end=$(wait_terminal 150)
  scan=$(message_at RFID_SCAN_COMPLETED)
  delay=$(vs_deadline)
  if [[ $end == CONFIRMED* && -n $scan && $(python3 -c "print($scan > 0)") == True ]]; then
    fail "C7 a coherent proof received $scan s after expiresAt confirmed the checkout ($delay s after expiresAt," \
      "loan created): with a slower evaluation pass, delivery extends the deadline (document 05 §5.5)"
  elif [[ -n $scan && $(python3 -c "print($scan > 0)") == True ]]; then
    pass "C7 a coherent proof received $scan s after expiresAt did not confirm: '$end'"
  else
    obs "C7 not conclusive: scan at expiresAt + ${scan:-none} s, '$end'"
  fi
  invariant C7
fi
hub_env=()

# C8: K14, the expected tag removed and a foreign tag left in the cell.
if wanted C8 && setup C8 '{ "wait": 1000 }, { "do": "openDoor", "code": "A1" },
  { "do": "takeTag", "code": "A1", "identifier": "'$tag'" },
  { "do": "putTag", "code": "A1", "identifier": "'$foreign'" }, { "wait": 1500 }, { "do": "closeDoor", "code": "A1" }'; then
  end=$(wait_terminal 40)
  if [[ $end == "ANOMALY UNEXPECTED_ASSET_OBSERVED" && $(loans) == 0 ]]; then
    pass "K14 foreign tag in the cell: '$end', no loan"
  else
    obs "K14 foreign tag in the cell with the expected tag removed: '$end', loans $(loans), anomaly '$(anomalies)'." \
      "Document 05 §5.4 maps a wrong asset observed to ANOMALY UNEXPECTED_ASSET_OBSERVED; document 06 §10.3 checks" \
      "the expected tag's absence first for a CHECKOUT. Contradiction for the contract owner."
  fi
  invariant C8
fi

# C9: the hub crashes after the closing, before its scan completes (Last Will OFFLINE).
hub_env=(AEGIS_SIM_RFID_WINDOW_MS=10000)
if wanted C9 && setup C9 "$open_take_close, { \"wait\": 2000 }, { \"do\": \"crash\" }"; then
  sleep 20
  early=$(op_state)
  reader=$(sql "SELECT c.rfid_reader_status FROM aegis.compartments c JOIN aegis.locker_operations o
                ON o.compartment_id = c.id WHERE o.id = '$op'")
  end=$(wait_terminal 140)
  delay=$(vs_deadline)
  if [[ $end == "ANOMALY DEVICE_OFFLINE_DURING_OPERATION" && $(python3 -c "print($delay >= 0)") == True ]]; then
    pass "C9 hub lost after the closing, no scan: '$early' 20 s later (cell reader '$reader'), then '$end' at" \
      "expiresAt + $delay s"
  elif [[ $end == "ANOMALY INCONSISTENT_PHYSICAL_STATE" ]]; then
    obs "C9 hub lost after the closing, no scan: '$end' $delay s from expiresAt (cell reader '$reader', finding" \
      "'$(anomalies)'). Rule 2 read from the projected reader turns a missing message into an inconsistency;" \
      "the approved rule names the evaluation scan, and the matrix (K8) says absence of a message is not a proof"
  else
    fail "C9 hub lost after the closing: '$early', then '$end' at expiresAt + $delay s"
  fi
  invariant C9
fi
hub_env=()

echo
if [[ $failures -eq 0 ]]; then echo "QA CHECKOUT CONFIRMATION: all checks passed"; else
  echo "QA CHECKOUT CONFIRMATION: $failures failed"; fi
exit "$failures"
