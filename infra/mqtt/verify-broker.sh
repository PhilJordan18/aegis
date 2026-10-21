#!/bin/sh
# Repeatable TLS, authentication and ACL check of the running local broker
# (doc 10 §6 and §23.1). See infra/mqtt/README.md.
#
#   verify-broker.sh [path/to/ca.crt]
#
# Prerequisite: the stack runs with compose.tls.yaml. The script provisions two
# temporary hubs, runs the clients in a container on the Compose network, then
# revokes both hubs. Mosquitto 2.1.2 silently drops an unauthorized PUBLISH and
# grants a SUBSCRIBE even to a filter such as #, $SYS/# or +/commands, then filters
# each delivery against the ACL. A SUBACK therefore proves nothing: every denial
# is proven by a message that never reaches an observer, next to a control
# message that does.
#
# Environment:
#   AEGIS_ENV_FILE  Compose env file (default infra/docker/.env, else .env.example)
set -eu

repo=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
ca=${1:-$repo/infra/mqtt/certs/lab/ca.crt}
[ -s "$ca" ] || { echo "lab CA not found: $ca (run infra/mqtt/certs/generate-lab-certs.sh)" >&2; exit 2; }
ca=$(CDPATH= cd -- "$(dirname -- "$ca")" && pwd)/$(basename -- "$ca")

env_file=${AEGIS_ENV_FILE:-}
if [ -z "$env_file" ]; then
  if [ -f "$repo/infra/docker/.env" ]; then env_file="$repo/infra/docker/.env"; else env_file="$repo/infra/docker/.env.example"; fi
fi
export AEGIS_ENV_FILE="$env_file"
export COMPOSE_IGNORE_ORPHANS=true
compose() {
  docker compose --progress quiet --env-file "$env_file" -f "$repo/infra/docker/compose.yaml" "$@"
}

container=$(compose ps -q mosquitto)
[ -n "$container" ] || { echo "mosquitto is not running" >&2; exit 2; }
network=$(docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' "$container" | awk '{print $1}')
image=$(docker inspect -f '{{.Config.Image}}' "$container")
broker_name=$(docker inspect -f '{{.Name}}' "$container" | sed 's#^/##')

failures=0
pass() { echo "PASS $1"; }
fail() { echo "FAIL $1"; failures=$((failures + 1)); }

example_password=false
if grep -Eq '^AEGIS_MQTT_(API|DEVICE)_PASSWORD=.*change-me$' "$env_file"; then example_password=true; fi

tls_probe_host=127.0.0.1
for port in 1883 8883; do
  binding=$(compose port mosquitto "$port" 2>/dev/null || true)
  case "$binding" in
    127.*|'[::1]':*) pass "host publishes $port on loopback only ($binding)" ;;
    '') fail "port $port is not published (is compose.tls.yaml in use?)" ;;
    *) echo "WARN host publishes $port on $binding (LAN exposure: expected only for 8883 with AEGIS_MQTT_TLS_BIND)"
       if [ "$port" = 8883 ]; then
         case "${binding%:*}" in 0.0.0.0|'[::]'|::) ;; *) tls_probe_host=${binding%:*} ;; esac
         if [ "$example_password" = true ]; then
           fail "8883 is exposed off loopback while $env_file still holds an example (change-me) MQTT password"
         else
           pass "8883 exposed off loopback with non-example MQTT passwords"
         fi
       else
         fail "plaintext 1883 must stay on 127.0.0.1"
       fi ;;
  esac
done

# A real handshake: pass only on the server's protocol_version alert. A client
# that cannot offer TLS 1.1 at all, or a server that accepts it, both fail.
tls11=$(openssl s_client -connect "$tls_probe_host:$(compose port mosquitto 8883 | sed 's/.*://')" \
  -tls1_1 -cipher 'DEFAULT@SECLEVEL=0' </dev/null 2>&1 || true)
if printf '%s' "$tls11" | grep -q 'alert protocol version'; then
  pass "TLS 1.1 handshake refused by the broker (protocol_version alert)"
else
  fail "TLS 1.1 handshake not refused by the broker: $(printf '%s' "$tls11" | grep -E 'Protocol|error' | head -n 2 | tr '\n' ' ')"
fi

work=$(mktemp -d)
locker_a=""
locker_b=""
cleanup() {
  for l in "$locker_a" "$locker_b"; do
    "$repo/infra/mqtt/provision-device.sh" --revoke "$l" >/dev/null 2>&1 || true
  done
  rm -rf "$work"
}
trap cleanup EXIT INT TERM

uuid() {
  od -An -N16 -tx1 /dev/urandom | tr -d ' \n' |
    awk '{ printf "%s-%s-4%s-%x%s-%s\n", substr($0,1,8), substr($0,9,4), substr($0,14,3), 8 + (index("0123456789abcdef", substr($0,17,1)) - 1) % 4, substr($0,18,3), substr($0,21,12) }'
}
locker_a=$(uuid)
locker_b=$(uuid)

