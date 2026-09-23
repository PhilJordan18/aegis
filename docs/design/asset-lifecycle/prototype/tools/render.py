#!/usr/bin/env python3
"""Render Aegis prototype screens with the locally installed Google Chrome (headless).

No dependency beyond Python 3 stdlib and Chrome. No network access is used.

Examples (run from anywhere):
  python3 tools/render.py                          # every built screen, A+B, light+dark
  python3 tools/render.py --screen ios-02 --treatment a --theme dark
  python3 tools/render.py --compare                # A/B comparison sheets (pivots)
  python3 tools/render.py --cahier                 # notebook sheets (treatment A, light)
  python3 tools/render.py --screen web-02 --query transparency=reduce --out-dir /tmp/x

Output naming: renders/<platform>/<treatment>/<theme>/<n>-<slug>.png
Viewports:     iOS 393x852 CSS px at 2x (786x1704 PNG); Web 1440x900 at 1x.
Compare sheets: renders/compare/<platform>.png
"""
import argparse
import json
import os
import pathlib
import re
import subprocess
import sys
import tempfile
import time

ROOT = pathlib.Path(__file__).resolve().parent.parent
CHROME = os.environ.get("CHROME", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
VIEWPORTS = {"ios": (393, 852, 2), "web": (1440, 900, 1)}
COMPARE_VIEWPORTS = {"ios": (1760, 1240, 1), "web": (1600, 1400, 1)}
CAHIER_SHEETS = {"ios": ("ios-parcours-technicien.png", 1800, 1290), "web": ("web-administration.png", 1640, 1600)}


def manifest():
    text = (ROOT / "data" / "screens.js").read_text(encoding="utf-8")
    m = re.search(r"/\*JSON-START\*/(.*?)/\*JSON-END\*/", text, re.S)
    return json.loads(m.group(1))


def chrome_screenshot(url, out, width, height, scale):
    """Chrome 153 headless writes the PNG but may not exit on macOS; we wait for
    a stable file, then terminate the process."""
    out.parent.mkdir(parents=True, exist_ok=True)
    if out.exists():
        out.unlink()
    with tempfile.TemporaryDirectory(prefix="aegis-chrome-") as profile:
        cmd = [
            CHROME, "--headless=new", "--hide-scrollbars", "--no-first-run",
            "--no-default-browser-check", "--disable-extensions", "--mute-audio",
            "--allow-file-access-from-files", "--run-all-compositor-stages-before-draw",
            "--virtual-time-budget=3000", f"--user-data-dir={profile}",
            f"--force-device-scale-factor={scale}", f"--window-size={width},{height}",
            f"--screenshot={out}", url,
        ]
        proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        deadline, last = time.time() + 60, -1
        while time.time() < deadline:
            if proc.poll() is not None and not out.exists():
                break
            if out.exists():
                size = out.stat().st_size
                if size > 0 and size == last:
                    break
                last = size
            time.sleep(0.4)
        if proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                proc.kill()
        if not out.exists() or out.stat().st_size == 0:
            raise SystemExit(f"render failed: {url}")
    return out


def screen_url(s, treatment, theme, query):
    path = ROOT / "screens" / s["platform"] / f"{s['n']}-{s['slug']}.html"
    q = f"treatment={treatment}&theme={theme}" + (f"&{query}" if query else "")
    return path.as_uri() + "?" + q


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--screen", help="screen id, e.g. ios-02 (default: all built)")
    ap.add_argument("--treatment", choices=["a", "b"])
    ap.add_argument("--theme", choices=["light", "dark"])
    ap.add_argument("--query", default="", help="extra URL query, e.g. transparency=reduce")
    ap.add_argument("--out-dir", help="alternative output root (default: renders/)")
    ap.add_argument("--compare", action="store_true", help="render only the comparison sheets")
    ap.add_argument("--cahier", action="store_true", help="render only the notebook sheets (renders/cahier/)")
    args = ap.parse_args()

    out_root = pathlib.Path(args.out_dir) if args.out_dir else ROOT / "renders"
    if args.compare:
        for platform, (w, h, sc) in COMPARE_VIEWPORTS.items():
            url = (ROOT / "compare.html").as_uri() + f"?platform={platform}"
            print(chrome_screenshot(url, out_root / "compare" / f"{platform}.png", w, h, sc))
        return

    if args.cahier:
        for sheet, (name, w, h) in CAHIER_SHEETS.items():
            url = (ROOT / "cahier.html").as_uri() + f"?sheet={sheet}"
            print(chrome_screenshot(url, out_root / "cahier" / name, w, h, 1))
        return

    screens = [s for s in manifest() if s["status"] == "built"]
    if args.screen:
        screens = [s for s in screens if s["id"] == args.screen]
        if not screens:
            raise SystemExit(f"unknown or unbuilt screen: {args.screen}")
    for s in screens:
        w, h, sc = VIEWPORTS[s["platform"]]
        for t in [args.treatment] if args.treatment else s.get("treatments", ["a", "b"]):
            for th in [args.theme] if args.theme else s.get("themes", ["light", "dark"]):
                out = out_root / s["platform"] / t / th / f"{s['n']}-{s['slug']}.png"
                print(chrome_screenshot(screen_url(s, t, th, args.query), out, w, h, sc))


if __name__ == "__main__":
    main()
