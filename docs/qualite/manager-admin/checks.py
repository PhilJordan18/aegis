#!/usr/bin/env python3
"""Manager administrative reads acceptance (#48, #52, #53) against a running Aegis Control and its PostgreSQL.

Run by run.sh. Standard library only. Each check prints one line:
  PASS / FAIL   the behaviour was observed / contradicted, with the evidence;
  ABSENT        the route is not served by the API under test, so its checks did not run (never a pass);
  INFO          a contract gap: the observed value is recorded, no verdict (document 09 leaves it open).
The exit status is failures + absent route groups, so a partial API never reads as accepted.

Phases (QA_PHASE): "empty" before any data, "setup" for the real business flows, "matrix" after the
synthetic seed. Identifiers starting with 5eed0000- are synthetic (seed-synthetic.sql).
"""

import calendar
import json
import os
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

API = os.environ.get("QA_API", "http://127.0.0.1:18081/api/v1")
STATE = os.path.join(os.environ.get("QA_DIR", "."), "state.json")
LOCKER = "d46a74ae-39dc-460b-8af0-38fc791b376a"
A1, A2 = "1ae77ae3-8490-4f09-9412-a7816b77bff9", "5c1d0b7e-2f4a-4d3b-9a61-0e8b7c2d4f10"
TAG_A1, TAG_A2 = "E20034120123456789000001", "E20034120123456789000002"
SENTINELS = ("QA-RAW-SENTINEL", "QA-SECRET-SENTINEL", "!synthetic-account-without-password", "$2a$", "$2b$")
RAW_TAGS = (TAG_A1, TAG_A2, "E2005EED")


def syn(suffix):
    return f"5eed0000-0000-4000-8000-{suffix:0>12}"


TECH_B = syn("101")
SYN_ASSET = {name: syn(str(300 + n)) for n, name in enumerate(
    ["", "loan-active", "loan-overdue", "loan-done", "anom-open", "anom-ack", "anom-target", "op-failed",
     "anom-resolved"]) if name}
OP = {n: syn(str(600 + n)) for n in (1, 2, 3, 4, 5, 7, 8, 13)}
LOAN_ACTIVE, LOAN_OVERDUE, LOAN_DONE = syn("701"), syn("702"), syn("703")
AN_OPEN, AN_ACK, AN_TARGET, AN_RESOLVED = syn("b04"), syn("b05"), syn("b06"), syn("b08")
OBS_OPEN = syn("901")

counts = {"PASS": 0, "FAIL": 0, "ABSENT": 0, "INFO": 0}
bodies = []
ROUTE_CHARACTERS = set("abcdefghijklmnopqrstuvwxyz0123456789-")


def report(verdict, name, evidence):
    counts[verdict] += 1
    print(f"{verdict:<6} {name}  ::  {evidence}", flush=True)


def check(name, ok, evidence):
    report("PASS" if ok else "FAIL", name, evidence)
    return ok


