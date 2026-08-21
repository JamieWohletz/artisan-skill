# Artisan discipline collapses during implementation

Date: 2026-08-17

## PROBLEM STATEMENT

1. **WHAT is the problem:** Artisan's rules and workflow hold through problem definition and solution selection, then collapse once implementation begins — and some sessions never enter the governed phase at all.
2. **WHY is it a problem:** Steps 2–4 name concrete decision points and produce an inspectable artifact; step 5 is a single paragraph covering hours of work with no per-slice checkpoints, so nothing detects or contests the drift.
3. **For WHOM is it a problem:** Jamie, who does the most consequential work — writing code — in the least governed phase of the workflow.

### How we got here

The opening report was "the workflow is great, except it is quickly forgotten by Claude, and Claude falls back to wordy, uncanny-valley explanations." That statement bundled an observation (output degrades) with a diagnosis (memory decay). The diagnosis was treated as a hypothesis, not a premise.

Two clarifying questions narrowed the symptom:

- **Which failure mode?** → Both style drift and process drift, roughly equally.
- **When does it break down?** → Gradually, over ~10+ turns.

The stated onset ("gradual, turn-count driven") turned out to be the wrong frame. Turn count is correlated with the real boundary — the start of implementation — but is not the cause.

### Method

Seven prior `/artisan` sessions were located in `~/.claude/projects/` by searching transcript JSONL for the distinctive workflow phrase `PROVIDE OVERVIEW`. Compliance was measured directly from the transcripts rather than inferred:

- **Rule 2 compliance** — fraction of substantive assistant messages (≥300 chars, to exclude one-line tool narration) beginning with a bold thesis (`^\*\*`).
- **Rule 1 compliance** — `AskUserQuestion` calls per conversational turn.
- **Verbosity** — mean character count of substantive messages.
- **Workflow compliance** — presence of `docs/artisan/` writes, `TodoWrite` calls.

Sessions were split at their **first non-doc `Write`/`Edit`** — the moment implementation begins — rather than at their midpoint.

### Five whys (as run, including the branch that was wrong)

1. **Why does the skill stop being applied?** Its content is injected once; everything after is newer and louder.
2. **Why does newer win?** Nothing in the intervening context restates the skill.
3. **Why does nothing restate it?** The skill produces no recurring artifact that must be re-read. The `docs/artisan` doc is written once and abandoned.
4. **Why is it built that way?** It is written as a description of values ("elegance is paramount", "be concise", "don't be a sycophant") rather than a sequence of gates with pass/fail conditions.
5. **Why does that matter?** Values have no observable failure state. Neither Claude nor tooling can detect a violation. Unverifiable instructions decay silently; verifiable ones fail loudly.

This chain is directionally right but incomplete — it predicts uniform decay, and the measurements show a **phase transition**, not a slope.

## HYPOTHESES TESTED

### H1: Compliance decays gradually with turn count

**HYPOTHESIS:** Rule adherence starts high and erodes as the conversation lengthens.

**TEST:** Split each session into early/late halves by turn index; compare Rule 2 compliance and message length on substantive messages.

**RESULTS:**

| Session length | Rule 2 early → late | Avg chars early → late |
|---|---|---|
| 11 turns | 67% → 75% | 1676 → 1925 |
| 85 turns | 14% → 13% | 1033 → 1172 |
| 40 turns | 73% → 21% | 1589 → 1729 |
| 27 turns | 100% → 67% | 2699 → 2150 |
| 14 turns | 43% → 33% | 2344 → 1258 |
| **mean** | **59% → 42%** | **1868 → 1647** |

**CONFIDENCE:** Low — **partially refuted.** Decay exists (59% → 42%) but compliance is already poor at the start; there is no high plateau to decay *from*. Message length is flat-to-declining, contradicting "wordy". One session sat at 13–14% throughout and never varied. Turn count alone does not explain the pattern.

### H2: The complaint is verbosity

**HYPOTHESIS:** Responses get longer over a session, which is what reads as uncanny-valley filler.

**TEST:** Mean character count of substantive messages, early vs. late halves.

**RESULTS:** 1868 → 1647 chars. Slightly *shorter* late.

**CONFIDENCE:** Low — **refuted under this split, later confirmed under the correct split (see H3).** The midpoint split straddles the code boundary and cancels the effect. The measurement was correct; the instrument was aimed at the wrong seam.

### H3: Discipline collapses at the start of implementation

**HYPOTHESIS:** Steps 2–4 are governed; step 5 is not. The failure boundary is the first line of code, not turn 10.

**TEST:** Split each session at its first non-doc `Write`/`Edit`; compare Rule 2 compliance, `AskUserQuestion` rate, and message length across that boundary. n = 6 sessions.

**RESULTS:**

| | Rule 2 (bold thesis) | AskUserQuestion / turn | Avg chars |
|---|---|---|---|
| Pre-code | 69% | 0.59 | 1643 |
| Post-code | 48% | 0.29 | **1967** |

**CONFIDENCE:** High for direction, moderate for magnitude (n = 6). Rule 2 drops 30% relative. Rule 1 rate halves. Messages grow 20% longer. **Longer plus less structured is precisely the reported symptom** — verbosity is real, but only after implementation starts, which is why the turn-count framing found nothing.

### H4: Compliance tracks verifiability, not emphasis

**HYPOTHESIS:** Instructions that name a concrete artifact are followed; instructions that describe a quality are not, regardless of how forcefully they are stated.

**TEST:** Compare adherence rates across three instruction classes in the same seven sessions.

**RESULTS:**

| Instruction | Form | Compliance |
|---|---|---|
| `docs/artisan/<doc>.md` | Names a path, produces an artifact | **6 / 7 sessions** |
| `TodoWrite` ("you MUST") | Names a tool, no inspectable artifact | **0 / 7 sessions** |
| "Be concise", "elegance is paramount", "don't be a sycophant" | Describes a quality | **~50%** |

