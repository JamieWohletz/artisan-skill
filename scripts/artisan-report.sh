#!/usr/bin/env bash
#
# Reports style-compliance figures from the telemetry that
# artisan-message-display.sh collects.
#
# Usage:
#   scripts/artisan-report.sh              # per-session table, newest first
#   scripts/artisan-report.sh <substring>  # only sessions whose cwd matches
#
# Reads $ARTISAN_HOME/telemetry.jsonl (default ~/.artisan/telemetry.jsonl).
#
# "thesis" is the share of substantive messages leading with a bold thesis
# line, which is Rule 2. Messages below the substantive threshold are excluded
# because tool narration is not expected to carry a thesis.

set -uo pipefail

ARTISAN_HOME="${ARTISAN_HOME:-$HOME/.artisan}"
TELEMETRY="$ARTISAN_HOME/telemetry.jsonl"
FILTER="${1:-}"

if [ ! -s "$TELEMETRY" ]; then
  printf 'No telemetry at %s\n' "$TELEMETRY" >&2
  printf 'The MessageDisplay hook has not run yet, or ARTISAN_HOME points elsewhere.\n' >&2
  exit 1
fi

jq -s -r --arg filter "$FILTER" '
  def pct($n; $d): if $d > 0 then (($n * 100 / $d) | floor | tostring) + "%" else "-" end;
  def pad($s; $w): ($s | tostring) as $t | $t + (" " * ([$w - ($t | length), 0] | max));
  def lpad($s; $w): ($s | tostring) as $t | (" " * ([$w - ($t | length), 0] | max)) + $t;

  map(select($filter == "" or (.cwd | contains($filter))))
  | if length == 0 then "No records match \($filter)" else

  ( group_by(.session_id)
    | map(
        ([.[] | select(.is_substantive)]) as $s
        | {
            sid: (.[0].session_id[0:8]),
            project: (.[0].cwd | split("/") | last),
            last: (map(.ts) | max),
            msgs: length,
            subst: ($s | length),
            thesis: ([$s[] | select(.has_thesis)] | length),
            filler: ([.[] | select(.filler > 0)] | length),
            avg: (if ($s | length) > 0 then (([$s[] | .chars] | add) / ($s | length) | floor) else 0 end)
          }
      )
    | sort_by(.last) | reverse
  ) as $rows

  | ( [ pad("session"; 10), pad("project"; 24), lpad("msgs"; 5), lpad("subst"; 6),
        lpad("thesis"; 7), lpad("filler"; 7), lpad("avgchars"; 9) ] | join("") )
  , ( "-" * 68 )
  , ( $rows[]
      | [ pad(.sid; 10), pad((.project[0:23]); 24), lpad(.msgs; 5), lpad(.subst; 6),
          lpad(pct(.thesis; .subst); 7), lpad(.filler; 7), lpad(.avg; 9) ] | join("")
    )
  , ( "-" * 68 )
  , ( ([$rows[] | .subst] | add) as $ts
      | ([$rows[] | .thesis] | add) as $tt
      | ([$rows[] | .msgs] | add) as $tm
      | [ pad("TOTAL"; 10), pad("\($rows | length) sessions"; 24), lpad($tm; 5),
          lpad($ts; 6), lpad(pct($tt; $ts); 7),
          lpad(([$rows[] | .filler] | add); 7), lpad(""; 9) ] | join("")
    )
  end
' "$TELEMETRY"
