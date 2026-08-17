#!/usr/bin/env bash
#
# Component tests for scripts/artisan-message-display.sh.
#
# Drives the hook exactly as Claude Code does — crafted JSON on stdin — and
# asserts on the telemetry record it appends, plus the invariant that it never
# writes to stdout. Every test runs against a throwaway ARTISAN_HOME so nothing
# touches real telemetry.
#
# Usage: tests/message-display.test.sh

set -uo pipefail

HOOK="$(cd "$(dirname "${BASH_SOURCE[0]}")/../scripts" && pwd)/artisan-message-display.sh"
PASS=0
FAIL=0

setup() {
  SANDBOX=$(mktemp -d)
  export ARTISAN_HOME="$SANDBOX/artisan"
  PROJECT="$SANDBOX/project"
  mkdir -p "$PROJECT"
}

teardown() {
  rm -rf "$SANDBOX"
}

# Feeds one batch to the hook. Args: message_id final delta [cwd]
send() {
  jq -c -n \
    --arg mid "$1" --argjson fin "$2" --arg delta "$3" --arg cwd "${4:-$PROJECT}" \
    '{message_id: $mid, final: $fin, delta: $delta, cwd: $cwd, session_id: "s-test"}' \
    | bash "$HOOK"
}

telemetry() {
  cat "$ARTISAN_HOME/telemetry.jsonl" 2>/dev/null
}

check() {
  local label="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    PASS=$((PASS + 1))
    printf '  ok   %s\n' "$label"
  else
    FAIL=$((FAIL + 1))
    printf '  FAIL %s\n       expected: %s\n       actual:   %s\n' "$label" "$expected" "$actual"
  fi
}

long_prose() {
  local i
  for i in $(seq 1 12); do
    printf 'This is a line of ordinary prose that exists purely to push the message past the substantive threshold. '
  done
}

printf 'artisan-message-display\n'

# --- the hook is silent on stdout, always ---------------------------------
setup
check "non-final batch is silent" "" "$(send 'm-quiet' false '**Thesis.**'$'\n')"
check "final batch is silent" "" "$(send 'm-quiet' true "$(long_prose)")"
teardown

setup
check "violating message is still silent" "" \
  "$(send 'm-bad' true "no thesis and you're absolutely right. $(long_prose)")"
teardown

# --- non-final batches accumulate -----------------------------------------
setup
send "m-accum" false "**Thesis.**"$'\n' >/dev/null
check "non-final batch leaves an accumulator" "1" "$(ls "$ARTISAN_HOME/acc" | wc -l | tr -d ' ')"
check "non-final batch writes no telemetry" "" "$(telemetry)"
teardown

# --- compliant message ----------------------------------------------------
setup
send "m-good" false "**A clear thesis line.**"$'\n' >/dev/null
send "m-good" true "$(long_prose)" >/dev/null
check "records has_thesis true" "true" "$(telemetry | jq -r '.has_thesis')"
check "records is_substantive true" "true" "$(telemetry | jq -r '.is_substantive')"
check "records zero filler" "0" "$(telemetry | jq -r '.filler')"
check "records session and message ids" "s-test m-good" \
  "$(telemetry | jq -r '"\(.session_id) \(.message_id)"')"
check "accumulator is reaped on final" "0" "$(ls "$ARTISAN_HOME/acc" | wc -l | tr -d ' ')"
teardown

# --- missing thesis -------------------------------------------------------
setup
send "m-nothesis" true "Here is a wall of prose with no thesis line at all. $(long_prose)" >/dev/null
check "records has_thesis false" "false" "$(telemetry | jq -r '.has_thesis')"
teardown

# --- short messages are exempt from the substantive threshold -------------
setup
send "m-short" true "Done." >/dev/null
check "short message is not substantive" "false" "$(telemetry | jq -r '.is_substantive')"
teardown

# --- filler in prose vs inside a code fence -------------------------------
setup
send "m-filler" true "**Thesis.**"$'\n'"You're absolutely right. $(long_prose)" >/dev/null
check "filler in prose is counted" "1" "$(telemetry | jq -r '.filler')"
teardown

setup
send "m-fenced" true "**Thesis.**"$'\n'"$(long_prose)"$'\n```\nYou'"'"'re absolutely right\n```\n' >/dev/null
check "filler inside a code fence is ignored" "0" "$(telemetry | jq -r '.filler')"
teardown

# --- accumulation spans batches -------------------------------------------
setup
send "m-multi" false "**Thesis.**"$'\n' >/dev/null
send "m-multi" false "$(long_prose)" >/dev/null
send "m-multi" true "" >/dev/null
chars=$(telemetry | jq -r '.chars')
check "chars accumulate across batches" "true" "$([ "$chars" -gt 300 ] && echo true || echo false)"
teardown

# --- a message_id that is not a plain basename is rejected ----------------
setup
send "../escape" true "$(long_prose)" >/dev/null
check "path-traversal message_id writes no telemetry" "" "$(telemetry)"
check "path-traversal message_id creates no file" "0" \
  "$(find "$ARTISAN_HOME" -name 'escape*' 2>/dev/null | wc -l | tr -d ' ')"
teardown

# --- telemetry is recorded regardless of project --------------------------
setup
mkdir -p "$SANDBOX/elsewhere"
send "m-elsewhere" true "$(long_prose)" "$SANDBOX/elsewhere" >/dev/null
check "telemetry recorded outside the artisan repo" "false" "$(telemetry | jq -r '.has_thesis')"
check "cwd is recorded" "$SANDBOX/elsewhere" "$(telemetry | jq -r '.cwd')"
teardown

# --- malformed input fails open -------------------------------------------
setup
out=$(printf 'not json' | bash "$HOOK")
check "malformed input emits nothing" "" "$out"
check "malformed input exits cleanly" "0" "$?"
teardown

printf '\n%d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
