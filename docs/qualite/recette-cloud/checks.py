#!/usr/bin/env python3
"""Cloud acceptance checks against a running Aegis Control, its PostgreSQL and its broker.

Run by run.sh, which starts the disposable stack, the API and the hub simulator.
Standard library only. Every check prints PASS or FAIL with the observed evidence;
the exit status is the number of failed checks (0 when all pass).

Environment (set by run.sh):
  RECETTE_API                 base URL, e.g. http://127.0.0.1:18080/api/v1
  AEGIS_DEMO_ADMIN_PASSWORD   disposable admin password (never printed)
  AEGIS_DEMO_TECHNICIAN_PASSWORD
  RECETTE_PSQL                command prefix reading SQL on stdin, e.g. "docker exec -i <pg> psql -U aegis -d aegis -tA"
  RECETTE_SIM_PID             PID of the running hub simulator
  RECETTE_PHASE               "catalog" (before the simulator) or "physical" (after it started)
"""

import json
import os
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

API = os.environ.get("RECETTE_API", "http://127.0.0.1:18080/api/v1")
LOCKER = "d46a74ae-39dc-460b-8af0-38fc791b376a"
A1 = "1ae77ae3-8490-4f09-9412-a7816b77bff9"
A2 = "5c1d0b7e-2f4a-4d3b-9a61-0e8b7c2d4f10"
# Tags placed by tools/hub-simulator/scenarios/presence-demo-local.json.
TAG_A1 = "E20034120123456789000001"
TAG_A2 = "E20034120123456789000002"
STATE = os.path.join(os.environ.get("RECETTE_DIR", "."), "state.json")

failures = 0


def check(name, ok, evidence):
    global failures
    if not ok:
        failures += 1
    print(f"{'PASS' if ok else 'FAIL'}  {name}  ::  {evidence}", flush=True)


