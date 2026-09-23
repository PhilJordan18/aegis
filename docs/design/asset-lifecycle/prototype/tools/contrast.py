#!/usr/bin/env python3
"""WCAG 2.2 contrast check for Aegis prototype tokens (stdlib only).

1. Token pairs: parses tokens/brand.css (light and dark blocks), composites
   rgba() over the declared base, and checks each text / UI pair.
2. Rendered samples: decodes the rendered PNGs and samples the real background
   behind text that sits on gradients or glass, then checks it against the
   text token actually used there.

Thresholds: body text 4.5:1, large text (>= 24 px regular / 18.66 px bold)
3:1, UI glyphs and control boundaries 3:1 (WCAG 1.4.3, 1.4.11).
Disabled controls are reported but exempt (WCAG 1.4.3 exception).

Usage: python3 tools/contrast.py [--samples-only | --tokens-only]
Exit code 1 if any non-exempt pair fails.
"""
import pathlib
import re
import struct
import sys
import zlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
CSS = (ROOT / "tokens" / "brand.css").read_text(encoding="utf-8")


def block(selector):
    m = re.search(re.escape(selector) + r"\s*\{(.*?)\n\}", CSS, re.S)
    out = {}
    for name, val in re.findall(r"--([\w-]+):\s*([^;]+);", m.group(1)):
        out[name] = val.strip()
    return out


ROOTV = block(":root")
THEMES = {"light": block('[data-theme="light"]'), "dark": block('[data-theme="dark"]')}
# Surfaces defined outside brand.css (components/ios.css, web.css) — kept in sync by hand.
EXTRA = {
    "light": {"ios-b-canvas": "#F0F3F8", "ios-b-group": "#FFFFFF", "ios-b-field": "#E3E7EF", "web-b-canvas": "#F3F5F9"},
    "dark": {"ios-b-canvas": "#03061A", "ios-b-group": "#0E1531", "ios-b-field": "#1A2142", "web-b-canvas": "#050A1C"},
}


def parse(val):
    val = val.strip()
    if val.startswith("#"):
        h = val[1:]
        return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4)) + (1.0,)
    m = re.match(r"rgba?\(([^)]+)\)", val)
    parts = [p.strip() for p in m.group(1).split(",")]
    a = float(parts[3]) if len(parts) > 3 else 1.0
    return (int(parts[0]), int(parts[1]), int(parts[2]), a)


def color(theme, name):
    t = THEMES[theme]
    if name.startswith("#") or name.startswith("rgb"):
        return parse(name)
    v = t.get(name) or EXTRA[theme].get(name) or ROOTV.get(name)
    if v is None:
        raise KeyError(name)
    if v.startswith("var("):
        return color(theme, v[6:-1])
    return parse(v)


def over(fg, bg):
    a = fg[3]
    return tuple(round(fg[i] * a + bg[i] * (1 - a)) for i in range(3)) + (1.0,)


def lum(c):
    def ch(v):
        v = v / 255
        return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4
    return 0.2126 * ch(c[0]) + 0.7152 * ch(c[1]) + 0.0722 * ch(c[2])


def ratio(a, b):
    la, lb = lum(a), lum(b)
    return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)


MIN = {"text": 4.5, "large": 3.0, "ui": 3.0, "exempt": 0.0}

