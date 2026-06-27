// @ts-check
'use strict';

/**
 * Artisan ledger — pure core.
 *
 * The ledger is the auditor's durable memory for one primary session, stored as
 * parseable markdown: YAML frontmatter holds scalar metadata, and the body holds
 * provenance-tagged sections. This module is SIDE-EFFECT FREE — it only transforms
 * strings and plain objects. All file IO lives in ledger-store.js.
 *
 * The on-disk format is markdown (not JSON/SQLite) because the ledger is injected
 * verbatim into the primary session as context and must stay human-readable.
 * Parsing is section-driven: a finding's origin (auditor vs user) and status (open
 * vs closed) come from which section it sits under, so each line only carries id,
 * severity, location, title, and evidence.
 */

/** @typedef {'bug'|'risk'|'pattern'|'design'|'missing'|'suggestion'|'question'} Severity */
/** @typedef {'auditor'|'user'} Origin */
/** @typedef {'open'|'closed'} Status */

/**
 * @typedef {Object} Finding
 * @property {string} id           Stable id within the session, e.g. "F3".
 * @property {Severity} severity
 * @property {string} title
 * @property {string} [loc]        "path:line" when the finding has a location.
 * @property {string} [evidence]   Concrete evidence (file:line, doc ref, etc.).
 * @property {Origin} origin       Who raised it.
 * @property {Status} status
 * @property {string} [note]       Resolution note, set when closed.
 */

/**
 * @typedef {Object} Decision
 * @property {string} id           e.g. "D2".
 * @property {string} text
 */

/**
 * @typedef {Object} LedgerMeta
 * @property {string} session      Primary session id this ledger tracks.
 * @property {number} cursor       Count of transcript entries already audited.
 * @property {number} nextId       Next finding-id number to assign.
 * @property {string} [updated]    ISO timestamp of last write (stamped by IO layer).
 */

/**
 * @typedef {Object} Ledger
 * @property {LedgerMeta} meta
 * @property {string} direction    Current agreed intent/plan; source of truth for intent.
 * @property {Decision[]} decisions
 * @property {Finding[]} findings
 */

/**
 * @typedef {Object} NewFinding
 * @property {Severity} severity
 * @property {string} title
 * @property {string} [loc]
 * @property {string} [evidence]
 * @property {Origin} [origin]     Defaults to "auditor".
 */

/**
 * @typedef {Object} LedgerUpdate
 * @property {string} [direction]              Replaces direction when present.
 * @property {string[]} [decisions]            Decision texts to append (deduped by text).
 * @property {NewFinding[]} [findings]         New findings to merge (deduped vs open findings).
 * @property {{id: string, note?: string}[]} [close]  Findings to mark closed.
 * @property {number} [cursor]                 Advances the transcript cursor.
 */

/** Severity key → emoji used in the rendered ledger. */
const SEVERITY_EMOJI = /** @type {Record<Severity, string>} */ ({
  bug: '🔴',
  risk: '🟠',
  pattern: '🟡',
  design: '🔵',
  missing: '🟣',
  suggestion: '⚪',
  question: '🟢',
});

/** Emoji → severity key, for parsing. */
const EMOJI_SEVERITY = /** @type {Record<string, Severity>} */ (
  Object.fromEntries(Object.entries(SEVERITY_EMOJI).map(([k, v]) => [v, k]))
);

const EMOJI_CLASS = Object.values(SEVERITY_EMOJI).join('');

/**
 * @what Computes a normalized dedupe key for a finding from severity, location, and a title slug.
 * @how Lowercases the title, collapses non-alphanumerics to spaces, trims and truncates it, then joins with severity and loc.
 * @why Lets the merge step recognize the same observation across audit runs so findings are not re-raised every turn.
 *
 * @param {{severity: Severity, title: string, loc?: string}} f The finding (or new finding) to key.
 * @returns {string} Stable key for equality comparison.
 *
 * @sideeffects None
 * @systemlayer Utility
 * @domain artisan-ledger
 * @tags ledger, finding, dedupe, key, normalize
 */
function findingKey(f) {
  const slug = f.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 48);
  return `${f.severity}|${f.loc || ''}|${slug}`;
}