**CONFIDENCE:** High for the ordering, moderate for causation. Shouting `MUST` bought nothing. Naming a file path bought 86%. Caveat: the `TodoWrite` line was added in today's commit (`1202727`), so those seven sessions predate its current phrasing — its predecessor wording fared no better, but the current wording is untested.

### H5: Artisan is outcompeted by other instructions

**HYPOTHESIS:** Global `CLAUDE.md`, superpowers system-reminders, and the harness prompt issue style directives continuously while artisan states its rules once, so artisan loses on repetition.

**TEST:** Not run. Would require sessions with and without the competing skill stack.

**CONFIDENCE:** Unknown — plausible and untested. Retained as a contributing factor, not adopted as the primary cause. Noted that competing instructions use imperative shouting (`EXTREMELY-IMPORTANT`, `ABSOLUTELY MUST`) while artisan asks politely — though H4 suggests emphasis is not what drives compliance anyway.

## SECONDARY FINDINGS

- **Two of six sessions issued their first code edit at turn 2.** The entire front half of the workflow — problem doc, five solutions, chosen solution — was skipped outright. This is a distinct and more severe failure than drift: those sessions never entered the governed phase.
- **`AskUserQuestion` clusters in steps 2–4 and evaporates afterward.** One 85-turn session made 29 calls, nearly all before turn 12. Rule 1 says "always", but only steps 2–4 describe decision points; step 5 gives the rule nothing to attach to.
- **One session (85 turns) sat at 5% pre-code compliance.** Code is not its explanation. Something went wrong at invocation. Unexplained; flagged for follow-up.
- **The `docs/artisan` doc is written once and never re-read.** It is the skill's only durable artifact and it plays no role after step 2.

## SOLUTIONS

### Inversion first

Asked: how would we make artisan collapse *faster*? Answer:

- Put every rule in one long file, read once, never referenced again
- State rules as abstract prohibitions with no observable failure condition
- Give the longest, highest-stakes phase the shortest instruction — one paragraph
- Produce no recurring artifact that forces re-reading
- Let code editing begin before the workflow's gates have been passed

That list is a description of the current `SKILL.md`. The inversion invented nothing; it read the file back.

### The precedent that constrains every out-of-band option

Codebase Guardian is a `PreToolUse` hook on `Edit|Write` that ran headless Claude on every edit. Its logs: **6734 ALLOW / 548 DENY** (92.5% no-op), median **~16s per edit**, outliers to 45s. It was disabled on 2026-08-17 (`settings.json` matcher renamed to `DISABLED_2026_08_17_restore_to__Edit|Write`). Roughly 30 hours of cumulative waiting to catch 548 issues. Any solution that puts an LLM in the per-edit path inherits this math.

### Cost model that makes a per-step reviewer viable

| | commits | code edits | edits/commit |
|---|---|---|---|
| 6 sessions | 56 | 452 | **8.1** |

Reviewing per **commit** rather than per **edit** is 8x cheaper. At Guardian's ~16s: ~15 min across all six sessions (~2.5 min/session) versus 120 min. Gating on the step, not the edit, is what makes LLM review affordable. Reviewing a landed commit is also off the hot path — it cannot stall an edit mid-thought.

### S1 — Slice gates (in-band restructure)

Step 5 becomes an explicit repeating loop; each slice must append a fixed-schema WORK LOG entry before the next begins.

- **Pro:** free, portable, zero latency; reuses the only mechanism measured at 86% (artifact at a named path). Gives Rule 1 a decision point to attach to at each slice boundary.
- **Con:** still self-policed. Re-reading the doc re-injects the *problem*, not the *rules* — the WORK LOG schema would have to carry the checklist itself, which reintroduces the cargo-cult risk. The 86% figure comes from one file written once, early; extrapolating to twelve appends across forty turns is a stretch.

### S2 — `UserPromptSubmit` rule-card injection

A hook detects an active artisan session and injects a compact rule card as context every prompt. No LLM, ~5ms.

- **Pro:** fixes the loudness asymmetry — artisan is stated once, superpowers is re-injected forever.
- **Con:** tests H5, which was never validated. H4 suggests repetition is not what buys compliance. Token cost every turn.

### S3 — `Stop`-hook style gate (deterministic)

Regex check on turn end: substantive message not starting with `**` → block, forcing a rewrite. ~5ms.

- **Pro:** real enforcement on the exact measured metric.
- **Con:** severe Goodhart risk — produces thesis-shaped sentences without the thinking behind them. Optimizes the metric that was chosen for measurement, which is not the same as fixing the problem. Blind to process.

### S4 — `PreToolUse` process gate (deterministic)

Non-doc `Write`/`Edit` denied while the session's artisan doc still has empty SOLUTIONS / CHOSEN SOLUTION. A file read, ~5ms — not Guardian's 16s.

- **Pro:** makes "first code edit at turn 2" structurally impossible; attacks the most severe finding.
- **Con:** same surface just disabled. Needs an escape hatch or it becomes infuriating.

### S5 — Phase-boundary reviewer subagent

At each phase/slice boundary, a **fresh** subagent reads `SKILL.md` cold plus the diff, grades compliance, reports violations into context.

- **Pro:** the reviewer has not drifted — this is the key property. It is not the degraded agent self-checking; it is an undrifted one checking. Sidesteps the Goodhart problem in S3. The only option that can judge the unjudgeable (is this diff elegant, are these five solutions actually distinct).
- **Con:** Guardian's architecture. Tokens, latency, and the auditor can drift too. Requires a non-discretionary trigger or it decays like `TodoWrite` (0/7).

## CHOSEN SOLUTION

**S5, scoped to per-step review with a deterministic hook trigger.**

