#!/usr/bin/env bash
# S1-S13: independent black-box probes of ADR-016 (revocable browser session), run from the repository root of the
# commit under test. Cookie values and passwords live in shell variables only; never printed.
here=$(cd "$(dirname "$0")" && pwd)
. "$here/lib.sh"
TP=$AEGIS_DEMO_TECHNICIAN_PASSWORD

# S1 iOS non-regression: no field, no Origin
c=$(login $A "$AP" - -)
[[ $c == 200 ]] && ! grep -qi '^set-cookie' "$work/h" && pass "S1 login without browserSession: 200, no Set-Cookie" || fail "S1 login without field: $c, set-cookie $(grep -ci '^set-cookie' "$work/h")"
c=$(login $A "$AP" - false); [[ $c == 200 ]] && ! grep -qi '^set-cookie' "$work/h" && pass "S1b browserSession false: 200, no cookie" || fail "S1b $c"
c=$(login $A "$AP" https://evil.example -); [[ $c == 200 ]] && ! grep -qi '^set-cookie' "$work/h" && pass "S1c foreign Origin without the field: 200, no cookie (bearer login unaffected)" || fail "S1c $c"

# S2 Origin refused before the password check
c1=$(login $A "$AP" - true); b1=$(json 'd.get("code")' <"$work/b" 2>/dev/null || echo -)
c2=$(login $A "wrong-password-xyz" https://evil.example true); b2=$(json 'd.get("code")' <"$work/b" 2>/dev/null || echo -)
c3=$(login nobody@aegis.demo "wrong-password-xyz" "$ORIGIN/" true)
c4=$(login $A "$AP" null true); c5=$(login $A "$AP" "HTTPS://manager.qa.test" true); c6=$(login $A "$AP" "http://manager.qa.test" true) # NOSONAR(shell:S5332) negative probe: a clear-text Origin must be refused
[[ "$c1 $c2 $c3 $c4 $c5 $c6" == "403 403 403 403 403 403" ]] && pass "S2 browserSession refused before credentials: no Origin $c1/$b1, foreign+wrong password $c2/$b2, trailing slash $c3, null $c4, upper-case scheme $c5, http $c6" || fail "S2 codes '$c1 $c2 $c3 $c4 $c5 $c6' ($b1 $b2)" # NOSONAR(shell:S5332) negative probe: the API must refuse these Origins, nothing is sent in clear text
n=$(sql "SELECT count(*) FROM aegis.browser_sessions"); [[ $n == 0 ]] && pass "S2b no session row after refusals" || fail "S2b rows $n"

# S3 cookie attributes, DB holds only the digest
c=$(login $A "$AP" "$ORIGIN" true); ck=$(cookie_from "$work/h"); attrs=$(setcookie_attrs "$work/h")
tok=$(json 'd["accessToken"]' <"$work/b")
hash=$(printf '%s' "$ck" | sha256sum | cut -d' ' -f1)
row=$(sql "SELECT encode(token_hash,'hex') = '$hash', role, extract(epoch from expires_at - created_at)::int FROM aegis.browser_sessions")
dump=$(docker exec "$project-postgres-1" pg_dump -U aegis -d aegis --data-only -t aegis.browser_sessions 2>/dev/null)
leak=0; grep -qF "$ck" <<<"$dump" && leak=1
echo "    attributes:$attrs"
if [[ $c == 200 && ${#ck} == 43 && $attrs == *"Path=/api/v1/auth/session"* && $attrs == *HttpOnly* && $attrs == *Secure* && $attrs == *"SameSite=Strict"* && $attrs != *Domain* && $attrs =~ Max-Age=(2879[0-9]|28800) && $row == "t|ADMIN|28800" && $leak == 0 ]]; then
  pass "S3 Set-Cookie Path=/api/v1/auth/session; HttpOnly; Secure; SameSite=Strict; no Domain; 8 h; DB keeps SHA-256 only (row '$row'), raw value absent from a dump"
else fail "S3 code $c len ${#ck} row '$row' leak $leak"; fi

# S4 cookie cannot act as a bearer, business routes ignore it
c1=$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $ck" "$api/auth/me")
c2=$(curl -s -o /dev/null -w '%{http_code}' -H "Cookie: __Secure-aegis_session=$ck" -H "Origin: $ORIGIN" "$api/auth/me")
c3=$(curl -s -o /dev/null -w '%{http_code}' -H "Cookie: __Secure-aegis_session=$ck" "$api/admin/anomalies?page=0&size=1")
c4=$(curl -s -o /dev/null -w '%{http_code}' "$api/auth/me?access_token=$tok")
c5=$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $tok" "$api/auth/me")
[[ "$c1 $c2 $c3 $c4 $c5" == "401 401 401 401 200" ]] && pass "S4 cookie as bearer 401, cookie on /me 401, cookie on admin 401, token in query 401; real bearer 200" || fail "S4 '$c1 $c2 $c3 $c4 $c5'"

# S5 refresh: origin enforced, token capped
c1=$(refresh "$ck" -); c2=$(refresh "$ck" https://evil.example); c3=$(refresh "$ck" "$ORIGIN")
exp=$(json 'd["expiresAt"]' <"$work/rb" 2>/dev/null || echo -)
rtok=$(json 'd["accessToken"]' <"$work/rb" 2>/dev/null || echo -)
c4=$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $rtok" "$api/admin/anomalies?page=0&size=1")
set_on_refresh=$(grep -ci '^set-cookie' "$work/rh" || true)
lifetime=$(python3 -c "import datetime,sys; e=datetime.datetime.fromisoformat(sys.argv[1].replace('Z','+00:00')); print(round((e-datetime.datetime.now(datetime.timezone.utc)).total_seconds()/60))" "$exp")
[[ "$c1 $c2 $c3 $c4" == "403 403 200 200" && $set_on_refresh == 0 && $lifetime -le 60 && $lifetime -ge 58 ]] && pass "S5 refresh: no Origin 403, foreign 403, allowed 200 with a token of ~$lifetime min usable on admin; cookie not rotated" || fail "S5 '$c1 $c2 $c3 $c4' setcookie $set_on_refresh lifetime $lifetime"
grep -qF "$rtok" "$work/rb" && true
[[ $(grep -c "$tok" <<<"$(cat "$work/rb")") == 0 ]] || obs "S5 refresh returned the same token as login"

# S6 concurrent refreshes from two tabs
pids=(); for i in 1 2 3 4 5 6; do (refresh "$ck" "$ORIGIN" >"$work/par$i"; echo >>"$work/par$i") & pids+=($!); done; wait "${pids[@]}"
codes=$(cat "$work"/par? | sort | uniq -c | tr -s ' ')
[[ $(cat "$work"/par? | sort -u) == 200 ]] && pass "S6 six concurrent refreshes: all 200 ($codes)" || fail "S6 concurrent refreshes '$codes'"

# S7 technician restored: no admin
c=$(login $T "$TP" "$ORIGIN" true); tck=$(cookie_from "$work/h")
c1=$(refresh "$tck" "$ORIGIN"); ttok=$(json 'd["accessToken"]' <"$work/rb")
c2=$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $ttok" "$api/admin/anomalies?page=0&size=1")
[[ "$c $c1 $c2" == "200 200 403" ]] && pass "S7 technician browser session restores a token that gets 403 on admin" || fail "S7 '$c $c1 $c2'"

# S8 sign-out
c1=$(revoke "$ck" https://evil.example); c2=$(refresh "$ck" "$ORIGIN")
c3=$(revoke "$ck" "$ORIGIN"); cl=$(grep -i '^set-cookie: __Secure-aegis_session=;' "$work/vh" | grep -ci 'Max-Age=0' || true)
c4=$(refresh "$ck" "$ORIGIN"); code4=$(json 'd.get("code")' <"$work/rb"); cl4=$(grep -i '^set-cookie: __Secure-aegis_session=;' "$work/rh" | grep -ci 'Max-Age=0' || true)
[[ $cl4 == 1 ]] || { echo "    refresh 401 header names:"; cut -d: -f1 "$work/rh" | tr -d '\r' | sort | uniq -c | sed 's/^/      /'; }
echo "    401 refresh Set-Cookie lines (cleared values only):"; grep -i '^set-cookie' "$work/rh" | sed 's/^/      /' | tr -d '\r'
grep -i '^set-cookie' "$work/vh" | sed 's/^/      revoke: /' | tr -d '\r'
c5=$(revoke "$ck" "$ORIGIN"); c6=$(revoke - "$ORIGIN"); c7=$(revoke "garbage" "$ORIGIN")
reason=$(sql "SELECT revocation_reason FROM aegis.browser_sessions WHERE role='ADMIN'")
[[ "$c1 $c2 $c3 $c4 $code4 $c5 $c6 $c7" == "403 200 204 401 AUTH_SESSION_INVALID 204 204 204" && $cl == 1 && $cl4 == 1 && $reason == SIGNED_OUT ]] && pass "S8 revoke from a foreign Origin 403 (session still live), revoke 204 clears the cookie, refresh then 401 AUTH_SESSION_INVALID with the cookie cleared; repeat/no cookie/garbage 204; reason SIGNED_OUT" || fail "S8 '$c1 $c2 $c3 $c4 $code4 $c5 $c6 $c7' cleared $cl/$cl4 reason $reason"

# S9 disabled account and role change
c=$(login $T "$TP" "$ORIGIN" true); t2=$(cookie_from "$work/h")
sql "UPDATE aegis.users SET status='DISABLED' WHERE email='$T'" >/dev/null 2>&1 || sql "UPDATE aegis.users SET status='INACTIVE' WHERE email='$T'" >/dev/null
c1=$(refresh "$t2" "$ORIGIN"); r1=$(sql "SELECT revocation_reason FROM aegis.browser_sessions WHERE token_hash = decode('$(printf '%s' "$t2" | sha256sum | cut -d' ' -f1)','hex')")
st=$(sql "SELECT status FROM aegis.users WHERE email='$T'")
sql "UPDATE aegis.users SET status='ACTIVE' WHERE email='$T'" >/dev/null
c2=$(refresh "$t2" "$ORIGIN")
[[ "$c1 $r1 $c2" == "401 ACCOUNT_CHANGED 401" ]] && pass "S9 account $st: refresh 401, session revoked ACCOUNT_CHANGED; re-enabling does not revive it" || fail "S9 '$c1 $r1 $c2' (status used: $st)"
c=$(login $T "$TP" "$ORIGIN" true); t3=$(cookie_from "$work/h")
sql "UPDATE aegis.users SET role='ADMIN' WHERE email='$T'" >/dev/null
c1=$(refresh "$t3" "$ORIGIN"); sql "UPDATE aegis.users SET role='TECHNICIAN' WHERE email='$T'" >/dev/null; c2=$(refresh "$t3" "$ORIGIN")
[[ "$c1 $c2" == "401 401" ]] && pass "S9b role change (escalation TECHNICIAN to ADMIN): refresh 401 and revoked for good" || fail "S9b '$c1 $c2'"

# S10 password rotation (the only credential change path: demo provisioning at startup)
c=$(login $A "$AP" "$ORIGIN" true); a2=$(cookie_from "$work/h")
stop_api
NEWP=qa-ses-admin2-$(openssl rand -hex 8)
start_api api-2.log AEGIS_DEMO_ADMIN_PASSWORD="$NEWP" || { fail "BLOCKED S10 restart"; }
c0=$(login $A "$AP" - -)
c1=$(refresh "$a2" "$ORIGIN")
if [[ $c0 == 401 && $c1 == 200 ]]; then
  fail "S10 after rotating the admin password (old password now $c0), the browser session started with the old password still refreshes ($c1): up to 8 h of admin tokens survive the rotation"
else pass "S10 rotation: old password $c0, old session refresh $c1"; fi
AP=$NEWP

# S11 absolute end and token cap: short lifetime
stop_api
start_api api-3.log AEGIS_DEMO_ADMIN_PASSWORD="$AP" AEGIS_WEB_SESSION_LIFETIME=PT40S || fail "BLOCKED S11 restart"
c=$(login $A "$AP" "$ORIGIN" true); s=$(cookie_from "$work/h"); ma=$(setcookie_attrs "$work/h" | grep -oE 'Max-Age=[0-9]+')
sleep 5; c1=$(refresh "$s" "$ORIGIN"); exp=$(json 'd["expiresAt"]' <"$work/rb")
end=$(sql "SELECT to_char(expires_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') FROM aegis.browser_sessions ORDER BY created_at DESC LIMIT 1")
tk=$(json 'd["accessToken"]' <"$work/rb")
sleep 37
c2=$(refresh "$s" "$ORIGIN"); c3=$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $tk" "$api/auth/me")
python3 -c "import sys,datetime as d; a=d.datetime.fromisoformat(sys.argv[1].replace('Z','+00:00')); b=d.datetime.fromisoformat(sys.argv[2].replace('Z','+00:00')); sys.exit(0 if a<=b else 1)" "$exp" "$end" && capped=yes || capped=no
[[ $c1 == 200 && $capped == yes && $c2 == 401 && $c3 == 401 ]] && pass "S11 lifetime 40 s ($ma): token expiresAt $exp <= session end $end; after the end refresh 401 and the restored token 401" || fail "S11 '$c1 capped=$capped $c2 $c3' exp $exp end $end"
stop_api
start_api api-4.log AEGIS_WEB_SESSION_LIFETIME=PT13H && fail "S11b lifetime PT13H accepted" || pass "S11b lifetime PT13H refused at startup"
api_pid=
start_api api-5.log AEGIS_WEB_ALLOWED_ORIGINS=http://manager.qa.test && fail "S11c http origin outside localhost accepted" || pass "S11c http origin other than localhost refused at startup"
api_pid=
start_api api-6.log AEGIS_WEB_ALLOWED_ORIGINS= AEGIS_DEMO_ADMIN_PASSWORD="$AP" || fail "BLOCKED S11d"
c=$(login $A "$AP" "$ORIGIN" true); c2=$(login $A "$AP" - -)
[[ "$c $c2" == "403 200" ]] && pass "S11d no origin configured: browserSession 403, bearer login 200" || fail "S11d '$c $c2'"
stop_api
sql "INSERT INTO aegis.browser_sessions (user_id, token_hash, role, created_at, expires_at) SELECT id, decode(repeat('ab',32),'hex'), 'ADMIN', now(), now() + interval '13 hours' FROM aegis.users LIMIT 1" >/dev/null 2>&1 && fail "S12 DB accepted a 13 h session" || pass "S12 DB CHECK refuses a 13 h session"

# S13 leaks: cookie values and tokens in API logs
leaks=0
for v in "$ck" "$tck" "$t2" "$t3" "$a2" "$s"; do grep -rqF "$v" "$work"/api-*.log && leaks=$((leaks + 1)); done
[[ $leaks == 0 ]] && pass "S13 no session cookie value in any API log ($(cat "$work"/api-*.log | wc -l) lines)" || fail "S13 $leaks cookie values found in API logs"
echo "EXIT $failures"
exit "$failures"
