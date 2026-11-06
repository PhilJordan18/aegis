#!/bin/sh
# Decide which CI components must run, written as "name=true|false" lines to
# $GITHUB_OUTPUT (or stdout). Fail-safe: anything but a readable pull request
# diff runs every component, so a required check is never skipped by mistake.
# The one exception is the iOS suite on a push to dev, below; it is not a
# required check, and any doubt about the pushed range still runs it.
#
# Exception: the accepted ADR guard compares a pull request with its base, so
# it applies to pull requests only (adrs=false on push and workflow_dispatch).
# `CI result` reads the same outputs, so it never waits for a job that cannot run.
set -eu

out="${GITHUB_OUTPUT:-/dev/stdout}"
all() {
  printf 'api=true\nweb=true\nsimulator=true\nagents=true\nadrs=%s\nios=true\nios_fast=false\nci=true\n' "$1" >>"$out"
  exit 0
}

# Paths whose change can alter an iOS result: the app with its Xcode project,
# configuration and recipes, the search corpus its tests read at the repository
# root, the REST contract it consumes, and every CI workflow or script.
ios_paths='^(apps/ios/|docs/cahier-conception/09-corpus-recherche-q\.json$|docs/cahier-conception/09-contrats-rest\.md$|\.github/)'

# A push to dev runs every Linux job, as before, but the iOS suite only when the
# pushed range touches an iOS path. Anything unproven (a new branch, an unknown
# or unreachable before commit, a range that is not a fast-forward) runs it.
# Pushes to main and manual runs stay full: they are the qualification path.
push_dev() {
  [ -n "${BEFORE_SHA:-}" ] && [ -n "${HEAD_SHA:-}" ] || all false
  git merge-base --is-ancestor "$BEFORE_SHA" "$HEAD_SHA" 2>/dev/null || all false
  # --no-renames lists both sides of a rename, so a file moved out of apps/ios still counts.
  pushed=$(git diff --name-only --no-renames "$BEFORE_SHA" "$HEAD_SHA") || all false
  if printf '%s\n' "$pushed" | grep -Eq "$ios_paths"; then
    ios=true
  else
    ios=false
    if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
      printf 'iOS skipped: no iOS path changed in %.7s..%.7s. Run CI manually for a full qualification.\n' \
        "$BEFORE_SHA" "$HEAD_SHA" >>"$GITHUB_STEP_SUMMARY"
    fi
  fi
  printf 'api=true\nweb=true\nsimulator=true\nagents=true\nadrs=false\nios=%s\nios_fast=false\nci=true\n' "$ios" >>"$out"
  exit 0
}

if [ "${EVENT_NAME:-}" = push ] && [ "${REF_NAME:-}" = dev ]; then push_dev; fi
[ "${EVENT_NAME:-}" = "pull_request" ] || all false
[ -n "${BASE_SHA:-}" ] && [ -n "${HEAD_SHA:-}" ] || all true
files=$(git diff --name-only --no-renames "$BASE_SHA" "$HEAD_SHA") || all true

# A workflow change re-runs everything, and so does a CI script this filter does
# not know. A known script reruns its unit tests and the jobs that execute it on
# real reports; the filter and the aggregator are proven by their unit tests,
# since a full run bypasses the filter and cannot exercise it.
known='^\.github/scripts/(tests/|changed-components\.sh$|ci-result\.py$|test-report\.py$|xcresult-summary\.py$|check-accepted-adrs\.py$)'
if printf '%s\n' "$files" | grep -Eq '^\.github/workflows/ci\.yml$'; then
  all true
fi
unknown=$(printf '%s\n' "$files" | grep -E '^\.github/scripts/' | grep -Ev "$known" || true)
[ -z "$unknown" ] || all true

changed() {
  if printf '%s\n' "$files" | grep -Eq "$1"; then echo true; else echo false; fi
}

# The API broker tests read the Mosquitto ACL and accounts of infra/mqtt/.
api=$(changed '^(services/api/|infra/docker/|infra/mqtt/)')
# No Web test reads docs/design/manager-entree/ any more (tokens moved to
# src/styles/); the path stays, which only runs Web more often than needed.
web=$(changed '^(apps/admin-web/|docs/design/manager-entree/)')
simulator=$(changed '^(tools/hub-simulator/|infra/mqtt/|infra/docker/)')
# The validator also checks the references written in Markdown documents.
agents=$(changed '^(\.claude/|\.codex/|\.agents/|AGENTS\.md$|CLAUDE\.md$)|\.md$')
# Deleting or renaming any file can break a Markdown link to it.
removed=$(git diff --name-only --diff-filter=DR "$BASE_SHA" "$HEAD_SHA") || all true
[ -z "$removed" ] || agents=true
adrs=$(changed '^(docs/adr/|docs/cahier-conception/13-registre-adrs-proposes\.md$|\.githooks/check-accepted-adrs$)')
ios=$(changed '^apps/ios/')
# A stacked pull request also carries its prerequisite's commits: they still
# land on the base with it, so they still select iOS. The summary names the
# commits that do, so a reviewer can tell them from the pull request's own.
if [ "$ios" = true ] && [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  {
    echo "iOS selected by these commits (not on the base):"
    git log --no-merges --format='- %h %s' "$BASE_SHA..$HEAD_SHA" -- apps/ios || echo "- (history unreadable)"
  } >>"$GITHUB_STEP_SUMMARY"
fi
if [ "$(changed '^\.github/scripts/test-report\.py$')" = true ]; then
  api=true; web=true; simulator=true
fi
# The fast iOS recipe (`pr`) runs only on a pull request into dev whose iOS
# changes all fall under these non-visual paths. Views, assets, strings, UI
# tests, recipes, project settings and any unknown path keep the full
# standalone recipe, as do pushes, manual runs and pull requests into main.
ios_non_visual='^apps/ios/(AegisMobile/Networking/|AegisMobileTests/|docs/|README\.md$)'
ios_fast=false
if [ "$ios" = true ] && [ "${BASE_REF:-}" = dev ]; then
  visual=$(printf '%s\n' "$files" | grep -E '^apps/ios/' | grep -Ev "$ios_non_visual" || true)
  [ -n "$visual" ] || ios_fast=true
fi
if [ "$(changed '^\.github/scripts/xcresult-summary\.py$')" = true ]; then
  ios=true; ios_fast=false
fi
[ "$(changed '^\.github/scripts/check-accepted-adrs\.py$')" = false ] || adrs=true
# The measurement tools of docs/qualite/ci-02/mesures/ are tested with the scripts.
ci=$(changed '^(\.github/scripts/|docs/qualite/ci-02/mesures/)')
printf 'api=%s\nweb=%s\nsimulator=%s\nagents=%s\nadrs=%s\nios=%s\nios_fast=%s\nci=%s\n' \
  "$api" "$web" "$simulator" "$agents" "$adrs" "$ios" "$ios_fast" "$ci" >>"$out"