Two review checkpoints, each executed by a **fresh** subagent (headless `claude -p`) so the reviewer reads `SKILL.md` at full salience rather than through a degraded context:

1. **Doc review** — fires when the artisan doc's SOLUTIONS and CHOSEN SOLUTION sections become populated. Reviews the problem statement, the five solutions, and the choice.
2. **Commit review** — fires once per commit. Reads `SKILL.md` plus the commit diff, reviews for adherence to the engineering principles.

### Decisions and rationale

| Decision | Choice | Why |
|---|---|---|
| Trigger | `PostToolUse` hook | Discretionary invocation is the failure being fixed. "Spawn a reviewer each slice" is the same instruction shape that measured 0/7 for `TodoWrite`. The trigger must not be forgettable. |
| Cadence | Per commit, not per edit | 8.1 edits/commit → 8x cheaper than Guardian, ~2.5 min/session. Off the hot path. |
| Teeth | Report into context, agent must respond | Re-injection of an undrifted voice is itself the fix. A hard block risks Guardian's 92.5% false-positive experience. |
| Scope | Process only for now | The style half (bold-thesis 69%→48%, +20% length) happens in prose that never reaches a diff. Deferred deliberately; revisit after measuring whether process discipline improves style as a side effect. |

### Mechanics confirmed against the docs

- `matcher` matches the **tool name only**. "Hook on `git commit`" is not directly expressible — match `Bash`, filter on `tool_input.command` in-script.
- `PostToolUse` **cannot block via JSON** (`decision: "block"` unsupported); only exit 2 + stderr blocks. `hookSpecificOutput.additionalContext` is supported and is the correct envelope for report-into-context.
- Guardian's source carries a hard-won lesson: the legacy exit-2 + stderr `{permissionDecision}` convention is classified as a non-blocking error, so denies never blocked. **JSON on stdout, exit 0.**
- Hooks must **fail open** — a broken reviewer must never wedge a session.

### Deferred

- **S1 (slice gates)** — cheap and complementary; revisit if the reviewer alone does not restore step-5 discipline.
- **S4 (process gate)** — directly addresses sessions that began editing at turn 2; deferred to keep the first increment small.
- **S3 (style gate)** — rejected for now on Goodhart risk.
- **Style reviewer** — deferred per the scope decision above.
- **The 85-turn session at 5% pre-code compliance** — unexplained by any chosen solution. Open question.

## REVISION — findings that changed the plan after CHOSEN SOLUTION was written

Three capabilities were absent from all five solutions above because they were not known when those were drafted. They materially change the design.

### `MessageDisplay` hook event

Fires while assistant message text is displayed. No matcher, always fires, 10s timeout (lowered from the default).

- **Input** carries `delta` (newly displayed lines), `message_id`, `index`, `final`. In `claude -p` and Agent SDK runs it fires once per message with the whole text.
- **Output** supports `displayContent`, which replaces *that batch's delta* on screen. `systemMessage` and `continue` are discarded for this event, and it has no decision control — it cannot block a message or alter the transcript.
- **Consequence:** the style half of the problem, deferred as uncoverable by a commit reviewer, becomes cheaply detectable. A regex on the final batch can flag a missing thesis line and surface it *to the user*, with no model round-trip and no tokens.

### Agent hooks (`type: "agent"`)

Claude Code spawns a subagent natively with the hook's JSON input; it can use Read/Grep/Glob and returns `{ok: true}` or `{ok: false, reason}`. On `ok: false` it behaves like a prompt hook with `continueOnBlock: true` — the reason reaches Claude and work continues.

- **Consequence:** "spin up a fresh subagent per step" is a configuration entry, not code. The chosen solution's teeth (report into context, do not block) are the default behavior.

### `TodoWrite` is unavailable on this model — a third failure class

`TodoWrite` and all four Task tools are excluded on Opus 4.8 / Sonnet 5 / Fable 5 / Mythos 5 and later in Claude Code v2.1.233+, unless opted in via `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`.

This revises **H4**. The 0/7 compliance was read as "MUST buys nothing without an artifact." The sharper reading: **the instruction was unsatisfiable**. Commit `1202727` mandated a tool that does not exist on the model in use, and nothing reported the impossibility — it failed silently, exactly like the unverifiable rules.

That is a third failure class, distinct from drift and from skipping:

| Class | Example | Detectable today |
|---|---|---|
| Drift | Rule 2 decays 69% → 48% post-code | No |
| Skipping | First code edit at turn 2 | No |
| **Impossible** | `MUST use TodoWrite` on Opus 5 | **No** |

**Resolved:** `CLAUDE_CODE_ENABLE_TODO_TOOLS=1` added to `settings.json` (took effect immediately, no restart), and `SKILL.md` step 5 now names `TaskCreate`/`TaskUpdate`/`TaskList`/`TaskGet` and requires an explicit statement when the tools are unavailable rather than a silent substitution.

### Guardian's "disable" never disabled `Write`

The matcher `DISABLED_2026_08_17_restore_to__Edit|Write` contains regex characters, so it is treated as a regex — and `|` is alternation. It parses as `DISABLED_..._Edit` **OR** `Write`. `Edit` was disabled; `Write` never was, which is why doc edits passed while every script `Write` hit a ~16s Guardian validation.

Fixed to `DISABLED_2026_08_17_restore_to__(Edit|Write)`. Same failure class again: a control that silently was not in force. Guardian's own source carries a comment about a previous instance of this exact category — its denies not actually denying.

## WORK LOG

### Slice 1 — MessageDisplay telemetry + live style marker (in progress)

**Files:** `hooks/artisan-message-display.sh`, `hooks/test-artisan-message-display.sh`

**Language decision — bash + `jq`, not TypeScript.** The initial recommendation was zero-dependency TypeScript (Node 22.22 runs `.ts` natively via type stripping, no build step). A benchmark overturned it:

