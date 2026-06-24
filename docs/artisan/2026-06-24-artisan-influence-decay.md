# Artisan skill: influence decay & the craft gap

- **Date:** 2026-06-24
- **Branch:** main (work to be branched)
- **Summary:** The artisan skill governs the opening of a task but does not persist through long sessions or reach the moment code is written. This doc captures the agreed problem and (later) candidate solutions.

## Problem statement

1. **WHAT:** The artisan skill governs the opening moves of a task but neither survives long sessions nor reaches the moment code is actually written.
2. **WHY:** The code drifts back to baseline LLM habits — the easy-but-complicated solutions the skill exists to prevent — defeating the purpose of invoking it.
3. **WHOM:** For Austin, who invokes the skill expecting artisan-quality work *throughout*, not just a strong kickoff.

### Root cause

**The skill is passive, one-shot text, but the behavior it wants is continuous and action-coupled.** Its principles are needed at the instant of an Edit/Write, which is exactly when the skill is least present in (or least salient within) the context window.

## How we got here

### Information used
- The user's original idea: a Claude lifecycle hook that runs every prompt (or every N prompts), reloads the artisan skill, analyzes the prompt + tool-use transcript, and gives real-time guidance / catches bad assumptions.
- Observed symptom: in long sessions, the skill's directives get lost in context; and even early on, the skill shapes problem-solving but not the *way code is written*.
- The skill's own structure (`SKILL.md`): a collaborative workflow + abstract principles, with no action-coupled trigger.

### Questions asked
- **Scope** — Which problem are we solving? → *Both, as one problem* (decay + craft gap share a root).
- **Root cause** — Does "passive vs action-coupled" land? → *Yes, that's the root to solve.*

### Hypotheses checked
- **H1: The two issues are separate problems.**
  - REJECTED. Both stem from the same root: the skill's influence is front-loaded and decays, never reaching sustained implementation.
- **H2: Root cause is context eviction / attention dilution alone.**
  - PARTIAL. True but downstream. Re-grounding helps, but eviction is a symptom of the skill being passive one-shot text.
- **H3: Root cause is a skill *content* gap (no line-level "what good code looks like").**
  - PARTIAL / DEFERRED. Plausible contributor; may resurface in solutions. Not selected as the primary root.
- **H4 (CHOSEN): Root cause is passive vs action-coupled.**
  - ACCEPTED. The skill is loaded once as passive text; the behaviors it wants are continuous and tied to actions (Edit/Write). The mechanism, not just the content, is the gap.

### Note on the original idea
The user's instinct (a hook) correctly identifies that an *active* mechanism is needed. The parts still open to challenge: the **trigger** ("every N prompts") and the **payload** ("reload the whole skill"). These are deferred to the solutions phase.

## Refined framing (the "staff engineer alongside" vision)

The target is not a reminder. It is a **continuous, out-of-band reviewer** that pairs with the primary session the way a staff engineer pairs with a competent mid-level developer: the mid-level is capable but occasionally misses things and drifts if unchecked. The staff engineer watches the work as it happens and intervenes on **taste**, not logical correctness:

- "Do we really need that function, or can we extend an existing one?"
- "Is that model in the right place? Will other code use that type?"
- "What are the performance implications of that loop?"

"Correct direction" here is subjective — it means adherence to the artisan principles (rigor, elegance, extensibility, footprint, architecture), not whether the code compiles.

### Added constraints
- **C1 — The auditor must avoid its own context bloat.** It runs repeatedly over a growing session; it cannot re-ingest the whole transcript every time.
- **C2 — Independence over inheritance.** The auditor's value is a *fresh, skeptical* read. It must NOT build its understanding from the primary session's own summary, or it inherits the same blind spots.
- **C3 — The feedback path is a first-class problem.** Getting the primary session to actually *act on* the auditor's feedback mid-flight (without being ignored — the original decay problem — or derailing the dev) is as hard as the watching itself.

- **C4 — Human interventions must be durably captured.** When the user catches a bug, changes direction, or raises a tangent, that context cannot be lost after the relevant transcript scrolls out of the window.

### Core design tension (C1 vs C2) — RESOLVED: hybrid living ledger
The user's first instinct — carry a running summary forward to bound context (C1) — conflicts with independence (C2). And a pure findings ledger risks dropping the user's own interventions (C4).