def call(method, path, token=None, body=None, key=None, raw_key=False):
    """key: an Idempotency-Key value, or True for a fresh one. Bodies are kept for the leakage check."""
    route, _, query = path.partition("?")
    if not (route.startswith("/") and all(s and set(s) <= ROUTE_CHARACTERS for s in route.split("/")[1:])):
        raise ValueError(f"refused route {route!r}")
    headers = {"Accept": "application/json"}
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if key:
        headers["Idempotency-Key"] = str(uuid.uuid4()) if key is True else key
    request = urllib.request.Request(API + route + ("?" + query if query else ""), data=data, method=method,
                                     headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            status, text = response.status, response.read().decode()
    except urllib.error.HTTPError as error:
        status, text = error.code, error.read().decode()
    bodies.append((f"{method} {route}", text))
    try:
        return status, json.loads(text) if text else None
    except json.JSONDecodeError:
        return status, {"raw": text[:200]}


def code_of(body):
    return (body or {}).get("code") or ((body or {}).get("error") or {}).get("code")


def sql(query):
    prefix = os.environ["QA_PSQL"].split()
    return subprocess.run(prefix, input=query, capture_output=True, text=True, check=True).stdout.strip()


def sql_set(query):
    return {line for line in sql(query).splitlines() if line}


def login(email, password):
    status, body = call("POST", "/auth/login", body={"email": email, "password": password})
    if status != 200:
        sys.exit(f"login failed for {email}: {status} {code_of(body)}")
    return body["accessToken"]


def served(admin, route, label):
    """A list route the API does not serve answers 404 to an admin; its whole group is then reported ABSENT."""
    status, body = call("GET", route, admin)
    if status == 404:
        report("ABSENT", label, f"GET {route} -> 404 {code_of(body)}: not served by this API, checks not run")
        return False
    return True


def items(body):
    return (body or {}).get("items") or []


def ids(body):
    return [item.get("id") for item in items(body)]


def walk_pages(admin, route, query, size):
    """All ids of a page/size list, page by page, until totalPages."""
    seen, page, total = [], 0, None
    while page < 1000:
        status, body = call("GET", f"{route}?{query}&page={page}&size={size}".replace("?&", "?"), admin)
        if status != 200:
            return seen, total, f"page {page}: HTTP {status} {code_of(body)}"
        total = body.get("totalItems")
        seen += ids(body)
        page += 1
        if page >= (body.get("totalPages") or 0):
            return seen, total, None
    return seen, total, "no end after 1000 pages"


def access_matrix(admin, tech, label, route, detail_route):
    status, body = call("GET", route)
    check(f"{label}: anonymous list is 401", status == 401, f"HTTP {status} {code_of(body)}")
    status, body = call("GET", route, tech)
    check(f"{label}: technician list is 403 FORBIDDEN", status == 403 and code_of(body) == "FORBIDDEN",
          f"HTTP {status} {code_of(body)}")
    if detail_route:
        missing = str(uuid.uuid4())
        status, body = call("GET", f"{detail_route}/{missing}", admin)
        check(f"{label}: missing detail is 404 RESOURCE_NOT_FOUND",
              status == 404 and code_of(body) == "RESOURCE_NOT_FOUND", f"HTTP {status} {code_of(body)}")
        status, body = call("GET", f"{detail_route}/not-a-uuid", admin)
        check(f"{label}: malformed id is 400", status == 400, f"HTTP {status} {code_of(body)}")
        status, body = call("GET", f"{detail_route}/{missing}", tech)
        check(f"{label}: technician detail is 403", status == 403, f"HTTP {status} {code_of(body)}")


def invalid_filters(admin, label, route, filters):
    for query in filters:
        status, body = call("GET", f"{route}?{query}", admin)
        # D3 as approved (#67 6800639533): violations[].code INVALID_VALUE on the field, not a top-level code.
        field = query.split("=", 1)[0]
        found = [(v.get("field"), v.get("code")) for v in ((body or {}).get("violations") or [])]
        check(f"{label}: invalid filter {query} is 400 VALIDATION_ERROR with {field} INVALID_VALUE (D3)",
              status == 400 and code_of(body) == "VALIDATION_ERROR" and (field, "INVALID_VALUE") in found,
              f"HTTP {status} {code_of(body)} violations={found}")


def paging(admin, label, route, query, size, expected):
    first, total, error = walk_pages(admin, route, query, size)
    second, _, error2 = walk_pages(admin, route, query, size)
    check(f"{label}: paging {query or '(no filter)'} size={size} has no duplicate and no omission",
          not error and len(first) == len(set(first)) and set(first) == expected and total == len(expected),
          error or f"{len(first)} ids over pages, {len(set(first))} distinct, totalItems={total}, "
                   f"expected {len(expected)} from SQL, missing={len(expected - set(first))}, "
                   f"extra={len(set(first) - expected)}")
    check(f"{label}: paging {query or '(no filter)'} is stable across two walks", not error2 and first == second,
          error2 or "same order" if first == second else "order differs between two identical walks")


def filtered(admin, label, route, query, expected):
    status, body = call("GET", f"{route}?{query}&size=100", admin)
    got = set(ids(body))
    return check(f"{label}: filter {query}", status == 200 and got == expected,
                 f"HTTP {status} {len(got)} item(s), expected {len(expected)}; "
                 f"missing={sorted(expected - got)[:3]} extra={sorted(got - expected)[:3]}")


def fingerprint():
    return sql("""SELECT md5(string_agg(x, ',' ORDER BY x)) FROM (
        SELECT 'r' || id || status FROM aegis.reservations UNION ALL
        SELECT 'l' || id || status || coalesce(returned_at::text, '') FROM aegis.loans UNION ALL
        SELECT 'o' || id || status FROM aegis.locker_operations UNION ALL
        SELECT 'a' || id || status || coalesce(acknowledged_at::text, '') FROM aegis.anomalies UNION ALL
        SELECT 's' || id || updated_at FROM aegis.assets UNION ALL
        SELECT 'p' || id || coalesce(removed_at::text, '') FROM aegis.asset_placements) t(x);""")


# --- phases -------------------------------------------------------------------------------------------------

def empty_phase(admin, tech):
    for label, route in (("M0.1 reservations", "/admin/reservations"), ("M0.2 loans", "/admin/loans"),
                         ("M0.3 operations", "/admin/locker-operations"), ("M0.4 anomalies", "/admin/anomalies")):
        if served(admin, route, label):
            status, body = call("GET", route, admin)
            check(f"{label}: empty database lists nothing", status == 200 and items(body) == []
                  and body.get("totalItems") == 0, f"HTTP {status} totalItems={(body or {}).get('totalItems')}")
            status, body = call("GET", f"{route}?page=5&size=10", admin)
            check(f"{label}: a page past the end is 200 and empty", status == 200 and items(body) == [],
                  f"HTTP {status} {len(items(body))} item(s)")
    if served(admin, "/admin/audit-events", "M0.5 audit"):
        status, body = call("GET", "/admin/audit-events?subjectType=ANOMALY", admin)
        check("M0.5 audit: no anomaly event on an empty database",
              status == 200 and items(body) == [] and body.get("hasMore") is False and body.get("nextCursor") is None,
              f"HTTP {status} items={len(items(body))} hasMore={(body or {}).get('hasMore')} "
              f"nextCursor={(body or {}).get('nextCursor')}")


def setup_phase(admin, tech):
    """Real business flows only: catalogue, identifiers, placements, schedule, reservations."""
    suffix = uuid.uuid4().hex[:6].upper()
    status, model = call("POST", "/admin/asset-models", admin, {
        "name": f"QA Manager multimètre {suffix}", "manufacturer": "Fluke", "modelNumber": "117",
        "description": "Modèle jetable de la recette Manager", "defaultCalibrationRequired": False}, key=True)
    check("S1 Manager creates a model (real flow)", status == 201, f"HTTP {status}")
    assets = []
    for n, (tag, cell) in enumerate(((TAG_A1, A1), (TAG_A2, A2)), 1):
        code = f"REC-{suffix}-{n}"
        status, asset = call("POST", "/admin/assets", admin, {
            "assetModelId": model["id"], "assetCode": code, "serialNumber": f"SN-{suffix}-{n}",
            "requiredAccessLevel": "STANDARD", "operationalStatus": "SERVICEABLE", "calibrationRequired": False,
            "calibrationDueAt": None}, key=True)
        s2, _ = call("POST", f"/admin/assets/{asset['id']}/identifiers", admin, {"type": "RFID_UHF", "value": tag}, key=True)
        s3, _ = call("PUT", f"/admin/assets/{asset['id']}/placement", admin, {"compartmentId": cell, "reason": "Recette Manager"})
        check(f"S2.{n} asset {code} created, tagged and placed (real flow)", (status, s2, s3) == (201, 201, 200),
              f"HTTP {status}/{s2}/{s3}")
        assets.append({"id": asset["id"], "code": code})
    days = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"]
    status, _ = call("PUT", f"/admin/lockers/{LOCKER}/operating-schedule", admin, {"timeZone": "America/Toronto",
                     "windows": [{"dayOfWeek": d, "enabled": True, "opensAt": "00:00", "closesAt": "23:59"} for d in days]})
    check("S3 Manager opens the locker every day (real flow)", status == 200, f"HTTP {status}")

    deadline = time.time() + 90
    while time.time() < deadline:
        views = [call("GET", f"/assets/{a['id']}", tech)[1] for a in assets]
        if all(v.get("readiness", {}).get("result") == "READY" for v in views):
            break
        time.sleep(3)
    check("S4 simulator scans make both assets READY", all(v.get("readiness", {}).get("result") == "READY" for v in views),
          f"{[(v.get('assetCode'), v.get('presence'), v.get('readiness', {}).get('result')) for v in views]}")

    until = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() + 3 * 3600))
    status, cancelled = call("POST", "/reservations", tech, {"assetId": assets[1]["id"], "reservedUntil": until}, key=True)
    s2, _ = call("POST", f"/reservations/{cancelled.get('id')}/cancel", tech, {}, key=True) if status == 201 else (None, None)
    check("S5 technician reserves then cancels asset 2 (real CANCELLED)", (status, s2) == (201, 200), f"HTTP {status}/{s2}")
    status, active = call("POST", "/reservations", tech, {"assetId": assets[0]["id"], "reservedUntil": until}, key=True)
    check("S6 technician reserves asset 1 (real ACTIVE)", status == 201, f"HTTP {status} {code_of(active)}")
    with open(STATE, "w", encoding="utf-8") as out:
        json.dump({"assets": assets, "cancelled": cancelled.get("id"), "active": active.get("id")}, out)


