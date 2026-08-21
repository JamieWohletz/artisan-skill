# artisan

> Write code like a true software engineering artisan.

A [Claude Code](https://claude.com/claude-code) skill that turns the agent into a knowledgeable, well-seasoned pair programmer. Software engineering is both an art and a science — more akin to blacksmithing than to mathematics. This skill encodes the principles and the collaborative workflow that make solutions _feel_ right.

## What it does

`artisan` is a **collaborative, Socratic workflow**, not an autopilot. It pairs with you to:

1. **Define the problem** — a problem is a stop sign, not a solution in disguise (what / why / for whom).
2. **Comprehend the problem** — five whys, hypotheses, and a written record in `docs/artisan/`.
3. **Solve it multiple times** — five distinct solutions before any code is written.
4. **Pick the best solution** — weighed against the engineering principles below.
5. **Implement in vertical slices** — small, tested, reviewed, and committed one at a time.
6. **Review** — smoke test, explain it back, then push.
7. **Write the pull request** — using the repo's template, with your annotations.

## Guiding principles

- **Elegance over expedience.** The simple, elegant solution beats the fast, easy, complicated one.
- **Right tool for the job.** CSS for styling, JS for interaction, well-known data structures for well-known problems.
- **Minimize footprint.** Less code, fewer bytes, stream don't buffer.
- **Lean on the type system.** Strictly, often, no escape hatches.
- **Work in small pieces.** One fully-functional vertical slice at a time.
- **Grow software iteratively** — like a bonsai, not a building.
- **Separate side effects from pure functions.**
- **Computer science fundamentals** are the most valuable tool available.

## Measurement and review

The workflow above is a set of instructions, and instructions are followed unevenly. Measuring seven prior artisan sessions from Claude Code's own transcripts showed the discipline holding through problem definition and giving way once implementation began:

|  | thesis-first responses | `AskUserQuestion` per turn | mean response length |
|---|---|---|---|
| Before the first code edit | 65% | 0.59 | 1643 chars |
| After the first code edit | 47% | 0.29 | 1967 chars |

So the skill ships with two hooks that make adherence observable instead of assumed.

### Compliance telemetry

A `MessageDisplay` hook records one line per assistant message to `~/.artisan/telemetry.jsonl`:

```json
{"chars":1935,"is_substantive":true,"has_thesis":true,"filler":0,"ts":"…","session_id":"…","cwd":"…"}
```

It is pure observation — it never writes to stdout, alters what you see, or sends anything anywhere. Written in `bash` and `jq` because it fires on every streamed batch of text, where a `node` process would cost 56ms against `jq`'s 7ms.

An earlier version appended a visible warning when a rule was broken. It was removed: a marker arrives after the message has already been read, reports the violation to the one party who cannot fix it, and taxes every message to restate the obvious.

Read the results with:

```bash
scripts/artisan-report.sh              # per-session table, newest first
scripts/artisan-report.sh my-project   # only sessions whose cwd matches
scripts/artisan-baseline.py            # re-derive the historical figures above
```

### Commit review

A `PostToolUse` hook spawns a **fresh subagent** on each commit. It has not read the conversation, which is the point — it judges the record on its own terms, against fifteen numbered pass/fail checks: eight for the code in the diff, seven for the reasoning in any `docs/artisan/` document the commit touched.

Findings arrive as context and the work continues; nothing is blocked. The prompt biases hard toward silence, because a reviewer that always finds something gets ignored and then switched off.

### What these hooks do not do

- **Only commits the agent makes are reviewed.** Hooks fire on tool calls, so a commit you type yourself produces no review.
- **The report mixes artisan and non-artisan sessions.** Telemetry is recorded everywhere; a session that never invoked `/artisan` is under no obligation to lead with a thesis, so compare like with like using the `cwd` filter.
- **Rule 1 is invisible to telemetry.** `MessageDisplay` sees prose, not tool calls, so `AskUserQuestion` rate is measurable only from transcripts via `artisan-baseline.py`.
- **Hook changes need a new session.** Plugin hook declarations are read once at startup and cached.

## Requirements

`bash`, `jq`, and `python3`. `jq` does the work in both shell scripts; `python3` runs the baseline analysis and its tests.

## Installation

Clone into your Claude Code skills directory:

```bash
git clone https://github.com/JamieWohletz/artisan-skill.git ~/.claude/skills/artisan
```

That directory contains a plugin manifest, so Claude Code loads it as `artisan@skills-dir` on the next session — the skill and both hooks together, with no install step. Confirm with:

```bash
claude plugin list | grep artisan
```

Then invoke it in Claude Code:

```
/artisan
```

## Development

```bash
tests/run-all.sh
```

43 tests across three suites. Four of them feed identical text to the live hook and to the historical analysis script and assert the two agree on what counts as a thesis line — without that, telemetry and baseline would not be comparable.

The full analysis behind the figures above, including the refuted hypotheses, is in [`docs/artisan/`](docs/artisan/).

## License

MIT
