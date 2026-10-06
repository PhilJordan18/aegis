#!/usr/bin/env python3
"""Build the Aegis conception notebook PDF from its Markdown source.

Usage, from the repository root:
  python3 docs/cahier-conception/pdf/build_cahier_pdf.py [--qa-dir DIR] [--force]

Pipeline:
  1. Markdown (15-cahier-de-conception.md) -> semantic HTML (python-markdown).
  2. Mermaid blocks -> static SVG, rendered once in headless Chrome with the pinned
     mermaid@11.17.2 bundle from jsDelivr, cached in build/.
  3. Treatment A interface screens re-rendered at 2x from the prototype sources.
  4. aegis-print.css (CSS Paged Media) + Chrome printToPDF through cdp.mjs.
  5. Second pass: table-of-contents page numbers taken from link destinations.
  6. PDF metadata and bookmarks written with PyMuPDF.

Requirements: Python 3.9+, markdown, pymupdf, Node >= 22, Google Chrome, and network
access for the pinned Mermaid bundle and the static Fontsource fonts on jsDelivr (Inter,
Inter Tight, JetBrains Mono; SIL Open Font License). Static instances are used on purpose:
Chrome embeds variable web fonts as Type3 outlines, static ones as TrueType subsets.
Intermediate files stay in pdf/build/ (git-ignored).
"""
import argparse
import hashlib
import html
import importlib.util
import json
import os
import re
import subprocess
import sys
import unicodedata
from pathlib import Path

import fitz  # PyMuPDF
import markdown

HERE = Path(__file__).resolve().parent
CAHIER = HERE.parent
REPO = CAHIER.parent.parent
SOURCE = CAHIER / "15-cahier-de-conception.md"
OUTPUT = CAHIER / "aegis-cahier-de-conception.pdf"
BUILD = HERE / "build"
CSS = HERE / "aegis-print.css"
CDP = HERE / "cdp.mjs"
PROTOTYPE = REPO / "docs" / "design" / "asset-lifecycle" / "prototype"
GITHUB_BLOB = "https://github.com/PhilJordan18/aegis/blob/main/"

MERMAID_URL = "https://cdn.jsdelivr.net/npm/mermaid@11.17.2/dist/mermaid.min.js"
FONTSOURCE = "https://cdn.jsdelivr.net/npm/@fontsource/{family}@5.3.0/{face}.css"
FONT_FACES = (("inter", ("400", "500", "600", "700", "400-italic")),
              ("inter-tight", ("600", "700", "800")),
              ("jetbrains-mono", ("400", "600")))
FONT_LINKS = "\n".join(f'<link rel="stylesheet" href="{FONTSOURCE.format(family=family, face=face)}">'
                        for family, faces in FONT_FACES for face in faces)
MERMAID_FONT_PX = 16
COVER_LEDE = ("Plateforme de disponibilité opérationnelle et de chaîne de possession "
              "pour des équipements critiques partagés")

# Layout decisions (see the report in the delivery message for the reasons).
LANDSCAPE_FIGURES = {3, 9, 11, 12, 13, 15, 16, 17, 18}   # dedicated landscape pages
DEFERRED_FIGURES = {15, 16, 17, 18}               # moved after their chapter's prose
LANDSCAPE_TABLES = {10, 20}                       # wide multi-column tables
BREAK_BEFORE_SECTIONS = {"10.4", "Annexe D"}      # keep short, cohesive sections on one page
FLOW_CHAPTERS = {"15"}                            # short conclusion follows chapter 14 without a blank page
PORTRAIT_BOX_MM = (172.0, 255.0)
MERMAID_BOX_MM = (164.0, 196.0)                   # inside the dark panel padding
MERMAID_MAX_MM_PER_UNIT = 0.26                    # avoid inflating small diagrams
UI_PAIR_WIDTH_MM = 69.0
WEB_SCREEN_WIDTH_MM = 250.0
SCHEMATIC_MAX_MM = (250.0, 146.0)

REASONING_LEADS = (
    "Une autorité, puis des données fiables.",
    "Une communication bidirectionnelle, reconnectable et auditable avec le hub.",
    "Des clients adaptés à leur usage, sans pouvoir métier.",
    "Un casier physique qui exécute sans décider.",
)
OPEN_ITEM_LEADS = (
    "Décision proposée pour la lecture des identifiants physiques.",
    "Lecture des identifiants physiques.",
    "Propositions de contrat encore non normatives.",
    "Écrans et états encore à produire.",
)

MERMAID_THEME = {
    "darkMode": True, "background": "#1e1e1e", "fontFamily": "Inter, sans-serif",
    "fontSize": f"{MERMAID_FONT_PX}px",
    "primaryColor": "#0F2C46", "primaryBorderColor": "#58A6FF", "primaryTextColor": "#E6EDF3",
    "secondaryColor": "#2B2440", "secondaryBorderColor": "#9F91F0", "secondaryTextColor": "#EDE9FE",
    "tertiaryColor": "#2A2A2E", "tertiaryBorderColor": "#9CA3AF", "tertiaryTextColor": "#E6EDF3",
    "mainBkg": "#0F2C46", "nodeBorder": "#58A6FF", "textColor": "#E6EDF3", "titleColor": "#E6EDF3",
    "lineColor": "#9CA3AF", "edgeLabelBackground": "#1e1e1e", "clusterBkg": "#16202c",
    "actorBkg": "#0F2C46", "actorBorder": "#58A6FF", "actorTextColor": "#E6EDF3",
    "actorLineColor": "#6B7280", "signalColor": "#C9D1D9", "signalTextColor": "#E6EDF3",
    "labelBoxBkgColor": "#2B2440", "labelBoxBorderColor": "#9F91F0", "labelTextColor": "#EDE9FE",
    "loopTextColor": "#EDE9FE", "noteBkgColor": "#3A2A0E", "noteTextColor": "#FCEACD",
    "noteBorderColor": "#D9A441", "activationBkgColor": "#1F3A5A", "activationBorderColor": "#58A6FF",
    "altSectionBkgColor": "#16202c", "sectionBkgColor": "#16202c",
    "attributeBackgroundColorOdd": "#16202c", "attributeBackgroundColorEven": "#1b2735",
    "stateBkg": "#0F2C46", "stateLabelColor": "#E6EDF3", "transitionColor": "#9CA3AF",
    "transitionLabelColor": "#E6EDF3", "compositeBackground": "#16202c",
}


def log(msg):
    print(f"[cahier-pdf] {msg}", flush=True)


def slugify(text):
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def md_inline(text):
    out = markdown.markdown(text, extensions=["attr_list"])
    return re.sub(r"^<p>|</p>$", "", out.strip())


