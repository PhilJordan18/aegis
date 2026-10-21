#!/usr/bin/env python3
"""Checks the String Catalog against the keys the compiler extracted.

Run after a build (the standalone recipe does it). Fails when a key used in
the code is missing from the catalog, when a catalog key is no longer used,
when an English translation is missing or empty, or when placeholders differ
between the French key and its English value.

usage: check-strings.py [derived-data] [catalog]   (paths inside apps/ios)
"""

import glob
import json
import os
import re
import sys

LANGUAGES = ["en"]
PLACEHOLDER = re.compile(r"%(?:\d+\$)?(?:lld|ld|d|@|f|%)")


def extracted_keys(derived_data):
    pattern = os.path.join(
        derived_data, "Build/Intermediates.noindex/AegisMobile.build",
        "*-iphonesimulator/AegisMobile.build/Objects-normal/*/*.stringsdata")
    files = glob.glob(pattern)
    if not files:
        sys.exit(f"error: no .stringsdata under {derived_data}; build the app first")
    # Derived data keeps older extractions (other architectures, earlier
    # builds, deleted sources): use only the newest one of each live source.
    newest = {}
    for path in files:
        with open(path, encoding="utf-8") as handle:
            data = json.load(handle)
        source = data.get("source", "")
        if not os.path.exists(source):
            continue
        if source not in newest or os.path.getmtime(path) > newest[source][0]:
            newest[source] = (os.path.getmtime(path), data)
    keys = set()
    for _, data in newest.values():
        for entry in data.get("tables", {}).get("Localizable", []):
            keys.add(entry["key"])
    return keys


def placeholders(text):
    return sorted(token.split("$")[-1] for token in PLACEHOLDER.findall(text) if token != "%%")


def translations(entry, language):
    localization = entry.get("localizations", {}).get(language)
    if not localization:
        return []
    units = []
    if "stringUnit" in localization:
        units.append(localization["stringUnit"])
    for variants in localization.get("variations", {}).values():
        units.extend(variant["stringUnit"] for variant in variants.values())
    return units


def inside(root, path):
    """Resolves a command-line path and refuses anything outside apps/ios."""
    resolved = os.path.realpath(os.path.join(root, path))
    if os.path.commonpath([root, resolved]) != root:
        sys.exit(f"error: {path} is outside {root}")
    return resolved


def main():
    root = os.path.realpath(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    derived_data = inside(root, sys.argv[1] if len(sys.argv) > 1 else "build/DerivedData")
    catalog_path = inside(root, sys.argv[2] if len(sys.argv) > 2 else "AegisMobile/Localizable.xcstrings")

    with open(catalog_path, encoding="utf-8") as handle:
        catalog = json.load(handle)
    problems = []
    if catalog.get("sourceLanguage") != "fr":
        problems.append("sourceLanguage must be fr")

    used = extracted_keys(derived_data)
    strings = catalog.get("strings", {})
    for key in sorted(used - strings.keys()):
        problems.append(f"missing from the catalog: {key!r}")
    for key in sorted(strings.keys() - used):
        if strings[key].get("extractionState") != "manual":
            problems.append(f"no longer used in the code: {key!r}")
    for key in sorted(used & strings.keys()):
        for language in LANGUAGES:
            units = translations(strings[key], language)
            if not units:
                problems.append(f"no {language} translation: {key!r}")
            for unit in units:
                if unit.get("state") != "translated" or not unit.get("value", "").strip():
                    problems.append(f"{language} translation not final: {key!r}")
                elif placeholders(unit["value"]) != placeholders(key):
                    problems.append(f"{language} placeholders differ: {key!r}")

    print(f"strings: {len(used)} used, {len(strings)} in the catalog, languages fr + {', '.join(LANGUAGES)}")
    if problems:
        sys.exit("error: " + "\nerror: ".join(problems))


if __name__ == "__main__":
    main()