| runtime | per-invocation |
|---|---|
| `node` + TypeScript stripping | 56ms |
| `node` + `.mjs` | 45ms |
| `jq` | 7ms |
| bash builtins | 4ms |

This hook fires on *every streamed batch*. At ~10 batches per message that is ~560ms of process startup per message for TypeScript versus ~70ms for `jq`. Principles 3 (minimize footprint) and 10 (performance) beat principle 4 (lean on the type system) on a path this hot. Types are sacrificed deliberately, and the cost is noted: correctness rests on the component tests instead.

**Design.** Non-final batches append the delta to a per-message accumulator and exit. Evaluation runs once, on the final batch: it computes `chars`, `is_substantive`, `has_thesis`, `filler`, appends a JSONL telemetry record, and returns `displayContent` (final delta + marker) only when a rule is violated.

**Findings from the validation hook, all addressed:**

- Accumulators leaked when a final batch never arrived (interrupted message, killed session) → `find -mmin +60 -delete` sweep on every invocation.
- `message_id` went from untrusted JSON straight into a filesystem path that is appended to and `rm -f`'d → basename guard rejecting anything outside `[A-Za-z0-9._-]`, plus `.` and `..`.
- The accumulator was unbounded while being slurped whole via `jq --rawfile` → 256KB cap checked before each append.
- **Filler detection scanned code blocks** (flagged as a suggestion, but the most serious of the four): the message in this very session that *listed* the filler phrases would have flagged itself → `strip_code` removes fenced and inline code before the scan. There is a test for it.

**Also fixed:** stderr noise on the first batch of every message. `wc -c < "$acc"` fails at the *redirection* layer when the file does not exist, so `2>/dev/null` on `wc` never suppressed it; guarded with `[ -f ]` instead. `jq` parse errors on malformed input silenced too. Both verified silent by direct invocation — the test suite passed throughout because it only asserted on stdout, which is a gap in the tests, not evidence the code was clean.

**Tests:** 22 component tests, driving the hook exactly as Claude Code does (crafted JSON on stdin) against a throwaway `ARTISAN_HOME`. Covers non-final silence, accumulation across batches, thesis present/absent, the substantive threshold, filler in prose vs. inside a fence, path-traversal rejection, marker suppression outside an artisan project, and fail-open on malformed input.

**The live style marker was built, smoke tested, and removed.** It appended a `⚠ artisan: …` line to the final delta via `displayContent` whenever a rule was violated. The verdict after using it: *"instantly annoying and offers no value."*

That is the right call and it was foreseeable — the risk was flagged when it shipped ("if it's noise you'll disable it within a day, which would leave us exactly where we started"). Worth recording *why* it failed, because it generalises:

- A marker fires **after** the message is already written and read. By the time it appears, the reader has absorbed the prose; the warning adds nothing they did not already perceive.
- It reports a violation to the one party who cannot fix it. The user cannot rewrite the message; only the next message can improve, and nothing carries the signal forward.
- It taxes every message to occasionally state the obvious.

The hook is now **pure observation** — it never writes to stdout at all. Simpler, faster, and it cannot annoy anyone into disabling it. Whatever eventually addresses style has to act *before or during* generation, not decorate the output afterwards.

**Repackaged as a plugin.** The first cut put the script in the repo but the registration in `~/.claude/settings.json` with a hardcoded absolute path — so a clone got inert code, and the skill was no longer self-contained. That was precisely the cost named as an argument *against* out-of-band solutions, then walked into anyway.

Fixed by making the repo a plugin:

- `.claude-plugin/plugin.json` — manifest
- `hooks/hooks.json` — declares `MessageDisplay`, referencing `"${CLAUDE_PLUGIN_ROOT}"/scripts/artisan-message-display.sh`, so no absolute paths
- `~/.claude/skills/artisan` repointed from the single `SKILL.md` to the **repo directory**, which auto-loads as `artisan@skills-dir` with no install step
- The `MessageDisplay` entry removed from `~/.claude/settings.json` entirely

Verified: `claude plugin list` reports `artisan@skills-dir … Status: ✔ loaded`.

**Live verification.** Three telemetry records captured from real messages in this session:

| chars | has_thesis | is_substantive | filler |
|---|---|---|---|
| 1935 | yes | yes | 0 |
| 550 | **no** | yes | 0 |
| 1333 | yes | yes | 0 |

The middle record is a genuine Rule 2 violation committed while building the Rule 2 detector — 2/3 compliance in the session where compliance should be at its absolute peak. Consistent with the 59% early-session baseline, and the first evidence produced by measurement rather than archaeology.

**Tests:** 21 component tests. The stdout-silence invariant is now asserted directly (including for a message that violates both rules), so a future change that reintroduces output fails the suite.

**Deferred from this slice:**

- Rule 1 (`AskUserQuestion`) compliance is not measurable from message text; it needs tool-call telemetry from a different event.
- Verbosity is recorded (`chars`) but nothing acts on it — no threshold has been justified by evidence yet.
- Whether telemetry should distinguish artisan from non-artisan sessions. It currently records everything with `cwd` and `session_id`, which is enough to separate them after the fact and avoids a detection heuristic in the hot path.

### Slice 2 — agent-hook commit reviewer

**File:** `hooks/hooks.json` (configuration only — no script)

**Zero code.** `type: "agent"` spawns a fresh subagent natively, so the whole reviewer is a hook declaration and a prompt. The planned wrapper script that would have shelled out to `claude -p` was never needed.

**Filtering.** `if` is a common field available to every hook type, so `"if": "Bash(git commit *)"` narrows a `Bash` matcher down to commits without a script. But the docs are explicit that this filter is **best-effort and fails open**: patterns naming more than the command name "run the hook anyway on `$()`, backticks, or `$VAR`". Since `$(...)` appears in a large share of commands, the prompt opens with a cheap bail-out — a false trigger costs one fast-model turn rather than a full review.