def holders(views, label, id_field, summary_field):
    # G1 (#67 6800639533): an admin read names the person, never null, consistent with the id and the users table.
    names = dict(line.split("|", 1) for line in sql(
        "SELECT id || '|' || display_name FROM aegis.users;").splitlines() if "|" in line)
    bad = [v.get("id") for v in views
           if not isinstance(v.get(summary_field), dict) or set(v[summary_field]) != {"id", "displayName"}
           or v[summary_field]["id"] != v.get(id_field) or v[summary_field]["displayName"] != names.get(v.get(id_field))]
    check(f"{label} (G1): {summary_field} is {{id, displayName}} matching {id_field} on detail and list",
          views and not bad, f"{len(views)} view(s), mismatched={bad[:3]}")


def reservations_loans_operations(admin, tech, state):
    tech_id = sql("SELECT id FROM aegis.users WHERE lower(email) = 'technician@aegis.demo';")
    route = "/admin/reservations"
    if served(admin, route, "M1 reservations (#48)"):
        access_matrix(admin, tech, "M1 reservations", route, route)
        invalid_filters(admin, "M1 reservations", route,
                        ["status=BOGUS", "assetId=xyz", "userId=xyz", "from=yesterday", "to=2026-13-40T00:00:00Z",
                         "page=-1", "size=0", "size=101"])
        everything = sql_set("SELECT id FROM aegis.reservations;")
        paging(admin, "M1 reservations", route, "", 4, everything)
        paging(admin, "M1 reservations", route, f"userId={tech_id}", 3,
               sql_set(f"SELECT id FROM aegis.reservations WHERE user_id = '{tech_id}';"))
        filtered(admin, "M1 reservations", route, f"userId={TECH_B}",
                 sql_set(f"SELECT id FROM aegis.reservations WHERE user_id = '{TECH_B}';"))
        filtered(admin, "M1 reservations", route, "status=EXPIRED",
                 sql_set("SELECT id FROM aegis.reservations WHERE status = 'EXPIRED';"))
        filtered(admin, "M1 reservations", route, f"assetId={SYN_ASSET['loan-active']}",
                 sql_set(f"SELECT id FROM aegis.reservations WHERE asset_id = '{SYN_ASSET['loan-active']}';"))
        tie = sql(f"SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') "
                  f"FROM aegis.reservations WHERE id = '{syn('c0010')}';")
        tied = sql_set(f"SELECT id FROM aegis.reservations WHERE created_at = '{tie}';")
        later = time.strftime("%Y-%m-%dT%H:%M:%SZ",
                              time.gmtime(calendar.timegm(time.strptime(tie, "%Y-%m-%dT%H:%M:%SZ")) + 1))
        filtered(admin, "M1 reservations (from inclusive)", route, f"from={tie}&to={later}", tied)
        earlier = time.strftime("%Y-%m-%dT%H:%M:%SZ",
                                time.gmtime(calendar.timegm(time.strptime(tie, "%Y-%m-%dT%H:%M:%SZ")) - 1))
        filtered(admin, "M1 reservations (to exclusive)", route, f"from={earlier}&to={tie}",
                 sql_set(f"SELECT id FROM aegis.reservations WHERE created_at >= '{earlier}' AND created_at < '{tie}';"))
        status, body = call("GET", f"{route}?from={tie}&to={tie}", admin)
        check("M1 reservations: an empty interval (from = to) is 400 VALIDATION_ERROR (Backend matrix, #67 6799329882)",
              status == 400 and code_of(body) == "VALIDATION_ERROR", f"HTTP {status} {code_of(body)}")

        status, body = call("GET", f"{route}/{state['active']}", admin)
        asset = (body or {}).get("asset") or {}
        check("M1 reservations: real ACTIVE reservation detail",
              status == 200 and body.get("status") == "ACTIVE" and body.get("userId") == tech_id
              and asset.get("assetCode") == state["assets"][0]["code"],
              f"HTTP {status} status={(body or {}).get('status')} asset={asset.get('assetCode')}")
        report("INFO", "M1 reservations: availableActions on an admin read (semantics unspecified)",
               f"{(body or {}).get('availableActions')}")
        status, body = call("GET", f"{route}/{state['cancelled']}", admin)
        check("M1 reservations: real CANCELLED reservation detail",
              status == 200 and body.get("status") == "CANCELLED" and body.get("cancelledAt"),
              f"HTTP {status} status={(body or {}).get('status')} cancelledAt={(body or {}).get('cancelledAt')}")
        failed_attempt = syn("609")
        status, body = call("GET", f"{route}/{syn('509')}", admin)
        current = (body or {}).get("currentOperationId")
        check("M1 reservations: an ACTIVE reservation keeps its failed attempt as currentOperationId (§8.4, a9142a7)",
              status == 200 and body.get("status") == "ACTIVE" and current == failed_attempt,
              f"HTTP {status} currentOperationId={current}")
        _, page = call("GET", f"{route}?userId={TECH_B}&status=ACTIVE", admin)
        listed = [item.get("currentOperationId") for item in (page or {}).get("items", [])]
        check("M1 reservations: the list shows the same currentOperationId", listed == [failed_attempt], f"{listed}")
        _, detail = call("GET", f"{route}/{state['active']}", admin)
        _, page = call("GET", f"{route}?size=100", admin)
        holders([detail or {}] + items(page), "M1 reservations", "userId", "user")
        status, body = call("GET", f"/reservations/{state['active']}", tech)
        check("M1 reservations (G1): the technician view has no user summary",
              status == 200 and "user" not in (body or {}), f"HTTP {status} keys={sorted(body or {})}")

    route = "/admin/loans"
    if served(admin, route, "M2 loans (#48)"):
        access_matrix(admin, tech, "M2 loans", route, route)
        invalid_filters(admin, "M2 loans", route, ["status=LATE", "assetId=xyz", "from=x", "size=101"])
        paging(admin, "M2 loans", route, "", 2, sql_set("SELECT id FROM aegis.loans;"))
        filtered(admin, "M2 loans", route, "status=ACTIVE", {LOAN_ACTIVE, LOAN_OVERDUE})
        filtered(admin, "M2 loans", route, f"assetId={SYN_ASSET['loan-done']}", {LOAN_DONE})
        expectations = {LOAN_ACTIVE: ("ACTIVE", False, OP[1], None), LOAN_OVERDUE: ("ACTIVE", True, OP[2], None),
                        LOAN_DONE: ("COMPLETED", False, OP[3], OP[13])}
        for loan, (status_value, overdue, checkout, ret) in expectations.items():
            status, body = call("GET", f"{route}/{loan}", admin)
            body = body or {}
            check(f"M2 loans: detail {loan[-3:]} is {status_value}, overdue={overdue}, linked operations",
                  status == 200 and body.get("status") == status_value and body.get("overdue") is overdue
                  and body.get("checkoutOperationId") == checkout and body.get("returnOperationId") == ret,
                  f"HTTP {status} status={body.get('status')} overdue={body.get('overdue')} "
                  f"checkout={body.get('checkoutOperationId')} return={body.get('returnOperationId')}")
        _, detail = call("GET", f"{route}/{LOAN_OVERDUE}", admin)
        _, page = call("GET", f"{route}?size=100", admin)
        holders([detail or {}] + items(page), "M2 loans", "holderUserId", "holder")

    route = "/admin/locker-operations"
    if served(admin, route, "M3 operations (#48)"):
        access_matrix(admin, tech, "M3 operations", route, route)
        invalid_filters(admin, "M3 operations", route, ["status=DONE", "lockerId=xyz", "size=0"])
        paging(admin, "M3 operations", route, f"lockerId={LOCKER}", 3,
               sql_set(f"SELECT id FROM aegis.locker_operations WHERE locker_id = '{LOCKER}';"))
        filtered(admin, "M3 operations", route, "status=ANOMALY", {OP[4], OP[5], OP[8]})
        status, body = call("GET", f"{route}/{OP[4]}", admin)
        check("M3 operations: ANOMALY checkout shows its open anomaly",
              status == 200 and (body or {}).get("anomalyId") == AN_OPEN and body.get("status") == "ANOMALY",
              f"HTTP {status} status={(body or {}).get('status')} anomalyId={(body or {}).get('anomalyId')}")
        status, body = call("GET", f"{route}/{OP[7]}", admin)
        check("M3 operations: FAILED checkout keeps its reason and has no anomaly",
              status == 200 and (body or {}).get("failureReason") == "COMMAND_REJECTED" and body.get("anomalyId") is None,
              f"HTTP {status} failureReason={(body or {}).get('failureReason')} anomalyId={(body or {}).get('anomalyId')}")

    for path in (f"/admin/loans/{LOAN_OVERDUE}/complete", f"/admin/loans/{LOAN_OVERDUE}/force-return",
                 f"/admin/locker-operations/{OP[4]}/confirm", f"/admin/reservations/{state['active']}/cancel"):
        status, body = call("POST", path, admin, {}, key=True)
        check(f"M4 no administrative mutation route: POST {path.rsplit('/', 1)[1]}", status in (404, 405),
              f"HTTP {status} {code_of(body)}")


