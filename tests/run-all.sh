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
printf 'All suites passed.\n'