def md_block(text):
    return markdown.markdown(text, extensions=["tables", "fenced_code", "sane_lists", "attr_list"])


NOBR = re.compile(r"\b(ADR-\d{3}(?:/\d{3})?|CAT-\d{2}|RDY-\d{2}|IAM-\d{2}|RES-\d{2}|LOC-\d{2}|"
                  r"MM-\d{3}|AEGIS-DEMO-\d{2}|420-5X7-SO|RS-485|TPS \+ TVQ)\b")
NBSP = "\u00a0"


def french_typography(fragment):
    """Non-breaking spaces and unbreakable codes in text nodes only (never inside tags or SVG)."""
    out = []
    for chunk in re.split(r"(<svg.*?</svg>)", fragment, flags=re.S):
        if chunk.startswith("<svg"):
            out.append(chunk)
            continue
        pieces = re.split(r"(<[^>]+>)", chunk)
        for i, piece in enumerate(pieces):
            if piece.startswith("<"):
                continue
            t = piece
            t = re.sub(r"(\d+) h (\d+)", lambda m: f"{m.group(1)}{NBSP}h{NBSP}{m.group(2)}", t)
            t = re.sub(r"(\d) (\$|%|h\b|s\b|min\b|mm\b|pt\b|V\b|A\b|mA\b|ms\b)", rf"\1{NBSP}\2", t)
            t = t.replace("« ", "«" + NBSP).replace(" »", NBSP + "»").replace(" :", NBSP + ":")
            t = NOBR.sub(r'<span class="nobr">\1</span>', t)
            pieces[i] = t
        out.append("".join(pieces))
    return "".join(out)


# ---------------------------------------------------------------- parsing

def split_front_matter(text):
    m = re.match(r"^---\n(.*?)\n---\n", text, re.S)
    meta, body = {}, text
    if m:
        body = text[m.end():]
        key = None
        for line in m.group(1).splitlines():
            item = re.match(r"^\s+-\s+\"?(.*?)\"?$", line)
            if item and key:
                meta.setdefault(key, []).append(item.group(1))
                continue
            kv = re.match(r"^([\w-]+):\s*(.*)$", line)
            if kv:
                key, value = kv.group(1), kv.group(2).strip().strip('"')
                if value:
                    meta[key] = value
    return meta, body


def blocks_of(body):
    """Split Markdown into blocks: fenced code, headings, or blank-line separated runs."""
    lines, blocks, i = body.split("\n"), [], 0
    while i < len(lines):
        line = lines[i]
        if not line.strip():
            i += 1
            continue
        fence = re.match(r"^```(\w*)", line)
        if fence:
            j = i + 1
            while j < len(lines) and not lines[j].startswith("```"):
                j += 1
            blocks.append({"kind": "code", "lang": fence.group(1), "text": "\n".join(lines[i + 1:j])})
            i = j + 1
            continue
        if line.startswith("#"):
            blocks.append({"kind": "heading", "text": line})
            i += 1
            continue
        j = i
        run = []
        while j < len(lines) and lines[j].strip() and not lines[j].startswith("```") \
                and not (lines[j].startswith("#") and j > i):
            run.append(lines[j])
            j += 1
        blocks.append({"kind": "text", "lines": run})
        i = j
    return blocks


def classify(block):
    if block["kind"] != "text":
        return block["kind"]
    first = block["lines"][0]
    if all(line.startswith("![") for line in block["lines"]):
        return "images"
    if re.match(r"^\*\*Figure \d+ — ", first):
        return "figcaption"
    if re.match(r"^\*\*Tableau \d+ — ", first):
        return "tabcaption"
    if all(line.startswith("|") for line in block["lines"]):
        return "table"
    if first.startswith(">"):
        return "quote"
    return "markdown"


# ---------------------------------------------------------------- assets