**Dropped from the plan: per-SHA idempotency.** `PostToolUse` fires once per tool call, and one commit is one tool call, so there is nothing to deduplicate. `git commit --amend` produces a genuinely different commit that deserves a genuinely new review. This was over-design carried forward from the pre-agent-hook draft.

**Rubric, not vibes.** Step 5 of the workflow already said "verify that the code adheres to our software engineering principles" and produced the compliance numbers in this document. Handing that sentence to a subagent verbatim would inherit its vagueness, so the prompt carries eight pass/fail checks derived from the principles: bespoke control flow, duplicated helpers, mixed side effects, type escape hatches, needless mutability, missing JSDoc / inline comments, untested behaviour, and foreclosed future direction.

**Calibrated against Guardian's failure.** Guardian was 92.5% ALLOW at ~16s per edit and was switched off. The prompt therefore instructs a hard bias toward `ok: true`, forbids style preferences, speculative suggestions, restating the diff, and any comment on the commit message, and caps findings at three, each one line citing `path:line`. The reasoning is stated in the prompt itself: *a reviewer that fires on 8% of commits gets trusted; one that always finds something gets ignored, then disabled.*

**Verified empirically, not assumed.**

| Test | Result |
|---|---|
| Empty commit | silent (correct — nothing to review) |
| `hooks.json` config commit | silent (correct) |
| Deliberately bad `.ts` file | **all three planted defects found**, cited by `path:line` and rubric check |

The positive control planted an `any[]` parameter with an `as any` cast, a hand-rolled index loop with a mutable accumulator, and a function with no JSDoc plus an inline comment. The reviewer named all three against checks 4, 1+5, and 6 respectively, with no preamble and no praise. Both control commits were then discarded with `git reset --hard`.

**Two mechanics the docs left ambiguous, now settled:**

- **Agent hooks can run `git`.** The documentation says only "tools like Read, Grep, and Glob"; the reviewer ran `git show HEAD` successfully.
- **Plugin `hooks.json` does not hot-reload.** The identical configuration did nothing while declared in the plugin, and fired immediately when moved to `~/.claude/settings.json`. Plugin hook changes require a new session. `settings.json` hook changes take effect at once — the Guardian matcher fix in slice 1 also proved this.

**Deferred from this slice:**

- The reviewer's judgement quality is tested against one synthetic bad commit. Slice 4 should test it against real commits, including ones it should stay silent on, to measure the false-positive rate against Guardian's 7.5% baseline.
- `${CLAUDE_PLUGIN_ROOT}` interpolation inside a `prompt` field is unverified; the prompt hedges with a fallback path to `~/.claude/skills/artisan/SKILL.md`.
- Scoping is still the crude `docs/artisan` directory check, now expressed as a prompt instruction rather than a shell test.

### Slice 3 - doc reviewer, folded into the commit reviewer

**File:** `hooks/hooks.json` (configuration only)

**The planned design was killed by a platform limitation, discovered by probing rather than by reading docs.** The intent was an agent hook on `PostToolUse` for `Write`/`Edit` under `docs/artisan/**`, which would read the document, judge the reasoning, and `touch` a sentinel so it reviewed each document only once.

Four probes, each isolating one variable:

| Probe | Event | Uses tools? | Result |
|---|---|---|---|
| `command` hook, three glob patterns | `Edit` | n/a | all fired - `Edit(docs/artisan/**)` matches correctly |
| agent returning fixed JSON | `Edit` | no | returned - agent hooks do fire on `Edit` |
| agent listing its own tools | `Edit` | no | returned - reports `Bash, Read, Edit, Write` available |
| agent calling `Read` once | `Edit` | **yes** | **nothing** - silent, no output, no timeout message |

**Finding: agent hooks on `Write`/`Edit` events can return a verdict but cannot use tools.** They report `Read`, `Bash`, `Write` and `Edit` as available; calling any of them ends the run silently. Agent hooks on `Bash` events use tools without trouble, which is why the commit reviewer works.

A claim recorded in the slice 2 entry was overstated as a result: "agent hooks can run `git`" was inferred from accurate `path:line` citations, but the reviewer could equally have used `Read` on the working tree. What is actually established is that tool use works in `Bash`-triggered agent hooks.

**Chosen fix: fold the reasoning review into the commit reviewer.** One hook on `Bash(git commit *)`, now carrying two rubrics - checks 1-8 for code, checks 9-15 for the reasoning in a `docs/artisan/*.md` file the commit touched. Both are skipped when irrelevant: step 3 is skipped for markdown-only commits, step 4 only runs when the commit touched an artisan document.

Why this is better than the original design rather than merely a workaround:

- **The sentinel disappears.** One commit is one review by construction, so there is no state to keep and no `touch` to fail.
- **It reuses a mechanism proven to work with tools** instead of fighting one that does not.
- **Commit is the natural checkpoint.** The document is committed as part of the workflow anyway, and the workflow already ends each slice with a commit.
- The cost of the extra rubric is zero on code-only commits and zero on commits that do not touch `docs/artisan/`.

**Rejected alternatives:**

- Passing the document inline via `$ARGUMENTS`: for `Edit`, `tool_input` carries only the `new_string` fragment, not the whole document, so the reviewer would judge a diff hunk out of context.
- Hanging the review off a specific shell command the skill instructs at the end of step 4: works with tools, but reintroduces a discretionary trigger, which is the exact failure class this project exists to remove.

**Verified with a positive control.** A deliberately weak document was committed - WHAT stated as "add a caching layer" (a masked solution), WHY as "it would be better", FOR WHOM as "Everyone", five solutions that were one mechanism varying only in TTL with one filler entry, a chosen-solution rationale of "flexibility is good", and a work log reading "Built it." The reviewer objected on five checks, grouped into three findings as instructed:

