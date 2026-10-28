#!/usr/bin/env python3
"""Check that a reservation of a demo asset is refused while no physical proof exists.

This is a negative test of the recipe: a refused reservation is the expected
result, never a successful one. It asks to reserve AEG-DEMO-004, which has no
placement, so the operating-hours checks do not apply and the answer does not
depend on the time of day (document 09, section 14.1). It reads the current
reservation before and after, to show that the refusal wrote nothing.

Environment:
  AEGIS_DEMO_TECHNICIAN_PASSWORD  required; never printed
  AEGIS_API_URL                   default http://127.0.0.1:8080/api/v1
  AEGIS_DEMO_TECHNICIAN_EMAIL     default technician@aegis.demo

Run it after scripts/seed-demo-catalog.py. It exits non-zero on any difference.
"""

import datetime
import json
import os
import sys
import urllib.error
import urllib.request
import uuid

API = os.environ.get("AEGIS_API_URL", "http://127.0.0.1:8080/api/v1").rstrip("/")
ASSET_CODE = "AEG-DEMO-004"


def call(method, path, token=None, body=None, key=None):
    """Return (status, payload) for any HTTP answer; only a transport failure raises."""
    request = urllib.request.Request(API + path, method=method)
    request.add_header("Accept", "application/json")
    if token:
        request.add_header("Authorization", "Bearer " + token)
    if key:
        request.add_header("Idempotency-Key", key)
    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        request.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(request, data, timeout=10) as response:
            raw = response.read()
            return response.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as error:
        raw = error.read()
        try:
            return error.code, json.loads(raw) if raw else {}
        except ValueError:
            return error.code, {}


def describe(status, payload):
    reasons = payload.get("reasons")
    suffix = f" {reasons}" if reasons else ""
    return f"{status} {payload.get('code') or payload.get('status') or ''}{suffix}".rstrip()


def check(step, expected, status, payload):
    observed = describe(status, payload)
    passed = observed == expected
    print(f"  {step}\n    attendu : {expected}\n    observé : {observed}\n    {'ok' if passed else 'ÉCART'}")
    return passed


def main():
    password = os.environ.get("AEGIS_DEMO_TECHNICIAN_PASSWORD")
    if not password:
        sys.exit("AEGIS_DEMO_TECHNICIAN_PASSWORD est requis.")
    email = os.environ.get("AEGIS_DEMO_TECHNICIAN_EMAIL", "technician@aegis.demo")
    status, session = call("POST", "/auth/login", body={"email": email, "password": password})
    if status != 200:
        sys.exit(f"Connexion technicien refusée : {describe(status, session)}")
    token = session["accessToken"]
    print(f"API : {API}")

    status, page = call("GET", f"/assets?q={ASSET_CODE}&page=0&size=10", token)
    found = [a for a in page.get("items", []) if a["assetCode"] == ASSET_CODE] if status == 200 else []
    if not found:
        sys.exit(f"{ASSET_CODE} est absent du catalogue technicien : lancer d'abord seed-demo-catalog.py.")
    asset = found[0]

    results = [check("Réservation courante avant la demande", "404 ACTIVE_RESERVATION_NOT_FOUND",
                     *call("GET", "/me/reservation", token))]
    until = (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=1)).replace(microsecond=0)
    body = {"assetId": asset["id"], "reservedUntil": until.isoformat().replace("+00:00", "Z")}
    status, payload = call("POST", "/reservations", token, body, str(uuid.uuid4()))
    results.append(check(f"Réservation de {ASSET_CODE} jusqu'à {body['reservedUntil']}",
                         "422 ASSET_NOT_READY ['UNKNOWN_PHYSICAL_STATE']", status, payload))
    if status == 201:
        print("    Une réservation a été créée : le test négatif échoue. Elle reste active, "
              "aucune annulation n'existe avant RES-02.")
    results.append(check("Réservation courante après la demande", "404 ACTIVE_RESERVATION_NOT_FOUND",
                         *call("GET", "/me/reservation", token)))
    if not all(results):
        sys.exit("Le refus observé diffère du refus attendu.")
    print("Refus attendu : aucune réservation créée, aucun actif READY sans preuve physique.")


if __name__ == "__main__":
    try:
        main()
    except urllib.error.URLError as error:
        sys.exit(f"API injoignable ({API}) : {error.reason}")
