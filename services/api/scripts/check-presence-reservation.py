#!/usr/bin/env python3
"""Run the presence and reservation journey against a running API, PostgreSQL and broker.

It validates the software with simulated observations only: it is not a
qualification of the real RFID reader or of the locker.

Two phases:
  online   (default) the hub simulator publishes and A1 is observed. Checks the
           status, the catalog (A1 READY, A2 BLOCKED by calibration), the
           reservation of A1, its cancellation with an idempotent replay, a
           short reservation that the server expires, the refusal of A2, the
           audit rows, and the MQTT evidence kept by the API.
  offline  the simulator has been stopped for more than 30 seconds. Checks
           that the hub is no longer ONLINE and that A1 can no longer be
           reserved.

Each phase exits non-zero on the first unreachable service and on any
difference; nothing is skipped. The audit and MQTT evidence have no read
route: they are read from PostgreSQL in a read-only transaction.

Environment:
  AEGIS_DEMO_ADMIN_PASSWORD       required; never printed
  AEGIS_DEMO_TECHNICIAN_PASSWORD  required; never printed
  AEGIS_RECIPE_DB_NAME            required; the dedicated recipe database
  AEGIS_RECIPE_DB_CONTAINER       default aegis-dev-postgres-1
  AEGIS_API_URL                   default http://127.0.0.1:8080/api/v1
  AEGIS_DEMO_ADMIN_EMAIL          default admin@aegis.demo
  AEGIS_DEMO_TECHNICIAN_EMAIL     default technician@aegis.demo

Run it after scripts/seed-demo-catalog.py, while the hub simulator plays
scenarios/presence-demo-local.json (10 minutes of presence for one
connection). When the locker has no active schedule, the online phase sets a
whole-day test schedule through the administrative API; it never replaces an
existing one.
"""

import argparse
import datetime
import os
import subprocess
import sys
import time
import urllib.error
import uuid

# python3 -I leaves the script directory out of sys.path; it is appended after
# the standard library so that the shared client loads without shadowing it.
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from aegis_http import API, send as call  # noqa: E402

LOCKER_ID = "d46a74ae-39dc-460b-8af0-38fc791b376a"
READY_CODE = "AEG-DEMO-001"
CALIBRATION_CODE = "AEG-DEMO-002"
SHORT_RESERVATION = datetime.timedelta(seconds=20)
# The expiry job runs every 15 seconds; the margin covers one missed run.
EXPIRY_DEADLINE = datetime.timedelta(seconds=45)

failures = []


def check(step, expected, observed):
    passed = observed == expected
    print(f"  {step}\n    attendu : {expected}\n    observé : {observed}\n    {'ok' if passed else 'ÉCART'}")
    if not passed:
        failures.append(step)
    return passed


def error_of(status, payload):
    reasons = payload.get("reasons")
    suffix = f" {reasons}" if reasons else ""
    return f"{status} {payload.get('code') or ''}{suffix}".rstrip()


def instant(delta):
    moment = datetime.datetime.now(datetime.timezone.utc) + delta
    return moment.replace(microsecond=0).isoformat().replace("+00:00", "Z")


def login(variable, default_email):
    password = os.environ.get(variable)
    if not password:
        sys.exit(f"{variable} est requis.")
    email = os.environ.get(variable.replace("PASSWORD", "EMAIL"), default_email)
    status, session = call("POST", "/auth/login", body={"email": email, "password": password})
    if status != 200:
        sys.exit(f"Connexion de {email} refusée : {error_of(status, session)}")
    return session["accessToken"]


def query(sql):
    """Rows of one read-only statement in the recipe database; the transaction cannot write."""
    database = os.environ.get("AEGIS_RECIPE_DB_NAME")
    if not database:
        sys.exit("AEGIS_RECIPE_DB_NAME est requis : la preuve d'audit se lit dans la base de recette.")
    container = os.environ.get("AEGIS_RECIPE_DB_CONTAINER", "aegis-dev-postgres-1")
    result = subprocess.run(
        ["docker", "exec", "-e", "PGOPTIONS=-c default_transaction_read_only=on", container,
         "psql", "-U", "aegis", "-d", database, "-v", "ON_ERROR_STOP=1", "-At", "-F", "|", "-c", sql],
        capture_output=True, text=True, check=False)
    if result.returncode != 0:
        sys.exit(f"Lecture PostgreSQL impossible ({container}/{database}) : {result.stderr.strip()}")
    return [line.split("|") for line in result.stdout.splitlines() if line]