- `PROBLEM STATEMENT` - masked solution, and WHY/FOR WHOM adding nothing (checks 9, 10)
- `SOLUTIONS` - one mechanism varying in degree, plus filler (check 11)
- `CHOSEN SOLUTION` / `WORK LOG` - rationale citing no earlier evidence, work log recording nothing (checks 12, 15)

The control commit was then discarded. This matters beyond the rubric: the reviewer had been silent on the preceding real commit, and silence alone cannot distinguish a considered approval from an early bail-out. A loud response to a bad document on the same rubric establishes that the silence was a judgement.

**Deferred:**

- The `Write`/`Edit` agent-hook tool limitation is worth reporting upstream; the tool list an agent hook advertises does not match what it can actually use.
- Reviewer false-positive rate is unmeasured. Four real commits so far produced four silences and two loud responses to planted controls, which is the right shape but far too small a sample to compare against Guardian's 7.5% deny rate.

### Slice 4 - report script and reproducible baseline

**Files:** `scripts/artisan-report.sh`, `scripts/artisan-baseline.py`

**Why this slice is not the verdict.** The question worth answering is whether the hooks improve artisan sessions, which needs artisan sessions recorded before and after. Only one session has run with the hooks so far, and it is the session that built them. This slice therefore builds the instrument that will answer the question in one command, and deliberately does not claim an answer.

**`scripts/artisan-report.sh`** renders per-session compliance from `~/.artisan/telemetry.jsonl`: substantive message count, thesis share, filler count, mean length, newest session first, with an optional cwd substring filter.

First real reading, 8 concurrent sessions, 345 messages:

| session | project | substantive | thesis | filler | avg chars |
|---|---|---|---|---|---|
| `7f37248a` | **artisan-skill (running the hooks)** | 8 | **75%** | 0 | **1002** |
| `ae281771` | main | 29 | 20% | 0 | 1419 |
| `684a5b2d` | admin-purchased-edit-by | 30 | 10% | 1 | 1761 |
| `a6865271` | main | 18 | 11% | 5 | 2084 |
| `ed84b6df` | main | 18 | 5% | 0 | 1352 |
| **total** | 8 sessions | 106 | 16% | 6 | |

The artisan session runs at 75% thesis compliance against 5-20% elsewhere, and is the shortest-winded at 1002 mean characters against 1352-2084. **This is not evidence the hooks work.** Non-artisan sessions are under no obligation to lead with a thesis, so the contrast establishes only that the instrument discriminates artisan-shaped output from ordinary output. That is worth having, and it is not the claim.

**`scripts/artisan-baseline.py`** reproduces the pre-hook figures from transcript JSONL. Until this slice, every baseline number in this document came from throwaway scripts in a scratchpad directory, so nothing here was reproducible and nobody could have checked it.

Running it corrected one published figure. Excluding this session, the six prior sessions give:

| | thesis | AskUserQuestion/turn | mean chars |
|---|---|---|---|
| Pre-code | **65%** | 0.59 | 1643 |
| Post-code | **47%** | 0.29 | 1967 |

The `AskUserQuestion` and character figures reproduce exactly. Thesis compliance is 65% / 47%, **not the 69% / 48% quoted in H3 and H4 above.** The original archaeology tested only whether a message began with `**`; both the telemetry hook and this script require a complete bold span, `^\*\*[^*]+\*\*`. The stricter figure is the correct one, and the two instruments now agree by construction rather than by coincidence. H3's direction and magnitude are unaffected: roughly a third of Rule 2 compliance is lost at the code boundary either way.

**A defect found by using the tool.** The first version of the report computed a session name and never printed it, so every row was anonymous and the table could not distinguish this session from the historical ones - which is the single most important distinction it exists to draw. Fixed by adding the project column. Worth recording because the tests would never have caught it: the numbers were all correct.

**This session's own figures are 93% pre-code and 75% post-code**, above every prior session on both sides. Stated with the caveat it deserves: n = 1, and the session being measured is the one that wrote the instrument.

**Deferred:**

- The before/after verdict, pending artisan sessions that run with the hooks and were not written by them.
- Rule 1 compliance is measurable from transcripts (the baseline script does it) but not from live telemetry, because `MessageDisplay` sees prose and not tool calls. A `PostToolUse` counter would close the gap.
- `artisan-baseline.py` includes the current session in its mean. The project column makes this visible rather than misleading, but a date or exclusion filter would make the comparison cleaner once there are sessions on both sides.

### Slice 4 addendum - the reviewer blocked this slice, correctly

**Files:** `tests/baseline.test.py`, `tests/report.test.sh`, `tests/run-all.sh`

The commit that added the two measurement scripts drew an objection:

> `scripts/artisan-baseline.py:1` and `scripts/artisan-report.sh:1` - check 7: 292 lines of new measurement logic ship with no test, though `tests/message-display.test.sh` sets the precedent for the sibling script and `classify_text`/`summarise`/`format_report` are already pure and directly testable; the commit's claim that both instruments agree on the thesis pattern by construction is exactly what a test should pin, since the corrected 65%/47% figures now rest on untested code.

This was right, and it is the first time in this workflow that the tooling caught something the session had talked itself past. The slice had been written up as complete with a defect already recorded in its own work log - the missing project column - and no test added in response. The reviewer noticed the inconsistency between the recorded defect and the absent coverage.

**What was added:**

- `tests/baseline.test.py` - 23 unit tests over the pure functions. The strictness of the thesis pattern is pinned explicitly, including the unclosed-marker case that caused the 69% to 65% correction, because that figure now rests on this code.
- `tests/report.test.sh` - 8 tests over the report, plus 4 **cross-instrument** tests feeding identical text to the live hook and to the baseline classifier and asserting they agree. The "agree by construction" claim made in the previous commit message is now asserted rather than asserted-in-prose.
- `tests/run-all.sh` - one command for all three suites.