# (foreground, background, [base under a translucent background], kind, where)
PAIRS = [
    ("ag-text", "ag-canvas", None, "text", "body text on canvas"),
    ("ag-text", "ag-surface", None, "text", "body text on surface"),
    ("ag-text-2", "ag-surface", None, "text", "secondary text on surface"),
    ("ag-text-2", "ag-canvas", None, "text", "secondary text on canvas (footnotes)"),
    ("ag-text-3", "ag-surface", None, "text", "placeholder / tertiary on surface"),
    ("ag-text-2", "ag-surface-sunken", None, "text", "table header on sunken"),
    ("ag-text", "ag-surface-selected", None, "text", "text on selected row"),
    ("ag-text-2", "ag-surface-selected", None, "text", "secondary text on selected row"),
    ("ag-accent-text", "ag-surface", None, "text", "links on surface"),
    ("ag-accent-text", "ag-surface-selected", None, "text", "active nav / link on selected"),
    ("ag-accent-text", "ag-accent-soft", None, "text", "B active nav item"),
    ("ag-text-on-accent", "ag-accent", None, "text", "primary button"),
    ("ag-text-on-accent", "ag-indigo-600", None, "text", "A primary gradient end"),
    ("ag-text-disabled", "ag-disabled-bg", None, "exempt", "disabled button (exempt, informative)"),
    ("ag-ready-fg", "ag-ready-bg", None, "text", "status Prêt (pill)"),
    ("ag-ready-fg", "ag-surface", None, "text", "status Prêt (plain)"),
    ("ag-blocked-fg", "ag-blocked-bg", None, "text", "status Bloqué (pill)"),
    ("ag-blocked-fg", "ag-surface", None, "text", "status Bloqué (plain), calibration expirée"),
    ("ag-blocked-fg", "ag-surface-selected", None, "text", "Bloqué on selected row"),
    ("ag-unknown-fg", "ag-unknown-bg", None, "text", "status À vérifier (pill)"),
    ("ag-unknown-fg", "ag-surface", None, "text", "status À vérifier (plain)"),
    ("ag-mine-fg", "ag-mine-bg", None, "text", "status Réservé / Emprunté par vous"),
    ("ag-neutral-fg", "ag-neutral-bg", None, "text", "status neutre"),
    ("ag-progress-fg", "ag-progress-bg", None, "text", "status Disponible (pill)"),
    ("ag-progress-fg", "ag-surface-selected", None, "text", "Disponible (plain) on selected row"),
    ("ag-progress-fg", "ag-surface", None, "text", "Disponible (plain)"),
    ("ag-text", "ag-blocked-bg", None, "text", "A diagnostic reason on blocked tint"),
    ("ag-text-2", "ag-blocked-bg", None, "text", "A diagnostic note on blocked tint"),
    ("ag-mock-fg", "ag-mock-bg", None, "text", "mock marker (10.5 px bold)"),
    ("ag-text", "ag-glass-fallback", None, "text", "text on opaque glass fallback"),
    ("ag-text-2", "ag-glass-fallback", None, "text", "secondary on glass fallback"),
    ("ag-text-2", "ios-b-canvas", None, "text", "iOS B footnote"),
    ("ag-text", "ios-b-group", None, "text", "iOS B row"),
    ("ag-text-2", "ios-b-group", None, "text", "iOS B row meta"),
    ("ag-text-3", "ios-b-field", None, "text", "iOS B search placeholder"),
    ("ag-text", "ios-b-field", None, "text", "iOS B segmented label"),
    ("ag-text-2", "web-b-canvas", None, "text", "Web B table footer"),
    ("ag-ready-icon", "ag-surface", None, "ui", "Prêt symbol"),
    ("ag-blocked-icon", "ag-surface", None, "ui", "Bloqué symbol"),
    ("ag-unknown-icon", "ag-surface", None, "ui", "À vérifier symbol"),
    ("ag-mine-icon", "ag-surface", None, "ui", "mine symbol"),
    ("ag-neutral-icon", "ag-surface", None, "ui", "neutral symbol"),
    ("ag-progress-icon", "ag-surface", None, "ui", "Disponible symbol"),
    ("ag-blocked-icon", "ag-blocked-bg", None, "ui", "Bloqué symbol in pill"),
    ("ag-ready-icon", "ag-ready-bg", None, "ui", "Prêt symbol in pill"),
    ("ag-glyph", "ag-ready-icon", None, "ui", "glyph inside Prêt shape"),
    ("ag-glyph", "ag-blocked-icon", None, "ui", "glyph inside Bloqué shape"),
    ("ag-glyph", "ag-unknown-icon", None, "ui", "glyph inside À vérifier shape"),
    ("ag-glyph", "ag-progress-icon", None, "ui", "glyph inside Disponible shape"),
    ("ag-focus", "ag-surface", None, "ui", "focus ring"),
    ("ag-focus", "ag-surface-selected", None, "ui", "focus ring on selected row"),
    ("ag-control-border", "ag-surface", None, "ui", "form control boundary"),
    ("ag-accent", "ag-surface", None, "ui", "switch track (on)"),
]