def load_render_module():
    spec = importlib.util.spec_from_file_location("aegis_render", PROTOTYPE / "tools" / "render.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def ui_render(rel_path, force):
    """Re-render a treatment A screen at 2x from the prototype source; fall back to the PNG."""
    m = re.search(r"prototype/renders/(ios|web)/a/light/(\d\d)-([\w-]+)\.png$", rel_path)
    if not m:
        return None
    platform, number, slug = m.groups()
    target = BUILD / "ui" / f"{platform}-{number}-{slug}@2x.png"
    if target.exists() and not force:
        return target
    render = load_render_module()
    screen = next(s for s in render.manifest() if s["platform"] == platform and s["n"] == number)
    width, height, _ = render.VIEWPORTS[platform]
    log(f"render {platform}-{number} at 2x")
    render.chrome_screenshot(render.screen_url(screen, "a", "light", ""), target, width, height, 2)
    return target


ER_PARTS = (
    ("Catalogue, casier et traçabilité",
     ["ASSET_MODEL", "ASSET", "ASSET_IDENTIFIER", "LOCKER", "COMPARTMENT", "ASSET_PLACEMENT",
      "USER", "AUDIT_EVENT"], set()),
    ("Réservation, prêt et opération",
     ["USER", "ASSET", "LOCKER", "COMPARTMENT", "RESERVATION", "LOAN", "LOCKER_OPERATION",
      "PHYSICAL_OBSERVATION", "ANOMALY"], {"USER", "ASSET", "LOCKER", "COMPARTMENT"}),
)
TYPE_CONFIG = {
    "flowchart": {"flowchart": {"htmlLabels": True, "curve": "basis", "padding": 14}},
    "state": {"state": {"useMaxWidth": True}},
    "er": {"er": {"nodeSpacing": 20, "rankSpacing": 30, "entityPadding": 8, "fontSize": 14}},
    "sequence": {"sequence": {"wrap": False, "width": 110, "actorMargin": 20, "messageMargin": 10,
                              "boxMargin": 3, "boxTextMargin": 12, "labelBoxHeight": 30, "noteMargin": 5,
                              "mirrorActors": False,
                              "messageFontSize": 16, "actorFontSize": 16, "noteFontSize": 15}},
}
TYPE_BOX_MM = {"er-1": (164.0, 140.0), "er-2": (164.0, 212.0)}
SEQUENCE_BOX_MM = (250.0, 150.0)       # each temporal half on a landscape page
SEQUENCE_LABEL_PT = 6.3                # same label size for both sequence figures
NOTES_AFTER_FIGURES = {11}             # explanatory paragraphs set in two columns under the figure
SEQUENCE_WRAP_CHARS = 26
SEQUENCE_PARTS = ("préparation et preuve locale", "autorisation, commande, observations et suivi")


def diagram_type(src):
    head = src.lstrip().split(None, 1)[0]
    return {"flowchart": "flowchart", "stateDiagram-v2": "state", "erDiagram": "er",
            "sequenceDiagram": "sequence"}.get(head, "flowchart")


def split_er(src):
    """Derive two readable print parts from the single ER source; every relation appears once."""
    entities = {m.group(1): m.group(0) for m in re.finditer(r"^\s{4}(\w+) \{\n.*?^\s{4}\}", src, re.S | re.M)}
    relations = [l for l in src.splitlines() if re.match(r"^\s+\w+ \S+ \w+ : ", l)]
    used, parts = set(), []
    for _title, names, reduced in ER_PARTS:
        lines = ["erDiagram"]
        for name in names:
            lines.append(f"    {name} {{\n        uuid id PK\n    }}" if name in reduced else entities[name])
        for rel in relations:
            a, b = re.match(r"^\s+(\w+) \S+ (\w+) :", rel).groups()
            if a in names and b in names and rel not in used:
                lines.append(rel)
                used.add(rel)
        parts.append("\n".join(lines))
    missing = set(entities) - {n for _t, names, _r in ER_PARTS for n in names}
    if len(used) != len(relations) or missing:
        raise SystemExit(f"ER split incomplete: relations {len(used)}/{len(relations)}, missing {missing}")
    return parts


def wrap_words(text, limit):
    """Break between words only, so identifiers such as COMMAND_ACKNOWLEDGED stay intact."""
    lines, current = [], ""
    for word in text.split():
        if current and len(current) + 1 + len(word) > limit:
            lines.append(current)
            current = word
        else:
            current = f"{current} {word}" if current else word
    if current:
        lines.append(current)
    return "<br/>".join(lines)


def wrap_sequence(src):
    out = []
    for line in src.splitlines():
        message = re.match(r"^(\s+\S+\s*-[->x)]+\+?-?\s*\S+\s*:\s*)(.*)$", line)
        actor = re.match(r"^(\s+(?:participant|actor)\s+\w+\s+as\s+)(.*)$", line)
        block = re.match(r"^(\s+(?:loop|alt|else|opt)\s+)(.*)$", line)
        if message:
            line = message.group(1) + wrap_words(message.group(2), SEQUENCE_WRAP_CHARS)
        elif actor:
            line = actor.group(1) + wrap_words(actor.group(2), 16)
        elif block:
            line = block.group(1) + wrap_words(block.group(2), 22)
        out.append(line)
    return "\n".join(out)


def split_sequence(svg, anchor_text="authorize-local"):
    """Cut a rendered sequence diagram between two messages; repeat the actor row on part 2."""
    x0, y0, width, height = (float(v) for v in re.search(r'viewBox="([^"]+)"', svg).group(1).split())
    lines = sorted(float(v) for v in re.findall(r'<line[^>]*y1="([\d.]+)"[^>]*class="messageLine[01]"', svg))
    texts = [(float(y), t) for y, t in re.findall(
        r'<text[^>]*y="([\d.]+)"[^>]*class="messageText"[^>]*>([^<]*)</text>', svg)]
    boxes = []
    for y1, y2 in re.findall(r'<line[^>]*y1="([\d.]+)"[^>]*y2="([\d.]+)"[^>]*class="loopLine"', svg):
        a, b = sorted((float(y1), float(y2)))
        if b - a > 1:
            boxes.append((a, b))
    actor_bottom = max(float(y) + float(h) for y, h in re.findall(
        r'<rect[^>]*y="([\d.]+)"[^>]*height="([\d.]+)"[^>]*class="actor actor-top"', svg))
    candidates = []
    for line_y in lines:
        later = [y for y, _t in texts if y > line_y + 1]
        if not later:
            continue
        cut = (line_y + min(later)) / 2
        if any(a - 4 <= cut <= b + 4 for a, b in boxes):
            continue
        next_text = " ".join(t for y, t in texts if abs(y - min(later)) < 1)
        candidates.append((cut, next_text))
    if not candidates:
        raise SystemExit("no safe split point in sequence diagram")
    preferred = [c for c in candidates if anchor_text in c[1] and 0.3 < (c[0] - y0) / height < 0.7]
    cut = (preferred or sorted(candidates, key=lambda c: abs(c[0] - (y0 + height / 2))))[0][0]
    ident = re.search(r'<svg id="([^"]+)"', svg).group(1)
    inner = svg[svg.index(">", svg.index("<svg")) + 1: svg.rindex("</svg>")]
    header_h = actor_bottom + 8 - y0
    top_h = cut - y0
    body_h = y0 + height - cut

    def nested(suffix, y, h, vy):
        body = inner.replace(ident, f"{ident}-{suffix}")
        return (f'<svg id="{ident}-{suffix}" x="0" y="{y:.1f}" width="{width:.1f}" height="{h:.1f}" '
                f'viewBox="{x0:.1f} {vy:.1f} {width:.1f} {h:.1f}" overflow="hidden">{body}</svg>')

    part1 = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width:.1f} {top_h:.1f}">'
             + nested("a", 0, top_h, y0) + "</svg>")
    part2 = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width:.1f} {header_h + body_h:.1f}">'
             + nested("h", 0, header_h, y0) + nested("b", header_h, body_h, cut) + "</svg>")
    return [part1, part2]


def mermaid_jobs(sources):
    jobs = []   # (source index, part label or None, type, src)
    for index, src in enumerate(sources):
        kind = diagram_type(src)
        if kind == "er":
            for part, derived in enumerate(split_er(src), start=1):
                jobs.append((index, f"er-{part}", kind, derived))
        elif kind == "sequence":
            jobs.append((index, None, kind, wrap_sequence(src)))
        else:
            jobs.append((index, None, kind, src))
    return jobs