**The duplicate-hook prediction came true, and is now resolved.** The reviewer fired twice on that commit with two different prompts - the current combined rubric from `settings.json`, and the older code-only rubric from the plugin. Plugin `hooks.json` is read once and cached, so the mid-session rewrite never reached it while `settings.json` picked it up immediately. The `settings.json` copy has been removed; the plugin is now the sole declaration, and it will load the current version on the next session. Recorded as a task at the time it was created rather than left to memory, which is why it did not get lost.

**Deferred:**

- `scripts/artisan-report.sh` has no unit-level coverage of its `jq` expression beyond end-to-end assertions on synthetic telemetry. Acceptable: the `jq` program is the behaviour, and testing it through its output is testing the right thing.

### Slice 4 second addendum - portability bug in the new tests

The reviewer objected again, this time to the tests themselves:

> `tests/report.test.sh:39` (and 45, 52, 59, 62, 65, 72) - check 1: all 7 output assertions invoke `ggrep` (Homebrew GNU grep), an undeclared non-POSIX dependency absent from the rest of the repo, when plain `grep -qE` matches these exact patterns; where it is missing the `&&` branch is skipped so the four assertions expecting "false" pass without testing anything.

Correct on both counts, and the second count is the serious one.

`ggrep` was used because the user's global instructions say to prefer it over `grep`. That instruction governs interactive shell use on a machine where Homebrew GNU grep is installed; it does not govern a committed test script that runs elsewhere. The distinction was not made, and the instruction was applied where it did not belong.

The failure mode matters more than the dependency. In `cmd -q ... && echo true || echo false`, a missing `cmd` exits nonzero and falls into the `false` branch. Every assertion whose expected value is `"false"` would therefore pass on a machine without `ggrep` **while testing nothing at all** - a green suite proving the opposite of what it claims. That is the same class as the two earlier findings in this document: Guardian's denies that never denied, and the matcher rename that never disabled `Write`. A control that silently is not in force.

**Fixed in two parts.** The symptom: `grep` throughout, with the patterns unchanged since they are POSIX ERE. The class: a preflight loop at the top of the suite that fails loudly if `grep`, `jq` or `python3` is missing, so a missing tool can never again be mistaken for a passing negative assertion.

**Standing tally of what the reviewer has caught**, over 8 real commits:

| Commit | Verdict |
|---|---|
| Slice 1 telemetry | silent |
| Reviewer config | silent |
| Slice 2 work log | silent |
| Slice 3 fold-in | silent |
| Slice 3 control record | silent |
| Slice 4 scripts | **blocked** - untested measurement code |
| Slice 4 tests | **blocked** - `ggrep` portability and vacuous passes |
| Planted bad `.ts` file (discarded) | **blocked** - three defects |
| Planted weak document (discarded) | **blocked** - five checks |

Five silences and two genuine blocks on real work, plus two correct catches on planted controls. Both real blocks were things this session had reasoned past rather than overlooked, which is the specific value of a reviewer that has not read the conversation.

### Coverage gap - the reviewer only sees commits the agent makes

`PostToolUse` fires on tool calls. The commit reviewer therefore sees a commit only when Claude runs `git commit` through the `Bash` tool. A commit typed by hand in a terminal produces no tool call and no review. Whether the `!` prefix inside Claude Code counts is untested; it is user-invoked, so the expectation is that it does not.

Every reviewer firing recorded in this document was on an agent-issued commit.

**This is judged acceptable rather than fixed.** The problem statement is about discipline collapsing during implementation, and implementation is the agent's work. Commits a human makes are the human's to judge. The gap is recorded because documentation must not imply that every commit in a repo gets reviewed - that would be an overclaim, and an overclaimed control is the failure class this document keeps running into.

**Rejected alternative:** a git `pre-commit` hook in the repo would cover hand commits, but it fires for every committer and in CI, is a different mechanism with different failure modes, and addresses a problem that was never measured. Deferred unless a reason appears.

### Slice 5 - documentation

**Files:** `README.md`, `SKILL.md`

**Packaging verified from a clean session first.** With no artisan hooks in `~/.claude/settings.json` at all, a fresh session in this repo grew telemetry from 356 to 361 records and the commit reviewer ran on an agent-issued commit containing `export const x: any = 1`. The plugin declaration is therefore the sole live mechanism, and the documentation describes a path that has been walked.

An incidental data point from that verification: the probe session recorded 0% thesis-first responses at a mean of 2325 characters - the longest of any session measured. It never invoked `/artisan`, so no rule applied to it, but it is a clean illustration of the ungoverned baseline sitting in the same project directory as an artisan session at 80%.

**`README.md`** gains a measurement section carrying the 65%/47% table, what each hook does, where telemetry lands, and how to run the two analysis scripts. The install instruction needed no change: cloning into `~/.claude/skills/artisan` produces exactly the plugin directory Claude Code auto-loads.

The section that took the most care is *What these hooks do not do*, stating four limits plainly: only agent-issued commits are reviewed, the report mixes artisan with non-artisan sessions, Rule 1 is invisible to live telemetry, and hook changes need a new session. An overclaimed control is the failure this document has hit three times - Guardian's denies that never denied, a matcher rename that never disabled `Write`, and a test suite that would have passed while testing nothing. Documentation that implies more coverage than exists would be the fourth.

**`SKILL.md`** step 5 now says what to do when the reviewer objects: fix the finding or state plainly why it is wrong, and never write a slice up as complete while a finding stands unaddressed. This is written from evidence rather than principle. Both real blocks in this session were findings the session had reasoned past - the first arrived on a slice already declared complete, whose own work log recorded a defect that no test had been added for.

**Deferred:**