# A server certificate from an unrelated CA must be refused.
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj "/CN=Rogue CA" \
  -keyout "$work/rogue.key" -out "$work/rogue-ca.crt" >/dev/null 2>&1
cp "$ca" "$work/ca.crt"
chmod 0644 "$work/ca.crt" "$work/rogue-ca.crt"

secret_a=$("$repo/infra/mqtt/provision-device.sh" "$locker_a" 2>/dev/null)
secret_b=$("$repo/infra/mqtt/provision-device.sh" "$locker_b" 2>/dev/null)
api_password=$(sed -n 's/^AEGIS_MQTT_API_PASSWORD=//p' "$env_file" | tail -n 1)
[ -n "$secret_a" ] && [ -n "$secret_b" ] && [ -n "$api_password" ] || { echo "could not prepare credentials" >&2; exit 1; }
export LOCKER_A="$locker_a" LOCKER_B="$locker_b" SECRET_A="$secret_a" SECRET_B="$secret_b" API_PASSWORD="$api_password" BROKER_NAME="$broker_name"

set +e
docker run --rm -i --network "$network" -v "$work:/work:ro" \
  -e LOCKER_A -e LOCKER_B -e SECRET_A -e SECRET_B -e API_PASSWORD -e BROKER_NAME \
  --entrypoint sh "$image" -s <<'CHECKS'
set -u
failures=0
pass() { echo "PASS $1"; }
fail() { echo "FAIL $1"; failures=$((failures + 1)); }
A="aegis/v1/lockers/$LOCKER_A"
B="aegis/v1/lockers/$LOCKER_B"
tls="-V mqttv311 -h mosquitto -p 8883 --cafile /work/ca.crt"
api="$tls -u aegis_api -P $API_PASSWORD"
dev_a="$tls -u $LOCKER_A -P $SECRET_A"
dev_b="$tls -u $LOCKER_B -P $SECRET_B"
n=0

connects() { mosquitto_pub "$@" -t "aegis/v1/probe" -n -q 1 >/dev/null 2>&1; }

# expect_connect yes|no description client-args...
expect_connect() {
  want=$1; desc=$2; shift 2
  if connects "$@"; then got=yes; else got=no; fi
  if [ "$got" = "$want" ]; then pass "$desc"; else fail "$desc"; fi
}

# observe NAME client-args... -t filter...: background subscriber, one file per observer.
observe() {
  name=$1; shift
  mosquitto_sub "$@" -q 1 -W 5 -F '%t %p' > "/tmp/$name.out" 2>&1 &
  eval "pid_$name=\$!"
}
stop_observers() {
  for p in "$@"; do eval "kill \$pid_$p 2>/dev/null; wait \$pid_$p 2>/dev/null"; done
}
received() { grep -q " $2\$" "/tmp/$1.out"; }
publish() { mosquitto_pub "$@" -q 1 >/dev/null 2>&1; }
# Sets each named variable to a distinct payload (no subshell, so the counter advances).
tokens() { for v in "$@"; do n=$((n + 1)); eval "$v=probe-$$-$n"; done; }

# --- Transport and authentication ---------------------------------------------
expect_connect yes "TLS 8883 with the lab CA and a provisioned hub" $dev_a
expect_connect no "TLS 8883 with a server certificate from another CA" -V mqttv311 -h mosquitto -p 8883 --cafile /work/rogue-ca.crt -u "$LOCKER_A" -P "$SECRET_A"
expect_connect no "TLS 8883 under a hostname absent from the certificate ($BROKER_NAME)" -V mqttv311 -h "$BROKER_NAME" -p 8883 --cafile /work/ca.crt -u "$LOCKER_A" -P "$SECRET_A"
expect_connect no "plaintext MQTT to 8883" -V mqttv311 -h mosquitto -p 8883 -u "$LOCKER_A" -P "$SECRET_A"
expect_connect no "anonymous on 8883" $tls
expect_connect no "anonymous on 1883" -V mqttv311 -h mosquitto -p 1883
expect_connect no "wrong secret on 8883" $tls -u "$LOCKER_A" -P "wrong-$SECRET_A"
expect_connect no "hub B secret used as hub A" $tls -u "$LOCKER_A" -P "$SECRET_B"
expect_connect yes "plaintext 1883 inside the Compose network (simulator, API)" -V mqttv311 -h mosquitto -p 1883 -u aegis_api -P "$API_PASSWORD"

