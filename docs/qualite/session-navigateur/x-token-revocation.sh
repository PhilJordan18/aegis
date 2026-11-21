#!/usr/bin/env bash
# X1-X9: ADR-018 (#179) access-token revocation, black box on a disposable stack. Run from the repository root of a
# commit that contains V012 (credential_version). Secrets stay in shell variables; never printed.
#   A: a real password change refuses every earlier token of the account, browser and device alike (claim cv).
#   B: a Manager sign-out refuses only the tokens of that browser session (claim sid); device tokens survive.
# X5 forges tokens with the disposable stack's own random signing key, only to prove that a token without cv is refused
# whatever its signature; the control token (same claims, cv kept) must be accepted, or the forge proves nothing.
here=$(cd "$(dirname "$0")" && pwd)
. "$here/lib.sh"
[[ -f services/api/src/main/resources/db/migration/V012__add_user_credential_version.sql ]] ||
  { echo "FAIL BLOCKED this commit has no V012: ADR-018 is not in it"; exit 1; }
expect() { [[ $2 == "$3" ]] && pass "$1 ($2)" || fail "$1: expected $3, got $2"; }
me() { curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $1" "$api/auth/me"; }
claims() { python3 -c 'import base64,json,sys; p=sys.argv[1].split(".")[1]; p+="="*(-len(p)%4)
print(json.dumps(json.loads(base64.urlsafe_b64decode(p)), sort_keys=True))' "$1"; }
token_of() { json 'd["accessToken"]' <"$work/b"; }

# Two browser sessions and one device login of the administrator.
c=$(login $A "$AP" "$ORIGIN" true); b1=$(token_of); k1=$(cookie_from "$work/h")
expect "X0a browser login 1" "$c" 200
c=$(login $A "$AP" "$ORIGIN" true); b2=$(token_of); k2=$(cookie_from "$work/h")
expect "X0b browser login 2" "$c" 200
c=$(login $A "$AP" - -); dev=$(token_of)
expect "X0c device login (no browser session)" "$c" 200
cl1=$(claims "$b1"); cld=$(claims "$dev")
[[ $(json '"cv" in d and "sid" in d' <<<"$cl1") == True && $(json '"cv" in d and "sid" not in d' <<<"$cld") == True ]] &&
  pass "X1 browser token carries cv and sid; device token carries cv only" ||
  fail "X1 claims: browser has cv/sid $(json '"cv" in d, "sid" in d' <<<"$cl1"), device $(json '"cv" in d, "sid" in d' <<<"$cld")"
sid1=$(json 'd["sid"]' <<<"$cl1")
[[ $(sql "SELECT count(*) FROM aegis.browser_sessions WHERE id = '$sid1' AND revoked_at IS NULL") == 1 ]] &&
  pass "X1b sid is the open browser_sessions row" || fail "X1b sid does not name an open session row"

# B: sign out of session 1 only.
expect "X2a sign-out of browser session 1" "$(revoke "$k1" "$ORIGIN")" 204
expect "X2b its token, at once" "$(me "$b1")" 401
expect "X2c the other browser session's token" "$(me "$b2")" 200
expect "X2d the device token" "$(me "$dev")" 200

# A restored token carries the session too, and dies with it.
c=$(refresh "$k2" "$ORIGIN"); r2=$(json 'd["accessToken"]' <"$work/rb")
expect "X3a restore of session 2" "$c" 200
[[ $(json 'd.get("sid")' <<<"$(claims "$r2")") == $(json 'd.get("sid")' <<<"$(claims "$b2")") ]] &&
  pass "X3b the restored token carries the same sid" || fail "X3b restored sid differs or is missing"

# An expired session refuses its tokens before their own expiry (session aged in the disposable database).
sid2=$(json 'd["sid"]' <<<"$(claims "$b2")")
sql "UPDATE aegis.browser_sessions SET expires_at = created_at + interval '1 millisecond' WHERE id = '$sid2'" >/dev/null 2>&1 ||
  obs "X4 could not age the session row (constraint); X4 not run"
expect "X4 token of an ended (expired) browser session" "$(me "$r2")" 401
expect "X4b the device token is still accepted" "$(me "$dev")" 200

# X5: a token without cv, validly signed with this stack's key, is refused; the same claims with cv are accepted.
forge() { python3 - "$1" "$2" <<'EOF'
import base64, hashlib, hmac, json, os, sys
tok, drop = sys.argv[1], sys.argv[2]
h, p, _ = tok.split(".")
pl = json.loads(base64.urlsafe_b64decode(p + "=" * (-len(p) % 4)))
if drop != "-": pl.pop(drop, None)
enc = lambda b: base64.urlsafe_b64encode(b).rstrip(b"=").decode()
body = h + "." + enc(json.dumps(pl, separators=(",", ":")).encode())
secret = os.environ["AEGIS_JWT_SECRET"]
for key in (base64.b64decode(secret), secret.encode()):
    sig = enc(hmac.new(key, body.encode(), hashlib.sha256).digest())
    print(body + "." + sig)
EOF
}
mapfile -t ctl < <(forge "$dev" -); mapfile -t nocv < <(forge "$dev" cv)
ok=-; for i in 0 1; do [[ $(me "${ctl[$i]}") == 200 ]] && ok=$i; done
if [[ $ok == - ]]; then
  fail "X5 BLOCKED the re-signed control token was not accepted: the forge does not match the key encoding"
else
  pass "X5a re-signed control token with cv accepted (200)"
  expect "X5b same token without cv" "$(me "${nocv[$ok]}")" 401
fi
unset ctl nocv

# X6: the database refuses a lowered version and a new hash without a new version (V012 trigger, as table owner).
v=$(sql "SELECT credential_version FROM aegis.users WHERE email = '$A'")
sql "UPDATE aegis.users SET credential_version = credential_version + 1 WHERE email = '$A'" >/dev/null 2>&1
sql "UPDATE aegis.users SET credential_version = $v WHERE email = '$A'" >"$work/x6a.log" 2>&1
grep -q 'cannot decrease' "$work/x6a.log" && pass "X6a lowering credential_version refused by the trigger" ||
  fail "X6a lowering credential_version was not refused"
sql "UPDATE aegis.users SET password_hash = password_hash || 'x' WHERE email = '$A'" >"$work/x6b.log" 2>&1
grep -q 'requires a new credential version' "$work/x6b.log" && pass "X6b new hash without a new version refused" ||
  fail "X6b new hash without a new version was not refused"
# The bump above is a real version change: every earlier admin token must now fail (A, without any password change).
expect "X6c the device token after the version bump" "$(me "$dev")" 401

# A: a real rotation by the provisioner refuses every earlier token, including a fresh device token.
c=$(login $A "$AP" - -); dev2=$(token_of); expect "X7a device login before the rotation" "$c" 200
c=$(login $A "$AP" "$ORIGIN" true); b3=$(token_of); expect "X7b browser login before the rotation" "$c" 200
c=$(login $T "$AEGIS_DEMO_TECHNICIAN_PASSWORD" - -); tech=$(token_of); expect "X7c technician login" "$c" 200
stop_api; NEWP=qa-x-admin2-$(openssl rand -hex 8)
start_api api-x.log AEGIS_DEMO_ADMIN_PASSWORD="$NEWP" || { echo "FAIL BLOCKED restart"; exit 1; }
for _ in $(seq 1 20); do grep -q 'Updated the password of demo account' "$work/api-x.log" && break; sleep 0.5; done
expect "X7d earlier device token after the rotation" "$(me "$dev2")" 401
expect "X7e earlier browser token after the rotation" "$(me "$b3")" 401
expect "X7f technician token (other account) untouched" "$(me "$tech")" 200
c=$(login $A "$NEWP" - -); new=$(token_of); expect "X7g new password login" "$c" 200
expect "X7h its token" "$(me "$new")" 200
audits=$(sql "SELECT count(*) FROM aegis.audit_events WHERE event_type = 'PASSWORD_CHANGED'")
[[ $audits == 1 ]] && pass "X7i one PASSWORD_CHANGED audit" || fail "X7i PASSWORD_CHANGED audits: $audits"

# X8: a restart with the same password changes nothing.
stop_api; start_api api-x2.log AEGIS_DEMO_ADMIN_PASSWORD="$NEWP" || { echo "FAIL BLOCKED restart 2"; exit 1; }
sleep 2
expect "X8 token still accepted after a restart with the same password" "$(me "$new")" 200

# X9: no token, cookie, password or hash in the API logs.
leak=0
for s in "$b1" "$b2" "$dev" "$dev2" "$new" "$k1" "$k2" "$AP" "$NEWP"; do grep -qF -- "$s" "$work"/api-*.log && leak=$((leak + 1)); done
[[ $leak == 0 ]] && pass "X9 no token, cookie or password in the API logs" || fail "X9 $leak secret values found in the API logs"
unset b1 b2 b3 r2 dev dev2 new tech k1 k2 NEWP
echo "failures: $failures"; exit "$failures"
