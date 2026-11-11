#!/usr/bin/env bash
# Builds and runs the host tests of the hub logic, then checks that every payload is strict JSON.
# Usage: firmware/locker-controller/tests/host/run.sh   (needs g++ or clang++ and python3)
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
src="$here/../../src"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# The cell sketch carries its own copy of the frame (see the header comment); they must not drift.
cmp "$src/cell_frame.h" "$here/../../../cell-controller/src/cell_frame.h"

"${CXX:-c++}" -std=c++17 -Wall -Wextra -Werror -O0 -fsanitize=address,undefined \
  "$here/test_hub.cpp" "$src/hub_messages.cpp" "$src/hub_link.cpp" "$src/command_inbox.cpp" "$src/cell_link.cpp" -o "$work/test_hub"
"$work/test_hub" "$work/payloads.jsonl"

python3 -I - "$work/payloads.jsonl" <<'PY'
import json, sys
lines = open(sys.argv[1]).read().splitlines()
for line in lines:
    json.loads(line)
print(f"{len(lines)} payloads are valid JSON")
PY
