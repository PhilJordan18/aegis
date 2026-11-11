#!/usr/bin/env bash
# Independent QA checks for the checkout preparation and the hub display challenge (#43, #46), complementary to
# services/api/scripts/check-hub-challenge.sh (T0-T7). Rows P1-P11 of docs/qualite/integration/matrice-retrait-retour.md.
#
#   docs/qualite/hub-challenge/run.sh     # from the repository root, about 12 minutes
#
# Real PostgreSQL, Mosquitto (with its ACL) and Spring on a disposable Compose project (aegis-qa-hub-challenge) with
# its own ports, never the developer stack, staging or the physical hub. The Node simulator plays the hub; forged hub
# events are published with the device account under a separate client id, never the simulator's.
#   Q1 malformed key configurations: the API refuses to start and logs no key material
#   Q2 preparation: AWAITING_LOCAL_PROOF, challenge PENDING, sealed envelope, no command, no token over REST
#   Q3 altered ciphertext: never published, never displayed, row cancelled and purged, operation expires
#   Q4 key removed while a row depends on it: startup warning names the key, row cancelled and never published
#   Q5 forged acknowledgements (wrong revision, session, challenge, operation, unknown instruction): no displayedAt,
#      every message kept as rejected evidence; then a correctly correlated acknowledgement after DISPLAY_REJECTED
#   Q6 duplicate acknowledgement (same messageId): displayedAt and its audit event unchanged
#   Q7 reservation cancelled during AWAITING_LOCAL_PROOF: challenge INVALIDATED, operation FAILED, purge, status
#   Q8 hub restart (new session) during AWAITING_LOCAL_PROOF: challenge INVALIDATED, operation FAILED, no command
#   Q9 preparation ceiling (decision of 11 November on #44): 6 accepted, 7th 429 LOCAL_PROOF_RATE_LIMITED with
#      Retry-After, idempotent replay not counted, another user not limited, release at the window boundary
# Every check also asserts: no command_outbox row and no loan. Exit code = number of FAIL lines. OBS lines are
# observations for the contract owner, not failures. The hub is simulated: this proves nothing about a real screen.
#
# Needs: docker with compose, Java 21, Node 22.18+, python3, openssl, curl. Overrides: QA_HUB_DB_PORT (58533),
# QA_HUB_MQTT_PORT (54984), QA_HUB_API_PORT (19381). The jar is always rebuilt from the checked-out commit.
set -euo pipefail

root=$(git rev-parse --show-toplevel)
cd "$root"
project=aegis-qa-hub-challenge
work=$(mktemp -d "${TMPDIR:-/tmp}/aegis-qa-hub.XXXXXX")
scenarios=$(mktemp -d tools/hub-simulator/.qa-hub.XXXXXX)
db_port=${QA_HUB_DB_PORT:-58533}
mqtt_port=${QA_HUB_MQTT_PORT:-54984}
api_port=${QA_HUB_API_PORT:-19381}
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
AEGIS_MQTT_CLIENT_ID=aegis-api-qa-hub
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

# Q1: malformed key configurations, each with the display flow enabled. The key values never reach a log.
short=$(openssl rand -base64 31)
declare -A bad=(
  [short-key]="k1:$short|k1"
  [duplicate-id]="k1:$K1,k1:$K2|k1"
  [unknown-active]="k1:$K1|k9"
  [not-base64]="k1:not*base64*at*all|k1"
  [bad-key-id]="k 1:$K1|k 1"
)
refused=0 leaked=0
for name in "${!bad[@]}"; do
  spec=${bad[$name]}
  if start_api "q1-$name.log" AEGIS_DISPLAY_ENABLED=true AEGIS_DISPLAY_KEYS="${spec%|*}" \
      AEGIS_DISPLAY_ACTIVE_KEY_ID="${spec#*|}"; then
    echo "  $name: the API started"
  else
    refused=$((refused + 1))
  fi
  stop_api
  for value in "$K1" "$K2" "$short"; do grep -qF -- "$value" "$work/q1-$name.log" && leaked=$((leaked + 1)); done
done
if [[ $refused == "${#bad[@]}" && $leaked == 0 ]]; then
  pass "Q1 ${#bad[@]} malformed key configurations refused at startup, no key material in the logs"
else
  fail "Q1 $refused/${#bad[@]} refused, $leaked key value(s) found in the logs"
fi

