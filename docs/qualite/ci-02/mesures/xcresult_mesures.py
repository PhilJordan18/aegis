#!/usr/bin/env python3
"""Measure one standalone.xcresult bundle for docs/qualite/ci-02/diagnostic-duree-ios.md.

Usage, from a virtual environment documented in README.md:

    python -I xcresult_mesures.py phases <bundle.xcresult>
    python -I xcresult_mesures.py audits <bundle.xcresult>
    python -I xcresult_mesures.py ui-tests <bundle.xcresult>

Not run by CI. The bundle is untrusted input downloaded from a run artifact:
it is opened read-only, and no file outside it is read, even through a link.
Exit status: 0 complete, 2 unreadable or invalid bundle, 3 incomplete profile.
"""
import collections
import datetime
import re
import sqlite3
import sys
from pathlib import Path

# xcresult times are seconds since 2001-01-01 UTC.
APPLE_EPOCH = 978307200
ZSTD_MAGIC = b"\x28\xb5\x2f\xfd"


class MeasureError(Exception):
    """The bundle cannot give a valid measurement."""


def open_bundle(argument):
    candidate = Path(argument)
    if not candidate.is_dir():
        raise MeasureError(f"bundle introuvable ou pas un dossier : {argument}")
    root = candidate.resolve(strict=True)
    if root.suffix != ".xcresult":
        raise MeasureError(f"pas un bundle .xcresult : {argument}")
    return root


def inside(root, relative, directory=False):
    """Resolve relative under root, refusing anything a link takes outside it."""
    path = root / relative
    try:
        real = path.resolve(strict=True)
    except (FileNotFoundError, NotADirectoryError):
        raise MeasureError(f"absent du bundle : {relative}") from None
    if not real.is_relative_to(root):
        raise MeasureError(f"sort du bundle par un lien : {relative}")
    if directory and not real.is_dir():
        raise MeasureError(f"pas un dossier : {relative}")
    if not directory and not real.is_file():
        raise MeasureError(f"pas un fichier : {relative}")
    return real


def connect(root):
    database = inside(root, "database.sqlite3")
    # as_uri() percent-encodes every character a SQLite URI would interpret, so
    # the path cannot add parameters. mode=ro never creates a database, and
    # immutable=1 writes no journal or lock file into the bundle.
    try:
        db = sqlite3.connect(f"{database.as_uri()}?mode=ro&immutable=1", uri=True)
        db.execute("select count(*) from sqlite_master").fetchone()
    except sqlite3.DatabaseError as error:
        raise MeasureError(f"base illisible : {error}") from None
    return db


def query(db, sql, parameters=()):
    try:
        return db.execute(sql, parameters).fetchall()
    except sqlite3.DatabaseError as error:
        raise MeasureError(f"schéma xcresult inattendu : {error}") from None


TEST_RUNS = """select r.rowid, tb.name, ts.name || '/' || tc.name, r.duration, r.result
 from TestCaseRuns r join TestCases tc on tc.rowid = r.testCase_fk
 join TestSuites ts on ts.rowid = tc.testSuite_fk
 join TestSuiteRuns sr on sr.rowid = r.testSuiteRun_fk
 join TestableRuns tr on tr.rowid = sr.testableRun_fk
 join Testables tb on tb.rowid = tr.testable_fk"""

TOP_ACTIVITIES = """select title, startTime, finishTime from Activities
 where testCaseRun_fk = ? and parent_fk is null order by startTime"""


def ui_runs(db):
    rows = [row for row in query(db, TEST_RUNS) if row[1].endswith("UITests")]
    if not rows:
        raise MeasureError("aucun test UI dans le bundle")
    return rows


# Session log markers, in xcodebuild's and the runner's own words.
MARKERS = {
    "session": r"Beginning test session",
    "socket": r"has testmanagerd socket",
    "install0": r"Installing app at path",
    "install1": r"Installed app at path",
    "launch0": r"Launching app with identifier",
    "launch1": r"Launched app with identifier",
    "runnable": r"Test process runnable PID",
    "unitrun": r"AegisMobile\[\d+:\d+\] Running tests with active",
}


