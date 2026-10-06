#!/usr/bin/env python3
"""Check the generated notebook PDF against its Markdown source.

Usage, from the repository root:
  python3 docs/cahier-conception/pdf/verify_cahier_pdf.py

Exits with status 1 when a check fails. Visual review of the rendered pages is still
required: these checks cannot judge legibility, balance or wording.
"""
import re
import sys
from pathlib import Path

import fitz  # PyMuPDF

HERE = Path(__file__).resolve().parent
CAHIER = HERE.parent
SOURCE = CAHIER / "15-cahier-de-conception.md"
PDF = CAHIER / "aegis-cahier-de-conception.pdf"
MM = 72 / 25.4
A4_PORTRAIT = (595, 842)
A4_LANDSCAPE = (842, 595)
MARGINS_MM = {"portrait": (21, 19), "landscape": (14, 13)}   # top, bottom, as in aegis-print.css

failures = []


def check(ok, label, detail=""):
    print(f"{'PASS' if ok else 'FAIL'}  {label}{(' — ' + detail) if detail else ''}")
    if not ok:
        failures.append(label)


def main():
    source = SOURCE.read_text(encoding="utf-8")
    doc = fitz.open(PDF)
    texts = [page.get_text() for page in doc]
    flat = [t.replace("\n", " ") for t in texts]
    full = " ".join(flat)

    check(not doc.is_encrypted, "PDF opens", f"{doc.page_count} pages")
    check(30 <= doc.page_count <= 90, "plausible page count", str(doc.page_count))

    sizes = [(round(p.mediabox.width), round(p.mediabox.height)) for p in doc]
    valid_sizes = {A4_PORTRAIT, A4_LANDSCAPE}
    check(all(s in valid_sizes for s in sizes), "every media box is A4 portrait or landscape",
          f"{sizes.count(A4_PORTRAIT)} portrait, {sizes.count(A4_LANDSCAPE)} landscape")

    thin = [i + 1 for i, t in enumerate(texts) if len(t.strip()) < 40]
    check(not thin, "text extractable on every page", f"pages with little text: {thin}" if thin else "")

    headings = [re.sub(r"^(?:\d+(?:\.\d+)*\.?|Annexe [A-Z] —)\s+", "", h).strip()
                for h in re.findall(r"^#{1,2} (.+)$", source, re.M)]
    searchable = full.casefold()
    missing = [h for h in headings if h.replace("`", "")[:40].casefold() not in searchable]
    check(not missing, "every Markdown heading appears in the PDF",
          f"{len(headings) - len(missing)}/{len(headings)}" + (f", missing {missing}" if missing else ""))

    n_fig = len(re.findall(r"^\*\*Figure \d+ —", source, re.M))
    n_tab = len(re.findall(r"^\*\*Tableau \d+ —", source, re.M))
    figs = sorted({int(n) for n in re.findall(r"FIGURE (\d+)(?: \(\d/\d\))?\s", full)})
    tabs = sorted({int(n) for n in re.findall(r"TABLEAU (\d+)\s", full)})
    check(figs == list(range(1, n_fig + 1)), "all figure captions present", f"{len(figs)}/{n_fig}")
    check(tabs == list(range(1, n_tab + 1)), "all table captions present", f"{len(tabs)}/{n_tab}")

    detached = []
    for page in doc:
        media = [fitz.Rect(i["bbox"]) for i in page.get_image_info()]
        media += [d["rect"] for d in page.get_drawings() if d["rect"].height > 40 * MM and d["rect"].width > 60 * MM]
        for block in page.get_text("dict")["blocks"]:
            for line in block.get("lines", []):
                for span in line["spans"]:
                    label = re.match(r"^FIGURE (\d+)(?: \(\d/\d\))?$", span["text"].strip())
                    if not label:
                        continue
                    top = span["bbox"][1]
                    above = [r for r in media if -1 <= top - r.y1 <= 25 * MM]
                    if not above:
                        detached.append((span["text"].strip(), page.number + 1))
    check(not detached, "each caption sits directly under its figure", str(detached) if detached else "")

    leaks = re.findall(r"(/Users/\S+|/private/\S+|file://\S+|scratchpad|localhost:\d+)", full)
    check(not leaks, "no local path in the text", str(leaks[:3]) if leaks else "")
    uris = [l.get("uri", "") for p in doc for l in p.get_links() if l.get("uri")]
    bad_uris = [u for u in uris if not u.startswith(("https://", "http://", "mailto:"))]
    check(not bad_uris, "every link is a web URL", f"{len(uris)} links" + (f", bad {bad_uris}" if bad_uris else ""))
    placeholders = [k for k in ("TODO", "TBD", "undefined", "NaN", "Lorem", "{{", "[cahier-pdf]", "WARNING")
                    if k in full]
    check(not placeholders, "no placeholder or generator message", str(placeholders) if placeholders else "")

    meta = doc.metadata
    check("Aegis" in (meta.get("title") or ""), "PDF title", repr(meta.get("title")))
    check("Philippe" in (meta.get("author") or "") and "Jimmy" in (meta.get("author") or ""),
          "PDF authors", repr(meta.get("author")))

    wrong = []
    for _level, title, page in doc.get_toc():
        key = re.sub(r"^(Annexe [A-Z]|\d+(\.\d+)?)\s+", "", title).strip()[:28]
        if key not in flat[page - 1]:
            wrong.append((title, page))
    check(not wrong, "bookmarks point to their headings", f"{len(doc.get_toc())} bookmarks"
          + (f", wrong {wrong}" if wrong else ""))

    fonts = {(f[2], f[3].split("+")[-1], f[1]) for p in doc for f in p.get_fonts(full=True)}
    type3 = [f for f in fonts if f[0] == "Type3"]
    unembedded = [f for f in fonts if f[2] == "n/a" and f[0] != "Type3"]
    check(not type3 and not unembedded, "fonts embedded as TrueType, no Type3",
          ", ".join(sorted({f[1] for f in fonts})))

    marks = []
    for page in doc:
        if page.number == 0:
            continue
        w, h = page.rect.width, page.rect.height
        top, bottom = MARGINS_MM["landscape" if w > h else "portrait"]
        bands = (fitz.Rect(10 * MM, (top - 4.2) * MM, w - 10 * MM, (top - 0.4) * MM),
                 fitz.Rect(10 * MM, h - (bottom - 0.4) * MM, w - 10 * MM, h - (bottom - 3.6) * MM))
        for band in bands:
            pix = page.get_pixmap(dpi=150, clip=band)
            s, n = pix.samples, pix.n
            if sum(1 for k in range(0, len(s), n) if min(s[k], s[k + 1], s[k + 2]) < 245) > 20:
                marks.append(page.number + 1)
    check(not marks, "nothing drawn between content and running headers", str(marks) if marks else "")

    targets = re.findall(r"!?\[[^\]]*\]\(([^)\s]+)\)", source)
    local = [t for t in targets if not t.startswith(("http://", "https://", "#", "mailto:"))]
    broken = [t for t in local if not (CAHIER / t.split("#")[0]).resolve().exists()]
    check(not broken, "every local link and image in the Markdown exists",
          f"{len(local)} local targets" + (f", broken {broken}" if broken else ""))

    print(f"\n{len(failures)} failed check(s)")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