/**
 * @what Creates an empty ledger object for a session.
 * @how Returns a fresh Ledger with zeroed cursor, nextId of 1, the given direction, and empty decision/finding arrays.
 * @why Provides the initial in-memory state the IO layer persists when no ledger exists yet.
 *
 * @param {string} session The primary session id this ledger will track.
 * @param {string} [direction] Optional initial direction/intent text.
 * @returns {Ledger} A new, empty ledger.
 *
 * @sideeffects None
 * @systemlayer Utility
 * @domain artisan-ledger
 * @tags ledger, create, init, factory
 */
function createLedger(session, direction = '') {
  return {
    meta: { session, cursor: 0, nextId: 1 },
    direction,
    decisions: [],
    findings: [],
  };
}

/**
 * @what Applies an auditor or user update to a ledger, returning a new ledger without mutating the input.
 * @how Appends novel decisions (ids are positional — decisions are append-only and never removed, so length-based ids stay stable); merges new findings while skipping any whose key matches a currently-open finding; closes findings by id; replaces direction and advances cursor when provided.
 * @why Separates the deterministic merge mechanics from the LLM's judgement so the same update can be applied and unit-tested without IO or a clock.
 *
 * @param {Ledger} ledger The current immutable ledger state.
 * @param {LedgerUpdate} update The validated auditor/user update to apply.
 * @returns {Ledger} A new ledger with the update applied.
 *
 * @sideeffects None
 * @systemlayer Utility
 * @domain artisan-ledger
 * @tags ledger, update, merge, dedupe, findings, decisions, pure
 */
function applyUpdate(ledger, update) {
  const decisions = ledger.decisions.slice();
  for (const text of update.decisions || []) {
    // Decisions are append-only (no removal path), so positional ids are stable.
    if (!decisions.some((d) => d.text === text)) {
      decisions.push({ id: `D${decisions.length + 1}`, text });
    }
  }

  const findings = ledger.findings.map((f) => ({ ...f }));
  let nextId = ledger.meta.nextId;
  const openKeys = new Set(findings.filter((f) => f.status === 'open').map(findingKey));
  for (const nf of update.findings || []) {
    const key = findingKey(nf);
    if (openKeys.has(key)) continue; // already tracked and open — don't re-raise
    openKeys.add(key);
    findings.push({
      id: `F${nextId++}`,
      severity: nf.severity,
      title: nf.title,
      ...(nf.loc ? { loc: nf.loc } : {}),
      ...(nf.evidence ? { evidence: nf.evidence } : {}),
      origin: nf.origin || 'auditor',
      status: 'open',
    });
  }

  for (const c of update.close || []) {
    const target = findings.find((f) => f.id === c.id);
    if (target) {
      target.status = 'closed';
      if (c.note) target.note = c.note;
    }
  }

  return {
    meta: {
      ...ledger.meta,
      nextId,
      cursor: update.cursor ?? ledger.meta.cursor,
    },
    direction: update.direction ?? ledger.direction,
    decisions,
    findings,
  };
}

/**
 * @what Validates one untrusted value into a NewFinding.
 * @how Requires severity to be a known key and title to be a non-empty string; validates optional loc/evidence/origin types; throws with the array index on any violation.
 * @why The auditor emits findings as LLM-produced JSON; per-finding validation here means a malformed finding (e.g. missing title) fails loudly at the boundary rather than corrupting the ledger or throwing deep in findingKey.
 *
 * @param {unknown} f The untrusted value (one element of the parsed findings array) to validate.
 * @param {number} i Index in the findings array, used in error messages.
 * @returns {NewFinding} The validated finding.
 * @throws {Error} When f is not a well-formed finding.
 *
 * @sideeffects None
 * @systemlayer Utility
 * @domain artisan-ledger
 * @tags ledger, validate, finding, boundary, coerce
 */
function coerceNewFinding(f, i) {
  if (typeof f !== 'object' || f === null) throw new Error(`findings[${i}] must be an object`);
  const o = /** @type {Record<string, unknown>} */ (f);
  // `in` walks the prototype chain ("toString" etc. would slip through), so check own keys only.
  if (typeof o.severity !== 'string' || !Object.prototype.hasOwnProperty.call(SEVERITY_EMOJI, o.severity)) {
    throw new Error(`findings[${i}].severity must be one of: ${Object.keys(SEVERITY_EMOJI).join(', ')}`);
  }
  if (typeof o.title !== 'string' || o.title.trim() === '') {
    throw new Error(`findings[${i}].title must be a non-empty string`);
  }
  /** @type {NewFinding} */
  const nf = { severity: /** @type {Severity} */ (o.severity), title: o.title };
  if (o.loc !== undefined) {
    if (typeof o.loc !== 'string') throw new Error(`findings[${i}].loc must be a string`);
    nf.loc = o.loc;
  }
  if (o.evidence !== undefined) {
    if (typeof o.evidence !== 'string') throw new Error(`findings[${i}].evidence must be a string`);
    nf.evidence = o.evidence;
  }
  if (o.origin !== undefined) {
    if (o.origin !== 'auditor' && o.origin !== 'user') {
      throw new Error(`findings[${i}].origin must be 'auditor' or 'user'`);
    }
    nf.origin = o.origin;
  }
  return nf;
}