def render_mermaid(sources, force):
    jobs = mermaid_jobs(sources)
    payload = [{"type": kind, "src": src, "cfg": TYPE_CONFIG[kind]} for _i, _p, kind, src in jobs]
    digest = hashlib.sha256(json.dumps([MERMAID_URL, FONT_LINKS, MERMAID_THEME, payload]).encode()).hexdigest()[:16]
    cache = BUILD / f"mermaid-{digest}.json"
    if cache.exists() and not force:
        rendered = json.loads(cache.read_text())
    else:
        page = f"""<!doctype html><html lang="fr"><head><meta charset="utf-8">
{FONT_LINKS}
<style>body{{margin:0;background:#1e1e1e;font-family:Inter,sans-serif}}</style>
<script src="{MERMAID_URL}"></script>
<script>mermaid.initialize({{startOnLoad: false}});</script></head><body><div id="stage"></div>
<script>
(async () => {{
  try {{
    for (const w of ['400', '500', '600', '700']) await document.fonts.load(w + ' 16px Inter', 'Éèàçô');
    await document.fonts.ready;
    const jobs = {json.dumps(payload)};
    const out = [];
    for (let i = 0; i < jobs.length; i++) {{
      mermaid.initialize(Object.assign({{startOnLoad: false, theme: 'base', securityLevel: 'loose',
        themeVariables: {json.dumps(MERMAID_THEME)}}}, jobs[i].cfg));
      const {{svg}} = await mermaid.render('aegis-mmd-' + i, jobs[i].src);
      const holder = document.createElement('div');
      holder.innerHTML = svg;
      document.getElementById('stage').appendChild(holder);
      const node = holder.querySelector('svg');
      const sizes = [...node.querySelectorAll('text, tspan, span, div, p')]
        .filter(e => (e.textContent || '').trim())
        .map(e => parseFloat(getComputedStyle(e).fontSize)).filter(x => x > 0);
      out.push({{svg: node.outerHTML, minFont: Math.min(...sizes)}});
    }}
    window.__AEGIS_OUT = JSON.stringify(out);
    window.__AEGIS_READY = true;
  }} catch (error) {{ window.__AEGIS_ERROR = String(error && error.message || error); }}
}})();
</script></body></html>"""
        BUILD.mkdir(parents=True, exist_ok=True)
        page_path = BUILD / "mermaid.html"
        page_path.write_text(page, encoding="utf-8")
        expr = BUILD / "mermaid-extract.js"
        expr.write_text("window.__AEGIS_OUT")
        out = BUILD / "mermaid-out.json"
        log(f"render {len(jobs)} Mermaid diagrams with {MERMAID_URL.split('/npm/')[1].split('/')[0]}")
        subprocess.run(["node", str(CDP), "eval", page_path.as_uri(), str(expr), str(out)], check=True)
        rendered = json.loads(out.read_text())
        cache.write_text(json.dumps(rendered))
    by_source = {}
    for (index, part, kind, _src), result in zip(jobs, rendered):
        by_source.setdefault(index, []).append({"part": part, "type": kind, **result})
    return [by_source[i] for i in range(len(sources))]


# ---------------------------------------------------------------- HTML building

