#!/usr/bin/env bash
# Builds and runs the host tests of the display node link logic.
# Usage: firmware/display-node/tests/host/run.sh   (needs g++ or clang++)
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

"${CXX:-c++}" -std=c++17 -Wall -Wextra -Werror -O0 -fsanitize=address,undefined \
  "$here/test_cyd.cpp" -o "$work/test_cyd"
"$work/test_cyd"
