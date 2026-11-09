#!/usr/bin/env bash
# Real-broker recipe for the R2 twin start and presence (#31, document 10 section 15.3, document 06 section 4.2).
#
#   services/api/scripts/check-presence-twin.sh     # from the repository root, about 2 minutes
#
# Real PostgreSQL, Mosquitto and Spring on a disposable Compose project (aegis-presence-twin) with its own
# ports and volumes, never the developer stack. Two simulators share the demo locker's account: the hub,
# then a twin started with the same bootCount and another deviceSessionId. The hubs are simulated: this
# proves the server path, not a physical reader. Checks on AEG-DEMO-001 (cell A1):
#   T1 after the hub's scan: PRESENT
#   T2 after the twin's start: UNKNOWN
#   T3 after a new scan of the hub, same boot: still UNKNOWN (nothing orders the twin's facts)
#   T4 the twin's facts are stored, under the shared bootCount
# The exit code is the number of failed checks.
#
# Needs: docker with compose, Java 21, Node 22.18+, python3, openssl. Overrides: PRESENCE_TWIN_DB_PORT
# (58432), PRESENCE_TWIN_MQTT_PORT (54883), PRESENCE_TWIN_API_PORT (19280).
set -euo pipefail

root=$(git rev-parse --show-toplevel)
cd "$root"
project=aegis-presence-twin
work=$(mktemp -d "${TMPDIR:-/tmp}/aegis-presence-twin.XXXXXX")
# The simulator only reads scenarios inside its own directory.
scenarios=$(mktemp -d tools/hub-simulator/.presence-twin.XXXXXX)
db_port=${PRESENCE_TWIN_DB_PORT:-58432}
mqtt_port=${PRESENCE_TWIN_MQTT_PORT:-54883}
api_port=${PRESENCE_TWIN_API_PORT:-19280}

# The example credentials, on this recipe's own ports. Never a real secret.
sed -e "s/^AEGIS_DB_PORT=.*/AEGIS_DB_PORT=$db_port/" -e "s/^AEGIS_MQTT_PORT=.*/AEGIS_MQTT_PORT=$mqtt_port/" \
  infra/docker/.env.example >"$work/env"
compose=(docker compose -p "$project" --env-file "$work/env" -f infra/docker/compose.yaml)
psql=(docker exec -i "$project-postgres-1" psql -U aegis -d aegis -tA -c)

api_pid= hub_pid=
cleanup() {
  rm -rf "$scenarios"
  [[ -z "$hub_pid" ]] || kill "$hub_pid" 2>/dev/null || true
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
AEGIS_DEMO_ADMIN_PASSWORD=presence-twin-admin-$(openssl rand -hex 8)
AEGIS_DEMO_TECHNICIAN_PASSWORD=presence-twin-tech-$(openssl rand -hex 8)
AEGIS_MQTT_ENABLED=true
AEGIS_MQTT_URL=tcp://127.0.0.1:$mqtt_port
AEGIS_MQTT_CLIENT_ID=aegis-api-presence-twin
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
java -jar "$jar" >"$work/api.log" 2>&1 &
api_pid=$!
for _ in $(seq 1 60); do
  curl -fs "$api/system/health" >/dev/null 2>&1 && break
  sleep 2
done
curl -fs "$api/system/health" >/dev/null || { tail -20 "$work/api.log"; exit 1; }
python3 -I services/api/scripts/seed-demo-catalog.py >"$work/seed.log" 2>&1

token=$(curl -fs -H 'Content-Type: application/json' \
  -d "{\"email\":\"technician@aegis.demo\",\"password\":\"$AEGIS_DEMO_TECHNICIAN_PASSWORD\"}" "$api/auth/login" |
  python3 -c 'import json,sys; print(json.load(sys.stdin)["accessToken"])')

cat >"$scenarios/hub.json" <<'EOF'
{ "steps": [
  { "do": "waitOnline", "timeoutMs": 10000 },
  { "do": "putTag", "code": "A1", "identifier": "E20034120123456789000001" },
  { "do": "scanRfid", "code": "A1" },
  { "wait": 25000 },
  { "do": "scanRfid", "code": "A1" },
  { "wait": 20000 },
  { "do": "stop" } ] }
EOF
cat >"$scenarios/twin.json" <<'EOF'
{ "steps": [
  { "do": "waitOnline", "timeoutMs": 10000 },
  { "wait": 1000 },
  { "do": "stop" } ] }
EOF
(cd tools/hub-simulator && { [[ -d node_modules ]] || npm ci --ignore-scripts >/dev/null; })
# simulate <deviceKey> <scenario>: both keys start at the same bootCount, each with a new deviceSessionId.
simulate() {
  AEGIS_MQTT_DEVICE_PASSWORD=$AEGIS_MQTT_DEVICE_PASSWORD AEGIS_MQTT_URL=mqtt://127.0.0.1:$mqtt_port \
  AEGIS_SIM_DEVICE_KEY=$1 AEGIS_SIM_BOOT_COUNT=41 AEGIS_SIM_BOOT_COUNT_FILE="$work/boot-$1.json" \
  AEGIS_SIM_COMMAND_JOURNAL_FILE="$work/journal-$1.json" \
    bash -c "cd tools/hub-simulator && exec node src/cli.ts --scenario ${scenarios##*/}/$2" >>"$work/simulator-$1.log" 2>&1
}

failures=0
# check <id> <label> <expected presence of AEG-DEMO-001>
check() {
  local presence
  presence=$(curl -fs -H "Authorization: Bearer $token" "$api/assets?q=AEG-DEMO-001&page=0&size=10" |
    python3 -c 'import json,sys; print([a for a in json.load(sys.stdin)["items"] if a["assetCode"] == "AEG-DEMO-001"][0]["presence"])')
  if [[ "$presence" == "$3" ]]; then echo "PASS $1 $2: $presence"; else
    echo "FAIL $1 $2: $presence, expected $3"; failures=$((failures + 1)); fi
}

simulate hub hub.json &
hub_pid=$!
sleep 12
check T1 "after the hub's scan" PRESENT
simulate twin twin.json || true
sleep 2
check T2 "after a twin start under the same bootCount" UNKNOWN
sleep 22
check T3 "after a new scan of the hub, same boot" UNKNOWN
wait "$hub_pid" || true
hub_pid=
sessions=$("${psql[@]}" "SELECT count(DISTINCT device_session_id) FROM aegis.inbound_device_messages
                         WHERE boot_count = 41 AND processing_status <> 'REJECTED'")
if [[ "$sessions" == 2 ]]; then echo "PASS T4 both starts stored under bootCount 41"; else
  echo "FAIL T4 $sessions session(s) stored under bootCount 41, expected 2"; failures=$((failures + 1)); fi

echo
if [[ "$failures" -eq 0 ]]; then echo "PRESENCE TWIN: all checks passed"; else echo "PRESENCE TWIN: $failures check(s) failed"; fi
exit "$failures"
