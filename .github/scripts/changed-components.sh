#!/bin/sh
# Decide which CI components must run, written as "name=true|false" lines to
# $GITHUB_OUTPUT (or stdout). Fail-safe: anything but a readable pull request
# diff runs every component, so a required check is never skipped by mistake.
#
# Exception: the accepted ADR guard compares a pull request with its base, so
# it applies to pull requests only (adrs=false on push and workflow_dispatch).
# `CI result` reads the same outputs, so it never waits for a job that cannot run.
set -eu

out="${GITHUB_OUTPUT:-/dev/stdout}"
all() {
  printf 'api=true\nweb=true\nsimulator=true\nagents=true\nadrs=%s\nios=true\nci=true\n' "$1" >>"$out"
  exit 0
}

[ "${EVENT_NAME:-}" = "pull_request" ] || all false
[ -n "${BASE_SHA:-}" ] && [ -n "${HEAD_SHA:-}" ] || all true
files=$(git diff --name-only "$BASE_SHA" "$HEAD_SHA") || all true

# A change to the CI itself re-runs everything.
if printf '%s\n' "$files" | grep -Eq '^\.github/(workflows/ci\.yml|scripts/)'; then
  all true
fi

changed() {
  if printf '%s\n' "$files" | grep -Eq "$1"; then echo true; else echo false; fi
}

api=$(changed '^(services/api/|infra/docker/)')
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
# A change under .github/scripts/ or to ci.yml already took the full run above.
ci=false
printf 'api=%s\nweb=%s\nsimulator=%s\nagents=%s\nadrs=%s\nios=%s\nci=%s\n' \
  "$api" "$web" "$simulator" "$agents" "$adrs" "$ios" "$ci" >>"$out"