def session_markers(root):
    data = inside(root, "Data", directory=True)
    decompressor = None
    marks = collections.defaultdict(set)
    for entry in sorted(data.iterdir()):
        if not entry.name.startswith("data"):
            continue
        name = f"Data/{entry.name}"
        try:
            content = inside(root, name).read_bytes()
        except OSError as error:
            raise MeasureError(f"lecture impossible : {name} ({error})") from None
        if content[:4] == ZSTD_MAGIC:
            if decompressor is None:
                try:
                    import zstandard
                except ImportError:
                    raise MeasureError("module zstandard absent : voir README.md, « Environnement »") from None
                decompressor = zstandard.ZstdDecompressor()
            try:
                content = decompressor.decompressobj().decompress(content)
            except Exception as error:  # zstandard raises its own ZstdError
                raise MeasureError(f"décompression impossible : {name} ({error})") from None
        if b"Beginning test session" not in content and b"Running tests with active" not in content:
            continue
        for line in content.decode("utf-8", "replace").splitlines():
            stamp = re.match(r"(\d\d):(\d\d):(\d\d\.\d+) ", line)
            if not stamp:
                continue
            seconds = int(stamp[1]) * 3600 + int(stamp[2]) * 60 + float(stamp[3])
            for key, pattern in MARKERS.items():
                if re.search(pattern, line):
                    marks[key].add(seconds)
    return {key: sorted(values) for key, values in marks.items()}


def time_of_day(apple_seconds):
    moment = datetime.datetime.fromtimestamp(apple_seconds + APPLE_EPOCH, datetime.timezone.utc)
    return moment.hour * 3600 + moment.minute * 60 + moment.second + moment.microsecond / 1e6


def phases(root):
    db = connect(root)
    marks = session_markers(root)
    actions = query(db, "select started, finished from Actions")
    if len(actions) != 1 or None in actions[0]:
        raise MeasureError("une action xcodebuild terminée est attendue")
    start, finish = (time_of_day(value) for value in actions[0])
    bounds = query(db, "select min(startTime), max(finishTime) from Activities")[0]
    rows = query(db, TEST_RUNS)
    launches = query(db, "select count(*), sum(finishTime - startTime) from Activities"
                         " where title like 'Launch com.example%'")[0]
    first = {key: values[0] for key, values in marks.items()}
    unit = sum(row[3] for row in rows if row[1] == "AegisMobileTests")
    ui = sum(row[3] for row in rows if row[1] == "AegisMobileUITests")
    ui_start, ui_end = (time_of_day(value) if value is not None else None for value in bounds)

    def span(a, b):
        return round(b - a, 1) if a is not None and b is not None else None

    unit_end = first["unitrun"] + unit if "unitrun" in first else None
    profile = {
        "action_total": span(start, finish),
        "pre_session(build)": span(start, first.get("session")),
        "boot": span(first.get("session"), first.get("socket")),
        "session->install": span(first.get("socket"), first.get("install0")),
        "install": span(first.get("install0"), first.get("install1")),
        "host_launch": span(first.get("launch0"), first.get("launch1")),
        "launched->runnable": span(first.get("launch1"), first.get("runnable")),
        "runnable->unit_start": span(first.get("runnable"), first.get("unitrun")),
        "unit_sum": round(unit, 1),
        "unit_end->ui_first_test": span(unit_end, ui_start),
        "ui_window": span(ui_start, ui_end),
        "ui_sum": round(ui, 1),
        "after_last_test": span(ui_end, finish),
        "ui_launches": launches[0],
        "ui_launch_s": round(launches[1] or 0, 1),
    }
    for key, value in profile.items():
        print(f"{key:26} {'absent' if value is None else value}")
    print("failed", [row[2] for row in rows if row[4] != "Success"])
    print("top", [(row[2].split("/")[-1][:40], round(row[3], 1))
                  for row in sorted(rows, key=lambda row: -row[3])[:5]])
    missing = [key for key, value in profile.items() if value is None]
    if missing:
        print(f"profil incomplet, phases absentes : {', '.join(missing)}", file=sys.stderr)
        return 3
    return 0