**Resolution (decided 2026-06-24):**
- **Judge from ground truth.** Each run, the auditor reads actual diffs + the raw transcript delta since its last run. This is where user interventions (caught bugs, redirections, tangents) appear — so nothing is lost at read time. Independence (C2) preserved: understanding is built from reality, not from the primary session's self-summary.
- **Curate a living session ledger for memory.** Not just auditor findings — a small, provenance-tagged artifact with sections:
  - **Direction / intent** — the current agreed plan; updated when the *user* redirects (this is the "plan = source of truth for intent" principle from pr-audit).
  - **Accepted decisions** — choices the user explicitly made, so the auditor won't re-flag them.
  - **Open findings (auditor)** — outstanding auditor-raised items + status.
  - **User-raised items** — bugs/tangents the user flagged that still need addressing (C4).
  - **Resolved / superseded** — collapsed, kept short.
- **The ledger is edited, not appended.** Per-run input = small delta + bounded curated state, so C1 holds; resolved items are checked off and superseded directions collapse so it never grows unbounded.
- Each run, the auditor *promotes* relevant events from the delta into the ledger, so they survive transcript eviction — directly curing the decay problem.

## Standards to borrow from harmony `pr-audit`

The harmony `.claude/skills/pr-audit/SKILL.md` is the canonical expression of Austin's review standards and already solves the fresh-context problem. Reuse:

- **Fresh-context execution model** — a separate agent with no implementation memory cannot short-circuit ("I think I know" is not evidence). This validates "separate agent" over "self-reminding hook."
- **Severity tiers** — 🔴 Bug / 🟠 Risk / 🟡 Pattern Violation / 🔵 Design Concern / 🟣 Missing Piece / ⚪ Suggestion / 🟢 Open Question.
- **Evidence-required findings** — every finding cites concrete evidence (file:line, doc ref); no-evidence hunches go to Open Questions.
- **Asymmetric cost** — false positives cost a reviewer 30s; false negatives cost hours. Surface, don't suppress.
- **Staff-synthesis lens** — should this exist at all? right model/module? approach right? right decomposition? perf/UX?
- **Persistent staging artifact** — `pr-audit` reads/clears `.guardian/suggestions.md`; an analogous ledger fits the auditor's findings memory.

## Solutions

**Shared across all (decided):** fresh-context auditor; living session ledger (see context-strategy resolution); feedback = inject-most (non-blocking, via hook into next turn) + gate-🔴 (blocking `PreToolUse` on Edit/Write). The five differ on **trigger × execution**.

**Implementation primitives (verified assumptions):** Claude Code hooks run *shell commands*, not Agent dispatches — so a hook-triggered auditor runs as a headless `claude -p` subprocess (E1). `UserPromptSubmit`/`SessionStart` hooks can return `additionalContext` (this very session demonstrates both). Using the `Agent` tool (E2) requires the *primary model* to invoke it, so an Agent-based trigger must inject an instruction the primary then obeys (more fragile).

