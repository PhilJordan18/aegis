#!/usr/bin/env bash
# Manager administrative reads acceptance (#48, #52, #53): real PostgreSQL, Mosquitto and Spring, disposable data.
#
#   docs/qualite/manager-admin/run.sh                    # API of this checkout
#   QA_API_DIR=/path/to/backend/services/api docs/qualite/manager-admin/run.sh
#
# Own Compose project (aegis-admin-qa) and ports, so it never touches aegis-dev or aegis-recette. Steps:
#   1. empty database: lists are empty;
#   2. real flows: catalogue, tags, placements, schedule, simulator scans, one cancelled and one active reservation;
#   3. seed-synthetic.sql: loans, operations, anomalies, evidence and audit that no producer can create yet;
#   4. the matrix of README.md.
# QA_KEEP=1 leaves the stack and the API running for the Web checks; QA_PHASES limits the phases
# (default "empty setup matrix"). Passwords are random, written only to a file readable by the current user.
#
# Needs: docker with compose, Java 21, Node 22.18+, python3, openssl.
set -euo pipefail

root=$(git rev-parse --show-toplevel)
cd "$root"
here=docs/qualite/manager-admin
api_dir=$(cd "${QA_API_DIR:-services/api}" && pwd)
project=aegis-admin-qa
work=$(mktemp -d "${TMPDIR:-/tmp}/aegis-admin-qa.XXXXXX")
db_port=${QA_DB_PORT:-56432}
mqtt_port=${QA_MQTT_PORT:-51884}
api_port=${QA_API_PORT:-18081}
export QA_DIR=$work

sed -e "s/^AEGIS_DB_PORT=.*/AEGIS_DB_PORT=$db_port/" -e "s/^AEGIS_MQTT_PORT=.*/AEGIS_MQTT_PORT=$mqtt_port/" \
  infra/docker/.env.example >"$work/env"
compose=(docker compose -p "$project" --env-file "$work/env" -f infra/docker/compose.yaml)

api_pid= sim_pid=
cleanup() {
  if [[ "${QA_KEEP:-0}" == 1 ]]; then
    echo "kept: API pid $api_pid on :$api_port, simulator pid $sim_pid, compose project $project"
    echo "stop: kill $api_pid $sim_pid; ${compose[*]} down -v"
  else
    [[ -z "$sim_pid" ]] || kill "$sim_pid" 2>/dev/null || true
    [[ -z "$api_pid" ]] || kill "$api_pid" 2>/dev/null || true
    "${compose[@]}" down -v >/dev/null 2>&1 || true
  fi
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
"${compose[@]}" up -d --wait --pull never

set -a
# shellcheck disable=SC1091
. "$work/env"
AEGIS_JWT_SECRET=$(openssl rand -base64 48)
AEGIS_DEMO_ACCOUNTS_ENABLED=true
AEGIS_DEMO_LOCKER_ENABLED=true
AEGIS_DEMO_ADMIN_PASSWORD=qa-admin-$(openssl rand -hex 8)
AEGIS_DEMO_TECHNICIAN_PASSWORD=qa-tech-$(openssl rand -hex 8)
AEGIS_MQTT_ENABLED=true
AEGIS_MQTT_URL=tcp://127.0.0.1:$mqtt_port
AEGIS_MQTT_CLIENT_ID=aegis-api-admin-qa
SERVER_PORT=$api_port
QA_API=http://127.0.0.1:$api_port/api/v1
QA_PSQL="docker exec -i $project-postgres-1 psql -U aegis -d aegis -tA -v ON_ERROR_STOP=1"
set +a
(umask 077; printf 'admin@aegis.demo %s\ntechnician@aegis.demo %s\n' \
  "$AEGIS_DEMO_ADMIN_PASSWORD" "$AEGIS_DEMO_TECHNICIAN_PASSWORD" >"$work/credentials")

(cd "$api_dir" && ./mvnw -B -q -ntp -DskipTests clean package)
jar=$(ls "$api_dir"/target/aegis-control-*.jar | head -1)
echo "api: $(git -C "$api_dir" rev-parse HEAD)$(git -C "$api_dir" diff --quiet HEAD -- . || echo ' plus local changes') ($api_dir)"
echo "qa:  $(git rev-parse HEAD) ($here)"
java -jar "$jar" >"$work/api.log" 2>&1 &
api_pid=$!
for _ in $(seq 1 60); do curl -fs "$QA_API/system/health" >/dev/null 2>&1 && break; sleep 2; done
curl -fs "$QA_API/system/health" >/dev/null || { tail -20 "$work/api.log"; exit 1; }

status=0
phases=${QA_PHASES:-empty setup matrix}
run_phase() { local s=0; QA_PHASE=$1 python3 -I "$here/checks.py" || s=$?; status=$((status + s)); }

[[ " $phases " == *" empty "* ]] && run_phase empty

if [[ " $phases " == *" setup "* ]]; then
  (cd tools/hub-simulator && { [[ -d node_modules ]] || npm ci --ignore-scripts >/dev/null; })
  AEGIS_MQTT_DEVICE_PASSWORD=$(grep '^AEGIS_MQTT_DEVICE_PASSWORD=' "$work/env" | cut -d= -f2) \
  AEGIS_MQTT_URL=mqtt://127.0.0.1:$mqtt_port AEGIS_SIM_BOOT_COUNT_FILE="$work/boot.json" \
    bash -c 'cd tools/hub-simulator && exec node src/cli.ts --scenario scenarios/presence-demo-local.json' >"$work/simulator.log" 2>&1 &
  sim_pid=$!
  run_phase setup
fi

if [[ " $phases " == *" matrix "* ]]; then
  $QA_PSQL -q <"$here/seed-synthetic.sql" >"$work/seed.log" 2>&1 || { cat "$work/seed.log"; exit 1; }
  echo "seed: $($QA_PSQL -c "SELECT count(*) FROM aegis.reservations WHERE id::text LIKE '5eed0000-%'") synthetic reservations,"\
       "$($QA_PSQL -c "SELECT count(*) FROM aegis.audit_events WHERE details->>'synthetic' = 'true'") synthetic audit events"
  run_phase matrix
fi

echo
if [[ "$status" -eq 0 ]]; then echo "MANAGER QA: all checks passed"; else echo "MANAGER QA: $status failed or absent"; fi
echo "credentials for manual checks: $work/credentials (mode 600, never commit or paste)"
exit "$status"