# --- Hub A on its own topics --------------------------------------------------
observe api_up $api -t "$A/events" -t "$A/status"
observe api_all $api -t "aegis/v1/lockers/+/events" -t "aegis/v1/lockers/+/status"
observe a_down $dev_a -t "$A/commands" -t "$A/display"
sleep 1
tokens ev st cmd dsp cmd_by_a dsp_by_a ev_by_api st_by_api self_ev self_st
publish $dev_a -t "$A/events" -m "$ev"
publish $dev_a -t "$A/status" -m "$st"
publish $api -t "$A/commands" -m "$cmd"
publish $api -t "$A/display" -m "$dsp"
publish $dev_a -t "$A/commands" -m "$cmd_by_a"
publish $dev_a -t "$A/display" -m "$dsp_by_a"
publish $api -t "$A/events" -m "$ev_by_api"
publish $api -t "$A/status" -m "$st_by_api"
publish $api -t "aegis/v1/lockers/aegis_api/events" -m "$self_ev"
publish $api -t "aegis/v1/lockers/aegis_api/status" -m "$self_st"
sleep 1
stop_observers api_up a_down api_all
received api_up "$ev" && pass "hub A publishes its events, backend receives" || fail "hub A publishes its events, backend receives"
received api_up "$st" && pass "hub A publishes its status, backend receives" || fail "hub A publishes its status, backend receives"
received a_down "$cmd" && pass "hub A receives its commands from the backend" || fail "hub A receives its commands from the backend"
received a_down "$dsp" && pass "hub A receives its display from the backend" || fail "hub A receives its display from the backend"
received a_down "$cmd_by_a" && fail "hub A cannot publish its own commands" || pass "hub A cannot publish its own commands"
received a_down "$dsp_by_a" && fail "hub A cannot publish its own display" || pass "hub A cannot publish its own display"
received api_up "$ev_by_api" && fail "backend cannot publish events" || pass "backend cannot publish events"
received api_up "$st_by_api" && fail "backend cannot publish status" || pass "backend cannot publish status"
received api_all "$ev" && received api_all "$st" \
  && pass "control: the backend's +/events and +/status subscriptions deliver" || fail "control: the backend's +/events and +/status subscriptions deliver"
received api_all "$self_ev" || received api_all "$self_st" \
  && fail "backend cannot inject on aegis/v1/lockers/aegis_api/{events,status} (%u pattern)" \
  || pass "backend cannot inject on aegis/v1/lockers/aegis_api/{events,status} (%u pattern)"

# --- Hub A against locker B ---------------------------------------------------
observe api_b $api -t "$B/events" -t "$B/status"
observe b_down $dev_b -t "$B/commands" -t "$B/display"
observe a_spy $dev_a -t "$B/commands" -t "$B/display" -t "$B/events" -t "$B/status"
observe a_wild $dev_a -t "aegis/v1/lockers/+/commands" -t "aegis/v1/lockers/+/events" -t "aegis/v1/lockers/#" -t "#"
sleep 1
tokens b_cmd b_dsp b_ev b_st a_to_b_ev a_to_b_st a_to_b_cmd
publish $api -t "$B/commands" -m "$b_cmd"
publish $api -t "$B/display" -m "$b_dsp"
publish $dev_b -t "$B/events" -m "$b_ev"
publish $dev_b -t "$B/status" -m "$b_st"
publish $dev_a -t "$B/events" -m "$a_to_b_ev"
publish $dev_a -t "$B/status" -m "$a_to_b_st"
publish $dev_a -t "$B/commands" -m "$a_to_b_cmd"
sleep 1
stop_observers api_b b_down a_spy a_wild
received b_down "$b_cmd" && received b_down "$b_dsp" && received api_b "$b_ev" && received api_b "$b_st" \
  && pass "control: locker B traffic flows to its legitimate readers" || fail "control: locker B traffic flows to its legitimate readers"
for t in "$b_cmd" "$b_dsp" "$b_ev" "$b_st"; do
  if received a_spy "$t"; then fail "hub A reads a topic of locker B ($t)"; fi
  if received a_wild "$t"; then fail "hub A reads locker B through a wildcard ($t)"; fi
done
received a_spy "$b_cmd" || received a_spy "$b_dsp" || received a_spy "$b_ev" || received a_spy "$b_st" || pass "hub A cannot read any topic of locker B"
received a_wild "$b_cmd" || received a_wild "$b_dsp" || received a_wild "$b_ev" || received a_wild "$b_st" || pass "hub A cannot read through +, aegis/v1/lockers/# or #"
received api_b "$a_to_b_ev" && fail "hub A cannot publish locker B events" || pass "hub A cannot publish locker B events"
received api_b "$a_to_b_st" && fail "hub A cannot publish locker B status" || pass "hub A cannot publish locker B status"
received b_down "$a_to_b_cmd" && fail "hub A cannot publish locker B commands" || pass "hub A cannot publish locker B commands"

echo "container checks: $failures failure(s)"
[ "$failures" -eq 0 ]
CHECKS
container_status=$?
set -e

if [ "$container_status" -ne 0 ] || [ "$failures" -ne 0 ]; then
  echo "broker verification FAILED" >&2
  exit 1
fi
echo "broker verification passed"