/**
 * @what Validates and narrows an untrusted value (parsed auditor JSON) into a LedgerUpdate.
 * @how Type-checks each optional field, delegates per-finding checks to coerceNewFinding, validates close entries and cursor, and drops unrecognized fields; throws a descriptive Error on any violation.
 * @why The auditor's output is an untrusted LLM/JSON boundary; validating here keeps malformed updates out of applyUpdate and the persisted ledger.
 *
 * @param {unknown} raw The untrusted value (parsed auditor JSON) to validate and narrow.
 * @returns {LedgerUpdate} The validated update.
 * @throws {Error} When raw is not a well-formed update.
 *
 * @sideeffects None
 * @systemlayer Utility
 * @domain artisan-ledger
 * @tags ledger, validate, boundary, coerce, auditor
 */
function coerceUpdate(raw) {
  if (typeof raw !== 'object' || raw === null) throw new Error('update must be an object');
  const o = /** @type {Record<string, unknown>} */ (raw);
  /** @type {LedgerUpdate} */
  const update = {};

  if (o.direction !== undefined) {
    if (typeof o.direction !== 'string') throw new Error('direction must be a string');
    update.direction = o.direction;
  }

  if (o.decisions !== undefined) {
    if (!Array.isArray(o.decisions)) throw new Error('decisions must be an array');
    update.decisions = o.decisions.map((d, i) => {
      if (typeof d !== 'string' || d.trim() === '') {
        throw new Error(`decisions[${i}] must be a non-empty string`);
      }
      return d;
    });
  }

  if (o.findings !== undefined) {
    if (!Array.isArray(o.findings)) throw new Error('findings must be an array');
    update.findings = o.findings.map((f, i) => coerceNewFinding(f, i));
  }

  if (o.close !== undefined) {
    if (!Array.isArray(o.close)) throw new Error('close must be an array');
    update.close = o.close.map((c, i) => {
      if (typeof c !== 'object' || c === null) throw new Error(`close[${i}] must be an object`);
      const cc = /** @type {Record<string, unknown>} */ (c);
      if (typeof cc.id !== 'string' || cc.id.trim() === '') {
        throw new Error(`close[${i}].id must be a non-empty string`);
      }
      if (cc.note !== undefined && typeof cc.note !== 'string') {
        throw new Error(`close[${i}].note must be a string`);
      }
      return cc.note !== undefined ? { id: cc.id, note: cc.note } : { id: cc.id };
    });
  }

  if (o.cursor !== undefined) {
    if (typeof o.cursor !== 'number' || !Number.isFinite(o.cursor)) {
      throw new Error('cursor must be a finite number');
    }
    update.cursor = o.cursor;
  }

  return update;
}

/**
 * @what Selects the open findings from a ledger, regardless of origin.
 * @how Filters the findings array on status === 'open'.
 * @why The injection hook and the manual review report only ever surface still-open items.
 *
 * @param {Ledger} ledger The ledger to read.
 * @returns {Finding[]} The open findings.
 *
 * @sideeffects None
 * @systemlayer Utility
 * @domain artisan-ledger
 * @tags ledger, findings, open, filter, selector
 */
function openFindings(ledger) {
  return ledger.findings.filter((f) => f.status === 'open');
}

/** Severity order, most-to-least urgent, for rendering. */
const SEVERITY_ORDER = ['bug', 'risk', 'pattern', 'design', 'missing', 'suggestion', 'question'];

/**
 * @what Renders a compact context block of a ledger's direction and open findings for injection into the primary session.
 * @how Returns an empty string when there is nothing to surface; otherwise emits a header, the one-line direction, and each open finding (severity-ordered) with its id, location, and an origin marker for user-raised items.
 * @why The UserPromptSubmit hook injects this every turn to re-ground the session in the auditor's standing findings — directly countering directive decay — so it must be terse and stable.
 *
 * @param {Ledger} ledger The ledger to render.
 * @returns {string} The injection block, or "" when there is nothing to inject.
 *
 * @sideeffects None
 * @systemlayer Utility
 * @domain artisan-ledger
 * @tags ledger, inject, render, context, decay
 */
