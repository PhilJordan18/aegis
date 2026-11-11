#!/usr/bin/env bash
# Real-broker recipe for LOC-01 and the checkout preparation (#43, #46; document 09 section 15.1,
# document 10 section 27, decision of 11 November 2026 on display keys).
#
#   services/api/scripts/check-hub-challenge.sh     # from the repository root, about 4 minutes
#
# Real PostgreSQL, Mosquitto (with its ACL) and Spring on a disposable Compose project (aegis-hub-challenge) with its
# own ports and volumes, never the developer stack. The Node simulator plays the demo hub: it reads the contract
# independently of the Java code. The display keys are drawn here, kept in the work directory and never printed.
#   T0 display flow enabled without keys: the API refuses to start
#   T1 three concurrent preparations: one 202 (Location, no-store, no token), two 409 LOCKER_OPERATION_IN_PROGRESS
#   T2 instruction sealed under key k1 while the dispatcher is off, published after rotation (k2 active, k1 kept)
#   T3 the simulator renders the QR and its ACCESS_CHALLENGE_DISPLAYED sets localProofDisplayedAt
#   T4 the token (decrypted here from the stored row) is absent from the REST body, the API and simulator logs,
#      every message the backend account can read on the broker, and a data dump of the database
#   T5 unconsumed: the operation expires (LOCAL_PROOF_EXPIRED), the ciphertext is purged, the hub gets a status
#   T6 key k1 is no longer referenced by any unpurged row: it may be retired
#   T7 a new preparation is sealed under k2 and displayed
# The exit code is the number of failed checks. The hub is simulated: this proves the server path and the broker
# contract, not a physical screen.
#
# Needs: docker with compose, Java 21, Node 22.18+, python3 with cryptography, openssl, curl. Overrides:
# HUB_CHALLENGE_DB_PORT (58433), HUB_CHALLENGE_MQTT_PORT (54884), HUB_CHALLENGE_API_PORT (19281).
set -euo pipefail

root=$(git rev-parse --show-toplevel)
cd "$root"
project=aegis-hub-challenge
work=$(mktemp -d "${TMPDIR:-/tmp}/aegis-hub-challenge.XXXXXX")
scenarios=$(mktemp -d tools/hub-simulator/.hub-challenge.XXXXXX)
db_port=${HUB_CHALLENGE_DB_PORT:-58433}
mqtt_port=${HUB_CHALLENGE_MQTT_PORT:-54884}
api_port=${HUB_CHALLENGE_API_PORT:-19281}
demo_locker=d46a74ae-39dc-460b-8af0-38fc791b376a

sed -e "s/^AEGIS_DB_PORT=.*/AEGIS_DB_PORT=$db_port/" -e "s/^AEGIS_MQTT_PORT=.*/AEGIS_MQTT_PORT=$mqtt_port/" \
  infra/docker/.env.example >"$work/env"
compose=(docker compose -p "$project" --env-file "$work/env" -f infra/docker/compose.yaml)
psql=(docker exec -i "$project-postgres-1" psql -U aegis -d aegis -tA -c)

