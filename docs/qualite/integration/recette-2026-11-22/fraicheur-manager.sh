#!/usr/bin/env bash
# Manager freshness probe (#197, #202), run as the QA_CYCLES_AFTER hook of dix-cycles.sh on its live stack:
#
#   QA_CYCLES=1 QA_CYC_PROJECT=aegis-qa-fresh QA_CYC_DB_PORT=58703 QA_CYC_MQTT_PORT=55154 QA_CYC_API_PORT=19551 \
#   QA_CYC_WEB_ORIGIN=http://localhost:5291 QA_FRESH_LABEL=dev \
#   QA_CYCLES_AFTER=docs/qualite/integration/recette-2026-11-22/fraicheur-manager.sh docs/qualite/integration/dix-cycles.sh
#
# Needs apps/admin-web built (npm ci && npm run build) on the same commit, and Playwright with Chromium. It serves the
# build with `vite preview` on port 5291 against the stack's API, then fraicheur-manager.cjs: the technician reserves
# and cancels through REST, and the Manager re-enters Équipements (F1) or returns to its tab (F2) 6 s later. Headless
# Chromium keeps every page visible, so F2 dispatches a bubbling visibilitychange on a visible page, as a real tab
# return does; a real OS tab switch is a human recipe row. Exit code = number of FAIL lines of the probe.
here=$(cd "$(dirname "$0")" && pwd)
out=${QA_FRESH_OUT:-$(mktemp -d "${TMPDIR:-/tmp}/aegis-qa-fresh.XXXXXX")}
cd apps/admin-web || exit 1
sleep 61  # the login ceiling of the cycles' own sign-ins
AEGIS_API_ORIGIN=http://127.0.0.1:$SERVER_PORT ./node_modules/.bin/vite preview --host localhost --port 5291 \
  --strictPort >"$out/preview.log" 2>&1 & preview=$!
for _ in $(seq 1 30); do curl -fs http://localhost:5291/ >/dev/null && break; sleep 1; done
API=http://127.0.0.1:$SERVER_PORT/api/v1 TECH="$AEGIS_DEMO_TECHNICIAN_PASSWORD" ADMIN="$AEGIS_DEMO_ADMIN_PASSWORD" \
  OUT=$out LABEL=${QA_FRESH_LABEL:-run} timeout 600 node "$here/fraicheur-manager.cjs"; status=$?
kill "$preview" 2>/dev/null
echo "probe output: $out"
exit $status