function renderInjection(ledger) {
  const open = openFindings(ledger);
  const direction = ledger.direction.trim();
  if (!open.length && !direction) return '';

  const lines = [`[artisan auditor — ${open.length} open finding(s)]`];
  if (direction) lines.push(`Direction: ${direction.replace(/\s+/g, ' ')}`);

  const sorted = open
    .slice()
    .sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));
  for (const f of sorted) {
    const loc = f.loc ? ` \`${f.loc}\`` : '';
    const who = f.origin === 'user' ? ' (you raised)' : '';
    lines.push(`${SEVERITY_EMOJI[f.severity]} ${f.id}${loc} — ${f.title}${who}`);
  }
  lines.push('(advisory — address these or run /artisan:review to refresh)');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

/**
 * @what Renders the body of one finding line (everything after the checkbox).
 * @how Joins id, severity emoji, optional backticked location, the title, and optional evidence into a single line.
 * @why Shared by every section's serializer so open and resolved findings render identically.
 *
 * @param {Finding} f The finding to render.
 * @returns {string} The finding line body.
 *
 * @sideeffects None
 * @systemlayer Utility
 * @domain artisan-ledger
 * @tags ledger, finding, render, serialize, markdown
 */
function findingBody(f) {
  const emoji = SEVERITY_EMOJI[f.severity];
  const loc = f.loc ? ` \`${f.loc}\`` : '';
  const evidence = f.evidence ? ` · ${f.evidence}` : '';
  return `${f.id} ${emoji}${loc} — ${f.title}${evidence}`;
}

/**
 * @what Serializes a ledger to its markdown representation.
 * @how Emits scalar frontmatter, then the Direction prose, then Decisions, Open findings, User-raised, and Resolved sections, omitting any empty section to keep the injected context compact.
 * @why The markdown is both the persisted form and the text injected into the primary session, so it must round-trip with parse() and stay readable.
 *
 * @param {Ledger} ledger The ledger to render.
 * @returns {string} The ledger rendered as markdown, newline-terminated.
 *
 * @sideeffects None
 * @systemlayer Utility
 * @domain artisan-ledger
 * @tags ledger, serialize, markdown, render, frontmatter
 */
