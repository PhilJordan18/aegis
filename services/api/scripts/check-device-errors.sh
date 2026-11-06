#!/usr/bin/env bash
# Real-broker recipe for LockerStatusView.deviceErrors (#29, document 09, section 8.6).
#
#   services/api/scripts/check-device-errors.sh     # from the repository root, about 3 minutes
#
# Real PostgreSQL, Mosquitto and Spring on a disposable Compose project (aegis-device-errors) with
# its own ports and volumes, never the developer stack. The hub is the simulator: this proves the
# server path, not a physical hub. Checks, in order:
#   E1 before any hub session: connectionStatus UNKNOWN, deviceErrors []
#   E2 after scenarios/invalid-inbound-local.json: INBOUND_MESSAGE_INVALID grouped by cell, the
#      retained command's group names A1, occurrences match the stored accepted reports
#   E3 the hub stopped and 31 s later: OFFLINE, the same groups still listed
#   E4 a new boot (heartbeats-then-crash.json): ONLINE then [], the stored reports kept
#   E5 no body ever carries detail, payload, messageId or deviceSessionId
# The exit code is the number of failed checks.
#
# Needs: docker with compose, Java 21, Node 22.18+, python3, openssl. Overrides: DEVICE_ERRORS_DB_PORT
# (57432), DEVICE_ERRORS_MQTT_PORT (53883), DEVICE_ERRORS_API_PORT (19180).
set -euo pipefail

root=$(git rev-parse --show-toplevel)
cd "$root"
project=aegis-device-errors
work=$(mktemp -d "${TMPDIR:-/tmp}/aegis-device-errors.XXXXXX")
db_port=${DEVICE_ERRORS_DB_PORT:-57432}
mqtt_port=${DEVICE_ERRORS_MQTT_PORT:-53883}
api_port=${DEVICE_ERRORS_API_PORT:-19180}

# The example credentials, on this recipe's own ports. Never a real secret.
sed -e "s/^AEGIS_DB_PORT=.*/AEGIS_DB_PORT=$db_port/" -e "s/^AEGIS_MQTT_PORT=.*/AEGIS_MQTT_PORT=$mqtt_port/" \
  infra/docker/.env.example >"$work/env"
compose=(docker compose -p "$project" --env-file "$work/env" -f infra/docker/compose.yaml)
psql=(docker exec -i "$project-postgres-1" psql -U aegis -d aegis -tA -c)

api_pid=
cleanup() {
  [[ -z "$api_pid" ]] || kill "$api_pid" 2>/dev/null || true
  "${compose[@]}" down -v >/dev/null 2>&1 || true
  echo "logs: $work"
}
trap cleanup EXIT

# Pinned images; when Docker Hub refuses (429), the same digests come from its GCR mirror.
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

set -a
# shellcheck disable=SC1091
. "$work/env"
AEGIS_JWT_SECRET=$(openssl rand -base64 48)
AEGIS_DEMO_ACCOUNTS_ENABLED=true
AEGIS_DEMO_LOCKER_ENABLED=true
AEGIS_DEMO_ADMIN_PASSWORD=device-errors-admin-$(openssl rand -hex 8)
AEGIS_DEMO_TECHNICIAN_PASSWORD=device-errors-tech-$(openssl rand -hex 8)
AEGIS_MQTT_ENABLED=true
AEGIS_MQTT_URL=tcp://127.0.0.1:$mqtt_port
AEGIS_MQTT_CLIENT_ID=aegis-api-device-errors
SERVER_PORT=$api_port
set +a
api=http://127.0.0.1:$api_port/api/v1

jar=$(ls services/api/target/aegis-control-*.jar 2>/dev/null | head -1 || true)
if [[ -z "$jar" ]]; then
  (cd services/api && ./mvnw -B -q -ntp -DskipTests package)
  jar=$(ls services/api/target/aegis-control-*.jar | head -1)
fi
echo "api: $jar, repository at $(git rev-parse --short HEAD)"
java -jar "$jar" >"$work/api.log" 2>&1 &
api_pid=$!
for _ in $(seq 1 60); do
  curl -fs "$api/system/health" >/dev/null 2>&1 && break
  sleep 2
