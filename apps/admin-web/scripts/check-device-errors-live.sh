#!/usr/bin/env bash
# Broker -> API -> Manager recipe for the locker device errors (#29, document 09, section 8.6).
#
#   apps/admin-web/scripts/check-device-errors-live.sh     # from the repository root, about 4 minutes
#
# Real PostgreSQL, Mosquitto and Spring on a disposable Compose project (aegis-web-device-errors) with
# its own ports and volumes, never the developer stack. The hub simulator plays
# scenarios/invalid-inbound-local.json, whose refused commands make it report INBOUND_MESSAGE_INVALID.
# Then the built Manager, served by vite preview, opens Casiers?casier= and its page must match a direct
# GET of the same status, error by error:
#   W1 right after the scenario: the reported groups are listed (AEGIS_LIVE_EXPECT_DEVICE_ERRORS=listed)
#   W2 31 s after the hub stopped: OFFLINE, the same groups still listed, with the not-online note (stale)
# The server path alone is services/api/scripts/check-device-errors.sh. The hub is simulated: this proves
# the Web path, not a physical hub.
#
# Needs: docker with compose, Java 21, Node 22.18+, openssl, the Manager's dependencies (npm ci in
# apps/admin-web), and an API jar that serves deviceErrors (#142): AEGIS_API_JAR, else services/api/target/aegis-control-*.jar, else a fresh build.
# Overrides: WEB_DEVICE_ERRORS_DB_PORT (57532), WEB_DEVICE_ERRORS_MQTT_PORT (53983),
# WEB_DEVICE_ERRORS_API_PORT (19280). The exit code is the number of failed steps.
set -euo pipefail

root=$(git rev-parse --show-toplevel)
cd "$root"
project=aegis-web-device-errors
work=$(mktemp -d "${TMPDIR:-/tmp}/aegis-web-device-errors.XXXXXX")
db_port=${WEB_DEVICE_ERRORS_DB_PORT:-57532}
mqtt_port=${WEB_DEVICE_ERRORS_MQTT_PORT:-53983}
api_port=${WEB_DEVICE_ERRORS_API_PORT:-19280}

# The Manager's own installed Playwright, never one npx would fetch and run on demand.
playwright=$root/apps/admin-web/node_modules/.bin/playwright
[[ -x "$playwright" ]] || { echo "missing $playwright: run 'npm ci' in apps/admin-web first" >&2; exit 1; }

# The example credentials, on this recipe's own ports. Never a real secret.
sed -e "s/^AEGIS_DB_PORT=.*/AEGIS_DB_PORT=$db_port/" -e "s/^AEGIS_MQTT_PORT=.*/AEGIS_MQTT_PORT=$mqtt_port/" \
  infra/docker/.env.example >"$work/env"
compose=(docker compose -p "$project" --env-file "$work/env" -f infra/docker/compose.yaml)

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
AEGIS_DEMO_ADMIN_PASSWORD=web-device-errors-admin-$(openssl rand -hex 8)
AEGIS_DEMO_TECHNICIAN_PASSWORD=web-device-errors-tech-$(openssl rand -hex 8)
AEGIS_MQTT_ENABLED=true
AEGIS_MQTT_URL=tcp://127.0.0.1:$mqtt_port
AEGIS_MQTT_CLIENT_ID=aegis-api-web-device-errors
SERVER_PORT=$api_port
AEGIS_API_ORIGIN=http://127.0.0.1:$api_port
set +a

jar=${AEGIS_API_JAR:-$(ls services/api/target/aegis-control-*.jar 2>/dev/null | head -1 || true)}
if [[ -z "$jar" ]]; then
  (cd services/api && ./mvnw -B -q -ntp -DskipTests package)
  jar=$(ls services/api/target/aegis-control-*.jar | head -1)
fi
echo "api: $jar; Manager at $(git rev-parse --short HEAD)"
java -jar "$jar" >"$work/api.log" 2>&1 &
api_pid=$!
for _ in $(seq 1 60); do
  curl -fs "$AEGIS_API_ORIGIN/api/v1/system/health" >/dev/null 2>&1 && break
  sleep 2
done
curl -fs "$AEGIS_API_ORIGIN/api/v1/system/health" >/dev/null || { tail -20 "$work/api.log"; exit 1; }

(cd tools/hub-simulator && { [[ -d node_modules ]] || npm ci --ignore-scripts >/dev/null; })
echo "simulator: invalid-inbound-local.json (about 80 s)"
AEGIS_MQTT_URL=mqtt://127.0.0.1:$mqtt_port AEGIS_SIM_BOOT_COUNT_FILE="$work/boot.json" \
  bash -c 'cd tools/hub-simulator && exec node src/cli.ts --scenario scenarios/invalid-inbound-local.json' \
  >"$work/simulator.log" 2>&1 || true

failures=0
manager() {
  if (cd apps/admin-web && AEGIS_LIVE_EXPECT_DEVICE_ERRORS=$2 \
    "$playwright" test -c playwright.api.config.ts --trace off -g 'Casiers \(\?casier=\)' >"$work/$1.log" 2>&1); then
    echo "PASS $1 $3"
  else
    echo "FAIL $1 $3 (see $work/$1.log)"
    failures=$((failures + 1))
  fi
}

manager W1 listed "the Manager lists the reported groups as the API sends them"
sleep 31
manager W2 stale "a stale hub stays OFFLINE beside its errors, with the not-online note"

echo
if [[ "$failures" -eq 0 ]]; then echo "WEB DEVICE ERRORS: all steps passed"; else echo "WEB DEVICE ERRORS: $failures step(s) failed"; fi
exit "$failures"