def asset(token, code):
    status, page = call("GET", f"/assets?q={code}&page=0&size=10", token)
    found = [a for a in page.get("items", []) if a["assetCode"] == code] if status == 200 else []
    if not found:
        sys.exit(f"{code} est absent du catalogue technicien : lancer d'abord seed-demo-catalog.py.")
    return found[0]


def readiness(item):
    return f"{item['readiness']['result']} {item['readiness']['reasons']}"


def reserve(token, asset_id, until):
    return call("POST", "/reservations", token, {"assetId": asset_id, "reservedUntil": until}, str(uuid.uuid4()))


def ensure_schedule(admin):
    path = f"/admin/lockers/{LOCKER_ID}/operating-schedule"
    status, schedule = call("GET", path, admin)
    if status == 200 and any(window.get("enabled") for window in schedule.get("windows", [])):
        print(f"  Horaire actif conservé ({schedule.get('timeZone')}).")
        return
    days = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"]
    body = {"timeZone": "America/Toronto",
            "windows": [{"dayOfWeek": day, "enabled": True, "opensAt": "00:00:00", "closesAt": "23:59:59"}
                        for day in days]}
    status, payload = call("PUT", path, admin, body)
    if status != 200:
        sys.exit(f"Horaire de test refusé : {error_of(status, payload)}")
    print("  Horaire de test posé : tous les jours de 00:00:00 à 23:59:59, America/Toronto.")


def audit_of(reservation_id):
    rows = query("SELECT event_type FROM aegis.audit_events WHERE subject_type = 'RESERVATION' "
                 f"AND subject_id = '{reservation_id}' ORDER BY occurred_at, event_type")
    return [row[0] for row in rows]


