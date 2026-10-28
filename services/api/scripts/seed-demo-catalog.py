#!/usr/bin/env python3
"""Seed the demo catalog through the administrative REST API.

Going through the API keeps every rule and writes the real audit events. The
script is rerunnable: deterministic Idempotency-Key values replay earlier
creations, and an existing model, asset or identifier is reused.

Environment:
  AEGIS_DEMO_ADMIN_PASSWORD       required; never printed
  AEGIS_DEMO_TECHNICIAN_PASSWORD  optional; when set, the technician catalog
                                  is read back and summarised
  AEGIS_API_URL                   default http://127.0.0.1:8080/api/v1
  AEGIS_DEMO_ADMIN_EMAIL          default admin@aegis.demo
  AEGIS_DEMO_TECHNICIAN_EMAIL     default technician@aegis.demo

The API must run with AEGIS_DEMO_ACCOUNTS_ENABLED=true and
AEGIS_DEMO_LOCKER_ENABLED=true, so that compartments A1 and A2 exist.
"""

import json
import os
import sys
import urllib.error
import urllib.request
import uuid

API = os.environ.get("AEGIS_API_URL", "http://127.0.0.1:8080/api/v1").rstrip("/")
SEED_NAMESPACE = uuid.UUID("6f1c2a52-3b7e-4d0a-9c59-2f8e1d7a4b30")

# Fixed by the demo locker provisioning (AEGIS-DEMO-01).
COMPARTMENT_A1 = "1ae77ae3-8490-4f09-9412-a7816b77bff9"
COMPARTMENT_A2 = "5c1d0b7e-2f4a-4d3b-9a61-0e8b7c2d4f10"

MODELS = [
    {"name": "Multimètre Fluke 117", "manufacturer": "Fluke", "modelNumber": "117",
     "description": "Multimètre numérique de terrain", "defaultCalibrationRequired": True},
    {"name": "Caméra thermique FLIR E8", "manufacturer": "FLIR", "modelNumber": "E8-XT",
     "description": "Caméra d'inspection thermique", "defaultCalibrationRequired": True},
    {"name": "Clé dynamométrique Norbar TTi 60", "manufacturer": "Norbar", "modelNumber": "TTi 60",
     "description": "Clé dynamométrique 12-60 N·m", "defaultCalibrationRequired": True},
    {"name": "Lampe d'inspection Peli 2380", "manufacturer": "Peli", "modelNumber": "2380",
     "description": "Lampe torche d'inspection", "defaultCalibrationRequired": False},
]

# expected: readiness of the demo technician (maximum level STANDARD) while no physical proof exists.
ASSETS = [
    {"assetCode": "AEG-DEMO-001", "model": "Multimètre Fluke 117", "serialNumber": "FL117-0001",
     "requiredAccessLevel": "STANDARD", "operationalStatus": "SERVICEABLE",
     "calibrationRequired": True, "calibrationDueAt": "2027-04-30T04:00:00Z",
     "compartment": COMPARTMENT_A1, "rfid": "E20034120123456789000001",
     "expected": "UNKNOWN [UNKNOWN_PHYSICAL_STATE]"},
    {"assetCode": "AEG-DEMO-002", "model": "Caméra thermique FLIR E8", "serialNumber": "FLIR-E8-0002",
     "requiredAccessLevel": "STANDARD", "operationalStatus": "SERVICEABLE",
     "calibrationRequired": True, "calibrationDueAt": "2026-10-01T04:00:00Z",
     "compartment": COMPARTMENT_A2, "rfid": "E20034120123456789000002",
     "expected": "BLOCKED [CALIBRATION_EXPIRED]"},
    {"assetCode": "AEG-DEMO-003", "model": "Clé dynamométrique Norbar TTi 60", "serialNumber": "NOR-60-0003",
     "requiredAccessLevel": "RESTRICTED", "operationalStatus": "SERVICEABLE",
     "calibrationRequired": True, "calibrationDueAt": "2027-03-31T04:00:00Z",
     "compartment": None, "rfid": None,
     "expected": "BLOCKED [ACCESS_DENIED]"},
    {"assetCode": "AEG-DEMO-004", "model": "Lampe d'inspection Peli 2380", "serialNumber": None,
     "requiredAccessLevel": "STANDARD", "operationalStatus": "SERVICEABLE",
     "calibrationRequired": False, "calibrationDueAt": None,
     "compartment": None, "rfid": None,
     "expected": "UNKNOWN [UNKNOWN_PHYSICAL_STATE]"},
    {"assetCode": "AEG-DEMO-005", "model": "Multimètre Fluke 117", "serialNumber": "FL117-0005",
     "requiredAccessLevel": "STANDARD", "operationalStatus": "MAINTENANCE",
     "calibrationRequired": True, "calibrationDueAt": "2027-01-31T05:00:00Z",
     "compartment": None, "rfid": None,
     "expected": "BLOCKED [MAINTENANCE]"},
]