class Builder:
    def __init__(self, meta, force):
        self.meta = meta
        self.force = force
        self.toc = []          # (level, id, number, title)
        self.identification = {}
        self.figure_report = []
        self.mermaid_svgs = []
        self.mermaid_index = 0
        self.headings_seen = set()

    # -- links and images
    def asset_src(self, rel):
        abs_path = (CAHIER / rel).resolve()
        if not abs_path.exists():
            raise SystemExit(f"missing figure source: {rel}")
        return abs_path

    def rewrite_links(self, fragment):
        def repl(m):
            href = m.group(1)
            if href.startswith(("http://", "https://", "#", "mailto:")):
                return m.group(0)
            target = (CAHIER / href.split("#")[0]).resolve()
            if not target.exists():
                raise SystemExit(f"broken repository link: {href}")
            rel = target.relative_to(REPO).as_posix()
            return f'class="repo-link" data-repo-path="{rel}" href="{GITHUB_BLOB}{rel}"'
        return re.sub(r'href="([^"]+)"', repl, fragment)

    # -- headings
    def heading(self, line):
        level = len(line) - len(line.lstrip("#"))
        text = line[level:].strip()
        number, title = None, text
        if level == 1:
            m = re.match(r"^(\d+)\.\s+(.*)$", text)
            if m:
                number, title = m.group(1), m.group(2)
        elif level == 2:
            m = re.match(r"^(\d+\.\d+)\s+(.*)$", text) or re.match(r"^(Annexe [A-Z]) — (.*)$", text)
            if m:
                number, title = m.group(1), m.group(2)
        anchor = "sec-" + slugify(text)
        if anchor in self.headings_seen:
            raise SystemExit(f"duplicate heading anchor: {anchor}")
        self.headings_seen.add(anchor)
        if level <= 2:
            self.toc.append((level, anchor, number, title))
        title_html = md_inline(title)
        num_html = f'<span class="h-num">{html.escape(number)}</span>' if number else ""
        cls = "chapter" if level == 1 else "section"
        if number in BREAK_BEFORE_SECTIONS:
            cls += " section--break"
        if level == 1 and not number:
            cls += " chapter--plain"
        if level == 1 and number in FLOW_CHAPTERS:
            cls += " chapter--flow"
        return f'<h{level} id="{anchor}" class="{cls}">{num_html}<span class="h-title">{title_html}</span></h{level}>'

    # -- figures
    def figure(self, media, caption_lines):
        caption = " ".join(line.strip() for line in caption_lines)
        m = re.match(r"^\*\*Figure (\d+) — (.*?)\*\*\s*(.*)$", caption)
        number, title, rest = int(m.group(1)), m.group(2), m.group(3)
        status_html = ""
        sm = re.search(r"\*Statut\s*:\s*(.+?)\*\s*$", rest)
        if sm:
            rest = rest[:sm.start()].rstrip()
            status_html = self.status_badge(sm.group(1))
        status_suffix = " " + status_html if status_html else ""
        if media["kind"] == "code":
            diagrams = self.mermaid_svgs[self.mermaid_index]
            self.mermaid_index += 1
            if len(diagrams) == 1 and diagrams[0]["type"] == "sequence":
                return number, self.sequence_figure(number, title, rest, status_suffix, diagrams[0])
            if len(diagrams) == 1:
                media_html, info = self.mermaid_media(diagrams[0])
                self.figure_report.append((number, info))
                cap = (f'<figcaption><span class="fig-label">Figure {number}</span>'
                       f'<span class="fig-title">{md_inline(title)}</span> {md_inline(rest)}{status_suffix}'
                       f'</figcaption>')
                return number, (f'<figure id="figure-{number}" class="fig fig--diagram">'
                                f'<div class="fig-media">{media_html}</div>{cap}</figure>')
            parts, infos = [], []
            for position, diagram in enumerate(diagrams, start=1):
                media_html, info = self.mermaid_media(diagram)
                infos.append(f"part {position}: {info}")
                part_title = ER_PARTS[position - 1][0]
                label = f'<span class="fig-label">Figure {number} ({position}/{len(diagrams)})</span>'
                if position < len(diagrams):
                    cap = (f'<figcaption>{label}<span class="fig-title">{md_inline(title)}</span> '
                           f'Première partie : {part_title.lower()}. La suite du diagramme figure à la '
                           f'page suivante.</figcaption>')
                else:
                    cap = (f'<figcaption>{label}<span class="fig-title">{md_inline(title)}</span> '
                           f'Seconde partie : {part_title.lower()}; les entités déjà détaillées sont '
                           f'réduites à leur identifiant. {md_inline(rest)}{status_suffix}</figcaption>')
                anchor = f' id="figure-{number}"' if position == 1 else ""
                parts.append(f'<figure{anchor} class="fig fig--diagram fig--part">'
                             f'<div class="fig-media">{media_html}</div>{cap}</figure>')
            self.figure_report.append((number, "; ".join(infos)))
            return number, "".join(parts)
        media_html, info, kind = self.image_media(media["lines"], number)
        self.figure_report.append((number, info))
        cap = (f'<figcaption><span class="fig-label">Figure {number}</span>'
               f'<span class="fig-title">{md_inline(title)}</span> {md_inline(rest)}{status_suffix}'
               f'</figcaption>')
        return number, (f'<figure id="figure-{number}" class="fig fig--{kind}">'
                        f'<div class="fig-media">{media_html}</div>{cap}</figure>')

    def sequence_figure(self, number, title, rest, status_suffix, diagram):
        parts = split_sequence(diagram["svg"])
        dims = [tuple(float(v) for v in re.search(r'viewBox="0 0 ([\d.]+) ([\d.]+)"', p).groups()) for p in parts]
        width = dims[0][0]
        scale = min(SEQUENCE_BOX_MM[0] / width, SEQUENCE_BOX_MM[1] / max(h for _w, h in dims),
                    SEQUENCE_LABEL_PT / (diagram["minFont"] * 2.8346))
        pt = diagram["minFont"] * scale * 2.8346
        if pt < 6.0:
            log(f"WARNING: sequence figure {number} smallest label only {pt:.1f} pt")
        self.figure_report.append((number, f"Mermaid sequence split in 2, {width:.0f} wide -> "
                                           f"{width * scale:.0f} mm, smallest {diagram['minFont']:.0f}px "
                                           f"label -> {pt:.1f} pt"))
        html_parts = []
        for position, (part, (w, h)) in enumerate(zip(parts, dims), start=1):
            svg = part.replace("<svg", f'<svg style="width:{w * scale:.1f}mm;height:{h * scale:.1f}mm"', 1)
            label = f'<span class="fig-label">Figure {number} ({position}/2)</span>'
            if position == 1:
                cap = (f'<figcaption>{label}<span class="fig-title">{md_inline(title)}</span> '
                       f'Première partie : {SEQUENCE_PARTS[0]}. La suite figure à la page '
                       f'suivante.</figcaption>')
            else:
                cap = (f'<figcaption>{label}<span class="fig-title">{md_inline(title)}</span> '
                       f'Seconde partie : {SEQUENCE_PARTS[1]}; la rangée des acteurs est répétée. '
                       f'{md_inline(rest)}{status_suffix}</figcaption>')
            anchor = f' id="figure-{number}"' if position == 1 else ""
            html_parts.append(f'<figure{anchor} class="fig fig--diagram fig--part fig--sequence">'
                              f'<div class="fig-media">{svg}</div>{cap}</figure>')
        return "".join(html_parts)

    @staticmethod
    def status_badge(text):
        low = text.lower()
        if "normatif" in low or "acceptée" in low:
            kind = "normative"
        elif "poc" in low or "qualifier" in low or "mesure" in low or "méthode" in low:
            kind = "poc"
        elif "proposition" in low or "proposé" in low:
            kind = "proposal"
        else:
            kind = "illustration"
        return f'<span class="status status--{kind}">Statut : {md_inline(text.rstrip(". "))}</span>'

    def image_media(self, lines, number):
        items = []
        for line in lines:
            m = re.match(r"^!\[(.*?)\]\((.*?)\)(\{.*?\})?\s*$", line.strip())
            if not m:
                raise SystemExit(f"unparsed image line: {line}")
            items.append((m.group(1), m.group(2)))
        parts, info = [], []
        rels = [rel for _, rel in items]
        if all("/renders/ios/" in r for r in rels):
            kind = "ui-pair"
        elif all("/renders/web/" in r for r in rels):
            kind = "web"
        elif all(r.endswith(".svg") for r in rels):
            kind = "schematic"
        else:
            kind = "render3d"
        for alt, rel in items:
            src = self.asset_src(rel)
            if "/prototype/renders/" in rel:
                src = ui_render(rel, self.force) or src
            pix = None if src.suffix == ".svg" else fitz.Pixmap(str(src))
            if kind == "ui-pair":
                w = UI_PAIR_WIDTH_MM
                h = w * pix.height / pix.width
                eff = 17 * w / 393 * 2.8346  # iOS body text in pt
                info.append(f"{src.name}: {w:.0f}x{h:.0f} mm, 17 pt iOS text -> {eff:.1f} pt")
            elif kind == "web":
                w = WEB_SCREEN_WIDTH_MM
                h = w * pix.height / pix.width
                eff = 14 * w / 1440 * 2.8346
                info.append(f"{src.name}: {w:.0f}x{h:.0f} mm, 14 px Web text -> {eff:.1f} pt")
            elif kind == "schematic":
                vb = re.search(r'viewBox="0 0 ([\d.]+) ([\d.]+)"', src.read_text(encoding="utf-8"))
                vw, vh = float(vb.group(1)), float(vb.group(2))
                scale = min(SCHEMATIC_MAX_MM[0] / vw, SCHEMATIC_MAX_MM[1] / vh)
                w, h = vw * scale, vh * scale
                info.append(f"{src.name}: {w:.0f}x{h:.0f} mm, "
                            f"smallest 10-unit label -> {10 * scale * 2.8346:.1f} pt")
            else:
                w = PORTRAIT_BOX_MM[0]
                h = w * pix.height / pix.width
                info.append(f"{src.name}: {w:.0f}x{h:.0f} mm, {pix.width / (w / 25.4):.0f} dpi")
            src_rel = os.path.relpath(src, BUILD)
            parts.append(f'<img src="{src_rel}" alt="{html.escape(alt)}" '
                         f'style="width:{w:.1f}mm;height:{h:.1f}mm">')
        return "".join(parts), "; ".join(info), kind

    def mermaid_media(self, diagram):
        svg = diagram["svg"]
        vb = re.search(r'viewBox="([-\d.]+) ([-\d.]+) ([\d.]+) ([\d.]+)"', svg)
        vw, vh = float(vb.group(3)), float(vb.group(4))
        box = TYPE_BOX_MM.get(diagram["part"] or diagram["type"], MERMAID_BOX_MM)
        scale = min(box[0] / vw, box[1] / vh, MERMAID_MAX_MM_PER_UNIT)
        w, h = vw * scale, vh * scale
        svg = re.sub(r'\sstyle="max-width:[^"]*"', "", svg, count=1)
        svg = re.sub(r'(<svg[^>]*?)\swidth="[^"]*"', r"\1", svg, count=1)
        svg = re.sub(r'(<svg[^>]*?)\sheight="[^"]*"', r"\1", svg, count=1)
        svg = svg.replace("<svg", f'<svg style="width:{w:.1f}mm;height:{h:.1f}mm"', 1)
        pt = diagram["minFont"] * scale * 2.8346
        if pt < 6.0:
            log(f"WARNING: Mermaid {diagram['type']} smallest label only {pt:.1f} pt")
        return svg, (f"Mermaid {diagram['type']} {vw:.0f}x{vh:.0f} -> {w:.0f}x{h:.0f} mm, "
                     f"smallest {diagram['minFont']:.0f}px label -> {pt:.1f} pt")

    # -- tables
    def table(self, caption_lines, table_lines):
        m = re.match(r"^\*\*Tableau (\d+) — (.*?)\*\*\s*(.*)$", caption_lines[0])
        number, title, first_note = int(m.group(1)), m.group(2), m.group(3)
        notes = " ".join([first_note] + [line.strip() for line in caption_lines[1:]]).strip()
        table_html = md_block("\n".join(table_lines))
        rows = len(table_lines) - 2
        small = " tbl--keep" if rows <= 12 and number not in LANDSCAPE_TABLES else ""
        note_html = f'<p class="tbl-note">{md_inline(notes)}</p>' if notes else ""
        return number, (f'<div class="tbl{small}" id="tableau-{number}">'
                        f'<p class="tbl-caption"><span class="tbl-label">Tableau {number}</span>'
                        f'{md_inline(title)}</p>{note_html}{table_html}</div>')

    def paragraph_block(self, lines):
        text = "\n".join(lines)
        rendered = md_block(text)
        lead = re.match(r"^\*\*(.+?)\*\*", lines[0])
        if lead and lead.group(1) in REASONING_LEADS:
            return f'<div class="card card--reasoning">{rendered}</div>'
        if lead and lead.group(1) in OPEN_ITEM_LEADS:
            return f'<div class="card card--open">{rendered}</div>'
        return rendered

    # -- document
    def build_items(self, blocks):
        items = []   # dicts: {"html", "kind", "fig", "tab", "h1"}
        i = 0
        while i < len(blocks):
            b = blocks[i]
            kind = classify(b)
            nxt = blocks[i + 1] if i + 1 < len(blocks) else None
            if kind in ("images", "code") and nxt and classify(nxt) == "figcaption" \
                    and (kind == "images" or b["lang"] == "mermaid"):
                number, frag = self.figure(b, nxt["lines"])
                items.append({"html": frag, "kind": "figure", "fig": number})
                i += 2
                continue
            if kind == "code" and b["lang"] == "mermaid":
                raise SystemExit("Mermaid block without a figure caption")
            if kind == "tabcaption" and nxt and classify(nxt) == "table":
                number, frag = self.table(b["lines"], nxt["lines"])
                items.append({"html": frag, "kind": "table", "tab": number})
                i += 2
                continue
            if kind == "heading":
                level = len(b["text"]) - len(b["text"].lstrip("#"))
                items.append({"html": self.heading(b["text"]), "kind": f"h{level}"})
            elif kind == "code":
                items.append({"html": md_block(f"```{b['lang']}\n{b['text']}\n```"), "kind": "code"})
            elif kind == "quote":
                inner = md_block("\n".join(re.sub(r"^>\s?", "", line) for line in b["lines"]))
                items.append({"html": f'<aside class="callout callout--status">{inner}</aside>', "kind": "quote"})
            elif kind in ("figcaption", "tabcaption", "images", "table"):
                raise SystemExit(f"orphan {kind}: {b['lines'][0][:60]}")
            else:
                items.append({"html": self.paragraph_block(b["lines"]), "kind": "markdown"})
            i += 1
        return items

    @staticmethod
    def keep_groups(items):
        """Bind a portrait figure to its single intro paragraph and preceding headings.

        Chrome can split a figure caption when several sibling break-avoid rules
        conflict; one unbreakable container keeps heading, intro and figure together.
        """
        out = []
        for item in items:
            fig = item.get("fig")
            if fig is None or fig in LANDSCAPE_FIGURES or not out:
                out.append(item)
                continue
            start = len(out)
            prev = out[-1]
            if prev["kind"] == "markdown" and prev["html"].count("<p>") == 1 \
                    and prev["html"].lstrip().startswith("<p>"):
                start -= 1
                if start > 0 and out[start - 1]["kind"] == "h2":
                    start -= 1
                if start > 0 and out[start - 1]["kind"] == "h1":
                    start -= 1
            lead = "".join(it["html"] for it in out[start:])
            del out[start:]
            html_fig = item["html"]
            cut = html_fig.index("</figure>") + len("</figure>")
            out.append({"html": f'<div class="keep">{lead}{html_fig[:cut]}</div>{html_fig[cut:]}',
                        "kind": "group", "fig": fig})
        return out

    def arrange(self, items):
        """Defer some schematics to their chapter end and wrap landscape runs."""
        chapters, current = [], []
        for item in items:
            if item["kind"] == "h1" and current:
                chapters.append(current)
                current = []
            current.append(item)
        chapters.append(current)
        ordered = []
        for chapter in chapters:
            deferred = [it for it in chapter if it.get("fig") in DEFERRED_FIGURES]
            body = [it for it in chapter if it.get("fig") not in DEFERRED_FIGURES]
            ordered.extend(body + deferred)
        out = self.keep_groups(ordered)
        html_parts, idx = [], 0
        while idx < len(out):
            item = out[idx]
            wide = item.get("fig") in LANDSCAPE_FIGURES or item.get("tab") in LANDSCAPE_TABLES
            if not wide:
                html_parts.append(item["html"])
                idx += 1
                continue
            run = [item["html"]]
            fig = item.get("fig")
            # A heading and its short intro stranded between two landscape runs join the figure page.
            if fig is not None and idx >= 2 and out[idx - 2]["kind"] == "h2" \
                    and out[idx - 1]["kind"] == "markdown" and len(html_parts) >= 3 \
                    and html_parts[-3].startswith('<section class="landscape">'):
                run = [html_parts.pop(-2), html_parts.pop(-1)] + run
            # A lone lead-in paragraph between two landscape runs stays on its figure's page.
            elif fig is not None and idx >= 1 and len(html_parts) >= 2 \
                    and html_parts[-2].startswith('<section class="landscape">') \
                    and html_parts[-1] == out[idx - 1]["html"] \
                    and out[idx - 1]["html"].lstrip().startswith(f"<p>La figure {fig} "):
                lead = html_parts.pop().replace("<p>", '<p class="lead">', 1)
                cut = item["html"].index("</figure>") + len("</figure>")
                run = [f'<div class="keep keep--lead">{lead}{item["html"][:cut]}</div>{item["html"][cut:]}']
            idx += 1
            if item.get("tab") in LANDSCAPE_TABLES and idx >= 2 and out[idx - 2]["kind"] == "h2" \
                    and html_parts and html_parts[-1] == out[idx - 2]["html"]:
                run.insert(0, html_parts.pop())       # keep the annex heading with its table
            if item.get("tab") in LANDSCAPE_TABLES:   # keep notes and follow-up tables with it
                while idx < len(out) and out[idx]["kind"] not in ("h1", "h2") \
                        and out[idx].get("fig") is None:
                    run.append(out[idx]["html"])
                    idx += 1
            while idx < len(out) and (out[idx].get("fig") in LANDSCAPE_FIGURES):
                run.append(out[idx]["html"])
                idx += 1
            last_fig = out[idx - 1].get("fig")
            if last_fig in NOTES_AFTER_FIGURES:
                notes = []
                while idx < len(out) and out[idx]["kind"] == "markdown" \
                        and not out[idx]["html"].lstrip().startswith("<p>La figure "):
                    notes.append(out[idx]["html"])
                    idx += 1
                if notes:
                    run.append('<div class="notes">' + "".join(notes) + "</div>")
            html_parts.append('<section class="landscape">' + "".join(run) + "</section>")
        return "\n".join(html_parts)

    def identification_data(self, blocks):
        for i, b in enumerate(blocks):
            if classify(b) == "tabcaption" and "Identification" in b["lines"][0]:
                for row in blocks[i + 1]["lines"][2:]:
                    cells = [c.strip() for c in row.strip("|").split("|")]
                    self.identification[cells[0]] = cells[1]
                return

    def cover(self):
        ident = self.identification
        authors = self.meta.get("author", [])
        teachers = ident.get("Enseignants", "").replace(" et ", ", ")
        rows = [
            ("Cours", ident.get("Cours", "")),
            ("Session", ident.get("Session", "")),
            ("Établissement", ident.get("Établissement", "")),
            ("Remise", "23 septembre 2026 — semaine 4"),
            ("Équipe", "<br>".join(html.escape(a) for a in authors)),
            ("Enseignants", "<br>".join(html.escape(t.strip()) for t in teachers.split(","))),
        ]
        grid = "".join(f'<div class="cover-item"><span class="cover-k">{k}</span>'
                       f'<span class="cover-v">{v if "<br>" in v else html.escape(v)}</span></div>'
                       for k, v in rows)
        return f"""<section class="cover">
<div class="cover-top">
  <div class="cover-kicker">Cahier de conception · P0</div>
  <h1 class="cover-title">Aegis</h1>
  <p class="cover-lede">{COVER_LEDE}</p>
  <p class="cover-course">420-5X7-SO — Écosystème connecté</p>
</div>
{COVER_ART}
<div class="cover-panel">{grid}</div>
<div class="cover-status"><strong>Statut du document.</strong> Cahier de conception du P0, remis
avant le développement. Les décisions acceptées y sont distinguées des propositions; les
résultats des POC physiques restent à produire et ne sont présentés comme obtenus nulle part.</div>
</section>"""

    def toc_html(self, pages=None):
        entries = []
        for n, (level, anchor, number, title) in enumerate(self.toc):
            page = str(pages[n]) if pages else "000"
            num = f'<span class="toc-num">{html.escape(number)}</span>' if number else ""
            entries.append(f'<li class="toc-l{level}"><a href="#{anchor}">{num}'
                           f'<span class="toc-t">{md_inline(title)}</span><span class="toc-dots"></span>'
                           f'<span class="toc-pg">{page}</span></a></li>')
        return ('<nav class="toc" id="table-des-matieres"><h1 class="chapter chapter--plain">'
                '<span class="h-title">Table des matières</span></h1><ol>' + "".join(entries) + "</ol></nav>")

    def document(self, body_html, toc_html):
        # Insert the table of contents right after the Identification section.
        marker = '<h1 id="sec-1-resume-du-projet"'
        if marker not in body_html:
            raise SystemExit("cannot place the table of contents")
        body_html = body_html.replace(marker, toc_html + "\n" + marker, 1)
        title = self.meta.get("title", "Aegis") + " — " + self.meta.get("subtitle", "")
        return f"""<!doctype html>
<html lang="fr-CA"><head><meta charset="utf-8">
<title>{html.escape(title)}</title>
<meta name="author" content="{html.escape('; '.join(self.meta.get('author', [])))}">
{FONT_LINKS}
<link rel="stylesheet" href="{os.path.relpath(CSS, BUILD)}">
</head><body>
{self.cover()}
<main>
{body_html}
</main>
<script>
(async () => {{
  try {{
    const faces = ['400 12px Inter', '600 12px Inter', '700 12px Inter', 'italic 400 12px Inter',
                   '700 12px "Inter Tight"', '800 12px "Inter Tight"', '400 12px "JetBrains Mono"'];
    for (const f of faces) await document.fonts.load(f, 'AaÉéèàçô');
    await document.fonts.ready;
    const missing = faces.filter(f => !document.fonts.check(f, 'AaÉé'));
    if (missing.length) {{ window.__AEGIS_ERROR = 'polices non chargées : ' + missing.join(', '); return; }}
    const imgs = [...document.images];
    await Promise.all(imgs.map(i => i.complete ? null : new Promise(r => {{ i.onload = i.onerror = r; }})));
    const broken = imgs.filter(i => !i.naturalWidth).map(i => i.getAttribute('src'));
    if (broken.length) {{ window.__AEGIS_ERROR = 'images manquantes : ' + broken.join(', '); return; }}
    window.__AEGIS_READY = true;
  }} catch (e) {{ window.__AEGIS_ERROR = String(e); }}
}})();
</script>
</body></html>"""


