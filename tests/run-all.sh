#!/usr/bin/env bash
#
# Runs every test suite in this directory and reports a combined result.
#
# Suites are discovered by glob rather than listed, so a new one is picked up
# by existing. An earlier version named each suite explicitly and silently
# omitted a whole file that had been added alongside it.
#
# On success, records the commit the suites passed against. The Stop gate reads
# that record to tell a tested commit from an untested one.
#
# Usage: tests/run-all.sh

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FAILED=""
RAN=0

for suite in "$HERE"/*.test.sh; do
  [ -e "$suite" ] || continue
  RAN=$((RAN + 1))
  bash "$suite" || FAILED="$FAILED $(basename "$suite")"
  printf '\n'
done

for suite in "$HERE"/*.test.py; do
  [ -e "$suite" ] || continue
  RAN=$((RAN + 1))
  python3 "$suite" || FAILED="$FAILED $(basename "$suite")"
  printf '\n'
done

if [ "$RAN" -eq 0 ]; then
  printf 'No test suites found in %s\n' "$HERE" >&2
  exit 1
fi

if [ -n "$FAILED" ]; then
  printf 'FAILED suites:%s\n' "$FAILED"
  exit 1
fi

ARTISAN_HOME="${ARTISAN_HOME:-$HOME/.artisan}"
if mkdir -p "$ARTISAN_HOME" 2>/dev/null; then
  git -C "$HERE/.." rev-parse HEAD > "$ARTISAN_HOME/last-test-run" 2>/dev/null
fi

printf '%d suites passed.\n' "$RAN"