function serialize(ledger) {
  const m = ledger.meta;
  const fm = ['---', `session: ${m.session}`, `cursor: ${m.cursor}`, `nextId: ${m.nextId}`];
  if (m.updated) fm.push(`updated: ${m.updated}`);
  fm.push('---');

  const out = [fm.join('\n'), '', '# Artisan ledger', '', '## Direction', ledger.direction.trim() || '_(not yet set)_'];

  if (ledger.decisions.length) {
    out.push('', '## Decisions', ...ledger.decisions.map((d) => `- ${d.id} — ${d.text}`));
  }

  const auditorOpen = ledger.findings.filter((f) => f.status === 'open' && f.origin === 'auditor');
  if (auditorOpen.length) {
    out.push('', '## Open findings', ...auditorOpen.map((f) => `- [ ] ${findingBody(f)}`));
  }

  const userOpen = ledger.findings.filter((f) => f.status === 'open' && f.origin === 'user');
  if (userOpen.length) {
    out.push('', '## User-raised', ...userOpen.map((f) => `- [ ] ${findingBody(f)}`));
  }

  const closed = ledger.findings.filter((f) => f.status === 'closed');
  if (closed.length) {
    out.push(
      '',
      '## Resolved',
      ...closed.map((f) => `- [x] ${findingBody(f)}${f.note ? ` → ${f.note}` : ''}`)
    );
  }

  return out.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;
const FINDING_RE = new RegExp(
  `^- \\[[ x]\\] (\\S+) ([${EMOJI_CLASS}])(?: \`([^\`]+)\`)? — (.+)$`,
  'u'
);
const DECISION_RE = /^- (D\d+) — (.+)$/;

/**
 * @what Splits a string once on the first occurrence of a separator.
 * @how Finds the separator index; returns the whole string and undefined when absent, otherwise the two sides.
 * @why Finding lines pack title plus optional evidence/note on one line; splitting only on the first separator keeps separators inside the title intact.
 *
 * @param {string} rest The string to split.
 * @param {string} sep The separator to split on (first occurrence).
 * @returns {[string, string | undefined]} The head and optional tail.
 *
 * @sideeffects None
 * @systemlayer Utility
 * @domain artisan-ledger
 * @tags string, split, parse, helper
 */
function splitOnce(rest, sep) {
  const i = rest.indexOf(sep);
  if (i === -1) return [rest, undefined];
  return [rest.slice(0, i), rest.slice(i + sep.length)];
}

/**
 * @what Builds a Finding from a matched finding line plus its section-derived origin and status.
 * @how Reads id, emoji, optional loc, and the remaining text from the regex match; peels a resolution note for closed items, then splits the rest into title and optional evidence.
 * @why Origin and status are not encoded on the line itself — they come from the section header — so parsing must supply them.
 *
 * @param {RegExpMatchArray} match The FINDING_RE match for the line.
 * @param {Origin} origin Origin derived from the line's section.
 * @param {Status} status Status derived from the line's section.
 * @returns {Finding} The reconstructed finding.
 *
 * @sideeffects None
 * @systemlayer Utility
 * @domain artisan-ledger
 * @tags ledger, finding, parse, markdown
 */
function parseFinding(match, origin, status) {
  const [, id, emoji, loc, rawRest] = match;
  let rest = rawRest;
  let note;
  if (status === 'closed') {
    [rest, note] = splitOnce(rest, ' → ');
  }
  const [title, evidence] = splitOnce(rest, ' · ');
  return {
    id,
    severity: EMOJI_SEVERITY[emoji],
    title,
    ...(loc ? { loc } : {}),
    ...(evidence ? { evidence } : {}),
    origin,
    status,
    ...(note ? { note } : {}),
  };
}

/**
 * @what Parses a ledger from its markdown representation back into a structured Ledger.
 * @how Extracts frontmatter scalars, then walks the body line by line tracking the current section and applying the section-appropriate grammar; unrecognized lines are ignored.
 * @why The auditor and the gate need structured access to findings; tolerating stray lines means a lightly hand-edited ledger still loads.
 *
 * @param {string} text The ledger markdown to parse.
 * @returns {Ledger} The parsed ledger.
 *
 * @sideeffects None
 * @systemlayer Utility
 * @domain artisan-ledger
 * @tags ledger, parse, markdown, frontmatter, sections
 */
function parse(text) {
  const fmMatch = text.match(FRONTMATTER_RE);
  const metaBlock = fmMatch ? fmMatch[1] : '';
  const body = fmMatch ? fmMatch[2] : text;

  /** @type {LedgerMeta} */
  const meta = { session: '', cursor: 0, nextId: 1 };
  for (const line of metaBlock.split('\n')) {
    const m = line.match(/^(\w+):\s*(.*)$/);
    if (!m) continue;
    const [, key, value] = m;
    if (key === 'cursor' || key === 'nextId') meta[key] = Number(value) || 0;
    else if (key === 'session' || key === 'updated') meta[key] = value;
  }

  let section = '';
  const directionLines = [];
  /** @type {Decision[]} */
  const decisions = [];
  /** @type {Finding[]} */
  const findings = [];

  for (const line of body.split('\n')) {
    const header = line.match(/^## (.+)$/);
    if (header) {
      section = header[1].trim();
      continue;
    }
    if (line.startsWith('# ')) continue;

    if (section === 'Direction') {
      directionLines.push(line);
      continue;
    }
    if (section === 'Decisions') {
      const d = line.match(DECISION_RE);
      if (d) decisions.push({ id: d[1], text: d[2] });
      continue;
    }
    if (section === 'Open findings' || section === 'User-raised') {
      const f = line.match(FINDING_RE);
      if (f) findings.push(parseFinding(f, section === 'User-raised' ? 'user' : 'auditor', 'open'));
      continue;
    }
    if (section === 'Resolved') {
      const f = line.match(FINDING_RE);
      // Origin is not recoverable for closed items; default to auditor (status is
      // what matters downstream — closed findings never gate or re-inject).
      if (f) findings.push(parseFinding(f, 'auditor', 'closed'));
    }
  }

  let direction = directionLines.join('\n').trim();
  if (direction === '_(not yet set)_') direction = '';

  return { meta, direction, decisions, findings };
}

module.exports = {
  SEVERITY_EMOJI,
  EMOJI_SEVERITY,
  findingKey,
  createLedger,
  applyUpdate,
  coerceUpdate,
  openFindings,
  renderInjection,
  serialize,
  parse,
};