COVER_ART = """<svg class="cover-art" viewBox="0 0 520 300" aria-hidden="true">
  <defs>
    <linearGradient id="ca-stroke" x1="0" x2="1"><stop offset="0" stop-color="#58A6FF"/><stop offset="1" stop-color="#8B7CF6"/></linearGradient>
    <linearGradient id="ca-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#58A6FF" stop-opacity=".16"/><stop offset="1" stop-color="#8B7CF6" stop-opacity=".05"/></linearGradient>
  </defs>
  <g fill="url(#ca-fill)" stroke="url(#ca-stroke)" stroke-width="1.6">
    <rect x="170" y="18" width="180" height="112" rx="12"/>
    <rect x="96" y="150" width="160" height="126" rx="12"/>
    <rect x="264" y="150" width="160" height="126" rx="12"/>
  </g>
  <rect x="190" y="36" width="78" height="76" rx="6" fill="#0B1F3A" stroke="#58A6FF" stroke-opacity=".7"/>
  <g fill="#9FC3FF" opacity=".85">
    <rect x="200" y="46" width="16" height="16" rx="2"/><rect x="242" y="46" width="16" height="16" rx="2"/>
    <rect x="200" y="86" width="16" height="16" rx="2"/><rect x="222" y="66" width="6" height="6"/>
    <rect x="232" y="76" width="6" height="6"/><rect x="246" y="90" width="8" height="8"/>
    <rect x="222" y="94" width="6" height="6"/><rect x="236" y="58" width="5" height="5"/>
  </g>
  <g stroke="#9FC3FF" stroke-opacity=".55" stroke-width="1.2" fill="none">
    <path d="M300 130 C 300 142, 176 138, 176 150"/><path d="M320 130 C 320 142, 344 138, 344 150"/>
  </g>
  <g font-family="Inter, sans-serif" font-size="13" font-weight="600" fill="#BFD3FF">
    <text x="112" y="172">A1</text><text x="280" y="172">A2</text><text x="286" y="44">HUB</text>
  </g>
  <rect x="236" y="196" width="4" height="46" rx="2" fill="#58A6FF" opacity=".7"/>
  <rect x="404" y="196" width="4" height="46" rx="2" fill="#58A6FF" opacity=".7"/>
  <circle cx="240" cy="166" r="4" fill="#4ADE80"/><circle cx="408" cy="166" r="4" fill="#F87171"/>
</svg>"""