def online(admin, technician):
    print("Horaire")
    ensure_schedule(admin)

    print("État du casier")
    status, locker = call("GET", f"/lockers/{LOCKER_ID}/status", technician)
    check("Connexion du hub", "200 ONLINE", f"{status} {locker.get('connectionStatus')}")

    print("Catalogue")
    ready, blocked = asset(technician, READY_CODE), asset(technician, CALIBRATION_CODE)
    check(f"{READY_CODE} présent et prêt", "PRESENT READY [] AVAILABLE",
          f"{ready['presence']} {readiness(ready)} {ready['availability']}")
    check(f"{CALIBRATION_CODE} bloqué par la calibration", "BLOCKED ['CALIBRATION_EXPIRED']", readiness(blocked))

    print("Réservation puis annulation")
    check("Aucune réservation courante", "404 ACTIVE_RESERVATION_NOT_FOUND",
          error_of(*call("GET", "/me/reservation", technician)))
    status, created = reserve(technician, ready["id"], instant(datetime.timedelta(minutes=10)))
    if not check(f"Réservation de {READY_CODE}", "201 ACTIVE ['CANCEL']",
                 f"{status} {created.get('status')} {created.get('availableActions')}"):
        sys.exit(f"Réservation refusée : {error_of(status, created)}")
    status, current = call("GET", "/me/reservation", technician)
    check("Mon activité montre la réservation", f"200 {created['id']}", f"{status} {current.get('id')}")
    check(f"{READY_CODE} réservé", "RESERVED", asset(technician, READY_CODE)["availability"])

    key = str(uuid.uuid4())
    path = f"/reservations/{created['id']}/cancel"
    status, cancelled = call("POST", path, technician, {}, key)
    check("Annulation", "200 CANCELLED []", f"{status} {cancelled.get('status')} {cancelled.get('availableActions')}")
    replay_status, replay = call("POST", path, technician, {}, key)
    check("Rejeu de la même annulation", f"200 {cancelled.get('cancelledAt')}",
          f"{replay_status} {replay.get('cancelledAt')}")
    check("Plus de réservation courante", "404 ACTIVE_RESERVATION_NOT_FOUND",
          error_of(*call("GET", "/me/reservation", technician)))
    check(f"{READY_CODE} de nouveau disponible", "AVAILABLE READY []",
          f"{asset(technician, READY_CODE)['availability']} {readiness(asset(technician, READY_CODE))}")
    check("Audit conservé", ["RESERVATION_CANCELLED", "RESERVATION_CREATED"], sorted(audit_of(created["id"])))

    print("Expiration côté serveur, sans changer l'heure du Mac")
    until = instant(SHORT_RESERVATION)
    status, short = reserve(technician, ready["id"], until)
    if not check(f"Réservation courte jusqu'à {until}", "201 ACTIVE",
                 f"{status} {short.get('status')}"):
        sys.exit(f"Réservation courte refusée : {error_of(status, short)}")
    deadline = time.monotonic() + (SHORT_RESERVATION + EXPIRY_DEADLINE).total_seconds()
    seen = short
    while seen.get("status") == "ACTIVE" and time.monotonic() < deadline:
        time.sleep(3)
        _, seen = call("GET", f"/reservations/{short['id']}", technician)
    check("Réservation expirée par le serveur", "EXPIRED True []",
          f"{seen.get('status')} {seen.get('expiredAt') is not None} {seen.get('availableActions')}")
    check(f"{READY_CODE} de nouveau disponible", "AVAILABLE", asset(technician, READY_CODE)["availability"])
    check("Audit de l'expiration", ["RESERVATION_CREATED", "RESERVATION_EXPIRED"], sorted(audit_of(short["id"])))

    print("Refus")
    status, refused = reserve(technician, blocked["id"], instant(datetime.timedelta(minutes=10)))
    check(f"Réservation de {CALIBRATION_CODE}", "422 ASSET_NOT_READY ['CALIBRATION_EXPIRED']",
          error_of(status, refused))

    print("Preuves MQTT conservées")
    rows = query("SELECT m.processing_status, count(*) FROM aegis.inbound_device_messages m "
                 "JOIN aegis.locker_devices d ON d.id = m.locker_device_id "
                 f"WHERE d.locker_id = '{LOCKER_ID}' GROUP BY m.processing_status ORDER BY 1")
    print(f"    messages entrants : {dict(rows)}")
    check("Messages entrants traités", True, any(row[0] == "PROCESSED" for row in rows))
    duplicates = query("SELECT count(*) FROM aegis.audit_events WHERE event_type = 'MQTT_MESSAGE_DUPLICATE_IGNORED'")
    print(f"    doublons ignorés et audités : {duplicates[0][0]}")
    print("  Non exercé ici : le garde d'un retrait incertain ou d'un prêt pendant l'expiration "
          "(tests sur fixtures seulement).")


def offline(technician):
    print("Hub arrêté")
    status, locker = call("GET", f"/lockers/{LOCKER_ID}/status", technician)
    check("Connexion du hub", True, status == 200 and locker.get("connectionStatus") in ("OFFLINE", "UNKNOWN"))
    print(f"    observé : {status} {locker.get('connectionStatus')}")
    ready = asset(technician, READY_CODE)
    check(f"{READY_CODE} sans preuve physique", "UNKNOWN ['UNKNOWN_PHYSICAL_STATE']", readiness(ready))
    status, refused = reserve(technician, ready["id"], instant(datetime.timedelta(minutes=10)))
    check(f"Réservation de {READY_CODE}", "422 ASSET_NOT_READY ['UNKNOWN_PHYSICAL_STATE']", error_of(status, refused))


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--phase", choices=["online", "offline"], default="online")
    phase = parser.parse_args().phase
    technician = login("AEGIS_DEMO_TECHNICIAN_PASSWORD", "technician@aegis.demo")
    print(f"API : {API} ; phase : {phase}")
    if phase == "online":
        online(login("AEGIS_DEMO_ADMIN_PASSWORD", "admin@aegis.demo"), technician)
    else:
        offline(technician)
    if failures:
        sys.exit(f"{len(failures)} écart(s) : " + " ; ".join(failures))
    print("Parcours conforme, avec des observations simulées : aucune qualification du RFID réel ni du casier.")


if __name__ == "__main__":
    try:
        main()
    except urllib.error.URLError as error:
        sys.exit(f"API injoignable ({API}) : {error.reason}")
