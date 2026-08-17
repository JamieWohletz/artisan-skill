#!/usr/bin/env bash
#
# MessageDisplay hook: records per-message style-compliance telemetry.
#
# Pure observation — it never writes to stdout, so it can neither alter what is
# displayed nor slow the stream down with output the user has to read. Its only
# product is an append-only JSONL record used to measure whether artisan's rules
# are actually being followed.
#
# Fires on every streamed batch of assistant text, so the non-final path must
# stay cheap: it appends the delta to a per-message accumulator and exits.
# Evaluation happens once, on the final batch.
#
# Input  (stdin): MessageDisplay hook JSON
# Output: none. Telemetry is appended to $ARTISAN_HOME/telemetry.jsonl.
#
# Fails open: every error path exits 0. A broken hook must never wedge a
# session, and losing telemetry is strictly preferable to losing work.

set -uo pipefail

ARTISAN_HOME="${ARTISAN_HOME:-$HOME/.artisan}"
ACC_DIR="$ARTISAN_HOME/acc"
TELEMETRY="$ARTISAN_HOME/telemetry.jsonl"
ACC_REAP_MINUTES=60

acc_max_bytes="${ARTISAN_ACC_MAX_BYTES:-262144}"
case "$acc_max_bytes" in
  ''|*[!0-9]*) acc_max_bytes=262144 ;;
esac

min_chars="${ARTISAN_MIN_SUBSTANTIVE_CHARS:-300}"
case "$min_chars" in
  ''|*[!0-9]*) min_chars=300 ;;
esac

mkdir -p "$ACC_DIR" || exit 0

# Accumulators are only reaped on the final batch. Interrupted messages and
# killed sessions never reach it, so sweep abandoned files on every invocation.
find "$ACC_DIR" -type f -mmin "+$ACC_REAP_MINUTES" -delete 2>/dev/null

input=$(cat) || exit 0
[ -n "$input" ] || exit 0

meta=$(printf '%s' "$input" | jq -r '
  [ (.message_id // "unknown")
  , (.final // false | tostring)
  , (.session_id // "-")
  , (.cwd // "-")
  ] | @tsv
' 2>/dev/null) || exit 0

IFS=$'\t' read -r message_id is_final session_id cwd <<< "$meta" || exit 0

# message_id becomes a path component, so it must be a plain basename.
case "$message_id" in
  ''|.|..|*[!A-Za-z0-9._-]*) exit 0 ;;
esac

acc="$ACC_DIR/$message_id"

# Bound the accumulator: it is slurped whole by jq below, so an unbounded
# message would make this hook's cost unbounded too.
if [ -f "$acc" ]; then
  acc_size=$(wc -c < "$acc" 2>/dev/null || printf '0')
else
  acc_size=0
fi
if [ "$acc_size" -lt "$acc_max_bytes" ]; then
  printf '%s' "$input" | jq -j '.delta // ""' 2>/dev/null >> "$acc" || exit 0
fi

if [ "$is_final" != "true" ]; then
  exit 0
fi

[ -f "$acc" ] || exit 0

report=$(jq -n \
  --rawfile msg "$acc" \
  --argjson min "$min_chars" \
  '
  def first_content_line:
    split("\n") | map(select(test("\\S"))) | (.[0] // "");

  def strip_code:
    gsub("(?s)```.*?```"; "") | gsub("`[^`\n]*`"; "");

  def filler_hits($prose):
    [ "you.{0,3}re absolutely right"
    , "you.{0,3}re right"
    , "great question"
    , "excellent question"
    , "i apologize"
    , "happy to help"
    , "certainly!"
    , "of course!"
    ] | map(select(. as $p | $prose | test($p; "i"))) | length;

  ($msg | length) as $chars
  | ($msg | first_content_line) as $first
  | ($msg | strip_code) as $prose
  | {
      chars: $chars,
      is_substantive: ($chars >= $min),
      has_thesis: ($first | test("^\\*\\*[^*]+\\*\\*")),
      filler: filler_hits($prose)
    }
  ' 2>/dev/null) || { rm -f "$acc"; exit 0; }

rm -f "$acc"

# Telemetry loss is deliberately silent: a full disk or unwritable ARTISAN_HOME
# must not interrupt the session, and no downstream consumer depends on an
# unbroken record.
jq -c -n \
  --argjson r "$report" \
  --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg session_id "$session_id" \
  --arg message_id "$message_id" \
  --arg cwd "$cwd" \
  '$r + {ts: $ts, session_id: $session_id, message_id: $message_id, cwd: $cwd}' \
  >> "$TELEMETRY" 2>/dev/null

exit 0
