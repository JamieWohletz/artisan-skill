#!/usr/bin/env bash
#
# Stop hook: refuses to end a turn when the artisan workflow was skipped, or
# when source was committed without the test suite being run.
#
# These are failures of omission. Nothing is attempted, so no tool-call hook can
# intercept them; the only moment they become visible is when the agent tries to
# finish. Stop is also the only event where a block becomes an instruction to
# keep working rather than mere context.
#
# Deterministic and fast — no model, no subagent. An agent hook on this event was
# measured hanging for six minutes and returning nothing.
#
# Input  (stdin): Stop hook JSON, including stop_hook_active
# Output (stdout): {"hookSpecificOutput":{"hookEventName":"Stop","decision":"block","reason":"..."}}
#                  emitted only when the turn should not end; silence allows it.
#
# Release: `touch ~/.artisan/release` dismisses the next block once. The
# dismissal is recorded so the false-positive rate can be measured later.
#
# Fails open: every error path exits 0. A gate that wedges a session is worse
# than no gate, which is why blocking is the exceptional path here.

set -uo pipefail

ARTISAN_HOME="${ARTISAN_HOME:-$HOME/.artisan}"
RELEASE_FILE="$ARTISAN_HOME/release"
DISMISSALS="$ARTISAN_HOME/dismissals.jsonl"
TEST_RECORD="$ARTISAN_HOME/last-test-run"

input=$(cat) || exit 0
[ -n "$input" ] || exit 0

meta=$(printf '%s' "$input" | jq -r '
  [ (.stop_hook_active // false | tostring), (.cwd // "-"), (.session_id // "-") ] | @tsv
' 2>/dev/null) || exit 0
IFS=$'\t' read -r stop_hook_active cwd session_id <<< "$meta" || exit 0

# A previous Stop hook is already blocking. Allowing the stop here is what keeps
# a failing check from looping forever.
[ "$stop_hook_active" = "true" ] && exit 0

case "$cwd" in
  /*) [ -d "$cwd/docs/artisan" ] || exit 0 ;;
  *) exit 0 ;;
esac

cd "$cwd" 2>/dev/null || exit 0
git rev-parse --git-dir >/dev/null 2>&1 || exit 0

# Reports whether any artisan document has both SOLUTIONS and CHOSEN SOLUTION
# filled in, meaning the workflow's front half was actually completed.
has_completed_workflow_doc() {
  local doc
  for doc in "$cwd"/docs/artisan/*.md; do
    [ -f "$doc" ] || continue
    grep -q '^## SOLUTIONS' "$doc" || continue
    grep -q '^## CHOSEN SOLUTION' "$doc" || continue
    awk '
      /^## (SOLUTIONS|CHOSEN SOLUTION)/ { section = 1; body = ""; next }
      /^## / { section = 0 }
      section && NF { body = body $0 }
      section && /_\(pending/ { placeholder = 1 }
      END { exit (placeholder ? 1 : 0) }
    ' "$doc" || continue
    return 0
  done
  return 1
}

# Lists changed files that are not documentation, across the working tree and
# any commits this branch carries beyond its merge base.
changed_source_files() {
  {
    git status --porcelain 2>/dev/null | awk '{print $NF}'
    local base
    base=$(git merge-base HEAD main 2>/dev/null || git merge-base HEAD origin/main 2>/dev/null)
    [ -n "$base" ] && git diff --name-only "$base"..HEAD 2>/dev/null
  } | grep -v '^docs/' | grep -v '\.md$' | sort -u
}

# Names the commit that introduced source changes without a recorded test run.
untested_commit() {
  [ -f "$TEST_RECORD" ] || return 1
  local recorded head
  recorded=$(cat "$TEST_RECORD" 2>/dev/null)
  head=$(git rev-parse HEAD 2>/dev/null)
  [ -n "$recorded" ] && [ -n "$head" ] || return 1
  [ "$recorded" = "$head" ] && return 1
  git cat-file -e "$recorded^{commit}" 2>/dev/null || return 1
  git diff --name-only "$recorded".."$head" 2>/dev/null \
    | grep -v '^docs/' | grep -q '.' || return 1
  printf '%s' "$head"
}

reasons=""

if [ -n "$(changed_source_files)" ] && ! has_completed_workflow_doc; then
  reasons="Source changed but no docs/artisan document has both SOLUTIONS and CHOSEN SOLUTION filled in. Steps 3 and 4 of the workflow have not been completed for this work."
fi

untested=$(untested_commit) && {
  [ -n "$reasons" ] && reasons="$reasons"$'\n'
  reasons="${reasons}Commit ${untested:0:8} changed source, but tests/run-all.sh has not been run since. Run the suite and smoke test the slice before handing it back."
}

[ -n "$reasons" ] || exit 0

if [ -f "$RELEASE_FILE" ]; then
  rm -f "$RELEASE_FILE"
  mkdir -p "$ARTISAN_HOME" 2>/dev/null
  jq -c -n \
    --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --arg session_id "$session_id" \
    --arg cwd "$cwd" \
    --arg reason "$reasons" \
    '{ts: $ts, session_id: $session_id, cwd: $cwd, dismissed: $reason}' \
    >> "$DISMISSALS" 2>/dev/null
  exit 0
fi

jq -n --arg reason "$reasons"$'\n\n'"To dismiss this once, run: touch $RELEASE_FILE" \
  '{hookSpecificOutput: {hookEventName: "Stop", decision: "block", reason: $reason}}'