done
curl -fs "$api/system/health" >/dev/null || { tail -20 "$work/api.log"; exit 1; }

token=$(curl -fs -H 'Content-Type: application/json' \
  -d "{\"email\":\"technician@aegis.demo\",\"password\":\"$AEGIS_DEMO_TECHNICIAN_PASSWORD\"}" "$api/auth/login" |
  python3 -c 'import json,sys; print(json.load(sys.stdin)["accessToken"])')
locker=$("${psql[@]}" "SELECT id FROM aegis.lockers WHERE code = 'AEGIS-DEMO-01'")
a1=$("${psql[@]}" "SELECT id FROM aegis.compartments WHERE locker_id = '$locker' AND code = 'A1'")

(cd tools/hub-simulator && { [[ -d node_modules ]] || npm ci --ignore-scripts >/dev/null; })
simulate() {
  AEGIS_MQTT_DEVICE_PASSWORD=$AEGIS_MQTT_DEVICE_PASSWORD AEGIS_MQTT_URL=mqtt://127.0.0.1:$mqtt_port \
  AEGIS_SIM_BOOT_COUNT_FILE="$work/boot.json" \
    bash -c "cd tools/hub-simulator && exec node src/cli.ts --scenario scenarios/$1" >>"$work/simulator.log" 2>&1 || true
}

failures=0
# check <id> <label> <python expression over v (the status), stored (accepted DEVICE_ERROR rows) and a1>
check() {
  local body stored
  body=$(curl -fs -H "Authorization: Bearer $token" "$api/lockers/$locker/status")
  stored=$("${psql[@]}" "SELECT count(*) FROM aegis.inbound_device_messages
                          WHERE message_type = 'DEVICE_ERROR' AND processing_status <> 'REJECTED'")
  if BODY=$body STORED=$stored A1=$a1 python3 -I -c '
import json, os, sys
raw = os.environ["BODY"]; v = json.loads(raw); stored = int(os.environ["STORED"]); a1 = os.environ["A1"]
errors = v["deviceErrors"]
groups = {(e["errorCode"], e["compartmentId"]): e for e in errors}
leak = any(k in raw for k in ("detail", "payload", "messageId", "deviceSessionId"))
ok = eval("(" + sys.argv[1] + "\n)")
print("   connectionStatus=%s deviceErrors=%s stored=%d" % (v["connectionStatus"],
      [(e["errorCode"], "A1" if e["compartmentId"] == a1 else e["compartmentId"], e["severity"],
        e["occurrences"]) for e in errors], stored))
sys.exit(0 if ok and not leak else 1)' "$3"; then
    echo "PASS $1 $2"
  else
    echo "FAIL $1 $2"
    failures=$((failures + 1))
  fi
}

check E1 "no hub session yet" 'v["connectionStatus"] == "UNKNOWN" and errors == []'

echo "simulator: invalid-inbound-local.json (about 80 s)"
simulate invalid-inbound-local.json
check E2 "reports grouped by cell, counts match storage" '
  stored > 0 and ("INBOUND_MESSAGE_INVALID", a1) in groups
  and sum(e["occurrences"] for e in errors) == stored
  and all(e["errorCode"] == "INBOUND_MESSAGE_INVALID" and e["severity"] == "WARNING" for e in errors)
  and all(e["firstReceivedAt"] <= e["lastReceivedAt"] for e in errors)'

sleep 31
check E3 "stale hub stays OFFLINE beside its errors" 'v["connectionStatus"] == "OFFLINE" and len(errors) > 0'
before=$("${psql[@]}" "SELECT count(*) FROM aegis.inbound_device_messages WHERE message_type = 'DEVICE_ERROR'")

echo "simulator: heartbeats-then-crash.json (new boot, about 30 s)"
simulate heartbeats-then-crash.json
check E4 "a new session lists nothing and keeps the stored reports" \
  "v['connectionStatus'] in ('ONLINE', 'OFFLINE') and errors == [] and stored == $before"

echo
if [[ "$failures" -eq 0 ]]; then echo "DEVICE ERRORS: all checks passed (E5 checked on every read)"; else echo "DEVICE ERRORS: $failures check(s) failed"; fi
exit "$failures"