api_pid= hub_pid= spy_pid=
stop_api() {
  [[ -z "$api_pid" ]] || { kill "$api_pid" 2>/dev/null || true; wait "$api_pid" 2>/dev/null || true; }
  api_pid=
}
cleanup() {
  rm -rf "$scenarios"
  stop_api
  [[ -z "$hub_pid" ]] || kill "$hub_pid" 2>/dev/null || true
  [[ -z "$spy_pid" ]] || kill "$spy_pid" 2>/dev/null || true
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

# Two keys drawn for this run only, in a file of the work directory removed at exit.
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
AEGIS_DEMO_ADMIN_PASSWORD=hub-challenge-admin-$(openssl rand -hex 8)
AEGIS_DEMO_TECHNICIAN_PASSWORD=hub-challenge-tech-$(openssl rand -hex 8)
AEGIS_MQTT_ENABLED=true
AEGIS_MQTT_URL=tcp://127.0.0.1:$mqtt_port
AEGIS_MQTT_CLIENT_ID=aegis-api-hub-challenge
SERVER_PORT=$api_port
AEGIS_API_URL=http://127.0.0.1:$api_port/api/v1
set +a
api=$AEGIS_API_URL

jar=$(ls services/api/target/aegis-control-*.jar 2>/dev/null | head -1 || true)
if [[ -z "$jar" ]]; then
  (cd services/api && ./mvnw -B -q -ntp -DskipTests package)
  jar=$(ls services/api/target/aegis-control-*.jar | head -1)
fi
echo "api: $jar, repository at $(git rev-parse --short HEAD)"

failures=0
pass() { echo "PASS $*"; }
fail() { echo "FAIL $*"; failures=$((failures + 1)); }

# start_api <log> <display env...>: starts the API with the given display variables and waits for its health.
start_api() {
  local log=$1
  shift
  env "$@" java -jar "$jar" >>"$work/$log" 2>&1 &
  api_pid=$!
  for _ in $(seq 1 60); do
    curl -fs "$api/system/health" >/dev/null 2>&1 && return 0
    kill -0 "$api_pid" 2>/dev/null || return 1
    sleep 1
  done
  return 1
}

# T0: fail closed.
if start_api api-t0.log AEGIS_DISPLAY_ENABLED=true AEGIS_DISPLAY_KEYS= AEGIS_DISPLAY_ACTIVE_KEY_ID=; then
  fail "T0 the API started with the display flow enabled and no key"
else
  pass "T0 display flow without keys: the API refused to start"
fi
stop_api

# Run 1: key k1, dispatcher off, so the instruction stays sealed in the outbox.
start_api api.log AEGIS_DISPLAY_ENABLED=true AEGIS_DISPLAY_KEYS="k1:$K1" AEGIS_DISPLAY_ACTIVE_KEY_ID=k1 \
  AEGIS_DISPLAY_DISPATCHER_ENABLED=false || { tail -20 "$work/api.log"; exit 1; }
python3 -I services/api/scripts/seed-demo-catalog.py >"$work/seed.log" 2>&1

login() {
  curl -fs -H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"password\":\"$2\"}" "$api/auth/login" |
    python3 -c 'import json,sys; print(json.load(sys.stdin)["accessToken"])'
}
admin=$(login admin@aegis.demo "$AEGIS_DEMO_ADMIN_PASSWORD")
token=$(login technician@aegis.demo "$AEGIS_DEMO_TECHNICIAN_PASSWORD")
windows=$(python3 -c 'import json; print(json.dumps({"timeZone": "America/Toronto", "windows": [
  {"dayOfWeek": d, "enabled": True, "opensAt": "00:00", "closesAt": "23:59"} for d in
  ["MONDAY","TUESDAY","WEDNESDAY","THURSDAY","FRIDAY","SATURDAY","SUNDAY"]]}))')
curl -fs -X PUT -H "Authorization: Bearer $admin" -H 'Content-Type: application/json' -d "$windows" \
  "$api/admin/lockers/$demo_locker/operating-schedule" >/dev/null

# The broker as seen by the backend account: everything it may read, for the secrecy check.
docker exec "$project-mosquitto-1" mosquitto_sub -u aegis_api -P "$AEGIS_MQTT_API_PASSWORD" -q 1 -v \
  -t 'aegis/v1/lockers/#' >"$work/backend-account.mqtt" 2>&1 &
spy_pid=$!

cat >"$scenarios/hub.json" <<'EOF'
{ "steps": [
  { "do": "waitOnline", "timeoutMs": 10000 },
  { "do": "putTag", "code": "A1", "identifier": "E20034120123456789000001" },
  { "do": "scanRfid", "code": "A1" },
  { "wait": 300000 },
  { "do": "stop" } ] }
EOF
(cd tools/hub-simulator && { [[ -d node_modules ]] || npm ci --ignore-scripts >/dev/null; })
AEGIS_MQTT_DEVICE_PASSWORD=$AEGIS_MQTT_DEVICE_PASSWORD AEGIS_MQTT_URL=mqtt://127.0.0.1:$mqtt_port \
AEGIS_SIM_BOOT_COUNT_FILE="$work/boot.json" AEGIS_SIM_COMMAND_JOURNAL_FILE="$work/journal.json" \
  bash -c "cd tools/hub-simulator && exec node src/cli.ts --scenario ${scenarios##*/}/hub.json" >"$work/simulator.log" 2>&1 &