- `scripts/` and `tests/` ship inside the plugin directory. Harmless, but a future version might keep the distributed surface to `SKILL.md`, `hooks/`, and `scripts/`.
- The README quotes 65%/47% from six sessions. Once artisan sessions accumulate under the hooks, that table should gain an after column, which is the verdict this project has deliberately not claimed yet.

### Slice 6 - ABANDONED: blocking commit review is not achievable

The commit reviewer reports; it cannot prevent. The attempt to move it to `PreToolUse`, so a failing commit never enters history, failed on a platform limitation.

`PreToolUse` does block, and an agent hook there behaves as `continueOnBlock: true` - the tool is denied, the reason feeds back, the turn continues. That part worked. But the reviewer said so itself:

> I could not verify the `~/.artisan/review-off` or `docs/artisan` bail-outs, nor read the staged diff - **tool access was denied**, so this review is based on the file content embedded in the command string.

It produced accurate findings only because the test command happened to contain the file's contents via `printf`. A normal `git add && git commit` would have given it nothing.

A `Stop`-event agent probe was then tried, since `Stop` is the only event where a block becomes an instruction. It hung for roughly six minutes across repeated 90-second timeouts and returned nothing; the transcript contains only the unfilled prompt template.

**Corrected table of where agent hooks can use tools**, replacing the claim in the slice 3 entry that the boundary was `PostToolUse` versus `PreToolUse`. It is not - the doc reviewer was also `PostToolUse` and still failed:

| event | matcher | agent tool use |
|---|---|---|
| `PostToolUse` | `Bash` | **works** - cited a line count from a file absent from the command |
| `PostToolUse` | `Write\|Edit` | silent, returns nothing |
| `PreToolUse` | `Bash` | explicitly denied |
| `Stop` | none | hung ~6 minutes, returned nothing |

`PostToolUse` + `Bash` is the only configuration where an agent hook both runs and can use tools. So an LLM reviewer can read a diff, or it can block, but not both.

**Rejected for now: a git `pre-commit` hook running `claude -p`.** It would genuinely block, has full shell access, and covers hand commits too. A warm `claude -p` costs 7.5s, or 3.5s on Haiku - the original 59s measurement was a cold start, and quoting it would have wrongly killed the idea. Deferred because it overlaps the reviewer that already exists, requires a `core.hooksPath` install step, is trivially bypassed with `--no-verify`, and no evidence yet shows that reporting is insufficient. Recorded so the latency correction is not lost.

### Slice 7 - Stop gate for omissions

**Files:** `scripts/artisan-stop-gate.sh`, `tests/stop-gate.test.sh`, `tests/run-all.sh`

**Why a separate mechanism from the commit reviewer.** A tool-call hook can only intercept an action taken. The worst measured failure is an action *not* taken: two of six sessions made their first code edit at turn 2, never writing a problem statement or solutions. No tool call represents "I skipped the workflow", so there is nothing for a commit hook to catch. The only moment an omission becomes visible is when the agent tries to finish.

`Stop` is also the only event where a block becomes an instruction rather than context - the reason is fed back and the turn continues - so it can assign the missing work instead of merely denying something.

**Deterministic, not an agent.** A command hook at a few milliseconds, after the agent probe on this same event hung for six minutes. Speed is secondary; the real reason is that this hook decides whether a session can end, and that decision must not depend on a model call that can hang.

**What it blocks:**

1. Source files changed, but no `docs/artisan` document has both SOLUTIONS and CHOSEN SOLUTION filled in with non-placeholder content.
2. `HEAD` has moved past the commit recorded by the last successful test run, and the intervening changes touch source. In short: committed without running the suite.

`tests/run-all.sh` now writes `HEAD` to `$ARTISAN_HOME/last-test-run` on success, which is what makes check 2 possible without parsing transcripts.

**Loop protection is the first thing the script does.** A `Stop` hook that blocks unconditionally never lets a session end, and Claude Code provides no built-in protection. The gate returns immediately when `stop_hook_active` is true, so a failing check can block at most once per attempt. There is a test for it, and it runs first.

**Release is one-shot.** `touch ~/.artisan/release` dismisses the next block and the file is consumed, so a dismissal cannot silently become a permanent disable. Each dismissal appends to `~/.artisan/dismissals.jsonl` with the reason that was waved through, which is what will eventually make the false-positive rate measurable rather than anecdotal.

**Deliberately narrow.** Check 2 fires on committing untested source, not on editing untested source - otherwise it would block during ordinary mid-slice work, which is most of the time. Check 2 also stays silent when no test record exists at all, so a repo that has never run the suite is not gated on a comparison it cannot make.

**Tests:** 20 cases against throwaway git repositories, covering loop protection, scoping, both checks, docs-only changes on both paths, one-shot release, dismissal logging, and fail-open on malformed input.

**Deferred:**

- The gate cannot see whether a slice was *smoke tested* in the sense the workflow means - a human confirming behaviour in the running app. It can only see whether the automated suite ran. The stronger check has no deterministic signal.
- Detecting `git commit --no-verify` or other deliberate bypasses.

### Slice 7 addendum - the runner was skipping a whole suite

`tests/run-all.sh` named its suites explicitly, so `tests/stop-gate.test.sh` was never executed by it. The gate's 20 tests passed only because they were run directly; the runner reported "All suites passed" while silently omitting the newest one.

Fixed by discovering suites with a glob rather than a list, so a new file is picked up by existing. The runner now also fails when it finds zero suites, because "no tests ran" and "every test passed" previously produced the same output.

This is the fourth instance in this project of a control that was not in force while appearing to be: Guardian's denies that never denied, a matcher rename that disabled `Edit` but not `Write`, assertions that would have passed with `ggrep` absent, and now a runner reporting success over a suite it never ran. Every one of them was silent, and every one was found by looking rather than by being told. That is the pattern the whole document keeps circling, and it applies to the tooling built here as readily as to the tooling that prompted it.

