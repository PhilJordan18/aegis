#!/usr/bin/env bash
# Records how busy the runner and the just-booted simulator are while the iOS
# job runs (#67). The first UI test of a run is the only one that has failed on
# hosted runners since 22 November, at a different point each time, after
# `simctl bootstatus` had returned. These samples let a later analysis compare
# the load when that test starts with the load in green runs.
#
# Measurement only: it is started in the background and never delays, retries,
# skips or fails a test. It stops at its own bound or with the job.
#
# Usage: simulator-load.sh <simulator-udid> <output.tsv> [seconds] [interval]
set -u

udid=${1:?simulator udid}
out=${2:?output file}
seconds=${3:-2700}
interval=${4:-10}

printf 'epoch\tload1\tsimulator_processes\tsimulator_cpu_percent\n' >"$out"
end=$(($(date +%s) + seconds))
while (($(date +%s) < end)); do
  # macOS prints "{ 1.23 1.10 0.98 }"; Linux has /proc/loadavg for the tests.
  load=$({ sysctl -n vm.loadavg 2>/dev/null || cat /proc/loadavg 2>/dev/null; } | tr -d '{}' | awk 'NF {print $1; exit}')
  # Processes of this simulator carry its device UDID in their command line;
  # this sampler and its awk carry it too and are not counted.
  read -r count cpu < <(ps -axo %cpu=,command= 2>/dev/null |
    awk -v id="$udid" 'index($0, id) && !/simulator-load\.sh|awk -v id=/ {n++; c += $1}
      END {printf "%d %.1f\n", n, c}')
  printf '%s\t%s\t%s\t%s\n' "$(date +%s)" "${load:-NA}" "${count:-0}" "${cpu:-0.0}" >>"$out"
  sleep "$interval"
done