# Run A: k1 active, dispatcher off, so the sealed row stays in the outbox.
start_api api-a.log AEGIS_DISPLAY_ENABLED=true AEGIS_DISPLAY_KEYS="k1:$K1" AEGIS_DISPLAY_ACTIVE_KEY_ID=k1 \
  AEGIS_DISPLAY_DISPATCHER_ENABLED=false || { tail -20 "$work/api-a.log"; exit 1; }
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
message_id() {
  sql "SELECT message_id FROM aegis.hub_display_outbox WHERE operation_id = '$1'
       AND message_type = 'DISPLAY_ACCESS_CHALLENGE'"
}
seen_by_hub() { grep -h -- "$1" "$work"/simulator-*.log 2>/dev/null | grep -c 'ACCESS_CHALLENGE' || true; }

# Q2: preparation, sealed instruction, nothing actionable.
ready || exit 1
reservation=$(reserve)
code=$(prepare q2 "$reservation")
op2=$(operation_of q2)
r2=$(row "$op2")
s2=$(state "$op2")
plain=$(sql "SELECT count(*) FROM aegis.hub_display_outbox WHERE operation_id = '$op2'
             AND position(convert_to('token', 'UTF8') IN encrypted_payload) > 0")
if [[ $code == 202 && $s2 == "AWAITING_LOCAL_PROOF None None" && $r2 =~ ^PENDING\ k1\ [0-9]+\ PENDING\ false$ &&
      $(commands "$op2") == 0 && $plain == 0 ]] && ! grep -qi '"token"\|qrUri' "$work/q2.body"; then
  pass "Q2 202, $s2, outbox '$r2' (envelope bytes: 12 nonce + ciphertext + 16 tag), no command, no token in REST"
else
  fail "Q2 $code, '$s2', outbox '$r2', commands $(commands "$op2"), plaintext marker $plain"
fi

# Q3: one ciphertext byte flipped while the dispatcher is off.
sql "UPDATE aegis.hub_display_outbox SET encrypted_payload = set_byte(encrypted_payload, 20,
       get_byte(encrypted_payload, 20) # 1) WHERE operation_id = '$op2'" >/dev/null
stop_api
start_api api-b.log AEGIS_DISPLAY_ENABLED=true AEGIS_DISPLAY_KEYS="k1:$K1" AEGIS_DISPLAY_ACTIVE_KEY_ID=k1 \
  AEGIS_DISPLAY_DISPATCHER_ENABLED=true || { tail -20 "$work/api-b.log"; exit 1; }
sleep 5
r3=$(row "$op2")
end3=$(wait_terminal "$op2" 75)
if [[ $r3 =~ ^CANCELLED\ k1\ purged\ PENDING\ false$ && $(seen_by_hub "$(message_id "$op2")") == 0 &&
      $end3 == "EXPIRED LOCAL_PROOF_EXPIRED None" && $(commands "$op2") == 0 ]] &&
   grep -q 'Display instruction refused before publication' "$work/api-b.log"; then
  pass "Q3 altered ciphertext: '$r3', never published, then $end3, no command"
else
  fail "Q3 altered ciphertext: '$r3', then '$end3', seen by hub $(seen_by_hub "$(message_id "$op2")")"
fi

# hub_fact <field>: envelope facts of the simulator's current session, from its last stored message.
hub_fact() {
  sql "SELECT m.$1 FROM aegis.inbound_device_messages m JOIN aegis.locker_devices d ON d.id = m.locker_device_id
       WHERE d.locker_id = '$locker' AND m.device_session_id IS NOT NULL AND m.sequence IS NOT NULL
       ORDER BY m.received_at DESC LIMIT 1"
}
forged=0
# forge <type> <operation> <displayMessageId> <challengeId> <revision> <session> [messageId] [reason]
forge() {
  local message=${7:-$(uuid)} body boot seq
  forged=$((forged + 1))
  boot=$(hub_fact boot_count)
  seq=$(hub_fact sequence)
  [[ -n $boot && -n $seq ]] || { echo "forge: no envelope facts for the hub session" >&2; return 1; }
  body=$(TYPE=$1 OP=$2 DMID=$3 CH=$4 REV=$5 SESSION=$6 MID=$message REASON=${8:-} LOCKER=$locker \
    BOOT=$boot SEQ=$((seq + 1000 + forged)) \
    COMPARTMENT=$(sql "SELECT compartment_id FROM aegis.locker_operations WHERE id = '$2'" || true) python3 -I -c '
import datetime, json, os
e = os.environ
body = {"schemaVersion": "3.0", "messageId": e["MID"], "type": e["TYPE"], "lockerId": e["LOCKER"],
        "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        "deviceSessionId": e["SESSION"], "bootCount": int(e["BOOT"]), "sequence": int(e["SEQ"]),
        "operationId": e["OP"], "compartmentId": e["COMPARTMENT"] or e["OP"], "displayMessageId": e["DMID"],
        "challengeId": e["CH"], "displayRevision": int(e["REV"])}
if e["REASON"]: body["reason"] = e["REASON"]
print(json.dumps(body))')
  timeout 15 docker exec "$project-mosquitto-1" mosquitto_pub -u "$locker" -P "$AEGIS_MQTT_DEVICE_PASSWORD" \
    -i "qa-forger-$forged" -q 1 -t "aegis/v1/lockers/$locker/events" -m "$body"
  echo "$message"
}

# Q5: forged acknowledgements against a challenge the simulator cannot display (screen unavailable).
stop_hub
start_hub boot2 false || { echo "simulator did not come back online"; exit 1; }
ready || exit 1
code=$(prepare q5 "$reservation")
op5=$(operation_of q5)
sleep 4
read -r dmid5 ch5 rev5 session5 < <(sql "SELECT message_id || ' ' || challenge_id || ' ' || display_revision || ' ' ||
  target_device_session_id FROM aegis.hub_display_outbox WHERE operation_id = '$op5'
  AND message_type = 'DISPLAY_ACCESS_CHALLENGE'" | tr '|' ' ')
r5=$(row "$op5")
other_op=$op2
wrong=()
wrong+=("$(forge ACCESS_CHALLENGE_DISPLAYED "$op5" "$dmid5" "$ch5" $((rev5 + 1)) "$session5")")
wrong+=("$(forge ACCESS_CHALLENGE_DISPLAYED "$op5" "$dmid5" "$ch5" "$rev5" "$(uuid)")")
wrong+=("$(forge ACCESS_CHALLENGE_DISPLAYED "$op5" "$dmid5" "$(uuid)" "$rev5" "$session5")")
wrong+=("$(forge ACCESS_CHALLENGE_DISPLAYED "$other_op" "$dmid5" "$ch5" "$rev5" "$session5")")
wrong+=("$(forge ACCESS_CHALLENGE_DISPLAYED "$op5" "$(uuid)" "$ch5" "$rev5" "$session5")")
sleep 3
after5=$(row "$op5")
kept=$(sql "SELECT processing_status || ':' || coalesce(processing_error, '-') FROM aegis.inbound_device_messages
            WHERE message_id IN ($(printf "'%s'," "${wrong[@]}" | sed 's/,$//')) ORDER BY 1" | sort | uniq -c |
       tr -s ' ' | tr '\n' ';')
api_alive=$(curl -fs "$api/system/health" >/dev/null && echo up || echo down)
stored=$(sql "SELECT count(*) FROM aegis.inbound_device_messages WHERE message_id IN ($(printf "'%s'," "${wrong[@]}" | sed 's/,$//'))
              AND processing_status = 'REJECTED'")
logged=$(grep -c 'Display report not applied\|OPERATION_LOCKER_MISMATCH\|OPERATION_NOT_FOUND\|Device message rejected' "$work/api-b.log" || true)
if [[ $code == 202 && $r5 =~ ^REJECTED\ k1\ purged\ PENDING\ false$ && $after5 =~ false$ && $api_alive == up &&
      ${#wrong[@]} == 5 && $stored -ge 3 ]]; then
  pass "Q5 screen unavailable: DISPLAY_REJECTED purged the row ('$r5'); 5 forged acknowledgements left" \
    "displayedAt empty ('$after5'); $stored stored as REJECTED evidence (${kept}), $logged rejection log line(s)"
else
  fail "Q5 forged acknowledgements: prepare $code, ${#wrong[@]} sent, $stored stored rejected, before '$r5', after '$after5', kept '${kept}', api $api_alive"
fi
late=$(forge ACCESS_CHALLENGE_DISPLAYED "$op5" "$dmid5" "$ch5" "$rev5" "$session5")
sleep 3
late5=$(row "$op5")
late_kept=$(sql "SELECT processing_status FROM aegis.inbound_device_messages WHERE message_id = '$late'")
if [[ $late5 =~ true$ ]]; then
  obs "Q5b a correctly correlated ACCESS_CHALLENGE_DISPLAYED after DISPLAY_REJECTED sets displayedAt" \
    "('$late5', message $late_kept): the instruction stays REJECTED and purged; doc 10 §27.2 does not say" \
    "whether a rejected instruction may still be acknowledged"
else
  obs "Q5b a correctly correlated acknowledgement after DISPLAY_REJECTED is ignored ('$late5', $late_kept)"
fi
end5=$(wait_terminal "$op5" 75)
[[ $end5 == EXPIRED\ LOCAL_PROOF_EXPIRED* && $(commands "$op5") == 0 ]] &&
  pass "Q5c rejected challenge then $end5, no command" || fail "Q5c after rejection: '$end5'"

# Q6: duplicate acknowledgement. A new boot with a working screen displays a fresh challenge.
stop_hub
start_hub boot3 true || { echo "simulator did not come back online"; exit 1; }
ready || exit 1
code=$(prepare q6 "$reservation")
op6=$(operation_of q6)
for _ in $(seq 1 15); do [[ $(row "$op6") =~ true$ ]] && break; sleep 1; done
first=$(sql "SELECT displayed_at FROM aegis.local_access_challenges WHERE operation_id = '$op6'")
ack=$(sql "SELECT message_id || ' ' || display_message_id || ' ' || device_session_id FROM aegis.inbound_device_messages
           WHERE operation_id = '$op6' AND message_type = 'ACCESS_CHALLENGE_DISPLAYED'
           AND processing_status = 'PROCESSED'")
read -r ack_id dmid6 session6 <<<"$ack"
read -r ch6 rev6 < <(sql "SELECT challenge_id || ' ' || display_revision FROM aegis.hub_display_outbox
                          WHERE message_id = '$dmid6'")
forge ACCESS_CHALLENGE_DISPLAYED "$op6" "$dmid6" "$ch6" "$rev6" "$session6" "$ack_id" >/dev/null
forge ACCESS_CHALLENGE_DISPLAYED "$op6" "$dmid6" "$ch6" "$rev6" "$session6" >/dev/null
sleep 3
second=$(sql "SELECT displayed_at FROM aegis.local_access_challenges WHERE operation_id = '$op6'")
audits=$(sql "SELECT count(*) FROM aegis.audit_events WHERE event_type = 'LOCAL_CHALLENGE_DISPLAYED'
              AND subject_id = '$ch6'")
dups=$(sql "SELECT count(*) FROM aegis.audit_events WHERE event_type = 'MQTT_MESSAGE_DUPLICATE_IGNORED'
            AND details->>'messageType' = 'ACCESS_CHALLENGE_DISPLAYED'")
if [[ $code == 202 && -n $first && $first == "$second" && $audits == 1 && $dups -ge 1 && $(commands "$op6") == 0 ]]; then
  pass "Q6 same messageId replayed and a second acknowledgement: displayedAt unchanged, 1 display audit, duplicate audited"
else
  fail "Q6 duplicate: prepare $code, '$first' -> '$second', $audits display audit(s), $dups duplicate audit(s)"
fi

# Q7: cancellation before authorization.
curl -fs -X POST -H "Authorization: Bearer $token" -H "Idempotency-Key: $(uuid)" \
  "$api/reservations/$reservation/cancel" >"$work/q7.body"
end7=$(wait_terminal "$op6" 20)
sleep 3
r7=$(row "$op6")
status7=$(grep '"kind":"OPERATION_STATUS"' "$work/simulator-boot3.log" | grep -c 'RESERVATION_CANCELLED' || true)
if [[ $end7 == FAILED\ RESERVATION_CANCELLED* && $r7 =~ purged\ INVALIDATED ]] && [[ $(commands "$op6") == 0 ]]; then
  pass "Q7 cancelled reservation: $end7, '$r7', no command; status messages on the hub screen: $status7"
else
  fail "Q7 cancellation: '$end7', '$r7', status messages $status7"
fi

# Q8: hub restart before authorization.
reservation=$(reserve)
code=$(prepare q8 "$reservation")
op8=$(operation_of q8)
for _ in $(seq 1 15); do [[ $(row "$op8") =~ true$ ]] && break; sleep 1; done
stop_hub
start_hub boot4 true || true
end8=$(wait_terminal "$op8" 45)
r8=$(row "$op8")
if [[ $end8 =~ ^FAILED\ (HUB_RESTARTED|LOCKER_OFFLINE) && $r8 =~ purged\ INVALIDATED && $(commands "$op8") == 0 ]]; then
  pass "Q8 new hub session: $end8, '$r8', no command"
else
  fail "Q8 hub restart: prepare $code, '$end8', '$r8'"
fi

# Q4: a row sealed under k1, then k1 removed from the configuration.
stop_api
start_api api-c.log AEGIS_DISPLAY_ENABLED=true AEGIS_DISPLAY_KEYS="k1:$K1" AEGIS_DISPLAY_ACTIVE_KEY_ID=k1 \
  AEGIS_DISPLAY_DISPATCHER_ENABLED=false || { tail -20 "$work/api-c.log"; exit 1; }
ready || exit 1
code=$(prepare q4 "$reservation")
op4=$(operation_of q4)
stop_api
start_api api-d.log AEGIS_DISPLAY_ENABLED=true AEGIS_DISPLAY_KEYS="k2:$K2" AEGIS_DISPLAY_ACTIVE_KEY_ID=k2 \
  AEGIS_DISPLAY_DISPATCHER_ENABLED=true || { tail -20 "$work/api-d.log"; exit 1; }
sleep 5
r4=$(row "$op4")
# Every unpurged row sealed under k1 counts, including status messages still due: at least this challenge.
warning=$(grep -o 'Display key not configured but still referenced: keyId=k1, unpurgedRows=[0-9]*' "$work/api-d.log" |
  grep -c 'unpurgedRows=[1-9]' || true)
rows_k1=$({ grep -o 'keyId=k1, unpurgedRows=[0-9]*' "$work/api-d.log" || true; } | head -1 | sed 's/.*=//')
if [[ $code == 202 && $warning == 1 && $r4 =~ ^CANCELLED\ k1\ purged && $(seen_by_hub "$(message_id "$op4")") == 0 ]]; then
  pass "Q4 k1 removed: startup warning names k1 and $rows_k1 unpurged row(s); challenge row '$r4', never published"
else
  fail "Q4 removed key: prepare $code, warning $warning, row '$r4'"
fi

# Q9: preparation ceiling (decision of 11 November on #44): 6 new preparations per sliding window for each
# user-locker pair, idempotent replays not counted, 429 LOCAL_PROOF_RATE_LIMITED with Retry-After. The window is
# shortened to 45 s through its configuration so the boundary is reachable; the shipped default is read separately.
curl -fs -X POST -H "Authorization: Bearer $token" -H "Idempotency-Key: $(uuid)" \
  "$api/reservations/$reservation/cancel" >/dev/null
stop_api
start_api api-e.log AEGIS_DISPLAY_ENABLED=true AEGIS_DISPLAY_KEYS="k2:$K2" AEGIS_DISPLAY_ACTIVE_KEY_ID=k2 \
  AEGIS_DISPLAY_DISPATCHER_ENABLED=true AEGIS_PREPARATION_MAX_PER_WINDOW=6 AEGIS_PREPARATION_WINDOW=PT45S ||
  { tail -20 "$work/api-e.log"; exit 1; }
sleep 46
# cycle <name> [key]: reserve, prepare, cancel; prints "<prepare status> <operation>".
cycle() {
  local r c o key=${2:-$(uuid)}
  r=$(reserve)
  c=$(curl -s -o "$work/$1.body" -D "$work/$1.headers" -w '%{http_code}' -X POST \
    -H "Authorization: Bearer $token" -H "Idempotency-Key: $key" "$api/reservations/$r/checkout")
  o=$(operation_of "$1" 2>/dev/null || true)
  echo "$r" >"$work/$1.reservation"
  [[ $c == 202 ]] && {
    curl -fs -X POST -H "Authorization: Bearer $token" -H "Idempotency-Key: $(uuid)" \
      "$api/reservations/$r/cancel" >/dev/null
    wait_terminal "$o" 20 >/dev/null
  }
  echo "$c $o"
}
replay_key=$(uuid)
read -r c1 o1 <<<"$(cycle q9-1 "$replay_key")"
replays=""
for n in 1 2; do
  replays+="$(curl -s -o "$work/q9-replay-$n.body" -w '%{http_code}' -X POST -H "Authorization: Bearer $token" \
    -H "Idempotency-Key: $replay_key" "$api/reservations/$(cat "$work/q9-1.reservation")/checkout") "
  replays+="$(operation_of "q9-replay-$n") "
done
accepted=$c1
for n in 2 3 4 5 6; do read -r c _ <<<"$(cycle "q9-$n")"; accepted+=" $c"; done
read -r c7 _ <<<"$(cycle q9-7)"
body7=$(json 'd.get("code", d.get("error", ""))' <"$work/q9-7.body" 2>/dev/null || cut -c1-120 "$work/q9-7.body")
retry7=$({ grep -i '^retry-after:' "$work/q9-7.headers" || true; } | tr -d '\r' | awk '{print $2}')
pairs=$(sql "SELECT count(*) FROM aegis.locker_operations o JOIN aegis.users u ON u.id = o.user_id
             WHERE u.email = 'technician@aegis.demo' AND o.created_at > now() - interval '45 seconds'")
[[ "$accepted" == "202 202 202 202 202 202" && $replays == "202 $o1 202 $o1 " ]] &&
  pass "Q9a 6 preparations accepted (window count $pairs), the same Idempotency-Key replayed twice returned the" \
    "same operation and was not counted" ||
  fail "Q9a accepted '$accepted', replays '$replays' (first $o1), window count $pairs"
if [[ $c7 == 429 && $body7 == LOCAL_PROOF_RATE_LIMITED && $retry7 =~ ^[0-9]+$ && $retry7 -ge 1 && $retry7 -le 45 ]]; then
  pass "Q9b 7th preparation: 429 $body7, Retry-After $retry7 s"
else
  fail "Q9b 7th preparation: $c7 '$body7', Retry-After '${retry7:-absent}' (decision: 429 LOCAL_PROOF_RATE_LIMITED" \
    "with Retry-After)"
fi
# Isolation: the administrator account is another user-locker pair.
admin_token=$token
token=$admin
read -r ca _ <<<"$(cycle q9-admin 2>/dev/null || echo "refused -")"
token=$admin_token
if [[ $ca == 202 ]]; then pass "Q9c another user on the same locker is not limited: $ca"; else
  obs "Q9c isolation not demonstrated: the demo set has one technician and one locker, and the administrator" \
    "cannot reserve ($(json 'd.get("code", "")' <"$work/reserve.body" 2>/dev/null || echo "?"))"; fi
# Boundary: the oldest counted preparation leaves the window at created_at + 45 s.
release=$(sql "SELECT extract(epoch FROM min(o.created_at) + interval '45 seconds')::numeric(16,3) FROM aegis.locker_operations o
               JOIN aegis.users u ON u.id = o.user_id WHERE u.email = 'technician@aegis.demo'
               AND o.created_at > now() - interval '45 seconds'")
reservation=$(cat "$work/q9-7.reservation")
python3 -c "import time; time.sleep(max(0, $release - 2 - time.time()))"
before=$(prepare q9-before "$reservation")
python3 -c "import time; time.sleep(max(0, $release + 1 - time.time()))"
after=$(prepare q9-after "$reservation")
if [[ $before == 429 && $after == 202 ]]; then
  pass "Q9d window boundary: 429 two seconds before the oldest preparation leaves the window, 202 one second after"
else
  fail "Q9d window boundary: before $before, after $after"
fi
default=$(grep -E '^aegis.display.preparation.(max-per-window|window)=' services/api/src/main/resources/application.properties |
  tr '\n' ' ')
obs "Q9e shipped defaults: $default"

# Global invariants and secrecy of the key material.
key_leaks=0
for log in "$work"/*.log; do
  for value in "$K1" "$K2"; do grep -qF -- "$value" "$log" && key_leaks=$((key_leaks + 1)); done
done
all_commands=$(sql "SELECT count(*) FROM aegis.command_outbox")
if [[ $(loans) == 0 && $all_commands == 0 && $key_leaks == 0 ]]; then
  pass "INV no loan, no command_outbox row, no key value in any log"
else
  fail "INV loans $(loans), commands $all_commands, key leaks $key_leaks"
fi

echo
if [[ $failures -eq 0 ]]; then echo "QA HUB CHALLENGE: all checks passed"; else echo "QA HUB CHALLENGE: $failures failed"; fi
exit "$failures"
