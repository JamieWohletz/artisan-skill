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

## Installation

`artisan` is packaged as a [Claude Code plugin](https://code.claude.com/docs/en/plugins). Add the marketplace and install:

```
/plugin marketplace add JamieWohletz/artisan-skill
/plugin install artisan@artisan-skill
```

Then invoke the workflow in Claude Code:

```
/artisan:artisan
```

> **Upgrading from the old skill-clone install?** Earlier versions were cloned directly into `~/.claude/skills/artisan`. Remove that clone and install via the plugin marketplace instead — the plugin bundles the skill (and, soon, the staff-engineer auditor hooks) and keeps them updated.

## License

MIT