# ---------------------------------------------------------------- PDF

def print_pdf(html_path, pdf_path):
    subprocess.run(["node", str(CDP), "pdf", html_path.as_uri(), str(pdf_path)], check=True)


def toc_pages(pdf_path, expected):
    doc = fitz.open(pdf_path)
    targets = []
    for page in doc:
        for link in page.get_links():
            if link.get("kind") in (fitz.LINK_GOTO, fitz.LINK_NAMED) and link.get("page", -1) >= 0:
                targets.append((page.number, link["from"].y0, link["page"] + 1))
        if len(targets) >= expected:
            break
    targets.sort()
    pages = [t[2] for t in targets[:expected]]
    if len(pages) != expected:
        raise SystemExit(f"TOC links found: {len(pages)} / {expected}")
    return pages, targets[0][0] + 1


def finalize(pdf_path, out_path, meta, toc, pages, toc_page):
    doc = fitz.open(pdf_path)
    authors = "; ".join(meta.get("author", []))
    doc.set_metadata({
        "title": "Aegis — Cahier de conception P0",
        "author": authors,
        "subject": "420-5X7-SO — Écosystème connecté, automne 2026. Remis le 23 septembre 2026.",
        "keywords": "Aegis, P0, IoT, Spring Boot, PostgreSQL, SwiftUI, React, MQTT, RS-485, RFID",
        "creator": "docs/cahier-conception/pdf/build_cahier_pdf.py (Chrome, CSS Paged Media)",
        "producer": f"PyMuPDF {fitz.VersionBind}",
    })
    outline = []
    for (level, _anchor, number, title), page in zip(toc, pages):
        label = re.sub(r"[`*]", "", title)
        outline.append([level, f"{number} {label}" if number else label, page])
    outline.insert(1, [1, "Table des matières", toc_page])
    doc.set_toc(outline)
    doc.save(out_path, garbage=3, deflate=True)
    count = doc.page_count
    doc.close()
    return count


