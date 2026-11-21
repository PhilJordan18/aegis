#!/usr/bin/env bash
# Independent QA probes of #178 (ADR-016 browser session), run from the repository root of the commit under test.
# Cookie values and passwords live in shell variables only; never printed.
set -uo pipefail
root=$(git rev-parse --show-toplevel); cd "$root"
project=${QA_PROJECT:-aegis-qa-session}; db_port=${QA_DB_PORT:-58573}; mqtt_port=${QA_MQTT_PORT:-55024}; api_port=${QA_API_PORT:-19421}
work=$(mktemp -d "${TMPDIR:-/tmp}/aegis-qa-session.XXXXXX")
ORIGIN=https://manager.qa.test
sed -e "s/^AEGIS_DB_PORT=.*/AEGIS_DB_PORT=$db_port/" -e "s/^AEGIS_MQTT_PORT=.*/AEGIS_MQTT_PORT=$mqtt_port/" \
  infra/docker/.env.example >"$work/env"
compose=(docker compose -p "$project" --env-file "$work/env" -f infra/docker/compose.yaml)
sql() { docker exec -i "$project-postgres-1" psql -U aegis -d aegis -tA -c "$1"; }
api_pid=
stop_api() { [[ -z "$api_pid" ]] || { kill "$api_pid" 2>/dev/null || true; wait "$api_pid" 2>/dev/null || true; }; api_pid=; }
# Response captures hold cookie and token values: only the API logs are kept.
cleanup() { stop_api; "${compose[@]}" down -v >/dev/null 2>&1 || true; find "$work" -maxdepth 1 -type f ! -name '*.log' -delete; echo "logs: $work"; }
trap cleanup EXIT
(cd services/api && ./mvnw -B -q -ntp -DskipTests package >"$work/build.log" 2>&1)
jar=$(ls services/api/target/aegis-control-*.jar | head -1)
echo "api: $jar at $(git rev-parse --short HEAD)"
set -a; . "$work/env"
AEGIS_JWT_SECRET=$(openssl rand -base64 48)
AEGIS_DEMO_ACCOUNTS_ENABLED=true
AEGIS_DEMO_ADMIN_PASSWORD=qa-ses-admin-$(openssl rand -hex 8)
AEGIS_DEMO_TECHNICIAN_PASSWORD=qa-ses-tech-$(openssl rand -hex 8)
AEGIS_WEB_ALLOWED_ORIGINS="$ORIGIN,http://localhost:5173"
SERVER_PORT=$api_port
set +a
api=http://127.0.0.1:$api_port/api/v1
failures=0
pass() { echo "PASS $*"; }; fail() { echo "FAIL $*"; failures=$((failures + 1)); }; obs() { echo "OBS  $*"; }
json() { python3 -c "import json,sys; d=json.load(sys.stdin); print($1)"; }
start_api() {
  local log=$1; shift
  env "$@" java -jar "$jar" >>"$work/$log" 2>&1 & api_pid=$!
  for _ in $(seq 1 90); do curl -fs "$api/system/health" >/dev/null 2>&1 && return 0
    kill -0 "$api_pid" 2>/dev/null || { api_pid=; return 1; }; sleep 1; done; return 1
}
"${compose[@]}" up -d --wait --pull never >/dev/null 2>&1 || { echo "FAIL BLOCKED environment: the Compose stack did not start (is Docker running?)"; exit 2; }
start_api api-1.log || { echo "FAIL BLOCKED api"; exit 1; }

# login <email> <password> <origin|-> <browserSession json|-> -> writes $work/h (headers) $work/b (body), echoes code
login() {
  local body
  body=$(python3 -c 'import json,sys; d={"email":sys.argv[1],"password":sys.argv[2]}
if sys.argv[3]!="-": d["browserSession"]=json.loads(sys.argv[3])
print(json.dumps(d))' "$1" "$2" "$4")
  local args=(-s -o "$work/b" -D "$work/h" -w '%{http_code}' -H 'Content-Type: application/json' --data-binary @-)
  [[ $3 == - ]] || args+=(-H "Origin: $3")
  # The limiter keys on client address and e-mail (5 per minute): rotate loopback sources so probes are not throttled.
  [[ -z ${QA_ROTATE_SOURCE:-} ]] || { # A counter file, because login often runs in a command substitution subshell.
    local n; n=$(( ($(cat "$work/src" 2>/dev/null || echo 0) + 1) % 250 )); echo "$n" >"$work/src"; args+=(--interface "127.0.0.$((n + 2))"); }
  curl "${args[@]}" "$api/auth/login" <<<"$body"
}
cookie_from() { grep -i '^set-cookie: __Secure-aegis_session=' "$1" | head -1 | sed -E 's/^[^=]*=([^;]*).*/\1/I' | tr -d '\r'; }
setcookie_attrs() { grep -i '^set-cookie: __Secure-aegis_session=' "$1" | head -1 | sed -E 's/^[^;]*;//' | tr -d '\r'; }
refresh() { # refresh <cookie|-> <origin|->  -> code; body $work/rb, headers $work/rh
  local args=(-s -o "$work/rb" -D "$work/rh" -w '%{http_code}' -X POST)
  [[ $1 == - ]] || args+=(-H "Cookie: __Secure-aegis_session=$1")
  [[ $2 == - ]] || args+=(-H "Origin: $2")
  curl "${args[@]}" "$api/auth/session/refresh"
}
revoke() {
  local args=(-s -o /dev/null -D "$work/vh" -w '%{http_code}' -X POST)
  [[ $1 == - ]] || args+=(-H "Cookie: __Secure-aegis_session=$1")
  [[ $2 == - ]] || args+=(-H "Origin: $2")
  curl "${args[@]}" "$api/auth/session/revoke"
}
A=admin@aegis.demo; T=technician@aegis.demo
AP=$AEGIS_DEMO_ADMIN_PASSWORD
