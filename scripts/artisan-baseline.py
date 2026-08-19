#!/usr/bin/env python3
"""Reproduces the pre-hook compliance baseline from Claude Code transcripts.

The figures quoted in docs/artisan came from this measurement. It exists so
those numbers can be re-derived rather than taken on trust, and so a later
session can extend the baseline as more artisan sessions accumulate.

Usage:
    scripts/artisan-baseline.py [transcript-root]

Default transcript root is ~/.claude/projects. Sessions are identified by the
distinctive workflow phrase injected when the artisan skill is invoked, and
each is split at its first code edit outside docs/artisan -- the moment
implementation begins, which the analysis identified as the failure boundary.
"""

from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

ARTISAN_MARKER = "PROVIDE OVERVIEW"
SUBSTANTIVE_CHARS = 300
THESIS_PATTERN = re.compile(r"^\*\*[^*]+\*\*")
EDIT_TOOLS = {"Write", "Edit", "NotebookEdit"}


def content_blocks(message: dict) -> list[dict]:
    """Normalises a transcript message's content into a list of typed blocks.

    Args:
        message: The `message` object from one transcript line.

    Returns:
        A list of block dicts, each carrying at least a `type` key.
    """
    content = message.get("content")
    if isinstance(content, str):
        return [{"type": "text", "text": content}]
    return [b for b in (content or []) if isinstance(b, dict)]


def is_real_user_turn(blocks: list[dict]) -> bool:
    """Reports whether blocks represent a human turn rather than a tool result.

    Args:
        blocks: Normalised content blocks from a `user` transcript line.

    Returns:
        True when no block is a tool result, meaning a person spoke.
    """
    return not any(b.get("type") == "tool_result" for b in blocks)


def classify_text(text: str) -> dict | None:
    """Scores one assistant message against the checkable style rules.

    Args:
        text: The assistant message text.

    Returns:
        A dict of measurements, or None when the message is too short to be
        held to Rule 2 (tool narration rather than substantive prose).
    """
    stripped = text.strip()
    if len(stripped) < SUBSTANTIVE_CHARS:
        return None
    return {"chars": len(stripped), "has_thesis": bool(THESIS_PATTERN.match(stripped))}


def summarise(measurements: list[dict], turns: int, questions: int) -> dict:
    """Aggregates per-message measurements into one side of the split.

    Args:
        measurements: Scored substantive messages.
        turns: Conversational turns covered by this side.
        questions: AskUserQuestion calls made during those turns.

    Returns:
        A dict of aggregate figures, zeroed when there are no measurements.
    """
    if not measurements:
        return {"n": 0, "thesis": 0.0, "chars": 0.0, "questions_per_turn": 0.0}
    return {
        "n": len(measurements),
        "thesis": sum(m["has_thesis"] for m in measurements) / len(measurements),
        "chars": sum(m["chars"] for m in measurements) / len(measurements),
        "questions_per_turn": questions / max(turns, 1),
    }


def measure_session(path: Path) -> dict | None:
    """Reads one transcript and measures compliance either side of first code.

    Args:
        path: Path to a session transcript JSONL file.

    Returns:
        A dict holding the session's pre and post figures, or None when the
        session is not an artisan session or never reached implementation.
    """
    turn = 0
    started = False
    split_turn = None
    scored: list[tuple[int, dict]] = []
    questions: list[int] = []

    with path.open() as handle:
        for line in handle:
            try:
                record = json.loads(line)
            except json.JSONDecodeError:
                continue
            if record.get("isSidechain"):
                continue
            message = record.get("message") or {}
            kind = record.get("type")

            if kind == "user" and not record.get("isMeta"):
                blocks = content_blocks(message)
                if not is_real_user_turn(blocks):
                    continue
                text = "".join(b.get("text", "") for b in blocks)
                if ARTISAN_MARKER in text or "/artisan" in text:
                    started = True
                if started:
                    turn += 1
            elif kind == "assistant" and started:
                for block in content_blocks(message):
                    if block.get("type") == "text":
                        measurement = classify_text(block.get("text", ""))
                        if measurement:
                            scored.append((turn, measurement))
                    elif block.get("type") == "tool_use":
                        name = block.get("name", "")
                        if name == "AskUserQuestion":
                            questions.append(turn)
                        if split_turn is None and name in EDIT_TOOLS:
                            target = (block.get("input") or {}).get("file_path", "")
                            if target and "docs/artisan" not in target:
                                split_turn = turn

    if split_turn is None or turn < 6:
        return None

    pre = [m for t, m in scored if t < split_turn]
    post = [m for t, m in scored if t >= split_turn]
    if not pre or not post:
        return None

    return {
        "name": path.parent.name.replace("-Users-jamiewohletz-Code-", "").replace("worktree-repos-", ""),
        "turns": turn,
        "split": split_turn,
        "pre": summarise(pre, split_turn - 1, len([t for t in questions if t < split_turn])),
        "post": summarise(post, turn - split_turn + 1, len([t for t in questions if t >= split_turn])),
    }


def format_report(rows: list[dict]) -> str:
    """Renders measured sessions as a table with a mean row.

    Args:
        rows: Session measurements from measure_session.

    Returns:
        The report as a printable string.
    """
    if not rows:
        return "No artisan sessions with both pre-code and post-code prose were found."

    header = f"{'project':<24}{'turns':>6}{'split':>6}   {'PRE: thesis':>12}{'q/turn':>8}{'chars':>7}   {'POST: thesis':>13}{'q/turn':>8}{'chars':>7}"
    lines = [header, "-" * len(header)]
    for row in rows:
        lines.append(
            f"{row['name'][:23]:<24}{row['turns']:>6}{row['split']:>6}   "
            f"{row['pre']['thesis']:>11.0%}{row['pre']['questions_per_turn']:>8.2f}{row['pre']['chars']:>7.0f}   "
            f"{row['post']['thesis']:>12.0%}{row['post']['questions_per_turn']:>8.2f}{row['post']['chars']:>7.0f}"
        )
    count = len(rows)
    mean = lambda side, key: sum(r[side][key] for r in rows) / count
    lines.append("-" * len(header))
    lines.append(
        f"{'MEAN of ' + str(count):<24}{'':>6}{'':>6}   "
        f"{mean('pre', 'thesis'):>11.0%}{mean('pre', 'questions_per_turn'):>8.2f}{mean('pre', 'chars'):>7.0f}   "
        f"{mean('post', 'thesis'):>12.0%}{mean('post', 'questions_per_turn'):>8.2f}{mean('post', 'chars'):>7.0f}"
    )
    return "\n".join(lines)


def main() -> int:
    """Finds artisan transcripts, measures each, and prints the report.

    Returns:
        A process exit code.
    """
    root = Path(sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser("~/.claude/projects"))
    if not root.is_dir():
        print(f"No transcript root at {root}", file=sys.stderr)
        return 1

    rows = []
    for path in sorted(root.rglob("*.jsonl")):
        if "subagents" in path.parts:
            continue
        try:
            if ARTISAN_MARKER not in path.read_text(errors="ignore"):
                continue
        except OSError:
            continue
        measured = measure_session(path)
        if measured:
            rows.append(measured)

    print(format_report(rows))
    return 0


if __name__ == "__main__":
    sys.exit(main())
