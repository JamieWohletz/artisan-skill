#!/usr/bin/env bash
#
# Runs every test suite in this directory and reports a combined result.
#
# Usage: tests/run-all.sh

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FAILED=""

for suite in "$HERE"/message-display.test.sh "$HERE"/report.test.sh; do
  bash "$suite" || FAILED="$FAILED $(basename "$suite")"
  printf '\n'
done

python3 "$HERE"/baseline.test.py || FAILED="$FAILED baseline.test.py"

printf '\n'
if [ -n "$FAILED" ]; then
  printf 'FAILED suites:%s\n' "$FAILED"
  exit 1
fi

# Record the commit these suites passed against. The Stop gate compares this
# against HEAD to tell a tested commit from an untested one.
ARTISAN_HOME="${ARTISAN_HOME:-$HOME/.artisan}"
if mkdir -p "$ARTISAN_HOME" 2>/dev/null; then
  git -C "$HERE/.." rev-parse HEAD > "$ARTISAN_HOME/last-test-run" 2>/dev/null
fi

printf 'All suites passed.\n'