def call(method, path, token=None, body=None, idempotent=False):
    headers = {"Accept": "application/json"}
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if idempotent:
        headers["Idempotency-Key"] = str(uuid.uuid4())
    request = urllib.request.Request(API + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            text = response.read().decode()
            return response.status, json.loads(text) if text else None
    except urllib.error.HTTPError as error:
        text = error.read().decode()
        try:
            return error.code, json.loads(text) if text else None
        except json.JSONDecodeError:
            return error.code, {"raw": text[:200]}


def code_of(body):
    return (body or {}).get("code") or (body or {}).get("error", {}).get("code")


def login(email, password):
    status, body = call("POST", "/auth/login", body={"email": email, "password": password})
    if status != 200:
        sys.exit(f"login failed for {email}: {status} {code_of(body)}")
    return body["accessToken"]


def sql(query):
    prefix = os.environ["RECETTE_PSQL"].split()
    return subprocess.run(prefix, input=query, capture_output=True, text=True, check=True).stdout.strip()


def tech_asset(tech, asset_id):
    return call("GET", f"/assets/{asset_id}", tech)


def catalog_phase(admin, tech):
    suffix = uuid.uuid4().hex[:6].upper()
    status, model = call("POST", "/admin/asset-models", admin, {
        "name": f"Recette multimètre {suffix}", "manufacturer": "Fluke", "modelNumber": "117",
        "description": "Modèle jetable de la recette cloud", "defaultCalibrationRequired": True}, True)
    check("R1.1 Manager creates a model", status == 201, f"HTTP {status}")

    def asset_body(code, serial, op="SERVICEABLE"):
        return {"assetModelId": model["id"], "assetCode": code, "serialNumber": serial,
                "requiredAccessLevel": "STANDARD", "operationalStatus": op,
                "calibrationRequired": True, "calibrationDueAt": "2027-06-30T04:00:00Z"}

    code1, code2 = f"REC-{suffix}-1", f"REC-{suffix}-2"
    status, asset1 = call("POST", "/admin/assets", admin, asset_body(code1, f"SN-{suffix}-1"), True)
    check("R1.2 Manager creates asset 1", status == 201, f"HTTP {status} {code1}")
    status, asset2 = call("POST", "/admin/assets", admin, asset_body(code2, f"SN-{suffix}-2"), True)
    check("R1.3 Manager creates asset 2", status == 201, f"HTTP {status} {code2}")

    status, view = tech_asset(tech, asset1["id"])
    check("R1.4 technician reads the new asset", status == 200 and view["assetCode"] == code1,
          f"HTTP {status} {view.get('assetCode')} readiness={view['readiness']['result']} {view['readiness']['reasons']}")

    status, _ = call("PUT", f"/admin/assets/{asset1['id']}", admin, asset_body(code1, f"SN-{suffix}-1", "MAINTENANCE"))
    _, view = tech_asset(tech, asset1["id"])
    check("R1.5 Manager edit is visible to the technician",
          status == 200 and view["operationalStatus"] == "MAINTENANCE"
          and "MAINTENANCE" in view["readiness"]["reasons"],
          f"PUT HTTP {status}; technician sees {view['operationalStatus']} {view['readiness']['result']} {view['readiness']['reasons']}")
    call("PUT", f"/admin/assets/{asset1['id']}", admin, asset_body(code1, f"SN-{suffix}-1"))

    status, body = call("GET", "/admin/assets", tech)
    check("R1.6 technician is refused the admin catalogue", status == 403, f"HTTP {status} {code_of(body)}")
    status, body = call("GET", "/assets", admin)
    check("R1.7 admin is refused the technician catalogue", status == 403, f"HTTP {status} {code_of(body)}")

    status, _ = call("POST", f"/admin/assets/{asset1['id']}/identifiers", admin, {"type": "RFID_UHF", "value": TAG_A1}, True)
    check("R2.1 RFID identifier bound to asset 1", status == 201, f"HTTP {status}")
    status, body = call("POST", f"/admin/assets/{asset2['id']}/identifiers", admin, {"type": "RFID_UHF", "value": TAG_A1}, True)
    check("R2.2 same RFID on asset 2 is refused", status == 409 and code_of(body) == "IDENTIFIER_ALREADY_ASSIGNED",
          f"HTTP {status} {code_of(body)}")
    status, _ = call("POST", f"/admin/assets/{asset2['id']}/identifiers", admin, {"type": "RFID_UHF", "value": TAG_A2}, True)
    check("R2.3 distinct RFID bound to asset 2", status == 201, f"HTTP {status}")

    status, _ = call("PUT", f"/admin/assets/{asset1['id']}/placement", admin, {"compartmentId": A1, "reason": "Recette cloud"})
    check("R2.4 asset 1 placed in A1", status == 200, f"HTTP {status}")
    status, body = call("PUT", f"/admin/assets/{asset2['id']}/placement", admin, {"compartmentId": A1, "reason": "Recette cloud"})
    check("R2.5 second asset in occupied A1 is refused", status == 409 and code_of(body) == "COMPARTMENT_ALREADY_OCCUPIED",
          f"HTTP {status} {code_of(body)}")
    status, _ = call("PUT", f"/admin/assets/{asset2['id']}/placement", admin, {"compartmentId": A2, "reason": "Recette cloud"})
    check("R2.6 asset 2 placed in A2", status == 200, f"HTTP {status}")
    _, view = tech_asset(tech, asset1["id"])
    placement = (view.get("placement") or {}).get("compartmentCode")
    check("R2.7 technician sees the placement and no presence yet",
          placement == "A1" and view["presence"] != "PRESENT" and view["readiness"]["result"] != "READY",
          f"placement={placement} presence={view['presence']} readiness={view['readiness']['result']} {view['readiness']['reasons']}")

    with open(STATE, "w", encoding="utf-8") as out:
        json.dump({"asset1": asset1["id"], "asset2": asset2["id"], "code1": code1}, out)

    search_corpus(tech)


def search_corpus(tech):
    """Replays the shared search corpus of #109 (doc 09, section 22.3) against the technician catalogue, if present."""
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "cahier-conception",
                        "09-corpus-recherche-q.json")
    if not os.path.exists(path):
        print("SKIP  R7 search corpus  ::  docs/cahier-conception/09-corpus-recherche-q.json is not on this branch", flush=True)
        return
    with open(path, encoding="utf-8") as source:
        cases = json.load(source)["cases"]
    mismatches = []
    for case in cases:
        text = "".join(part["text"] * part.get("times", 1) for part in case["parts"])
        status, body = call("GET", "/assets?size=1&q=" + urllib.parse.quote(text, safe=""), tech)
        codes = sorted({v.get("code") for v in (body or {}).get("violations", []) if v.get("field") == "q"})
        observed = "VALID" if status == 200 else (codes[0] if status == 400 and len(codes) == 1 else f"HTTP {status} {codes}")
        if observed != case["result"]:
            mismatches.append(f"{case['id']}: expected {case['result']}, got {observed}")
    check(f"R7 API answers the {len(cases)} cases of the shared search corpus", not mismatches,
          "; ".join(mismatches[:5]) or f"{len(cases)}/{len(cases)} as expected")


def schedule(enabled_today):
    days = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"]
    return {"timeZone": "America/Toronto", "windows": [
        {"dayOfWeek": day, "enabled": enabled_today, "opensAt": "00:00" if enabled_today else None,
         "closesAt": "23:59" if enabled_today else None} for day in days]}


