#!/usr/bin/env python3
"""Unit tests for the pure functions in scripts/artisan-baseline.py.

The published pre-hook compliance figures rest on these functions, so the
strictness of the thesis pattern is pinned explicitly: it is the change that
corrected the reported figure from 69%/48% to 65%/47%.

Usage: tests/baseline.test.py
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

import importlib.util

spec = importlib.util.spec_from_file_location(
    "artisan_baseline",
    Path(__file__).resolve().parent.parent / "scripts" / "artisan-baseline.py",
)
baseline = importlib.util.module_from_spec(spec)
spec.loader.exec_module(baseline)

PASS = 0
FAIL = 0


def check(label: str, expected: object, actual: object) -> None:
    """Records one assertion and prints its outcome.

    Args:
        label: Human-readable description of the assertion.
        expected: The value the code should produce.
        actual: The value it did produce.
    """
    global PASS, FAIL
    if expected == actual:
        PASS += 1
        print(f"  ok   {label}")
    else:
        FAIL += 1
        print(f"  FAIL {label}\n       expected: {expected!r}\n       actual:   {actual!r}")


def long_text(prefix: str = "") -> str:
    """Builds a message comfortably above the substantive threshold.

    Args:
        prefix: Text to place at the start of the message.

    Returns:
        A string of at least SUBSTANTIVE_CHARS characters.
    """
    return prefix + ("padding to clear the substantive threshold. " * 12)


print("artisan-baseline")

check(
    "short message is not scored",
    None,
    baseline.classify_text("Done."),
)
check(
    "message exactly below threshold is not scored",
    None,
    baseline.classify_text("x" * (baseline.SUBSTANTIVE_CHARS - 1)),
)
check(
    "message at threshold is scored",
    baseline.SUBSTANTIVE_CHARS,
    baseline.classify_text("x" * baseline.SUBSTANTIVE_CHARS)["chars"],
)
check(
    "complete bold span counts as a thesis",
    True,
    baseline.classify_text(long_text("**A real thesis line.**\n\n"))["has_thesis"],
)
check(
    "unclosed bold marker does NOT count as a thesis",
    False,
    baseline.classify_text(long_text("**an unclosed marker and then prose "))["has_thesis"],
)
check(
    "bold later in the message does not count",
    False,
    baseline.classify_text(long_text("Ordinary opening. **bold later** "))["has_thesis"],
)
check(
    "leading whitespace is stripped before matching",
    True,
    baseline.classify_text("\n\n" + long_text("**Thesis.**\n"))["has_thesis"],
)
check(
    "empty bold span is not a thesis",
    False,
    baseline.classify_text(long_text("**** "))["has_thesis"],
)

check(
    "summarise with no measurements is zeroed",
    {"n": 0, "thesis": 0.0, "chars": 0.0, "questions_per_turn": 0.0},
    baseline.summarise([], turns=5, questions=3),
)
check(
    "summarise averages thesis share",
    0.5,
    baseline.summarise(
        [{"chars": 100, "has_thesis": True}, {"chars": 300, "has_thesis": False}],
        turns=4,
        questions=0,
    )["thesis"],
)
check(
    "summarise averages length",
    200.0,
    baseline.summarise(
        [{"chars": 100, "has_thesis": True}, {"chars": 300, "has_thesis": False}],
        turns=4,
        questions=0,
    )["chars"],
)
check(
    "summarise divides questions by turns",
    0.5,
    baseline.summarise([{"chars": 400, "has_thesis": True}], turns=4, questions=2)[
        "questions_per_turn"
    ],
)
check(
    "summarise treats zero turns as one to avoid division by zero",
    2.0,
    baseline.summarise([{"chars": 400, "has_thesis": True}], turns=0, questions=2)[
        "questions_per_turn"
    ],
)

check(
    "string content becomes a single text block",
    [{"type": "text", "text": "hello"}],
    baseline.content_blocks({"content": "hello"}),
)
check(
    "missing content yields no blocks",
    [],
    baseline.content_blocks({}),
)
check(
    "non-dict entries are discarded",
    [{"type": "text", "text": "keep"}],
    baseline.content_blocks({"content": [{"type": "text", "text": "keep"}, "drop", None]}),
)
check(
    "a tool result is not a real user turn",
    False,
    baseline.is_real_user_turn([{"type": "tool_result", "content": "x"}]),
)
check(
    "plain text is a real user turn",
    True,
    baseline.is_real_user_turn([{"type": "text", "text": "hi"}]),
)

EMPTY_REPORT = baseline.format_report([])
check(
    "empty report explains itself rather than printing a bare table",
    True,
    "No artisan sessions" in EMPTY_REPORT,
)

ROW = {
    "name": "some-project",
    "turns": 20,
    "split": 5,
    "pre": {"n": 4, "thesis": 1.0, "chars": 1000.0, "questions_per_turn": 0.5},
    "post": {"n": 6, "thesis": 0.5, "chars": 2000.0, "questions_per_turn": 0.25},
}
REPORT = baseline.format_report([ROW])
check("report names the project", True, "some-project" in REPORT)
check("report shows the pre-code thesis share", True, "100%" in REPORT)
check("report shows the post-code thesis share", True, "50%" in REPORT)
check("report includes a mean row", True, "MEAN of 1" in REPORT)

print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