def render_qa(pdf_path, qa_dir, dpi=110):
    qa_dir.mkdir(parents=True, exist_ok=True)
    for old in qa_dir.glob("page-*.png"):
        old.unlink()
    doc = fitz.open(pdf_path)
    for page in doc:
        page.get_pixmap(dpi=dpi).save(qa_dir / f"page-{page.number + 1:03d}.png")
    log(f"QA images: {doc.page_count} pages in {qa_dir}")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--qa-dir", type=Path, help="render every page to PNG in this directory")
    parser.add_argument("--force", action="store_true", help="re-render cached Mermaid and UI assets")
    args = parser.parse_args()

    BUILD.mkdir(parents=True, exist_ok=True)
    meta, body = split_front_matter(SOURCE.read_text(encoding="utf-8"))
    blocks = blocks_of(body)
    builder = Builder(meta, args.force)
    builder.identification_data(blocks)
    sources = [b["text"] for b in blocks if b["kind"] == "code" and b["lang"] == "mermaid"]
    builder.mermaid_svgs = render_mermaid(sources, args.force)
    items = builder.build_items(blocks)
    body_html = french_typography(builder.rewrite_links(builder.arrange(items)))
    for number, info in sorted(builder.figure_report):
        log(f"figure {number:2d}: {info}")

    html_path = BUILD / "cahier.html"
    pass_pdf = BUILD / "pass.pdf"
    pages = None
    for attempt in range(1, 4):
        html_path.write_text(builder.document(body_html, builder.toc_html(pages)), encoding="utf-8")
        log(f"print pass {attempt}")
        print_pdf(html_path, pass_pdf)
        found, toc_page = toc_pages(pass_pdf, len(builder.toc))
        if found == pages:
            break
        pages = found
    else:
        html_path.write_text(builder.document(body_html, builder.toc_html(pages)), encoding="utf-8")
        print_pdf(html_path, pass_pdf)
        found, toc_page = toc_pages(pass_pdf, len(builder.toc))
        if found != pages:
            raise SystemExit("table of contents page numbers did not stabilise")
    total = finalize(pass_pdf, OUTPUT, meta, builder.toc, pages, toc_page)
    log(f"wrote {OUTPUT.relative_to(REPO)} ({total} pages)")
    if args.qa_dir:
        render_qa(OUTPUT, args.qa_dir)


if __name__ == "__main__":
    sys.exit(main())
