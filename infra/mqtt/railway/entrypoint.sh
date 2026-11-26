#!/bin/sh
set -eu
umask 077
: "${AEGIS_MQTT_API_PASSWORD:?Missing backend secret}"
: "${AEGIS_MQTT_HUB_PASSWORD:?Missing hub secret}"
: "${AEGIS_MQTT_HUB_ID:?Missing hub identity}"
: "${MQTT_CA_B64:?Missing CA}"
: "${MQTT_CERT_B64:?Missing certificate}"
: "${MQTT_KEY_B64:?Missing key}"
case "$AEGIS_MQTT_HUB_ID" in *[!0-9a-f-]*|'') exit 20;; esac
printf '%s\n' "$AEGIS_MQTT_HUB_ID" | grep -Eq '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' || exit 20
# Plaintext is only a private temporary input to Mosquitto's in-place hasher.
# Reject record separators; never pass a production password in process argv.
[ "$(printf '%s' "$AEGIS_MQTT_API_PASSWORD" | tr -d '\r\n')" = "$AEGIS_MQTT_API_PASSWORD" ] || exit 24
[ "$(printf '%s' "$AEGIS_MQTT_HUB_PASSWORD" | tr -d '\r\n')" = "$AEGIS_MQTT_HUB_PASSWORD" ] || exit 24
mkdir -p /run/aegis-mqtt /mosquitto/data
chmod 0700 /run/aegis-mqtt
work=$(mktemp -d /run/aegis-mqtt/build.XXXXXX)
trap 'rm -rf "$work"' EXIT INT TERM
printf '%s' "$MQTT_CA_B64" | base64 -d > "$work/ca.crt"
printf '%s' "$MQTT_CERT_B64" | base64 -d > "$work/server.crt"
printf '%s' "$MQTT_KEY_B64" | base64 -d > "$work/server.key"
printf 'aegis_api:%s\n%s:%s\n' "$AEGIS_MQTT_API_PASSWORD" "$AEGIS_MQTT_HUB_ID" "$AEGIS_MQTT_HUB_PASSWORD" > "$work/passwords"
mosquitto_passwd -U "$work/passwords"
# An explicit inventory (possibly empty) preserves other devices, including the SIM.
extra=/mosquitto/data/device-accounts.hash
[ -f "$extra" ] || exit 25
awk -F: -v primary="$AEGIS_MQTT_HUB_ID" '
{ n=split($1, parts, "-") }
NF != 2 || n != 5 || length(parts[1]) != 8 || length(parts[2]) != 4 || length(parts[3]) != 4 || length(parts[4]) != 4 || length(parts[5]) != 12 || $1 !~ /^[0-9a-f]+-[0-9a-f]+-[0-9a-f]+-[0-9a-f]+-[0-9a-f]+$/ || length($1) != 36 || $2 !~ /^[$]7[$][^[:space:]]+$/ || $1 == primary || seen[$1]++ { bad=1 }
END { exit(bad) }' "$extra" || exit 25
# Ensure the appended record cannot join the base or recipe identity line.
awk '{ print }' "$extra" >> "$work/passwords"
# Always reconstruct from the immutable base; repeated boots never append twice.
cp /opt/aegis/base.acl "$work/acl"
sh /opt/aegis/install-recipe-overlay.sh "$work" /mosquitto/data/recipe-230
for file in passwords acl ca.crt server.crt server.key; do
 mv "$work/$file" "/run/aegis-mqtt/$file"
done
rmdir "$work"
trap - EXIT INT TERM
chown -R mosquitto:mosquitto /run/aegis-mqtt
chown mosquitto:mosquitto /mosquitto/data
chmod 0600 /run/aegis-mqtt/*
unset AEGIS_MQTT_API_PASSWORD AEGIS_MQTT_HUB_PASSWORD MQTT_CA_B64 MQTT_CERT_B64 MQTT_KEY_B64
mosquitto --test-config -c /opt/aegis/mosquitto.conf
exec /usr/sbin/mosquitto -c /opt/aegis/mosquitto.conf