def custody(admin, tech):
    status, body = call("GET", f"/admin/assets/{SYN_ASSET['loan-overdue']}", admin)
    check("M4 overdue loan keeps the asset BORROWED for the Manager (lateness never frees custody)",
          status == 200 and (body or {}).get("availability") == "BORROWED",
          f"HTTP {status} availability={(body or {}).get('availability')}")
    # A reservation attempt would be refused first for the technician's own active reservation (S6), which proves
    # nothing here; the technician's derived view is the evidence instead.
    status, body = call("GET", f"/assets/{SYN_ASSET['loan-overdue']}", tech)
    readiness = (body or {}).get("readiness") or {}
    check("M4 the technician sees the overdue asset BORROWED and not READY",
          status == 200 and body.get("availability") == "BORROWED" and readiness.get("result") != "READY",
          f"HTTP {status} availability={(body or {}).get('availability')} readiness={readiness.get('result')} "
          f"{readiness.get('reasons')}")
    loan = sql(f"SELECT status FROM aegis.loans WHERE id = '{LOAN_OVERDUE}';")
    check("M4 the overdue loan is still ACTIVE in the database", loan == "ACTIVE", f"loans.status={loan}")


def anomalies(admin, tech):
    route = "/admin/anomalies"
    if not served(admin, route, "M5 anomalies (#52)"):
        return
    access_matrix(admin, tech, "M5 anomalies", route, route)
    invalid_filters(admin, "M5 anomalies", route, ["status=CLOSED", "type=NOPE", "severity=CRITICAL",
                                                    "lockerOperationId=xyz", "size=101"])
    paging(admin, "M5 anomalies", route, "", 3, sql_set("SELECT id FROM aegis.anomalies;"))
    filtered(admin, "M5 anomalies", route, "status=OPEN", {AN_OPEN, AN_TARGET})
    filtered(admin, "M5 anomalies", route, "severity=HIGH", {AN_OPEN, AN_RESOLVED})
    filtered(admin, "M5 anomalies", route, "type=DOOR_NOT_CLOSED_BEFORE_EXPIRY", {AN_ACK})
    filtered(admin, "M5 anomalies", route, f"lockerOperationId={OP[4]}", {AN_OPEN})

    status, body = call("GET", f"{route}/{AN_OPEN}", admin)
    evidence = (body or {}).get("evidence")
    check("M5 anomalies: OPEN detail carries its normalized observation as evidence",
          status == 200 and OBS_OPEN in json.dumps(evidence), f"HTTP {status} evidence={json.dumps(evidence)[:300]}")
    report("INFO", "M5 anomalies: evidence shape (unspecified by document 09, section 18.1)", json.dumps(evidence)[:300])
    status, body = call("GET", f"{route}/{AN_ACK}", admin)
    body = body or {}
    check("M5 anomalies: ACKNOWLEDGED detail keeps author, date and note, never resolution",
          status == 200 and body.get("status") == "ACKNOWLEDGED" and body.get("acknowledgementNote")
          and (body.get("acknowledgedBy") or {}).get("displayName") and body.get("resolvedAt") is None,
          f"HTTP {status} status={body.get('status')} by={body.get('acknowledgedBy')} resolvedAt={body.get('resolvedAt')}")
    status, body = call("GET", f"{route}/{AN_TARGET}", admin)
    check("M5 anomalies: missing correlation stays null, never invented",
          status == 200 and (body or {}).get("lockerOperationId") is None,
          f"HTTP {status} lockerOperationId={(body or {}).get('lockerOperationId')}")


