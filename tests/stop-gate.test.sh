#!/usr/bin/env bash
#
# Tests for scripts/artisan-stop-gate.sh.
#
# Each case builds a throwaway git repository and drives the hook with crafted
# Stop JSON. The loop-protection case is the important one: a Stop hook that
# blocks unconditionally never lets a session end.
#
# Usage: tests/stop-gate.test.sh

set -uo pipefail

GATE="$(cd "$(dirname "${BASH_SOURCE[0]}")/../scripts" && pwd)/artisan-stop-gate.sh"
PASS=0
FAIL=0

for tool in grep jq git awk; do
  command -v "$tool" >/dev/null 2>&1 || {
    printf 'required tool not found: %s\n' "$tool" >&2
    exit 1
  }
done

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
  REPO="$SANDBOX/repo"
  mkdir -p "$REPO/docs/artisan" "$ARTISAN_HOME"
  git -C "$REPO" init -q -b main
  git -C "$REPO" config user.email t@example.com
  git -C "$REPO" config user.name Test
  printf 'seed\n' > "$REPO/README.md"
  git -C "$REPO" add -A && git -C "$REPO" commit -qm seed
}

teardown() { rm -rf "$SANDBOX"; }

# Runs the gate. Args: [stop_hook_active] [cwd]
run_gate() {
  jq -c -n --argjson active "${1:-false}" --arg cwd "${2:-$REPO}" \
    '{stop_hook_active: $active, cwd: $cwd, session_id: "s-test"}' | bash "$GATE"
}

blocked() {
  [ -n "$1" ] && printf '%s' "$1" | jq -e '.hookSpecificOutput.decision == "block"' >/dev/null 2>&1 \
    && echo true || echo false
}

complete_doc() {
  cat > "$REPO/docs/artisan/doc.md" <<'EOF'
# A problem

## SOLUTIONS
### S1
A real mechanism.

## CHOSEN SOLUTION
S1, because of the evidence above.
EOF
}

placeholder_doc() {
  cat > "$REPO/docs/artisan/doc.md" <<'EOF'
# A problem

## SOLUTIONS

_(pending — step 3)_

## CHOSEN SOLUTION

_(pending — step 4)_
EOF
}

add_source() { printf 'export const x = 1;\n' > "$REPO/src.ts"; }

printf 'artisan-stop-gate\n'

# --- loop protection comes before every other consideration ----------------
setup
add_source
placeholder_doc
check "stop_hook_active=true always allows the stop" "false" "$(blocked "$(run_gate true)")"
teardown

# --- scoping ----------------------------------------------------------------
setup
add_source
rm -rf "$REPO/docs/artisan"
check "non-artisan repo is not gated" "false" "$(blocked "$(run_gate false)")"
teardown

setup
check "artisan repo with no source change is not gated" "false" "$(blocked "$(run_gate false)")"
teardown

setup
add_source
check "missing cwd is not gated" "false" "$(blocked "$(run_gate false /nonexistent-path)")"
teardown

# --- skipped workflow -------------------------------------------------------
setup
add_source
placeholder_doc
out=$(run_gate false)
check "source change with placeholder sections blocks" "true" "$(blocked "$out")"
check "block names the missing sections" "true" \
  "$(printf '%s' "$out" | jq -r '.hookSpecificOutput.reason' | grep -q 'CHOSEN SOLUTION' && echo true || echo false)"
teardown

setup
add_source
complete_doc
check "source change with a completed doc does not block" "false" "$(blocked "$(run_gate false)")"
teardown

setup
complete_doc
printf 'notes\n' > "$REPO/docs/artisan/notes.md"
check "documentation-only changes never count as source" "false" "$(blocked "$(run_gate false)")"
teardown

# --- untested commits -------------------------------------------------------
setup
complete_doc
add_source
git -C "$REPO" add -A && git -C "$REPO" commit -qm "source"
git -C "$REPO" rev-parse HEAD > "$ARTISAN_HOME/last-test-run"
check "commit recorded as tested does not block" "false" "$(blocked "$(run_gate false)")"

printf 'export const y = 2;\n' > "$REPO/src2.ts"
git -C "$REPO" add -A && git -C "$REPO" commit -qm "more source"
out=$(run_gate false)
check "source committed after the test record blocks" "true" "$(blocked "$out")"
check "block tells you to run the suite" "true" \
  "$(printf '%s' "$out" | jq -r '.hookSpecificOutput.reason' | grep -q 'run-all.sh' && echo true || echo false)"
teardown

setup
complete_doc
add_source
git -C "$REPO" add -A && git -C "$REPO" commit -qm "source"
git -C "$REPO" rev-parse HEAD > "$ARTISAN_HOME/last-test-run"
printf 'more docs\n' >> "$REPO/docs/artisan/doc.md"
git -C "$REPO" add -A && git -C "$REPO" commit -qm "docs only"
check "a docs-only commit after testing does not block" "false" "$(blocked "$(run_gate false)")"
teardown

setup
complete_doc
add_source
git -C "$REPO" add -A && git -C "$REPO" commit -qm "source"
check "no test record at all does not block" "false" "$(blocked "$(run_gate false)")"
teardown

# --- release ----------------------------------------------------------------
setup
add_source
placeholder_doc
touch "$ARTISAN_HOME/release"
check "release dismisses the block" "false" "$(blocked "$(run_gate false)")"
check "release file is consumed" "false" \
  "$([ -f "$ARTISAN_HOME/release" ] && echo true || echo false)"
check "dismissal is recorded" "true" \
  "$([ -s "$ARTISAN_HOME/dismissals.jsonl" ] && echo true || echo false)"
check "dismissal records what was dismissed" "true" \
  "$(jq -e '.dismissed | test("CHOSEN SOLUTION")' "$ARTISAN_HOME/dismissals.jsonl" >/dev/null 2>&1 && echo true || echo false)"
check "release is one-shot, not permanent" "true" "$(blocked "$(run_gate false)")"
teardown

# --- fail open --------------------------------------------------------------
setup
out=$(printf 'not json' | bash "$GATE"); rc=$?
check "malformed input emits nothing" "" "$out"
check "malformed input exits cleanly" "0" "$rc"
teardown

printf '\n%d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
