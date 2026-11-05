#!/bin/sh
# Creates the lab CA (once) and issues the broker's TLS server certificate.
# See infra/mqtt/README.md. Lab use only; nothing produced here is committed.
#
#   generate-lab-certs.sh [--out DIR] [--force-ca] [--allow-unignored] NAME_OR_IP...
#
# Inside a Git work tree, --out must be ignored by Git (private keys); use
# --allow-unignored only for a directory you know will never be committed.
#
# Each argument becomes a subjectAltName entry (IP if it looks like an IPv4/IPv6
# address, DNS otherwise). localhost, 127.0.0.1 and mosquitto (the Compose
# service name) are always added.
#
# Keys are RSA 2048: verified quickly by the ESP32 (mbedTLS, hardware RSA) and
# accepted by every client in the project (Mosquitto, Node, Java, iOS).
set -eu

CA_DAYS=1095
SERVER_DAYS=397

usage() {
  echo "usage: $0 [--out DIR] [--force-ca] [--allow-unignored] HOSTNAME_OR_IP..." >&2
  echo "example: $0 aegis-demo.local 192.168.1.42" >&2
  exit 2
}

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
out="$script_dir/lab"
force_ca=false
allow_unignored=false
san="DNS:localhost,IP:127.0.0.1,DNS:mosquitto"

add_san() {
  case "$1" in
    *[!A-Za-z0-9.:-]*|'') echo "invalid name or address: '$1'" >&2; exit 2 ;;
  esac
  if printf '%s' "$1" | grep -Eq '^[0-9]{1,3}(\.[0-9]{1,3}){3}$' || printf '%s' "$1" | grep -q ':'; then
    entry="IP:$1"
  else
    entry="DNS:$1"
  fi
  case ",$san," in
    *",$entry,"*) ;;
    *) san="$san,$entry" ;;
  esac
}

while [ $# -gt 0 ]; do
  case "$1" in
    --out) [ $# -ge 2 ] || usage; out=$2; shift 2 ;;
    --force-ca) force_ca=true; shift ;;
    --allow-unignored) allow_unignored=true; shift ;;
    -h|--help) usage ;;
    -*) echo "unknown option $1" >&2; usage ;;
    *) add_san "$1"; shift ;;
  esac
done

command -v openssl >/dev/null 2>&1 || { echo "openssl is required" >&2; exit 1; }

umask 077
mkdir -p "$out/private" "$out/broker"

# Refuse to write private keys where Git would pick them up.
out_abs=$(CDPATH= cd -- "$out" && pwd -P)
if top=$(git -C "$out_abs" rev-parse --show-toplevel 2>/dev/null); then
  if ! git -C "$top" check-ignore -q "$out_abs/private/ca.key" || ! git -C "$top" check-ignore -q "$out_abs/broker/server.key"; then
    if [ "$allow_unignored" = true ]; then
      echo "WARNING: $out_abs is inside $top but not ignored by Git; never commit its keys" >&2
    else
      echo "$out_abs is inside the Git work tree $top but not ignored by Git; use the default directory, add it to .gitignore, or pass --allow-unignored" >&2
      exit 1
    fi
  fi
fi

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT INT TERM
# Runs openssl quietly, but shows its diagnostics when it fails.
run_openssl() {
  if ! openssl "$@" 2>"$tmp/openssl.err"; then
    cat "$tmp/openssl.err" >&2
    echo "openssl $1 failed" >&2
    exit 1
  fi
}

ca_key="$out/private/ca.key"
ca_crt="$out/ca.crt"

if [ -e "$ca_key" ] || [ -e "$ca_crt" ]; then
  if [ "$force_ca" = true ]; then
    echo "replacing the existing lab CA: every hub must be re-flashed with the new ca.crt" >&2
    rm -f "$ca_key" "$ca_crt" "$out/private/ca.srl"
  elif [ ! -e "$ca_key" ] || [ ! -e "$ca_crt" ]; then
    echo "incomplete lab CA in $out (ca.crt or private/ca.key missing); refusing to overwrite without --force-ca" >&2
    exit 1
  else
    echo "reusing the existing lab CA in $out (use --force-ca to replace it)" >&2
  fi
fi

if [ ! -e "$ca_key" ]; then
  run_openssl req -x509 -new -newkey rsa:2048 -sha256 -nodes -days "$CA_DAYS" \
    -keyout "$ca_key" -out "$ca_crt" \
    -subj "/O=Aegis lab/CN=Aegis lab MQTT CA" \
    -addext "basicConstraints=critical,CA:TRUE,pathlen:0" \
    -addext "keyUsage=critical,keyCertSign,cRLSign" \
    -addext "subjectKeyIdentifier=hash"
  chmod 0600 "$ca_key"
  chmod 0644 "$ca_crt"
  echo "created lab CA $ca_crt (valid $CA_DAYS days)" >&2
fi

cat > "$tmp/server.ext" <<EOF
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=$san
subjectKeyIdentifier=hash
authorityKeyIdentifier=keyid
EOF

run_openssl req -new -newkey rsa:2048 -sha256 -nodes \
  -keyout "$tmp/server.key" -out "$tmp/server.csr" \
  -subj "/O=Aegis lab/CN=Aegis MQTT broker"
run_openssl x509 -req -sha256 -days "$SERVER_DAYS" \
  -in "$tmp/server.csr" -CA "$ca_crt" -CAkey "$ca_key" \
  -CAserial "$out/private/ca.srl" -CAcreateserial \
  -extfile "$tmp/server.ext" -out "$tmp/server.crt"
openssl verify -CAfile "$ca_crt" "$tmp/server.crt" >/dev/null

mv "$tmp/server.key" "$out/broker/server.key"
mv "$tmp/server.crt" "$out/broker/server.crt"
cp "$ca_crt" "$out/broker/ca.crt"
chmod 0600 "$out/broker/server.key"
chmod 0644 "$out/broker/server.crt" "$out/broker/ca.crt"

echo "issued $out/broker/server.crt (valid $SERVER_DAYS days) for $san" >&2
echo "public CA to flash on the hub and give to clients: $ca_crt" >&2
echo "never copy $ca_key or $out/broker/server.key anywhere else" >&2
