#!/usr/bin/env python3
"""File-level checks for docs/design/asset-lifecycle (stdlib only).

1. Local references: Markdown links/images and HTML href/src resolve on disk
   (query strings and #fragments ignored; http(s), mailto and data: skipped;
   JS template literals ${...} skipped — those are covered by tools/check.mjs).
2. Whitespace: no trailing whitespace, exactly one final newline, in every
   text file given (default: every .md/.html/.css/.js/.mjs/.py of the folder).
3. PNG dimensions: renders match the declared viewports.

Usage: python3 tools/check_files.py [file ...]   (exit 1 on failure)
"""
import pathlib
import re
import struct
import sys

PROTO = pathlib.Path(__file__).resolve().parent.parent
FOLDER = PROTO.parent
TEXT = {".md", ".html", ".css", ".js", ".mjs", ".py"}
failures = 0


def report(ok, msg):
    global failures
    print(f"  {'ok  ' if ok else 'FAIL'} {msg}")
    failures += not ok


def targets(path):
    text = path.read_text(encoding="utf-8")
    if path.suffix == ".md":
        text = re.sub(r"```.*?```", "", text, flags=re.S)
        return re.findall(r"!?\[[^\]]*\]\(([^)\s]+)\)", text)
    return re.findall(r"""(?:href|src)=["']([^"']+)["']""", text)


def check_refs(files):
    print("== local references ==")
    for f in files:
        if f.suffix not in (".md", ".html"):
            continue
        bad, n = [], 0
        for t in targets(f):
            if re.match(r"^(https?:|mailto:|data:|#)", t) or "${" in t:
                continue
            n += 1
            p = t.split("#")[0].split("?")[0]
            if not (f.parent / p).exists():
                bad.append(t)
        report(not bad, f"{f.relative_to(FOLDER)}: {n} local target(s){' — missing: ' + ', '.join(bad) if bad else ''}")


def check_ws(files):
    print("\n== whitespace ==")
    for f in files:
        if f.suffix not in TEXT:
            continue
        data = f.read_bytes()
        trailing = [i + 1 for i, line in enumerate(data.split(b"\n")) if line.rstrip(b" \t") != line]
        final = data.endswith(b"\n") and not data.endswith(b"\n\n")
        report(not trailing and final, f"{f.relative_to(FOLDER)}"
               + (f" — trailing whitespace on lines {trailing[:8]}" if trailing else "")
               + ("" if final else " — final newline missing or doubled"))


def check_png():
    print("\n== PNG dimensions ==")
    expect = {"ios": (786, 1704), "web": (1440, 900)}
    boards = {"compare/ios.png": (1760, 1240), "compare/web.png": (1600, 1400),
              "cahier/ios-parcours-technicien.png": (1800, 1290), "cahier/web-administration.png": (1640, 1600)}
    for png in sorted((PROTO / "renders").rglob("*.png")):
        rel = png.relative_to(PROTO / "renders").as_posix()
        w, h = struct.unpack(">II", png.read_bytes()[16:24])
        want = boards.get(rel) or expect.get(rel.split("/")[0])
        report((w, h) == want, f"renders/{rel}: {w}×{h} (expected {want[0]}×{want[1]})")


if __name__ == "__main__":
    args = [pathlib.Path(a).resolve() for a in sys.argv[1:]]
    files = args or sorted(p for p in FOLDER.rglob("*") if p.is_file() and p.suffix in TEXT and "renders" not in p.parts)
    check_refs(files)
    check_ws(files)
    check_png()
    print(f"\n{'ALL PASS' if failures == 0 else str(failures) + ' FAILURE(S)'}")
    sys.exit(1 if failures else 0)