def acknowledgement(admin, tech):
    ack = f"/admin/anomalies/{AN_TARGET}/acknowledge"
    note = "Inspection du compartiment A2 planifiée (recette QA)."
    status, body = call("POST", ack, admin, {"note": note})
    check("M6 acknowledge without Idempotency-Key is 400 IDEMPOTENCY_KEY_REQUIRED",
          status == 400 and code_of(body) == "IDEMPOTENCY_KEY_REQUIRED", f"HTTP {status} {code_of(body)}")
    for label, payload in (("empty note", {"note": ""}), ("blank note", {"note": "   "}),
                           ("501-character note", {"note": "x" * 501}), ("missing note", {})):
        status, body = call("POST", ack, admin, payload, key=True)
        check(f"M6 acknowledge with {label} is 400 VALIDATION_ERROR",
              status == 400 and code_of(body) == "VALIDATION_ERROR", f"HTTP {status} {code_of(body)}")
    status, body = call("POST", ack, tech, {"note": note}, key=True)
    check("M6 technician acknowledge is 403", status == 403, f"HTTP {status} {code_of(body)}")
    status, body = call("POST", ack, None, {"note": note}, key=True)
    check("M6 anonymous acknowledge is 401", status == 401, f"HTTP {status} {code_of(body)}")
    status, body = call("POST", f"/admin/anomalies/{uuid.uuid4()}/acknowledge", admin, {"note": note}, key=True)
    check("M6 acknowledge of a missing anomaly is 404", status == 404, f"HTTP {status} {code_of(body)}")
    still = sql(f"SELECT status FROM aegis.anomalies WHERE id = '{AN_TARGET}';")
    check("M6 rejected attempts leave the anomaly OPEN", still == "OPEN", f"anomalies.status={still}")

    key = str(uuid.uuid4())
    status, first = call("POST", ack, admin, {"note": note}, key=key)
    first = first or {}
    check("M6 acknowledge is 200 ACKNOWLEDGED with author and note, not resolved",
          status == 200 and first.get("status") == "ACKNOWLEDGED" and first.get("acknowledgementNote") == note
          and first.get("acknowledgedBy") and first.get("resolvedAt") is None,
          f"HTTP {status} status={first.get('status')} by={first.get('acknowledgedBy')} resolvedAt={first.get('resolvedAt')}")
    status, replay = call("POST", ack, admin, {"note": note}, key=key)
    check("M6 replay with the same key returns the same answer", status == 200 and replay == first,
          f"HTTP {status} identical={replay == first}")
    status, body = call("POST", ack, admin, {"note": note + " modifiée"}, key=key)
    check("M6 same key with another note is 409 IDEMPOTENCY_KEY_REUSED",
          status == 409 and code_of(body) == "IDEMPOTENCY_KEY_REUSED", f"HTTP {status} {code_of(body)}")
    status, body = call("POST", ack, admin, {"note": note}, key=True)
    check("M6 a new acknowledge of an ACKNOWLEDGED anomaly is 409 ANOMALY_NOT_ACKNOWLEDGEABLE (doc 05 §6.2 reading)",
          status == 409 and code_of(body) == "ANOMALY_NOT_ACKNOWLEDGEABLE", f"HTTP {status} {code_of(body)}")
    status, body = call("POST", f"/admin/anomalies/{AN_RESOLVED}/acknowledge", admin, {"note": note}, key=True)
    check("M6 acknowledge of a RESOLVED anomaly is 409 ANOMALY_ALREADY_RESOLVED",
          status == 409 and code_of(body) == "ANOMALY_ALREADY_RESOLVED", f"HTTP {status} {code_of(body)}")
    status, body = call("POST", f"/admin/anomalies/{AN_TARGET}/resolve", admin, {"note": note}, key=True)
    check("M6 there is no resolve route", status in (404, 405), f"HTTP {status} {code_of(body)}")
    row = sql(f"SELECT status, resolved_at IS NULL, acknowledgement_note FROM aegis.anomalies WHERE id = '{AN_TARGET}';")
    audit = sql(f"SELECT count(*) || '|' || coalesce(min(actor_user_id::text), '') FROM aegis.audit_events "
                f"WHERE event_type = 'ANOMALY_ACKNOWLEDGED' AND subject_id = '{AN_TARGET}';")
    admin_id = sql("SELECT id FROM aegis.users WHERE lower(email) = 'admin@aegis.demo';")
    check("M6 database: ACKNOWLEDGED, unresolved, the note stored once", row == f"ACKNOWLEDGED|t|{note}", f"{row}")
    check("M6 exactly one ANOMALY_ACKNOWLEDGED audit event, by the admin", audit == f"1|{admin_id}", f"count|actor={audit}")

    results = []

    def racer():
        results.append(call("POST", f"/admin/anomalies/{AN_OPEN}/acknowledge", admin, {"note": note}, key=True)[0])

    threads = [threading.Thread(target=racer) for _ in range(4)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    events = sql(f"SELECT count(*) FROM aegis.audit_events WHERE event_type = 'ANOMALY_ACKNOWLEDGED' "
                 f"AND subject_id = '{AN_OPEN}';")
    check("M6 four concurrent acknowledgements with distinct keys: one 200, three 409, one audit event",
          sorted(results) == [200, 409, 409, 409] and events == "1", f"statuses={sorted(results)} audit events={events}")


def walk_audit(admin, route, cursor=None, limit=100):
    seen = []
    for _ in range(200):
        query = f"limit={limit}" + (f"&cursor={urllib.parse.quote(cursor)}" if cursor else "")
        status, body = call("GET", f"{route}?{query}", admin)
        if status != 200:
            return seen, f"HTTP {status} {code_of(body)}"
        seen += ids(body)
        cursor = body.get("nextCursor") if body.get("hasMore") else None
        if not cursor:
            return seen, None
    return seen, "more than 200 pages"


def late_arrivals(admin, route):
    # D10 as approved (#67 6800639533): no snapshot. During a walk, an event backdated behind the cursor is still
    # read; one newer than page 1 waits for the next walk. Never a repeat, never a loss of what existed before.
    before = sql_set("SELECT id FROM aegis.audit_events;")
    status, body = call("GET", f"{route}?limit=5", admin)
    first, cursor = ids(body), (body or {}).get("nextCursor")
    insert = ("WITH x AS (INSERT INTO aegis.audit_events (event_type, actor_user_id, subject_type, subject_id, "
              "operation_id, details, occurred_at) VALUES ('ANOMALY_CREATED', NULL, 'ANOMALY', "
              f"'{AN_TARGET}', NULL, '{{\"synthetic\": true}}'::jsonb, {{at}}) RETURNING id) SELECT id FROM x;")
    backdated = sql(insert.replace("{at}", "now() - interval '400 days'"))
    newer = sql(insert.replace("{at}", "now() + interval '1 second'"))
    rest, error = walk_audit(admin, route, cursor)
    walk = first + rest
    check("M7 audit (D10): a walk with arrivals never repeats an event and keeps every earlier one",
          status == 200 and cursor and not error and len(walk) == len(set(walk)) and before <= set(walk),
          error or f"{len(walk)} ids, {len(set(walk))} distinct, missing earlier={len(before - set(walk))}")
    check("M7 audit (D10): an event backdated behind the cursor appears in the same walk",
          backdated in walk, f"backdated {backdated} {'read' if backdated in walk else 'not read'}")
    check("M7 audit (D10): an event newer than page 1 waits for the next walk",
          newer not in walk, f"newer {newer} {'read (unexpected)' if newer in walk else 'not read'}")
    fresh, error = walk_audit(admin, route)
    check("M7 audit (D10): a fresh walk from page 1 contains both arrivals",
          not error and {backdated, newer} <= set(fresh) and len(fresh) == len(set(fresh)),
          error or f"{len(fresh)} ids, both present={({backdated, newer} <= set(fresh))}")


def filtered_details(admin, route):
    # D9 as approved: only allowlisted scalar leaf paths survive, and a type without an allowlist (the schema accepts
    # more types than the allowlist names, e.g. LOCKER_ONLINE) exposes {}.
    def shown_details(event_type, subject_type, subject, details):
        event = sql("WITH x AS (INSERT INTO aegis.audit_events (event_type, actor_user_id, subject_type, subject_id, "
                    f"operation_id, details, occurred_at) VALUES ('{event_type}', NULL, '{subject_type}', '{subject}', "
                    f"NULL, '{json.dumps(details)}'::jsonb, now() + interval '2 seconds') RETURNING id) SELECT id FROM x;")
        status, body = call("GET", f"{route}?subjectId={subject}&limit=10", admin)
        return status, next((item.get("details") for item in items(body) if item.get("id") == event), "absent")

    status, shown = shown_details("ANOMALY_CREATED", "ANOMALY", AN_TARGET, {
        "commandMessageId": "QA-D9-KEPT", "outcome": {"nested": "QA-D9-NESTED"}, "qaUnknown": "QA-D9-UNKNOWN"})
    check("M7 audit (D9): details keep an allowlisted scalar and drop an unknown key and a non-scalar leaf",
          status == 200 and shown == {"commandMessageId": "QA-D9-KEPT"}, f"HTTP {status} details={json.dumps(shown)}")
    status, shown = shown_details("LOCKER_ONLINE", "LOCKER", LOCKER, {"payload": {"raw": "QA-RAW-SENTINEL"}})
    check("M7 audit (D9): a type without an allowlist exposes empty details",
          status == 200 and shown == {}, f"HTTP {status} details={json.dumps(shown)}")


def audit(admin, tech):
    route = "/admin/audit-events"
    if not served(admin, route, "M7 audit (#53)"):
        return
    access_matrix(admin, tech, "M7 audit", route, None)
    invalid_filters(admin, "M7 audit", route, ["limit=0", "limit=101", "eventType=NOPE", "subjectType=NOPE",
                                                "operationId=xyz", "from=x"])
    status, body = call("GET", f"{route}?cursor=not-a-cursor", admin)
    check("M7 audit: tampered cursor is 400 INVALID_CURSOR", status == 400 and code_of(body) == "INVALID_CURSOR",
          f"HTTP {status} {code_of(body)}")
    snapshot = sql("SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"');")
    expected = sql_set(f"SELECT id FROM aegis.audit_events WHERE occurred_at < '{snapshot}';")
    seen, cursor, order, pages, error = [], None, [], 0, None
    while pages < 500:
        query = f"to={urllib.parse.quote(snapshot)}&limit=7" + (f"&cursor={urllib.parse.quote(cursor)}" if cursor else "")
        status, body = call("GET", f"{route}?{query}", admin)
        if status != 200:
            error = f"page {pages}: HTTP {status} {code_of(body)}"
            break
        seen += ids(body)
        order += [(item.get("occurredAt"), item.get("id")) for item in items(body)]
        pages += 1
        if not body.get("hasMore"):
            break
        cursor = body.get("nextCursor")
    check("M7 audit: cursor walk (limit=7, to=snapshot) has no duplicate and no omission",
          not error and len(seen) == len(set(seen)) and set(seen) == expected,
          error or f"{pages} pages, {len(seen)} ids, {len(set(seen))} distinct, {len(expected)} expected from SQL, "
                   f"missing={len(expected - set(seen))}, extra={len(set(seen) - expected)}")
    check("M7 audit: latest first, occurredAt desc then id desc (Backend D10, #67 6799329882)",
          not error and order == sorted(order, reverse=True),
          "descending" if order == sorted(order, reverse=True) else
          "ascending" if order == sorted(order) else "neither")
    status, body = call("GET", f"{route}?limit=2", admin)
    other = (body or {}).get("nextCursor")
    status, body = call("GET", f"{route}?subjectType=ANOMALY&limit=2&cursor={urllib.parse.quote(other or 'x')}", admin)
    check("M7 audit: a cursor reused with another filter is 400 INVALID_CURSOR",
          other is not None and status == 400 and code_of(body) == "INVALID_CURSOR", f"HTTP {status} {code_of(body)}")
    filtered_audit = [
        (f"operationId={OP[4]}", f"operation_id = '{OP[4]}'"),
        ("subjectType=ANOMALY", "subject_type = 'ANOMALY'"),
        ("eventType=ANOMALY_ACKNOWLEDGED", "event_type = 'ANOMALY_ACKNOWLEDGED'"),
        (f"subjectId={LOAN_DONE}", f"subject_id = '{LOAN_DONE}'"),
    ]
    for query, where in filtered_audit:
        status, body = call("GET", f"{route}?{query}&limit=100", admin)
        want = sql_set(f"SELECT id FROM aegis.audit_events WHERE {where};")
        check(f"M7 audit: filter {query}", status == 200 and set(ids(body)) == want,
              f"HTTP {status} {len(ids(body))} item(s), expected {len(want)}")
    status, body = call("GET", f"{route}?subjectId={uuid.uuid4()}", admin)
    check("M7 audit: an unknown subject gives an empty, final page",
          status == 200 and items(body) == [] and body.get("hasMore") is False and body.get("nextCursor") is None,
          f"HTTP {status} hasMore={(body or {}).get('hasMore')} nextCursor={(body or {}).get('nextCursor')}")
    late_arrivals(admin, route)
    filtered_details(admin, route)
    status, body = call("GET", f"{route}?operationId={OP[4]}&limit=1", admin)
    sample = items(body)[0] if items(body) else {}
    report("INFO", "M7 audit: actor and details of an operation event (for the Web parsers)",
           f"actor={json.dumps(sample.get('actor'))} details={json.dumps(sample.get('details'))[:200]}")
    status, body = call("GET", f"{route}?eventType=ANOMALY_ACKNOWLEDGED&limit=100", admin)
    actors = [item.get("actor") for item in items(body)]
    check("M7 audit: actor is {id, displayName} for an administrator action (Backend D8)",
          status == 200 and actors and all(isinstance(a, dict) and set(a) == {"id", "displayName"} for a in actors),
          f"HTTP {status} {json.dumps(actors)[:200]}")
    status, body = call("GET", f"{route}?eventType=COMMAND_SENT&limit=100", admin)
    check("M7 audit: a system event has actor null", status == 200 and items(body)
          and all(item.get("actor") is None for item in items(body)), f"HTTP {status} {len(items(body))} item(s)")


def leakage():
    leaks = [(where, s) for where, text in bodies for s in SENTINELS if s in text]
    check(f"M8 no sentinel, password hash or raw payload in {len(bodies)} responses", not leaks,
          f"{leaks[:5]}" if leaks else "none found")
    raw = [(where, s) for where, text in bodies for s in RAW_TAGS
           if s in text and "/identifiers" not in where]
    check("M8 no raw RFID value outside the identifier routes", not raw, f"{raw[:5]}" if raw else "none found")


def matrix_phase(admin, tech):
    with open(STATE, encoding="utf-8") as source:
        state = json.load(source)
    before = fingerprint()
    reservations_loans_operations(admin, tech, state)
    anomalies(admin, tech)
    audit(admin, tech)
    after = fingerprint()
    check("M4 the read routes change no reservation, loan, operation, anomaly, asset or placement",
          before == after, f"fingerprint {before[:12]} -> {after[:12]}")
    custody(admin, tech)
    status, _ = call("GET", "/admin/anomalies", admin)
    if status != 404:
        acknowledgement(admin, tech)
    else:
        report("ABSENT", "M6 acknowledgement (#52)", "anomaly routes not served, mutation checks not run")
    leakage()


def main():
    admin = login("admin@aegis.demo", os.environ["AEGIS_DEMO_ADMIN_PASSWORD"])
    tech = login("technician@aegis.demo", os.environ["AEGIS_DEMO_TECHNICIAN_PASSWORD"])
    phase = os.environ.get("QA_PHASE", "matrix")
    {"empty": empty_phase, "setup": setup_phase, "matrix": matrix_phase}[phase](admin, tech)
    print(f"{phase}: " + ", ".join(f"{v} {k}" for k, v in counts.items()), flush=True)
    return counts["FAIL"] + counts["ABSENT"]


if __name__ == "__main__":
    sys.exit(main())