def check_tokens():
    fails = 0
    for theme in ("light", "dark"):
        print(f"\n== tokens · {theme} ==")
        for fg, bg, base, kind, where in PAIRS:
            b = color(theme, bg)
            if b[3] < 1:
                b = over(b, color(theme, base or "ag-surface"))
            f = color(theme, fg)
            if f[3] < 1:
                f = over(f, b)
            r = ratio(f, b)
            ok = r >= MIN[kind]
            fails += (not ok) and kind != "exempt"
            flag = "ok  " if ok else ("n/a " if kind == "exempt" else "FAIL")
            print(f"  {flag} {r:5.2f}:1  [{kind:6}] {fg} on {bg}  — {where}")
    return fails


# ------------------------------------------------------------ PNG sampling
def read_png(path):
    data = path.read_bytes()
    assert data[:8] == b"\x89PNG\r\n\x1a\n"
    pos, idat, w = 8, b"", None
    while pos < len(data):
        ln, typ = struct.unpack(">I4s", data[pos:pos + 8])
        chunk = data[pos + 8:pos + 8 + ln]
        if typ == b"IHDR":
            w, h, depth, ctype, _, _, interlace = struct.unpack(">IIBBBBB", chunk)
            assert depth == 8 and interlace == 0 and ctype in (2, 6)
            bpp = 4 if ctype == 6 else 3
        elif typ == b"IDAT":
            idat += chunk
        pos += 12 + ln
    raw = zlib.decompress(idat)
    stride = w * bpp
    rows, prev, i = [], bytearray(stride), 0
    for _ in range(h):
        f = raw[i]; line = bytearray(raw[i + 1:i + 1 + stride]); i += 1 + stride
        for x in range(stride):
            a = line[x - bpp] if x >= bpp else 0
            b = prev[x]
            c = prev[x - bpp] if x >= bpp else 0
            if f == 1: line[x] = (line[x] + a) & 255
            elif f == 2: line[x] = (line[x] + b) & 255
            elif f == 3: line[x] = (line[x] + ((a + b) >> 1)) & 255
            elif f == 4:
                p = a + b - c; pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                line[x] = (line[x] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        rows.append(line); prev = line
    return w, h, bpp, rows


def sample(img, x, y, r=3):
    w, h, bpp, rows = img
    acc = [0, 0, 0]; n = 0
    for yy in range(y - r, y + r + 1):
        for xx in range(x - r, x + r + 1):
            px = rows[yy][xx * bpp:xx * bpp + 3]
            for k in range(3): acc[k] += px[k]
            n += 1
    return tuple(round(v / n) for v in acc) + (1.0,)


# (render relative to renders/<platform>/<treatment>/<theme>/, x, y in PNG px, text token, kind, where)
SAMPLES = [
    ("ios", "a", "02-catalogue.png", 620, 240, "ag-text", "large", "large title on A gradient"),
    ("ios", "a", "02-catalogue.png", 40, 57, "ag-text", "text", "status-bar clock on A gradient"),
    ("ios", "a", "02-catalogue.png", 768, 572, "ag-text-2", "text", "section meta on A gradient"),
    ("ios", "a", "02-catalogue.png", 505, 1600, "ag-text", "text", "tab label on glass tab bar"),
    ("ios", "a", "02-catalogue.png", 70, 1614, "ag-accent-text", "text", "active tab label on glass"),
    ("ios", "a", "02-catalogue.png", 675, 135, "ag-text", "ui", "toolbar glyph on glass button"),
    ("ios", "a", "02-catalogue.png", 740, 1490, "ag-text-2", "text", "footnote above tab bar"),
    ("ios", "b", "02-catalogue.png", 505, 1600, "ag-text", "text", "tab label on glass tab bar"),
    ("ios", "b", "02-catalogue.png", 70, 1614, "ag-accent-text", "text", "active tab label on glass"),
    ("ios", "b", "02-catalogue.png", 680, 135, "ag-text", "ui", "toolbar glyph on glass button"),
    ("web", "a", "02-equipements.png", 200, 315, "ag-text", "text", "nav label on glass sidebar"),
    ("web", "a", "02-equipements.png", 250, 96, "ag-text-2", "text", "institution label on glass sidebar"),
    ("web", "a", "02-equipements.png", 430, 112, "ag-text-2", "text", "inactive tab on glass capsule"),
    ("web", "a", "02-equipements.png", 897, 112, "ag-text-2", "text", "locker chip text on canvas gradient"),
    ("web", "a", "02-equipements.png", 520, 44, "ag-text", "large", "page title on canvas gradient"),
    ("web", "b", "02-equipements.png", 200, 280, "ag-text", "text", "nav label on B sidebar"),
    ("web", "b", "02-equipements.png", 600, 40, "ag-text-2", "text", "breadcrumb on B top bar"),
    ("web", "b", "02-equipements.png", 1290, 40, "ag-text-2", "text", "freshness on B top bar"),
    # Notebook set (treatment A, light only): text behind scrims and over dimmed gradients.
    ("ios", "a", "03-detail-reserver.png", 40, 57, "ag-text", "text", "status-bar clock over sheet scrim"),
    ("ios", "a", "05-retrait-scanner.png", 40, 57, "ag-text", "text", "status-bar clock over sheet scrim"),
    ("ios", "a", "06-pret-actif.png", 740, 1300, "ag-text", "text", "callout text on sunken tint"),
    ("web", "a", "04-anomalie.png", 1230, 553, "ag-text-2", "text", "key evidence detail behind light scrim"),
    ("web", "a", "04-anomalie.png", 1180, 492, "ag-text-2", "text", "evidence detail behind light scrim"),
    ("web", "a", "04-anomalie.png", 1360, 335, "ag-text", "text", "permanent reminder behind light scrim"),
    ("web", "a", "04-anomalie.png", 1100, 672, "ag-text-2", "text", "linked card meta behind light scrim"),
    ("web", "a", "04-anomalie.png", 1000, 245, "ag-text", "text", "anomaly summary behind light scrim"),
]


def check_samples():
    fails = 0
    for theme in ("light", "dark"):
        print(f"\n== rendered samples · {theme} ==")
        cache = {}
        for plat, tr, name, x, y, tok, kind, where in SAMPLES:
            p = ROOT / "renders" / plat / tr / theme / name
            if not p.exists() and theme == "dark" and name[:2] in ("03", "04", "05", "06"):
                continue  # notebook screens are light only
            if not p.exists():
                print(f"  skip  {p.relative_to(ROOT)} missing"); continue
            img = cache.setdefault(p, read_png(p))
            bg = sample(img, x, y)
            r = ratio(color(theme, tok), bg)
            ok = r >= MIN[kind]
            fails += not ok
            print(f"  {'ok  ' if ok else 'FAIL'} {r:5.2f}:1  [{kind:5}] {plat}/{tr} {tok} on #{bg[0]:02X}{bg[1]:02X}{bg[2]:02X} @({x},{y}) — {where}")
    return fails


if __name__ == "__main__":
    f = 0
    if "--samples-only" not in sys.argv:
        f += check_tokens()
    if "--tokens-only" not in sys.argv:
        f += check_samples()
    print(f"\n{'ALL PASS' if f == 0 else str(f) + ' FAILURE(S)'}")
    sys.exit(1 if f else 0)