def physical_phase(admin, tech):
    with open(STATE, encoding="utf-8") as source:
        state = json.load(source)
    asset1 = state["asset1"]

    deadline = time.time() + 90
    status_body, view = None, None
    while time.time() < deadline:
        _, status_body = call("GET", f"/lockers/{LOCKER}/status", tech)
        _, view = tech_asset(tech, asset1)
        if status_body.get("connectionStatus") == "ONLINE" and view["presence"] == "PRESENT":
            break
        time.sleep(3)
    check("R4.1 heartbeat gives an ONLINE locker", status_body.get("connectionStatus") == "ONLINE",
          f"locker={status_body.get('connectionStatus')} lastSeenAt={status_body.get('lastSeenAt')} "
          f"A1={[(c['code'], c['doorState'], c['lockState']) for c in status_body.get('compartments', [])]}")
    check("R4.2 scan of the bound tag gives PRESENT and READY", view["presence"] == "PRESENT" and view["readiness"]["result"] == "READY",
          f"presence={view['presence']} readiness={view['readiness']['result']} {view['readiness']['reasons']}")

    status, body = call("PUT", f"/admin/lockers/{LOCKER}/operating-schedule", admin, schedule(False))
    check("R3.1 Manager stores a closed schedule", status == 200, f"HTTP {status} {code_of(body)}")
    until = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() + 3600))
    commands_before = sql("SELECT count(*) FROM aegis.command_outbox;")
    operations_before = sql("SELECT count(*) FROM aegis.locker_operations;")
    status, body = call("POST", "/reservations", tech, {"assetId": asset1, "reservedUntil": until}, True)
    # Document 09, section 14.1 step 6: 422 OUTSIDE_OPERATING_HOURS.
    check("R3.2 reservation outside opening hours is refused", status == 422 and code_of(body) == "OUTSIDE_OPERATING_HOURS",
          f"HTTP {status} {code_of(body)}")

    status, body = call("PUT", f"/admin/lockers/{LOCKER}/operating-schedule", admin, schedule(True))
    check("R3.3 Manager opens the locker every day", status == 200, f"HTTP {status} {code_of(body)}")
    _, locker = call("GET", f"/lockers/{LOCKER}/status", tech)
    check("R3.4 the technician sees the open window", (locker.get("currentWindow") or {}).get("open") is True,
          f"currentWindow={locker.get('currentWindow')}")
    too_late = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() + 2 * 86400))
    status, body = call("POST", "/reservations", tech, {"assetId": asset1, "reservedUntil": too_late}, True)
    check("R3.5 reservation ending after closing is refused", status == 422 and code_of(body) == "RESERVATION_END_AFTER_CLOSING",
          f"HTTP {status} {code_of(body)}")
    status, reservation = call("POST", "/reservations", tech, {"assetId": asset1, "reservedUntil": until}, True)
    reservation_ok = status == 201
    check("R5.1 reservation inside opening hours is created", reservation_ok,
          f"HTTP {status} {code_of(reservation) or reservation.get('status')}")
    commands_after = sql("SELECT count(*) FROM aegis.command_outbox;")
    operations_after = sql("SELECT count(*) FROM aegis.locker_operations;")
    check("R5.2 the reservation creates no opening command and no operation",
          reservation_ok and commands_after == commands_before and operations_after == operations_before,
          f"command_outbox {commands_before}->{commands_after}; operations {operations_before}->{operations_after}")
    _, view = tech_asset(tech, asset1)
    check("R5.3 the asset reads RESERVED", view["availability"] == "RESERVED",
          f"availability={view['availability']} readiness={view['readiness']['result']} {view['readiness']['reasons']}")

    pid = int(os.environ["RECETTE_SIM_PID"])
    os.kill(pid, signal.SIGSTOP)
    print(f"      simulator {pid} frozen (SIGSTOP): heartbeats stop without a disconnect", flush=True)
    time.sleep(36)
    _, locker = call("GET", f"/lockers/{LOCKER}/status", tech)
    _, admin_view = call("GET", f"/admin/assets/{asset1}", admin)
    check("R6.1 a heartbeat gap over 30 s gives an OFFLINE locker", locker.get("connectionStatus") == "OFFLINE",
          f"locker={locker.get('connectionStatus')} lastSeenAt={locker.get('lastSeenAt')} evaluatedAt={locker.get('evaluatedAt')}")
    check("R6.2 the continuity loss voids the scan: presence UNKNOWN", (admin_view or {}).get("presence") == "UNKNOWN",
          f"presence={(admin_view or {}).get('presence')}")
    os.kill(pid, signal.SIGCONT)

    if reservation_ok:
        status, _ = call("POST", f"/reservations/{reservation['id']}/cancel", tech, {}, True)
        print(f"      cleanup: reservation cancelled, HTTP {status}", flush=True)


def main():
    admin = login(os.environ.get("AEGIS_DEMO_ADMIN_EMAIL", "admin@aegis.demo"), os.environ["AEGIS_DEMO_ADMIN_PASSWORD"])
    tech = login(os.environ.get("AEGIS_DEMO_TECHNICIAN_EMAIL", "technician@aegis.demo"), os.environ["AEGIS_DEMO_TECHNICIAN_PASSWORD"])
    phase = os.environ.get("RECETTE_PHASE", "catalog")
    if phase == "catalog":
        catalog_phase(admin, tech)
    else:
        physical_phase(admin, tech)
    print(f"{phase}: {failures} failed check(s)", flush=True)
    return failures


if __name__ == "__main__":
    sys.exit(main())
