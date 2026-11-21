#!/usr/bin/env bash
# Independent QA probes of #178 round 2 (ADR-017 password change, retention, races), black box against a disposable
# stack built from the commit under test. Secrets stay in shell variables; never printed.
# Env: QA_V2_CASES (default all), QA_PURGE_TRIGGER (shell command run to make the purge happen, default: restart).
here=$(cd "$(dirname "$0")" && pwd)
export QA_ROTATE_SOURCE=1 QA_PROJECT=aegis-qa-session2 QA_DB_PORT=58583 QA_MQTT_PORT=55034 QA_API_PORT=19431
# Short absolute lifetime so V1 can reach the session end without a controllable clock.
export AEGIS_WEB_SESSION_LIFETIME=${QA_LIFETIME:-PT75S}
# Run the hourly purge job every 3 s (BrowserSessionPurgeJob), so V7 and V8 see it without waiting an hour.
purge_env='SPRING_APPLICATION_JSON={"aegis.security.browser-session.purge.interval":"PT3S"}'
. "$here/lib.sh"
cases=${QA_V2_CASES:-"V1 V2 V3 V4 V5 V6 V7 V9 V8"}
want() { [[ " $cases " == *" $1 "* ]]; }
epoch() { python3 -c 'import sys,datetime; print(datetime.datetime.fromisoformat(sys.argv[1].replace("Z","+00:00")).timestamp())' "$1"; }
open_session() { local c; c=$(login "$1" "$2" "$ORIGIN" true); [[ $c == 200 ]] || { echo "FAIL BLOCKED login $1 -> $c" >&2; return 1; }; cookie_from "$work/h"; }
me() { curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $1" "$api/auth/me"; }
uid() { sql "SELECT id FROM aegis.users WHERE email='$1'"; }
TP=$AEGIS_DEMO_TECHNICIAN_PASSWORD

if want V1; then # absolute end, token capped by the end, refresh after the end
  ck=$(open_session $A "$AP"); lexp=$(json 'd["expiresAt"]' <"$work/b")
  end=$(sql "SELECT extract(epoch FROM expires_at) FROM aegis.browser_sessions ORDER BY created_at DESC LIMIT 1")
  c=$(refresh "$ck" "$ORIGIN"); rexp=$(json 'd["expiresAt"]' <"$work/rb")
  python3 - "$(epoch "$rexp")" "$end" <<'P' && pass "V1a refreshed token expiry $rexp capped by the session end" || fail "V1a refresh $c token exp $rexp vs end $end"
import sys; t,e=map(float,sys.argv[1:]); sys.exit(0 if t<=e+1 else 1)
P
  python3 -c 'import sys; sys.exit(0 if float(sys.argv[1])<=float(sys.argv[2])+1 else 1)' "$(epoch "$lexp")" "$end" \
    && pass "V1b login token expiry $lexp within the session end" || obs "V1b login token expiry $lexp exceeds the session end (login is not capped)"
  now=$(date +%s); sleep $(python3 -c "print(max(0,int($end-$now)+1))")
  c=$(refresh "$ck" "$ORIGIN"); code=$(json 'd.get("code")' <"$work/rb" 2>/dev/null)
  clr=$(grep -ci '^set-cookie: __Secure-aegis_session=;.*max-age=0' "$work/rh")
  [[ $c == 401 && $code == AUTH_SESSION_INVALID && $clr == 1 ]] && pass "V1c refresh 1 s after the end: 401 $code, cookie cleared" || fail "V1c $c $code clear=$clr"
  obs "V1 exact-instant refresh at the end is Backend's MutableClock test; black box only checks end+1 s"
fi

if want V2; then # concurrent tabs refresh with the same cookie
  ck=$(open_session $A "$AP"); pids=()
  for i in $(seq 1 10); do curl -s -o "$work/p$i" -D "$work/ph$i" -w '%{http_code}\n' -X POST -H "Origin: $ORIGIN" \
    -H "Cookie: __Secure-aegis_session=$ck" "$api/auth/session/refresh" >"$work/pc$i" & pids+=($!); done
  wait "${pids[@]}"; codes=$(cat "$work"/pc* | sort | uniq -c | tr -s ' \n' ' ')
  setc=$(cat "$work"/ph* | grep -ci '^set-cookie: __Secure-aegis_session=')
  [[ $codes == " 10 200 " && $setc == 0 ]] && pass "V2 10 concurrent refreshes: all 200, no cookie rotated" || fail "V2 codes$codes set-cookie $setc"
  rm -f "$work"/p*
fi

if want V3; then # revoke vs refresh race
  bad=0; won=0
  for i in $(seq 1 15); do
    ck=$(open_session $A "$AP") || { bad=$((bad + 1)); continue; }
    refresh "$ck" "$ORIGIN" >"$work/r3" & p1=$!; revoke "$ck" "$ORIGIN" >"$work/v3" & p2=$!; wait $p1 $p2
    [[ $(cat "$work/r3") == 200 ]] && won=$((won + 1))
    [[ $(cat "$work/v3") == 204 && $(refresh "$ck" "$ORIGIN") == 401 ]] || bad=$((bad + 1))
  done
  open=$(sql "SELECT count(*) FROM aegis.browser_sessions WHERE revoked_at IS NULL AND expires_at > now()")
  [[ $bad == 0 ]] && pass "V3 15 revoke/refresh races: revoke 204 and refresh 401 afterwards every time ($won refreshes won the race; $open sessions open overall)" || fail "V3 $bad races left the session usable"
fi

if want V4; then # a revoked row cannot be reopened or edited
  ck=$(open_session $A "$AP"); revoke "$ck" "$ORIGIN" >/dev/null
  id=$(sql "SELECT id FROM aegis.browser_sessions WHERE revoked_at IS NOT NULL ORDER BY created_at DESC LIMIT 1")
  r=0
  for stmt in "SET revoked_at=NULL, revocation_reason=NULL" "SET expires_at=expires_at + interval '1 minute'" \
      "SET revocation_reason='ACCOUNT_CHANGED'" "SET role='TECHNICIAN'"; do
    sql "UPDATE aegis.browser_sessions $stmt WHERE id='$id'" >/dev/null 2>&1 && { r=$((r + 1)); echo "  accepted: $stmt"; }
  done
  [[ $r == 0 && $(refresh "$ck" "$ORIGIN") == 401 ]] && pass "V4 trigger refuses reopening or editing a revoked row (4 updates, as the owner role)" || fail "V4 $r updates accepted on a revoked row"
  obs "V4 last_refreshed_at on a revoked row: $(sql "UPDATE aegis.browser_sessions SET last_refreshed_at=now() WHERE id='$id'" >/dev/null 2>&1 && echo accepted || echo refused)"
fi

if want V5 || want V6; then # real rotation through the provisioner
  a1=$(open_session $A "$AP"); a2=$(open_session $A "$AP"); tk=$(json 'd["accessToken"]' <"$work/b")
  t1=$(open_session $T "$TP")
  aid=$(uid $A); ev0=$(sql "SELECT count(*) FROM aegis.audit_events WHERE event_type='PASSWORD_CHANGED'")
  aud0=$(sql "SELECT count(*) FROM aegis.audit_events")
  # V6: hammer old-password browser logins across the restart; none may survive the change.
  # A tight curl loop (no interpreter per request) to reach the window where the new API answers before the
  # demo provisioner has applied the change. The body file holds the old password; it is deleted afterwards.
  python3 -c 'import json,sys; print(json.dumps({"email":sys.argv[1],"password":sys.argv[2],"browserSession":True}))' "$A" "$AP" >"$work/hbody"
  ( i=0; while :; do i=$(( (i + 1) % 250 )); c=$(curl -s -o /dev/null -w '%{http_code}' --interface "127.0.0.$((i + 2))" \
      -H 'Content-Type: application/json' -H "Origin: $ORIGIN" --data-binary @"$work/hbody" "$api/auth/login")
      echo "$(date +%s.%N) $c" >>"$work/hammer.codes"; done ) & hammer=$!
  sleep 2
  stop_api; date +%s.%N >"$work/stopped_at"; NEWP=qa-ses-admin3-$(openssl rand -hex 8)
  start_api api-v5.log AEGIS_DEMO_ADMIN_PASSWORD="$NEWP" || { echo "FAIL BLOCKED restart"; exit 1; }; date +%s.%N >"$work/started_at"
  sleep 3; kill $hammer 2>/dev/null; wait $hammer 2>/dev/null; rm -f "$work/hbody"
  export AEGIS_DEMO_ADMIN_PASSWORD="$NEWP"  # later restarts must keep the rotated password
  # Unexpired only: earlier cases leave sessions that simply reached their (short) end, which no change revokes.
  open_a=$(sql "SELECT count(*) FROM aegis.browser_sessions WHERE user_id='$aid' AND revoked_at IS NULL AND expires_at > now()")
  [[ $open_a == 0 ]] || sql "SELECT 'open since', created_at, 'change at', (SELECT max(occurred_at) FROM aegis.audit_events WHERE event_type='PASSWORD_CHANGED') FROM aegis.browser_sessions WHERE user_id='$aid' AND revoked_at IS NULL AND expires_at > now()"
  pc=$(sql "SELECT count(*) FROM aegis.browser_sessions WHERE user_id='$aid' AND revocation_reason='PASSWORD_CHANGED'")
  ev1=$(sql "SELECT count(*) FROM aegis.audit_events WHERE event_type='PASSWORD_CHANGED'")
  evs=$(sql "SELECT count(*) FROM aegis.audit_events WHERE event_type='PASSWORD_CHANGED' AND subject_id='$aid'")
  ra=$(refresh "$a1" "$ORIGIN"); rb=$(refresh "$a2" "$ORIGIN"); rt=$(refresh "$t1" "$ORIGIN")
  if want V5; then
    [[ $open_a == 0 && $pc -ge 2 && $ra == 401 && $rb == 401 ]] && pass "V5a admin rotation: every admin session revoked PASSWORD_CHANGED ($pc), refresh 401/401" || fail "V5a open=$open_a revoked=$pc refresh $ra/$rb"
    [[ $((ev1 - ev0)) == 1 && $evs == 1 ]] && pass "V5b exactly one PASSWORD_CHANGED audit event, subject = admin" || fail "V5b events +$((ev1 - ev0)), on admin $evs"
    [[ $rt == 200 ]] && pass "V5c technician session untouched (refresh 200)" || fail "V5c technician refresh $rt"
    obs "V5d pre-rotation access token on /auth/me: $(me "$tk") (ADR-018 proposed, not implemented: expected 200 until its expiry)"
    hm=$(json 'd.get("code")' <<<"$(curl -s -H 'Content-Type: application/json' --data-binary @- "$api/auth/login" <<<"{\"email\":\"$A\",\"password\":\"$AP\"}")" 2>/dev/null)
    echo "  old password login after rotation: ${hm:-?}"
    n0=$(sql "SELECT count(*) FROM aegis.browser_sessions WHERE revoked_at IS NOT NULL"); a2c=$(open_session $A "$NEWP")
    stop_api; start_api api-v5b.log AEGIS_DEMO_ADMIN_PASSWORD="$NEWP" || { echo "FAIL BLOCKED restart 2"; exit 1; }
    n1=$(sql "SELECT count(*) FROM aegis.browser_sessions WHERE revoked_at IS NOT NULL")
    ev2=$(sql "SELECT count(*) FROM aegis.audit_events WHERE event_type='PASSWORD_CHANGED'")
    [[ $n0 == "$n1" && $ev2 == "$ev1" && $(refresh "$a2c" "$ORIGIN") == 200 ]] && pass "V5e restart with the unchanged password: nothing revoked, no event, session still refreshes" || fail "V5e revoked $n0->$n1 events $ev1->$ev2"
  fi
  if want V6; then
    stop_t=$(cat "$work/stopped_at"); up_t=$(cat "$work/started_at")
    awk -v s="$stop_t" -v u="$up_t" '$2==200 && $1<s {b++} $2==200 && $1>=s {a++} $2==200 && $1>=u {w++} $2!=200 && $1>=u {r[$2]++} END {printf "  hammer: %d sessions opened before the stop, %d after it (%d after the health check); refusals after start:", b, a, w; for (k in r) printf " %s=%d", k, r[k]; print ""}' "$work/hammer.codes"
    opened=$(sql "SELECT count(*) FROM aegis.browser_sessions WHERE user_id='$aid'")
    echo "  admin session rows: $opened"
  fi
  want V6 && { [[ $open_a == 0 ]] && pass "V6 old-password browser logins hammered across the change: no admin session survives" || fail "V6 $open_a admin sessions open after the change"; }
  AP=$NEWP
fi

if want V7; then # retention
  aid=$(uid $A); aud0=$(sql "SELECT count(*) FROM aegis.audit_events")
  sql "INSERT INTO aegis.browser_sessions (user_id, token_hash, role, created_at, expires_at, revoked_at, revocation_reason) VALUES
   ('$aid', gen_random_bytes(32), 'ADMIN', now()-interval '31 days 8 hours', now()-interval '31 days', NULL, NULL),
   ('$aid', gen_random_bytes(32), 'ADMIN', now()-interval '31 days', now()-interval '30 days 20 hours', now()-interval '30 days 23 hours', 'SIGNED_OUT'),
   ('$aid', gen_random_bytes(32), 'ADMIN', now()-interval '29 days 8 hours', now()-interval '29 days', NULL, NULL),
   ('$aid', gen_random_bytes(32), 'ADMIN', now()-interval '29 days', now()-interval '28 days 20 hours', now()-interval '28 days 23 hours', 'SIGNED_OUT')" >/dev/null \
    || echo "FAIL BLOCKED V7 seed"
  # Late sign-out (ADR-017 as accepted): end = LEAST(revoked_at, expires_at); revoking after the end must not delay.
  late=$(sql "INSERT INTO aegis.browser_sessions (user_id, token_hash, role, created_at, expires_at, revoked_at, revocation_reason) VALUES
   ('$aid', gen_random_bytes(32), 'ADMIN', now()-interval '31 days', now()-interval '30 days 16 hours', now()-interval '29 days', 'SIGNED_OUT') RETURNING id" | head -1)
  edge=$(sql "INSERT INTO aegis.browser_sessions (user_id, token_hash, role, created_at, expires_at) VALUES
   ('$aid', gen_random_bytes(32), 'ADMIN', now()-interval '30 days 8 hours', now()-interval '30 days' + interval '10 minutes') RETURNING id" | head -1) \
    || echo "FAIL BLOCKED V7 seed"
  keep=$(open_session $A "$AP"); keep_id=$(sql "SELECT id FROM aegis.browser_sessions ORDER BY created_at DESC LIMIT 1")
  before=$(sql "SELECT count(*) FROM aegis.browser_sessions")
  if [[ -n ${QA_PURGE_TRIGGER:-} ]]; then eval "$QA_PURGE_TRIGGER"; else stop_api; start_api api-v7.log "$purge_env" || exit 1; sleep "${QA_PURGE_WAIT:-8}"; fi
  old=$(sql "SELECT count(*) FROM aegis.browser_sessions WHERE LEAST(revoked_at, expires_at) < now() - interval '30 days'")
  recent=$(sql "SELECT count(*) FROM aegis.browser_sessions WHERE LEAST(revoked_at, expires_at) BETWEEN now() - interval '30 days' AND now() - interval '28 days' AND id <> '$edge'")
  aud1=$(sql "SELECT count(*) FROM aegis.audit_events")
  [[ $(sql "SELECT count(*) FROM aegis.browser_sessions WHERE id='$late'") == 0 ]] && pass "V7c late sign-out (expired 30 d 16 h ago, revoked 29 d ago) purged: the end is the earlier instant" || fail "V7c late sign-out row kept: the purge uses the revocation instant"
  [[ $(sql "SELECT count(*) FROM aegis.browser_sessions WHERE id='$edge'") == 1 ]] && pass "V7d row ended 30 d minus 10 min ago kept (strict 30 days; the exact instant is Backend's clock test)" || fail "V7d row inside 30 days purged"
  # The open session may reach its short end during the wait: its row must survive, which is what is checked.
  kept=$(sql "SELECT count(*) FROM aegis.browser_sessions WHERE id='$keep_id'")
  [[ $old == 0 && $recent == 2 && $kept == 1 ]] && pass "V7a purge: >30-day ended rows gone, 29-day rows and the recent session kept (rows $before -> $(sql 'SELECT count(*) FROM aegis.browser_sessions'))" || fail "V7a old=$old recent=$recent kept=$kept"
  [[ $aud1 -ge $aud0 ]] && pass "V7b audit events not purged ($aud0 -> $aud1)" || fail "V7b audit $aud0 -> $aud1"
fi

scan() { # scan <file> <label> -> sets hits (secret classes found) and loggers (masked logger names)
  local f=$1 pair var v; hits=""
  for pair in cookie:ck token:tk token2:tk2 old-password:OLDP new-password:NEWP2 password-hash:hash cookie-digest:ckhex; do
    var=${pair#*:}; v=${!var:-}; [[ -n $v ]] && grep -qF -- "$v" "$f" && hits+=" ${pair%%:*}"; done
  loggers=$(for pair in ck OLDP NEWP2 hash ckhex tk tk2; do v=${!pair:-}; [[ -n $v ]] || continue
    grep -nF -- "$v" "$f" | cut -d: -f1 | while read -r n; do awk -v n="$n" 'NR<=n && /^20[0-9][0-9]-/ {l=$0} NR==n {print l; exit}' "$f"; done; done \
    | sed -E 's/.*\] ([a-zA-Z0-9_.$]+) +:.*/\1/' | sort | uniq -c | tr -s ' \n' ' ')
}
v8_run() { # v8_run <log> <env...>: sign in, refresh, revoke, rotate the password through the provisioner, purge
  local log=$1; shift; OLDP=$AP
  stop_api; start_api "$log" "$@" AEGIS_DEMO_ADMIN_PASSWORD="$AP" || { echo "FAIL BLOCKED $log"; return 1; }
  ck=$(open_session $A "$AP") || return 1; tk=$(json 'd["accessToken"]' <"$work/b"); refresh "$ck" "$ORIGIN" >/dev/null; tk2=$(json 'd["accessToken"]' <"$work/rb")
  revoke "$ck" "$ORIGIN" >/dev/null; login $A "wrong-$(openssl rand -hex 4)" "$ORIGIN" true >/dev/null
  NEWP2=qa-ses-admin4-$(openssl rand -hex 8); stop_api
  start_api "$log" "$@" "$purge_env" AEGIS_DEMO_ADMIN_PASSWORD="$NEWP2" || { echo "FAIL BLOCKED $log 2"; return 1; }
  sleep "${QA_PURGE_WAIT:-8}"
  grep -q 'BrowserSessionPurgeJob\|purge' "$work/$log" || echo "  note: no purge trace in $log"
  hash=$(sql "SELECT password_hash FROM aegis.users WHERE email='$A'")
  ckhex=$(printf %s "$ck" | python3 -c 'import sys,hashlib; print(hashlib.sha256(sys.stdin.read().encode()).hexdigest())')
  AP=$NEWP2
}
if want V9; then # an open session can never be deleted (tr_browser_sessions_open_kept)
  ck=$(open_session $A "$AP"); oid=$(sql "SELECT id FROM aegis.browser_sessions ORDER BY created_at DESC LIMIT 1")
  sql "DELETE FROM aegis.browser_sessions WHERE id='$oid'" >/dev/null 2>&1 && d1=deleted || d1=refused
  sql "DELETE FROM aegis.browser_sessions" >/dev/null 2>&1 && d2=deleted || d2=refused
  rc=$(refresh "$ck" "$ORIGIN")
  revoke "$ck" "$ORIGIN" >/dev/null
  sql "DELETE FROM aegis.browser_sessions WHERE id='$oid'" >/dev/null 2>&1 && d3=deleted || d3=refused
  [[ "$d1 $d2 $rc $d3" == "refused refused 200 deleted" ]] && pass "V9 DELETE of an open session refused (by id and table-wide, as the owner role), session still refreshes; once revoked it may be deleted" || fail "V9 open delete $d1, table-wide $d2, refresh $rc, revoked delete $d3"
fi

if want V8; then # no cookie, token, password or hash in logs
  v8_run api-trace-app.log LOGGING_LEVEL_CA_AEGIS=TRACE && { scan "$work/api-trace-app.log"
    [[ -z $hits ]] && pass "V8a application loggers (ca.aegis) at TRACE, login/refresh/revoke/provisioner rotation/purge: no cookie, token, password, hash or digest" || fail "V8a ca.aegis TRACE leaks:$hits via$loggers"; }
  v8_run api-trace-root.log LOGGING_LEVEL_ROOT=TRACE && { scan "$work/api-trace-root.log"
    [[ -z $hits ]] && pass "V8b root TRACE: no secret class" || obs "V8b root TRACE (framework loggers) exposes:$hits via$loggers"; }
fi
echo "failures: $failures"; exit "$failures"