class ApiError(Exception):
    def __init__(self, status, body):
        super().__init__(f"HTTP {status}: {body.get('code') or body}")
        self.status = status
        self.code = body.get("code")


def call(method, path, token=None, body=None, key=None):
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
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as error:
        raw = error.read()
        try:
            payload = json.loads(raw) if raw else {}
        except ValueError:
            payload = {}
        raise ApiError(error.code, payload) from None


def seed_key(*parts):
    return str(uuid.uuid5(SEED_NAMESPACE, "/".join(parts)))


def login(email, password):
    return call("POST", "/auth/login", body={"email": email, "password": password})["accessToken"]


def ensure_models(token):
    existing = {m["name"]: m["id"] for m in call("GET", "/admin/asset-models?page=0&size=100", token)["items"]
                if m.get("archivedAt") is None}
    ids = {}
    for model in MODELS:
        if model["name"] in existing:
            ids[model["name"]] = existing[model["name"]]
            print(f"  modèle présent : {model['name']}")
            continue
        created = call("POST", "/admin/asset-models", token, model, seed_key("model", model["name"]))
        ids[model["name"]] = created["id"]
        print(f"  modèle créé    : {model['name']}")
    return ids


def ensure_asset(token, spec, model_ids):
    found = [a for a in call("GET", f"/admin/assets?q={spec['assetCode']}&page=0&size=100", token)["items"]
             if a["assetCode"] == spec["assetCode"]]
    if found:
        print(f"  actif présent  : {spec['assetCode']}")
        return found[0]["id"]
    body = {
        "assetModelId": model_ids[spec["model"]],
        "assetCode": spec["assetCode"],
        "serialNumber": spec["serialNumber"],
        "requiredAccessLevel": spec["requiredAccessLevel"],
        "operationalStatus": spec["operationalStatus"],
        "calibrationRequired": spec["calibrationRequired"],
        "calibrationDueAt": spec["calibrationDueAt"],
    }
    created = call("POST", "/admin/assets", token, body, seed_key("asset", spec["assetCode"]))
    print(f"  actif créé     : {spec['assetCode']}")
    return created["id"]


def place_and_tag(token, spec, asset_id):
    if spec["compartment"]:
        call("PUT", f"/admin/assets/{asset_id}/placement", token,
             {"compartmentId": spec["compartment"], "reason": "Jeu de démonstration du catalogue technicien"})
    if spec["rfid"]:
        try:
            call("POST", f"/admin/assets/{asset_id}/identifiers", token,
                 {"type": "RFID_UHF", "value": spec["rfid"]}, seed_key("identifier", spec["assetCode"]))
        except ApiError as error:
            if error.code != "IDENTIFIER_ALREADY_ASSIGNED":
                raise


def summarise(email, password):
    token = login(email, password)
    page = call("GET", "/assets?page=0&size=100&sort=assetCode,asc", token)
    observed = {a["assetCode"]: a for a in page["items"]}
    print(f"\nCatalogue technicien ({page['totalItems']} actifs) :")
    mismatches = 0
    for spec in ASSETS:
        asset = observed.get(spec["assetCode"])
        if asset is None:
            print(f"  {spec['assetCode']} absent")
            mismatches += 1
            continue
        readiness = f"{asset['readiness']['result']} [{', '.join(asset['readiness']['reasons'])}]"
        placement = asset["placement"]["compartmentCode"] if asset["placement"] else "-"
        status = "ok" if readiness == spec["expected"] else f"attendu {spec['expected']}"
        mismatches += readiness != spec["expected"]
        print(f"  {spec['assetCode']}  {readiness:<34} {asset['availability']:<11} {placement:<3} {status}")
    return mismatches


def main():
    password = os.environ.get("AEGIS_DEMO_ADMIN_PASSWORD")
    if not password:
        sys.exit("AEGIS_DEMO_ADMIN_PASSWORD est requis.")
    token = login(os.environ.get("AEGIS_DEMO_ADMIN_EMAIL", "admin@aegis.demo"), password)
    print(f"API : {API}")
    model_ids = ensure_models(token)
    for spec in ASSETS:
        place_and_tag(token, spec, ensure_asset(token, spec, model_ids))
    technician = os.environ.get("AEGIS_DEMO_TECHNICIAN_PASSWORD")
    if technician:
        email = os.environ.get("AEGIS_DEMO_TECHNICIAN_EMAIL", "technician@aegis.demo")
        if summarise(email, technician):
            sys.exit("Le catalogue observé diffère du jeu attendu.")


if __name__ == "__main__":
    try:
        main()
    except ApiError as error:
        sys.exit(f"Échec : {error}")
    except urllib.error.URLError as error:
        sys.exit(f"API injoignable ({API}) : {error.reason}")
