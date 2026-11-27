#!/bin/sh
# Run after base identities are generated, before starting Mosquitto.
set -eu
umask 077
base=${1:?Base auth directory required}
bundle=${2:?Persistent recipe bundle required}
[ -f "$base/passwords" ] && [ -f "$base/acl" ]
[ -f "$bundle/account.hash" ] && [ -f "$bundle/locker-id" ] && [ -f "$bundle/commands-enabled" ]
locker=$(cat "$bundle/locker-id")
case "$locker" in *[!0-9a-f-]*|'') exit 20;; esac
printf '%s\n' "$locker" | grep -Eq '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' || exit 20
commands=$(cat "$bundle/commands-enabled")
case "$commands" in true|false) ;; *) exit 21;; esac
# Never merge over a divergent identity or ACL. The entrypoint must supply a clean base.
if grep -q '^aegis_api_recipe_223:' "$base/passwords" || grep -q '^user aegis_api_recipe_223$' "$base/acl"; then exit 22; fi
awk 'NR != 1 || $0 !~ /^aegis_api_recipe_223:[$]7[$][^[:space:]]+$/ { bad=1 } END { exit(bad || NR != 1) }' "$bundle/account.hash" || exit 23
work=$(mktemp -d "$base/overlay.XXXXXX")
trap 'rm -rf "$work"' EXIT INT TERM
cat "$base/passwords" "$bundle/account.hash" > "$work/passwords"
cp "$base/acl" "$work/acl"
{
 printf '\nuser aegis_api_recipe_223\n'
 printf 'topic write aegis/v1/lockers/%s/display\n' "$locker"
 if [ "$commands" = true ]; then
   printf 'topic write aegis/v1/lockers/%s/commands\n' "$locker"
 else
   printf 'topic deny aegis/v1/lockers/+/commands\n'
 fi
 printf 'topic read aegis/v1/lockers/+/events\ntopic read aegis/v1/lockers/+/status\n'
 # Global %u patterns otherwise grant this non-device account device permissions.
 printf 'topic deny aegis/v1/lockers/aegis_api_recipe_223/commands\ntopic deny aegis/v1/lockers/aegis_api_recipe_223/display\ntopic deny aegis/v1/lockers/aegis_api_recipe_223/events\ntopic deny aegis/v1/lockers/aegis_api_recipe_223/status\n'
} >> "$work/acl"
chmod 0600 "$work/passwords" "$work/acl"
mv "$work/passwords" "$base/passwords"
mv "$work/acl" "$base/acl"
