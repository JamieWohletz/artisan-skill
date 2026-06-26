---
name: review
description: Run the artisan staff-engineer auditor over the current work — a fresh-context review of the diff against the artisan principles, recorded in the session ledger. Use for an on-demand quality gut-check.
---

# /artisan:review — staff-engineer review on demand

Dispatch the artisan auditor over the current work, record its verdict in the ledger, and surface the open findings. This is the manual entry point; the same auditor runs automatically via hooks in later versions.

## Why a fresh subagent (do not skip this)

You — the controller — have this session's implementation memory. That memory is exactly what makes a self-review weak: you "know" what the code was meant to do, so you skip checking whether it actually does it. **You MUST dispatch a fresh `general-purpose` subagent to perform the review.** A fresh agent has no implementation history and cannot short-circuit. Your job is only to dispatch it, apply its verdict, and present the results.

## Steps

1. **Locate the plugin scripts.** They live two directories up from this skill's base directory, under `scripts/` — i.e. `<this skill's base dir>/../../scripts`. Resolve that to an absolute path and call it `SCRIPTS`. The auditor prompt is `$SCRIPTS/auditor-prompt.md`; the ledger CLI is `$SCRIPTS/ledger-cli.js`. Set `PROJECT` to the current working directory.

2. **Dispatch the fresh auditor.** Use your harness's subagent-dispatch tool (`Task` in Claude Code; `Agent` in some harnesses) with `subagent_type: "general-purpose"`. The prompt must:
   - Begin with `ultrathink` to maximize its reasoning budget — the auditor's failure mode is shallow thinking, not running out of context.
   - Tell it to **read `$SCRIPTS/auditor-prompt.md` in full and follow it exactly.** Do not paraphrase the prompt; do not summarize the implementation for it (that would pollute its fresh context).
   - Pass only: the project directory (`PROJECT`), the ledger path (`$PROJECT/.artisan/ledger.md`), and — if a transcript path is readily available — that path.
   - Require it to return **only** the JSON `LedgerUpdate` object specified by the auditor prompt, with no prose around it.

3. **Apply the verdict.** The subagent is told to return JSON only, but may wrap it in reasoning prose — **extract the single JSON object** (the ` ```json ` fenced block, or the last top-level `{ ... }`) before saving. Write that JSON to a temp file, then run:
   ```
   node "$SCRIPTS/ledger-cli.js" apply <tmpfile> --project "$PROJECT"
   ```
   If the CLI reports a validation error, the subagent's JSON was malformed — ask it to re-emit valid JSON rather than hand-editing.

4. **Show and summarize.** Run:
   ```
   node "$SCRIPTS/ledger-cli.js" show --project "$PROJECT"
   ```
   Present the result to the user **thesis-first**: one bold summary line (e.g. "**3 findings — 1 risk, 2 questions**"), then the open findings grouped by severity, each with its `file:line` and evidence. Note that findings are advisory today; the 🔴 severity will gate edits in a later version.

## Notes

- The auditor judges from ground truth (the diff) and only uses the ledger to avoid re-raising settled items — so re-running `/artisan:review` is cheap and idempotent (it dedupes).
- It records the user's own interventions (caught bugs, redirections) as `user`-origin items so they survive even after the conversation scrolls out of context.
