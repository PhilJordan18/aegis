#!/usr/bin/env bash
# R0-R8: a real demo-password rotation, browser-session cookie versus access token already issued (ADR-017, 09 §10.6).
# Run from the repository root of the commit under test. Secrets stay in shell variables; never printed.
# R3 expects 200 before ADR-018 (#179): issued JWTs stay valid until expiry (<= 60 min); 401 once V012 is present.
here=$(cd "$(dirname "$0")" && pwd)
. "$here/lib.sh"
expect() { [[ $2 == "$3" ]] && pass "$1 ($2)" || fail "$1: expected $3, got $2"; }
me() { curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $1" "$api/auth/me"; }

c=$(login $A "$AP" "$ORIGIN" true); ck=$(cookie_from "$work/h"); tk0=$(json 'd["accessToken"]' <"$work/b")
expect "R0 browser login before the rotation" "$c" 200
stop_api; NEWP=qa-ses-admin2-$(openssl rand -hex 8)
start_api api-r.log AEGIS_DEMO_ADMIN_PASSWORD="$NEWP" || { echo "FAIL BLOCKED restart"; exit 1; }
# The provisioner applies the rotation ~300 ms after Tomcat accepts requests (runbook line): wait for it, up to 10 s.
for _ in $(seq 1 20); do grep -q 'Updated the password of demo account' "$work/api-r.log" && break; sleep 0.5; done
grep -q 'Updated the password of demo account' "$work/api-r.log" && pass "R1 API log: demo admin password updated at startup" || fail "R1 no rotation logged"
expect "R2a old password login" "$(login $A "$AP" - -)" 401
expect "R2b new password login" "$(login $A "$NEWP" - -)" 200
# ADR-018 (#179, V012) refuses earlier tokens after a real password change; before it they live until expiry.
if [[ -f services/api/src/main/resources/db/migration/V012__add_user_credential_version.sql ]]; then
  expect "R3 access token issued before the rotation, on /auth/me (ADR-018 in effect)" "$(me "$tk0")" 401
else
  expect "R3 access token issued before the rotation, on /auth/me (valid until expiry until #179)" "$(me "$tk0")" 200
fi
c=$(refresh "$ck" "$ORIGIN"); code=$(json 'd.get("code","")' <"$work/rb")
expect "R4a refresh with the pre-rotation cookie" "$c" 401
expect "R4b problem code" "$code" AUTH_SESSION_INVALID
expect "R4c revocation reason" "$(sql "SELECT revocation_reason FROM aegis.browser_sessions ORDER BY created_at LIMIT 1")" PASSWORD_CHANGED
expect "R4d PASSWORD_CHANGED audit events" "$(sql "SELECT count(*) FROM aegis.audit_events WHERE event_type='PASSWORD_CHANGED'")" 1
expect "R6a explicit revoke of the dead cookie (idempotent)" "$(revoke "$ck" "$ORIGIN")" 204
expect "R6b refresh after it" "$(refresh "$ck" "$ORIGIN")" 401
c=$(login $A "$NEWP" "$ORIGIN" true); ck2=$(cookie_from "$work/h")
sql "UPDATE aegis.users SET status='DISABLED' WHERE email='$A'" >/dev/null
expect "R8a disabled account (the admin remedy today): refresh" "$(refresh "$ck2" "$ORIGIN")" 401
expect "R8b revocation reason" "$(sql "SELECT revocation_reason FROM aegis.browser_sessions ORDER BY created_at DESC LIMIT 1")" ACCOUNT_CHANGED
echo "failures: $failures"; exit "$failures"
