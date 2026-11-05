#!/bin/sh
# Creates, rotates or revokes the MQTT account of one hub in the local broker.
# See infra/mqtt/README.md.
#
#   provision-device.sh <lockerId>           create or rotate; prints the new secret once
#   provision-device.sh --revoke <lockerId>  delete the account
#
# The username is the lockerId, which the ACL patterns bind to the hub's own
# topics. The secret goes to stdout only, for flashing into the hub's NVS: it is
# never written to a file or passed on a command line. Messages go to stderr.
#
# Environment:
#   AEGIS_ENV_FILE  Compose env file (default infra/docker/.env, else .env.example)
set -eu

usage() {
  echo "usage: $0 [--revoke] <lockerId>" >&2
  exit 2
}

revoke=false
case "${1:-}" in
  --revoke) revoke=true; shift ;;
  -h|--help|'') usage ;;
esac
[ $# -eq 1 ] || usage
locker=$1

# Doc 10 §5 rule 1: canonical lowercase UUID. This also keeps the username free
# of '/', '+' and '#', which the %u ACL patterns must never see.
if ! printf '%s' "$locker" | grep -Eq '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'; then
  echo "lockerId must be a canonical lowercase UUID" >&2
  exit 2
fi
if [ "$locker" = "d46a74ae-39dc-460b-8af0-38fc791b376a" ]; then
  echo "the simulator locker is managed by mqtt-auth-init (AEGIS_MQTT_DEVICE_PASSWORD)" >&2
  exit 2
fi

repo=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
env_file=${AEGIS_ENV_FILE:-}
if [ -z "$env_file" ]; then
  if [ -f "$repo/infra/docker/.env" ]; then env_file="$repo/infra/docker/.env"; else env_file="$repo/infra/docker/.env.example"; fi
fi
# The TLS override defines mqtt-tls-init; this script only needs the base file.
export COMPOSE_IGNORE_ORPHANS=true
compose() {
  docker compose --progress quiet --env-file "$env_file" -f "$repo/infra/docker/compose.yaml" "$@"
}

# Runs in a throwaway container that mounts the auth volume read-write, then
# restores the owner and mode expected by the mosquitto user.
edit_passwords() {
  compose run --rm --no-deps -T --entrypoint sh mqtt-auth-init -ec "$1" sh "$locker"
}

if [ "$revoke" = true ]; then
  edit_passwords '
    if ! grep -q "^$1:" /mosquitto/data/passwords; then
      echo "$1 is not provisioned" >&2
      exit 1
    fi
    mosquitto_passwd -D /mosquitto/data/passwords "$1" >/dev/null 2>&1
    chown 1883:1883 /mosquitto/data/passwords
    chmod 0600 /mosquitto/data/passwords
  '
  action="revoked"
else
  if command -v openssl >/dev/null 2>&1; then
    secret=$(openssl rand -hex 32)
  else
    secret=$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')
  fi
  [ ${#secret} -eq 64 ] || { echo "could not generate a secret" >&2; exit 1; }
  # mosquitto_passwd reads the password twice from stdin.
  printf '%s\n%s\n' "$secret" "$secret" | edit_passwords '
    if [ ! -f /mosquitto/data/passwords ]; then
      echo "no password file yet: start the stack once (mqtt-auth-init creates it)" >&2
      exit 1
    fi
    mosquitto_passwd /mosquitto/data/passwords "$1" >/dev/null 2>&1
    chown 1883:1883 /mosquitto/data/passwords
    chmod 0600 /mosquitto/data/passwords
  '
  action="provisioned"
fi

# SIGHUP reloads the password file and the ACL without dropping other clients.
if [ -n "$(compose ps -q mosquitto 2>/dev/null)" ]; then
  compose kill -s SIGHUP mosquitto >/dev/null
  echo "$action $locker; broker reloaded" >&2
else
  echo "$action $locker; broker not running, it will load the change at start" >&2
fi

if [ "$revoke" = false ]; then
  echo "secret for $locker (shown once, store it only in the hub's NVS):" >&2
  printf '%s\n' "$secret"
fi