### S1 — Turn-boundary auditor (REVISED — UserPromptSubmit-based)
- **Trigger + injection on `UserPromptSubmit` (confirmed-live primitive).** Each prompt the hook does double duty: (1) inject the ledger's open items as `additionalContext` — re-grounds every turn, *this is the decay cure*; (2) launch a **detached** headless `claude -p` auditor over the transcript-delta + `git diff` since last run. **Gate:** `PreToolUse(Edit|Write)` denies-with-reason on unresolved 🔴 touching the file.
- **`Stop` is optional, not load-bearing.** It captures the *same* "dev paused" boundary from the other side; use it only to start the audit at turn-end (shaving the one-turn lag). The design does not depend on `Stop`'s ambiguous/synchronous-blocking semantics.
- **Stop hook precise semantics (verified 2026-06-24):** fires once at turn-end (incl. no-op Q&A turns); synchronous + can block (must detach long work); can force Claude to *continue* (we won't use that); stdin carries `transcript_path`/`session_id`/`cwd`/`stop_hook_active`; **not** an injection primitive (injection is UserPromptSubmit/SessionStart only). Public docs are thin on the schema; design routes around the uncertain parts.
- **Pros:** Rides only confirmed primitives that Austin already runs (Obsidian `UserPromptSubmit` injection; harmony validation `PreToolUse` deny). Reviews each completed slice — aligns with artisan's vertical-slice cadence. Primary context stays clean; cost scales with turns, not edits.
- **Cons / accepted property:** Auditor is **async**, so injection + 🔴 gate are always one audit behind (bug in turn N is gated from turn N+1). This mirrors how a human staff engineer reviews — after the write, not per keystroke. Acceptable.

### S2 — Edit-coupled gate
- **Trigger:** every `Edit`/`Write` (`PostToolUse`). **Execution:** audit just that diff; arm a `PreToolUse` gate for the next edit on severe findings.
- **Pros:** Most literal answer to the root cause (action-coupled at the keystroke).
- **Cons:** Fires constantly → expensive (violates *minimize footprint*); adds latency to the edit loop; each pass sees a single edit with no surrounding context (myopic). The "react-for-styling" mistake — heavyweight tool for a lighter job.

### S3 — Parallel staff session
- **Trigger:** continuous. **Execution:** a *second* Claude session (`/loop`, self-paced) tails the primary's transcript JSONL from disk, audits new entries, writes the ledger. **Feedback:** primary's hooks inject + gate from the ledger.
- **Pros:** Truest "engineer sitting next to you"; offloads all audit cost off the primary session.
- **Cons:** Two sessions to run and keep open; cross-session coordination; operationally heavy (highest footprint to operate).

### S4 — Periodic counter audit (the original idea)
- **Trigger:** every N prompts (`UserPromptSubmit` counter). **Execution:** hook injects an instruction telling the primary to dispatch a fresh audit `Agent` (pr-audit controller style).
- **Pros:** Simplest conceptually; reuses the Agent tool and pr-audit pattern already trusted.
- **Cons:** "Every N" is an arbitrary boundary, not a real work unit; relies on the primary obeying an injected instruction (fragile); orchestration pollutes the primary context (weakens independence in spirit).

### S5 — On-demand review skill (baseline / control)
- **Trigger:** user invokes `/artisan-review`. **Execution:** dispatch a fresh audit subagent over the session delta; write ledger. **Feedback:** none automated (results read on demand).
- **Pros:** Zero overhead; fully user-controlled; trivial to build.
- **Cons:** Does not cure decay — it's a manual checkpoint, not a continuous reviewer. Kept as the honest "least we could build" yardstick.

### Staff lean (pre-pick)
S1 is the elegant default: rides a *natural work boundary* (the just-finished slice), native primitives, clean primary. S3 is the purest expression of the vision but pays an operational tax. S2 is seductive but heavyweight for the job. S4 is the original instinct but arbitrary + fragile. S5 is the control. Likely synthesis: **S1 as the spine, with an optional S3-style parallel session for heavy/long sessions, and S5's manual invocation always available.**

## Chosen solution

**S1 (revised) as the spine + S5 manual review; S3 deferred.** A fresh-context "staff engineer" auditor runs out-of-band each turn, judges from ground truth, and maintains a living ledger; feedback is injected non-blocking every turn and the 🔴 severity is gated at the edit.

### Rationale (against principles)
- **Elegance / right tool:** rides the natural turn boundary via native, confirmed primitives — not an arbitrary clock (S4), a myopic per-edit loop (S2), or two-session overhead (S3).
- **Minimize footprint:** cost scales with turns (and only turns that changed code), auditor runs detached off the critical path.
- **Grow iteratively (bonsai):** S3's parallel session is deferred until long sessions prove the need.
- **Lean on existing primitives:** injection = Austin's Obsidian `UserPromptSubmit` pattern; gate = harmony's validation `PreToolUse` deny pattern.

### Architecture
- **Ledger** — a living, edited (not appended) markdown file per primary session, with provenance-tagged sections: Direction/intent · Accepted decisions · Open findings (auditor) · User-raised items · Resolved/superseded. Markdown (not SQLite) because it is both machine-updated and injected verbatim as context; revisit if querying emerges.
- **Auditor** — a headless `claude -p` invocation with a dedicated staff-engineer prompt (framing borrowed from `pr-audit`: evidence-required, asymmetric-cost, staff-synthesis lens) + the artisan principles. Inputs: transcript delta (via cursor), `git diff`, current ledger. Output: edited ledger with severity-tagged, evidence-cited findings. **MCP-agnostic** — works on any repo via git/file reads; optionally enhanced by codebase-guardian if present.
- **Hooks** — `UserPromptSubmit` does double duty (inject open items as `additionalContext`; launch detached auditor over the delta). `PreToolUse(Edit|Write)` denies-with-reason on an unresolved 🔴 touching the target file, with an **ack/override path** so a false 🔴 never paints us into a corner (principle #8). `Stop` is an optional latency optimization, not required.
- **`/artisan-review` skill (S5)** — runs the same auditor synchronously on demand and reports.

### Enumerated edge cases (to handle in slices)
- **Ledger race / atomicity:** detached auditor writes while hooks read → atomic write (temp + rename); readers tolerate slightly-stale ledger (the accepted async property).
- **Overlapping auditors:** per-session lockfile; if locked, skip this turn (cursor unadvanced → next turn catches up).
- **Cursor:** advances only on successful audit, so nothing is skipped on failure.
- **No-op turns:** auditor exits cheaply when no new diff / no meaningful tool use since cursor.
- **First run:** initialize ledger Direction from this doc's chosen solution / current task.
- **Cost:** only audit turns that changed code; staff judgment needs a strong model (don't downgrade), so gate frequency instead.
- **Gate disruption:** 🔴 gate must be acknowledgeable/overridable (surface, don't trap).

### Install / packaging — DECIDED: ship as a Claude Code plugin (verified 2026-06-24)
Install is solved natively by the plugin system — no bespoke installer, no `settings.json` merging.
- **Plugins bundle** skills + slash commands + hooks (`UserPromptSubmit`/`PreToolUse`/`Stop` all supported) + helper scripts referenced via `${CLAUDE_PLUGIN_ROOT}`. State dir: `${CLAUDE_PLUGIN_DATA}`; project root: `${CLAUDE_PROJECT_DIR}`.
- **Hooks auto-register on install, auto-remove on uninstall.** Plugin hooks **merge** with the user's existing hooks (no clobbering — kills the original concern).
- **Distribution:** repo ships `.claude-plugin/marketplace.json`; users `/plugin marketplace add <owner>/<repo>` then `/plugin install artisan@<marketplace>`.
- **Repo restructure required:** flat skill (`SKILL.md` at root) → plugin layout:
  ```
  .claude-plugin/plugin.json
  .claude-plugin/marketplace.json
  skills/artisan/SKILL.md            (existing workflow skill)
  skills/artisan-review/SKILL.md     (S5 manual review)
  hooks/hooks.json                   (grows per slice)
  scripts/                           (auditor + hook glue)
  ```
- **Risk to de-risk EARLY (docs silent):** can a plugin hook spawn a **detached `claude -p`**? Load-bearing for Slice 3. Smoke-test it before building auto-audit; fallback if not (e.g., hook drops an "audit-requested" marker consumed another way).
- _Optional later:_ a documented manual-install fallback for non-plugin users.

### Build plan — vertical slices (plugin-based)
1. **Plugin skeleton + `/artisan-review` engine (delivers S5 whole).** Restructure repo to plugin layout; `plugin.json` + `marketplace.json`; move existing artisan skill into `skills/`; build the ledger (schema + pure parse/serialize, IO isolated) + auditor prompt + synchronous `/artisan-review`. **Verify the plugin installs and the command runs.** Test the auditor on a sample diff/transcript.
2. **Spike — detached subprocess.** Smoke-test a plugin `UserPromptSubmit` hook spawning a detached `claude -p` that writes a file. Confirms (or kills) the Slice 3 approach before we build on it.
3. **Injection leg** — `UserPromptSubmit` reads ledger → `additionalContext`. (Decay cure, advisory.)
4. **Detached auto-audit** — `UserPromptSubmit`/`Stop` launches auditor over the delta; cursor, lockfile, no-op guard.
5. **🔴 gate** — `PreToolUse(Edit|Write)` deny-with-reason + ack/override.
6. **Polish** — optional `Stop` latency opt; config (cadence, enable/disable, model); ledger location; uninstall verification; README/docs.

_First-slice decision still open: hook/auditor glue runtime (Node no-deps + @ts-check vs bash+jq) — settle at Slice 1 kickoff._
