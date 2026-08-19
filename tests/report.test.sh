#!/usr/bin/env bash
#
# Tests for scripts/artisan-report.sh, plus a cross-instrument check that the
# live hook and the historical baseline script agree on what counts as a thesis
# line. That agreement is what makes telemetry comparable to the baseline, so
# it is asserted rather than assumed.
#
# Usage: tests/report.test.sh

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPORT="$ROOT/scripts/artisan-report.sh"
HOOK="$ROOT/scripts/artisan-message-display.sh"
BASELINE="$ROOT/scripts/artisan-baseline.py"
PASS=0
FAIL=0

check() {
  local label="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    PASS=$((PASS + 1)); printf '  ok   %s\n' "$label"
  else
    FAIL=$((FAIL + 1))
    printf '  FAIL %s\n       expected: %s\n       actual:   %s\n' "$label" "$expected" "$actual"
  fi
}

setup() {
  SANDBOX=$(mktemp -d)
  export ARTISAN_HOME="$SANDBOX/artisan"
  mkdir -p "$ARTISAN_HOME"
}

teardown() { rm -rf "$SANDBOX"; }

# Appends one synthetic telemetry record. Args: session cwd chars has_thesis filler
record() {
  jq -c -n --arg s "$1" --arg c "$2" --argjson ch "$3" --argjson t "$4" --argjson f "$5" \
    '{ts:"2026-08-19T00:00:00Z", session_id:$s, message_id:("m"+$s+($ch|tostring)),
       cwd:$c, chars:$ch, is_substantive:($ch>=300), has_thesis:$t, filler:$f}' \
    >> "$ARTISAN_HOME/telemetry.jsonl"
}

printf 'artisan-report\n'

# --- missing telemetry is an explicit error, not an empty table ------------
setup
out=$(bash "$REPORT" 2>&1); rc=$?
check "missing telemetry exits nonzero" "1" "$rc"
check "missing telemetry explains itself" "true" \
  "$(printf '%s' "$out" | ggrep -q 'No telemetry' && echo true || echo false)"
teardown

# --- thesis share counts only substantive messages -------------------------
setup
record s1 /repo/alpha 1000 true 0
record s1 /repo/alpha 1000 false 0
record s1 /repo/alpha 100 false 0
out=$(bash "$REPORT")
check "substantive count excludes short messages" "true" \
  "$(printf '%s' "$out" | ggrep -qE 's1 +alpha +3 +2 +50%' && echo true || echo false)"
teardown

# --- a session of only short messages reports a dash, not 0% or an error ---
setup
record s2 /repo/beta 50 false 0
out=$(bash "$REPORT")
check "no substantive messages reports a dash" "true" \
  "$(printf '%s' "$out" | ggrep -qE 's2 +beta +1 +0 +-' && echo true || echo false)"
teardown

# --- cwd filter selects a subset -------------------------------------------
setup
record s3 /repo/gamma 1000 true 0
record s4 /repo/delta 1000 false 0
out=$(bash "$REPORT" gamma)
check "filter includes the matching session" "true" \
  "$(printf '%s' "$out" | ggrep -q 'gamma' && echo true || echo false)"
check "filter excludes other sessions" "false" \
  "$(printf '%s' "$out" | ggrep -q 'delta' && echo true || echo false)"
out=$(bash "$REPORT" nothing-matches-this)
check "unmatched filter says so" "true" \
  "$(printf '%s' "$out" | ggrep -q 'No records match' && echo true || echo false)"
teardown

# --- totals aggregate across sessions --------------------------------------
setup
record s5 /repo/eps 1000 true 0
record s6 /repo/zeta 1000 false 1
out=$(bash "$REPORT")
check "total row counts both sessions" "true" \
  "$(printf '%s' "$out" | ggrep -qE 'TOTAL +2 sessions +2 +2 +50% +1' && echo true || echo false)"
teardown

printf '\ncross-instrument agreement\n'

# The live hook and the baseline script must classify a thesis line
# identically, or telemetry cannot be compared against the baseline.
pad='padding to clear the substantive threshold. '
long=''; for _ in $(seq 1 12); do long="$long$pad"; done

for case in "**A real thesis.**|true" "**unclosed marker |false" "Plain opening **bold later** |false" "****|false"; do
  prefix="${case%|*}"; want="${case#*|}"
  setup
  msg="$prefix$long"
  jq -c -n --arg d "$msg" --arg c /repo/x \
    '{message_id:"x1", final:true, delta:$d, cwd:$c, session_id:"s"}' | bash "$HOOK" >/dev/null
  hook_says=$(jq -r '.has_thesis' "$ARTISAN_HOME/telemetry.jsonl")
  py_says=$(MSG="$msg" python3 -c "
import importlib.util, os, pathlib
spec = importlib.util.spec_from_file_location('b', '$BASELINE')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
print(str(m.classify_text(os.environ['MSG'])['has_thesis']).lower())
")
  check "hook and baseline agree on [${prefix:0:22}]" "$want $want" "$hook_says $py_says"
  teardown
done

printf '\n%d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
