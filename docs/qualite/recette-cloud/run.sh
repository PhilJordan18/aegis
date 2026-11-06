#!/usr/bin/env bash
# Cloud acceptance recipe: real PostgreSQL, Mosquitto and Spring, disposable data.
#
#   docs/qualite/recette-cloud/run.sh            # from the repository root
#
# Uses its own Compose project (aegis-recette) on its own ports, so it never
# touches the developer stack (aegis-dev) or its volumes. It starts from empty
# volumes of that project only, creates the demo admin and technician accounts
# with random disposable passwords, runs the catalogue checks, starts the hub
# simulator, runs the physical checks, then stops what it started.
#
# Needs: docker with compose, Java 21, Node 22.18+, python3, openssl.
# Environment overrides: RECETTE_DB_PORT (55432), RECETTE_MQTT_PORT (51883),
# RECETTE_API_PORT (18080), RECETTE_KEEP=1 to leave the stack running.
set -euo pipefail

root=$(git rev-parse --show-toplevel)
cd "$root"
project=aegis-recette
work=$(mktemp -d "${TMPDIR:-/tmp}/aegis-recette.XXXXXX")
db_port=${RECETTE_DB_PORT:-55432}
mqtt_port=${RECETTE_MQTT_PORT:-51883}
api_port=${RECETTE_API_PORT:-18080}
export RECETTE_DIR=$work

# The example credentials, on this recipe's own ports. Never a real secret.
sed -e "s/^AEGIS_DB_PORT=.*/AEGIS_DB_PORT=$db_port/" -e "s/^AEGIS_MQTT_PORT=.*/AEGIS_MQTT_PORT=$mqtt_port/" \
  infra/docker/.env.example >"$work/env"
compose=(docker compose -p "$project" --env-file "$work/env" -f infra/docker/compose.yaml)

api_pid= sim_pid=
cleanup() {
  [[ -z "$sim_pid" ]] || kill -CONT "$sim_pid" 2>/dev/null || true
  [[ -z "$sim_pid" ]] || kill "$sim_pid" 2>/dev/null || true
  [[ -z "$api_pid" ]] || kill "$api_pid" 2>/dev/null || true
  if [[ "${RECETTE_KEEP:-0}" != 1 ]]; then "${compose[@]}" down -v >/dev/null 2>&1 || true; fi
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
"${compose[@]}" up -d --wait --pull never
echo "stack: PostgreSQL 127.0.0.1:$db_port, Mosquitto 127.0.0.1:$mqtt_port (project $project)"

set -a
# shellcheck disable=SC1091
. "$work/env"
AEGIS_JWT_SECRET=$(openssl rand -base64 48)
AEGIS_DEMO_ACCOUNTS_ENABLED=true
AEGIS_DEMO_LOCKER_ENABLED=true
AEGIS_DEMO_ADMIN_PASSWORD=recette-admin-$(openssl rand -hex 8)
AEGIS_DEMO_TECHNICIAN_PASSWORD=recette-tech-$(openssl rand -hex 8)
AEGIS_MQTT_ENABLED=true
AEGIS_MQTT_URL=tcp://127.0.0.1:$mqtt_port
AEGIS_MQTT_CLIENT_ID=aegis-api-recette
SERVER_PORT=$api_port
RECETTE_API=http://127.0.0.1:$api_port/api/v1
RECETTE_PSQL="docker exec -i $project-postgres-1 psql -U aegis -d aegis -tA"
set +a

jar=$(ls services/api/target/aegis-control-*.jar 2>/dev/null | head -1 || true)
if [[ -z "$jar" ]]; then
  (cd services/api && ./mvnw -B -q -ntp -DskipTests package)
  jar=$(ls services/api/target/aegis-control-*.jar | head -1)
fi
echo "api: $jar at commit $(git rev-parse --short HEAD)"
java -jar "$jar" >"$work/api.log" 2>&1 &
api_pid=$!
for _ in $(seq 1 60); do
  curl -fs "$RECETTE_API/system/health" >/dev/null 2>&1 && break
  sleep 2
done
curl -fs "$RECETTE_API/system/health" >/dev/null || { tail -20 "$work/api.log"; exit 1; }

status=0
RECETTE_PHASE=catalog python3 -I docs/qualite/recette-cloud/checks.py || status=$?

(cd tools/hub-simulator && { [[ -d node_modules ]] || npm ci --ignore-scripts >/dev/null; })
AEGIS_MQTT_DEVICE_PASSWORD=$(grep '^AEGIS_MQTT_DEVICE_PASSWORD=' "$work/env" | cut -d= -f2) \
AEGIS_MQTT_URL=mqtt://127.0.0.1:$mqtt_port AEGIS_SIM_BOOT_COUNT_FILE="$work/boot.json" \
  bash -c 'cd tools/hub-simulator && exec node src/cli.ts --scenario scenarios/presence-demo-local.json' >"$work/simulator.log" 2>&1 &
sim_pid=$!
export RECETTE_SIM_PID=$sim_pid
echo "simulator: presence-demo-local.json (30 s online, then scans A1 and A2)"
sleep 40
physical=0
RECETTE_PHASE=physical python3 -I docs/qualite/recette-cloud/checks.py || physical=$?
status=$((status + physical))

echo
if [[ "$status" -eq 0 ]]; then echo "RECETTE: all checks passed"; else echo "RECETTE: $status check(s) failed"; fi
exit "$status"