NAVIGATION_QUERY = re.compile(r"(Find|Checking existence of `)(the )?NavigationBar \(First Match\)")


def audits(root):
    # XCTest records no activity for the audit itself: its window runs from the
    # last navigation bar query before it to the next screenshot or tear-down.
    db = connect(root)
    total, count = 0.0, 0
    for run_id, _, name, _, result in ui_runs(db):
        activities = query(db, TOP_ACTIVITIES, (run_id,))
        start, windows = None, []
        for title, began, ended in activities:
            if NAVIGATION_QUERY.match(title):
                start = ended or began
                continue
            if start is not None and (title.startswith("Added attachment") or title.startswith("Tear Down")):
                label = title[25:60] if title.startswith("Added") else "TEARDOWN"
                # Issue handler queries run inside the window; their time is shown apart.
                handler = sum((late or early) - early for other, early, late in activities
                              if start <= early <= began and other.startswith("Find the"))
                windows.append((label, round(began - start, 1), round(handler, 1)))
                start = None
        if windows:
            print(name.split("/")[-1][:55], result[:4])
            for window in windows:
                print("   ", window)
            audited = [window[1] for window in windows if window[0] != "TEARDOWN"]
            total += sum(audited)
            count += len(audited)
    print("audits", count, "total s", round(total, 1))
    return 0


KINDS = [("launch", r"^Open |^Launch "), ("terminate", r"^Terminate"), ("appearance", r"^Setting appearance"),
         ("wait", r"^Waiting |to not exist"), ("teardown", r"^Tear Down"), ("start", r"^Start Test"),
         ("tap/type", r"^(Tap|Type|Swipe|Press|Pull|Drag)"), ("attach", r"^Added attachment")]


def kind(title):
    for name, pattern in KINDS:
        if re.search(pattern, title):
            return name
    return "query"


def ui_tests(root):
    db = connect(root)
    totals = collections.Counter()
    print(f"{'test':58} {'dur':>6} {'launch':>6} {'wait':>6} {'query':>6} {'tap':>5} {'tdown':>5} {'gap':>6} {'gap>3s':>6}")
    for run_id, _, name, duration, result in sorted(ui_runs(db), key=lambda row: -row[3]):
        activities = query(db, TOP_ACTIVITIES, (run_id,))
        label = name.split("/")[-1][:58]
        if not activities:
            print(f"{label:58} {duration:6.1f} (aucune activité) {result}")
            continue
        spent, gap, long_gaps, end = collections.Counter(), 0.0, 0.0, activities[0][1]
        for title, began, ended in activities:
            ended = ended or began
            if began > end:
                gap += began - end
                long_gaps += began - end if began - end > 3 else 0
            spent[kind(title)] += ended - began
            end = max(end, ended)
        totals.update(spent)
        totals.update({"gap": gap, "gap>3s": long_gaps, "duration": duration})
        print(f"{label:58} {duration:6.1f} {spent['launch']:6.1f} {spent['wait']:6.1f} {spent['query']:6.1f}"
              f" {spent['tap/type']:5.1f} {spent['teardown']:5.1f} {gap:6.1f} {long_gaps:6.1f} {result[:4]}")
    print({key: round(value, 1) for key, value in totals.items()})
    return 0


COMMANDS = {"phases": phases, "audits": audits, "ui-tests": ui_tests}


def main(arguments):
    if len(arguments) != 2 or arguments[0] not in COMMANDS:
        print(f"usage : xcresult_mesures.py {{{'|'.join(COMMANDS)}}} <bundle.xcresult>", file=sys.stderr)
        return 2
    try:
        return COMMANDS[arguments[0]](open_bundle(arguments[1]))
    except MeasureError as error:
        print(f"erreur : {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
