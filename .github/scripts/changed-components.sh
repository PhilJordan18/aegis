#!/bin/sh
# Decide which CI components must run, written as "name=true|false" lines to
# $GITHUB_OUTPUT (or stdout). Fail-safe: anything but a readable pull request
# diff runs every component, so a required check is never skipped by mistake.
set -eu

out="${GITHUB_OUTPUT:-/dev/stdout}"
all() {
  printf 'api=true\nweb=true\nsimulator=true\nagents=true\nadrs=true\nios=true\n' >>"$out"
  exit 0
}

[ "${EVENT_NAME:-}" = "pull_request" ] || all
[ -n "${BASE_SHA:-}" ] && [ -n "${HEAD_SHA:-}" ] || all
files=$(git diff --name-only "$BASE_SHA" "$HEAD_SHA") || all

# A change to the CI itself re-runs everything.
if printf '%s\n' "$files" | grep -Eq '^\.github/(workflows/ci\.yml|scripts/)'; then
  all
fi

api=false
web=false
printf '%s\n' "$files" | grep -Eq '^(services/api/|infra/docker/)' && api=true
# The Web token test reads the design handoff's tokens.css.
printf '%s\n' "$files" | grep -Eq '^(apps/admin-web/|docs/design/manager-entree/)' && web=true
simulator=false
agents=false
adrs=false
ios=false
printf '%s\n' "$files" | grep -Eq '^(tools/hub-simulator/|infra/mqtt/|infra/docker/)' && simulator=true
# The validator also checks the references written in Markdown documents.
printf '%s\n' "$files" | grep -Eq '^(\.claude/|\.codex/|\.agents/|AGENTS\.md$|CLAUDE\.md$)|\.md$' && agents=true
printf '%s\n' "$files" | grep -Eq '^(docs/adr/|docs/cahier-conception/13-registre-adrs-proposes\.md$|\.githooks/check-accepted-adrs$)' && adrs=true
printf '%s\n' "$files" | grep -Eq '^apps/ios/' && ios=true
printf 'api=%s\nweb=%s\nsimulator=%s\nagents=%s\nadrs=%s\nios=%s\n' "$api" "$web" "$simulator" "$agents" "$adrs" "$ios" >>"$out"
