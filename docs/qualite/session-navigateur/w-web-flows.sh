#!/usr/bin/env bash
# #178 combined head: Web's own real-API acceptance plus independent QA browser checks, against one disposable
# stack (real PostgreSQL, Mosquitto, API built from the commit under test). Run from the repository root.
here=$(cd "$(dirname "$0")" && pwd)
export QA_PROJECT=aegis-qa-web QA_DB_PORT=58593 QA_MQTT_PORT=55044 QA_API_PORT=19441
. "$here/lib.sh"
export AEGIS_WEB_ALLOWED_ORIGINS="http://localhost:5181,http://localhost:5182"
stop_api; start_api api-web.log AEGIS_DEMO_LOCKER_ENABLED=true AEGIS_WEB_ALLOWED_ORIGINS="$AEGIS_WEB_ALLOWED_ORIGINS" || { echo "FAIL BLOCKED api"; exit 1; }
web=$root/apps/admin-web
TP=$AEGIS_DEMO_TECHNICIAN_PASSWORD
# The limiter counts every sign-in (5 per minute per client and e-mail): wait out the window between batches.
window() { sleep 61; }

echo "== Web real-API acceptance (playwright.api.config.ts), API at $api"
(cd "$web" && AEGIS_API_ORIGIN=http://127.0.0.1:$api_port AEGIS_DEMO_ADMIN_PASSWORD="$AP" AEGIS_DEMO_TECHNICIAN_PASSWORD="$TP" \
  timeout 900 ./node_modules/.bin/playwright test -c playwright.api.config.ts --trace off >"$work/web-api.log" 2>&1); rc=$?
grep -E "passed|failed|flaky|skipped" "$work/web-api.log" | tail -4; echo "web real-API exit $rc"; [[ $rc == 0 ]] || failures=$((failures + 1))

echo "== QA independent browser checks (real API; fault-injected cases labelled)"
(cd "$web" && AEGIS_API_ORIGIN=http://127.0.0.1:$api_port ./node_modules/.bin/vite preview --host localhost --port 5182 --strictPort >"$work/preview.log" 2>&1) & preview=$!
for _ in $(seq 1 30); do curl -fs http://localhost:5182/ >/dev/null && break; sleep 1; done
export QA_BASE=http://localhost:5182 QA_WEB_DIR=$web QA_ADMIN_PW="$AP" QA_STATE=$work/state.json
export QA_SQL="docker exec -i $project-postgres-1 psql -U aegis -d aegis -tA -c"
window; node "$here/qa-browser.mjs" phase1 || failures=$((failures + $?))
window; node "$here/qa-browser.mjs" phase2a || failures=$((failures + 1))
stop_api; NEWP=qa-web-admin2-$(openssl rand -hex 8)
start_api api-web2.log AEGIS_DEMO_LOCKER_ENABLED=true AEGIS_WEB_ALLOWED_ORIGINS="$AEGIS_WEB_ALLOWED_ORIGINS" AEGIS_DEMO_ADMIN_PASSWORD="$NEWP" || { echo "FAIL BLOCKED restart"; exit 1; }
for _ in $(seq 1 20); do grep -q 'Updated the password of demo account admin' "$work/api-web2.log" && break; sleep 0.5; done
QA_ADMIN_PW2="$NEWP" node "$here/qa-browser.mjs" phase2b || failures=$((failures + $?))
QA_ADMIN_PW2="$NEWP" node "$here/qa-browser.mjs" fallback || failures=$((failures + $?))
kill $preview 2>/dev/null; pkill -f "vite preview --host localhost --port 5182" 2>/dev/null
rm -f "$work/state.json"
echo "failures: $failures"; exit "$failures"