hub_pid=$!
sleep 12

asset=$(curl -fs -H "Authorization: Bearer $token" "$api/assets?q=AEG-DEMO-001&page=0&size=10" |
  python3 -c 'import json,sys; print([a for a in json.load(sys.stdin)["items"] if a["assetCode"] == "AEG-DEMO-001"][0]["id"])')
until=$(python3 -c 'import datetime; print((datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(minutes=30)).strftime("%Y-%m-%dT%H:%M:%SZ"))')
reservation=$(curl -fs -H "Authorization: Bearer $token" -H 'Content-Type: application/json' \
  -H "Idempotency-Key: $(python3 -c 'import uuid; print(uuid.uuid4())')" \
  -d "{\"assetId\":\"$asset\",\"reservedUntil\":\"$until\"}" "$api/reservations" |
  python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')

# prepare <name>: POST checkout, keeping headers and body in the work directory.
prepare() {
  curl -s -o "$work/$1.body" -D "$work/$1.headers" -w '%{http_code}' -X POST \
    -H "Authorization: Bearer $token" -H "Idempotency-Key: $(python3 -c 'import uuid; print(uuid.uuid4())')" \
    "$api/reservations/$reservation/checkout"
}
callers=()
for n in 1 2 3; do (prepare "t1-$n" >"$work/t1-$n.code"; echo >>"$work/t1-$n.code") & callers+=($!); done
wait "${callers[@]}"
codes=$(cat "$work"/t1-*.code | sort | tr '\n' ' ')
winner=$(grep -l 202 "$work"/t1-*.code | head -1 | sed 's/\.code$//')
if [[ "$codes" == "202 409 409 " ]] && grep -qi '^location: /api/v1/locker-operations/' "$winner.headers" &&
   grep -qi '^cache-control: no-store' "$winner.headers" && ! grep -q '"token"' "$winner.body" &&
   [[ $(grep -l LOCKER_OPERATION_IN_PROGRESS "$work"/t1-*.body | wc -l) == 2 ]]; then
  pass "T1 concurrent preparations: $codes"
else
  fail "T1 concurrent preparations: $codes"
fi
operation=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["id"])' "$winner.body")
row_key=$("${psql[@]}" "SELECT encryption_key_id || ' ' || status FROM aegis.hub_display_outbox
                       WHERE operation_id = '$operation' AND message_type = 'DISPLAY_ACCESS_CHALLENGE'")
stop_api

# Run 2: rotation, k2 active and k1 kept; the dispatcher publishes the k1 instruction.
start_api api.log AEGIS_DISPLAY_ENABLED=true AEGIS_DISPLAY_KEYS="k2:$K2,k1:$K1" AEGIS_DISPLAY_ACTIVE_KEY_ID=k2 \
  AEGIS_DISPLAY_DISPATCHER_ENABLED=true AEGIS_DISPLAY_EXPIRY_INTERVAL=PT15S || { tail -20 "$work/api.log"; exit 1; }
displayed=
for _ in $(seq 1 20); do
  displayed=$(curl -fs -H "Authorization: Bearer $token" "$api/locker-operations/$operation" |
    python3 -c 'import json,sys; print(json.load(sys.stdin)["localProofDisplayedAt"] or "")')
  [[ -n "$displayed" ]] && break
  sleep 1
done
published=$("${psql[@]}" "SELECT status FROM aegis.hub_display_outbox
                         WHERE operation_id = '$operation' AND message_type = 'DISPLAY_ACCESS_CHALLENGE'")
if [[ "$row_key" == "k1 PENDING" && "$published" == ACKNOWLEDGED ]]; then
  pass "T2 sealed under k1 before rotation, published under k2 active: $published"
else
  fail "T2 rotation: before '$row_key', after '$published'"
fi
if [[ -n "$displayed" ]] && grep -q '"type":"ACCESS_CHALLENGE_DISPLAYED"' "$work/simulator.log"; then
  pass "T3 displayed by the simulator, localProofDisplayedAt=$displayed"
else
  fail "T3 no display acknowledgement reached the operation"
fi

# T4: the token, decrypted here from the stored row (still sealed until the challenge ends).
secret=$("${psql[@]}" "SELECT id || ' ' || locker_id || ' ' || operation_id || ' ' || display_revision || ' ' ||
                              encryption_key_id || ' ' || encode(encrypted_payload, 'base64')
                       FROM aegis.hub_display_outbox
                       WHERE operation_id = '$operation' AND message_type = 'DISPLAY_ACCESS_CHALLENGE'" | tr -d '\n' |
  K1=$K1 K2=$K2 python3 -I -c '
import base64, json, os, sys
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
row, locker, operation, revision, key_id, payload = sys.stdin.read().split(" ", 5)
key = base64.b64decode(os.environ[key_id.upper()])
envelope = base64.b64decode(payload)
aad = f"aegis-display-aad/v1\n{row}\n{locker}\n{operation}\n{revision}".encode()
print(json.loads(AESGCM(key).decrypt(envelope[:12], envelope[12:], aad))["payload"]["token"])')
docker exec "$project-postgres-1" pg_dump -U aegis -d aegis --data-only >"$work/dump.sql" 2>/dev/null
leaks=0
for file in "$winner.body" "$work/api.log" "$work/simulator.log" "$work/backend-account.mqtt" "$work/dump.sql"; do
  grep -qF -- "$secret" "$file" && { echo "  token found in ${file##*/}"; leaks=$((leaks + 1)); }
done
display_seen=$(grep -c '/display ' "$work/backend-account.mqtt" || true)
if [[ ${#secret} -eq 43 && $leaks -eq 0 && "$display_seen" == 0 ]]; then
  pass "T4 token (43 base64url characters) absent from REST, logs, backend-account broker traffic and database dump"
else
  fail "T4 secrecy: length ${#secret}, $leaks leak(s), $display_seen display message(s) read by the backend account"
fi
unset secret

# T5: no one consumes the challenge.
for _ in $(seq 1 90); do
  state=$(curl -fs -H "Authorization: Bearer $token" "$api/locker-operations/$operation" |
    python3 -c 'import json,sys; o=json.load(sys.stdin); print(o["status"], o["failureReason"])')
  [[ "$state" == "AWAITING_LOCAL_PROOF None" ]] || break
  sleep 1
done
purged=$("${psql[@]}" "SELECT count(*) FROM aegis.hub_display_outbox WHERE operation_id = '$operation'
                       AND message_type = 'DISPLAY_ACCESS_CHALLENGE' AND encrypted_payload IS NULL")
sleep 3
if [[ "$state" == "EXPIRED LOCAL_PROOF_EXPIRED" && "$purged" == 1 ]] &&
   grep '"kind":"OPERATION_STATUS"' "$work/simulator.log" | grep -q '"reasonCode":"LOCAL_PROOF_EXPIRED"'; then
  pass "T5 $state, ciphertext purged, status displayed by the hub"
else
  fail "T5 after the deadline: '$state', purged=$purged"
fi

# T6: no unpurged row depends on k1 any more (document 08 retirement query).
dependent=$("${psql[@]}" "SELECT count(*) FROM aegis.hub_display_outbox
                          WHERE encryption_key_id = 'k1' AND encrypted_payload IS NOT NULL")
if [[ "$dependent" == 0 ]]; then pass "T6 k1 referenced by no unpurged row: retirable"; else
  fail "T6 k1 still referenced by $dependent row(s)"; fi

# T7: a new preparation under the active key.
code=$(prepare t7)
next=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("id", ""))' "$work/t7.body")
sleep 4
t7=$("${psql[@]}" "SELECT d.encryption_key_id || ' ' || (c.displayed_at IS NOT NULL)
                   FROM aegis.hub_display_outbox d JOIN aegis.local_access_challenges c ON c.id = d.challenge_id
                   WHERE d.operation_id = '$next'")
if [[ "$code" == 202 && "$t7" == "k2 true" ]]; then pass "T7 new preparation sealed under k2 and displayed"; else
  fail "T7 new preparation: $code, '$t7'"; fi

echo
if [[ "$failures" -eq 0 ]]; then echo "HUB CHALLENGE: all checks passed"; else echo "HUB CHALLENGE: $failures check(s) failed"; fi
exit "$failures"
