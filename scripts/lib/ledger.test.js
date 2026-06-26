// @ts-check
'use strict';

/**
 * Unit tests for the ledger core (pure) and store (IO). Run: `node --test scripts/lib/`.
 * Test callbacks are inline arrows by design, so the structured-JSDoc convention
 * (which applies to named functions) does not apply to them.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const fs = require('fs');
const path = require('path');

const { createLedger, applyUpdate, coerceUpdate, openFindings, serialize, parse } = require('./ledger');
const { ledgerPath, readLedger, writeLedger, ensureLedger } = require('./ledger-store');

const NOW = '2026-06-25T00:00:00Z';

test('createLedger produces an empty ledger', () => {
  const l = createLedger('sess-1', 'Build the auditor');
  assert.deepEqual(l, {
    meta: { session: 'sess-1', cursor: 0, nextId: 1 },
    direction: 'Build the auditor',
    decisions: [],
    findings: [],
  });
});

test('applyUpdate merges direction, decisions, findings, and cursor', () => {
  const l = applyUpdate(createLedger('s'), {
    direction: 'Slice 1b',
    decisions: ['Use markdown for the ledger'],
    findings: [
      { severity: 'bug', title: 'leaks temp file', loc: 'a.js:80', evidence: 'rename can throw' },
      { severity: 'risk', title: 'no lock', origin: 'user' },
    ],
    cursor: 12,
  });

  assert.equal(l.direction, 'Slice 1b');
  assert.deepEqual(l.decisions, [{ id: 'D1', text: 'Use markdown for the ledger' }]);
  assert.equal(l.meta.cursor, 12);
  assert.equal(l.meta.nextId, 3);
  assert.equal(l.findings.length, 2);
  assert.deepEqual(l.findings[0], {
    id: 'F1', severity: 'bug', title: 'leaks temp file', loc: 'a.js:80',
    evidence: 'rename can throw', origin: 'auditor', status: 'open',
  });
  assert.equal(l.findings[1].origin, 'user');
});

test('applyUpdate does not mutate the input ledger', () => {
  const base = createLedger('s');
  applyUpdate(base, { findings: [{ severity: 'bug', title: 'x' }] });
  assert.equal(base.findings.length, 0);
  assert.equal(base.meta.nextId, 1);
});

test('applyUpdate dedupes a finding that is already open', () => {
  let l = applyUpdate(createLedger('s'), {
    findings: [{ severity: 'pattern', title: 'Missing JSDoc', loc: 'b.js:1' }],
  });
  l = applyUpdate(l, {
    findings: [{ severity: 'pattern', title: 'missing   jsdoc', loc: 'b.js:1' }],
  });
  assert.equal(l.findings.length, 1);
  assert.equal(l.meta.nextId, 2);
});

test('a closed finding no longer dedupes — it can be re-raised', () => {
  let l = applyUpdate(createLedger('s'), {
    findings: [{ severity: 'bug', title: 'regression', loc: 'c.js:5' }],
  });
  l = applyUpdate(l, { close: [{ id: 'F1', note: 'fixed' }] });
  l = applyUpdate(l, { findings: [{ severity: 'bug', title: 'regression', loc: 'c.js:5' }] });
  assert.equal(openFindings(l).length, 1);
  assert.equal(l.findings.length, 2);
});

test('close marks a finding closed and openFindings excludes it', () => {
  let l = applyUpdate(createLedger('s'), {
    findings: [
      { severity: 'bug', title: 'one' },
      { severity: 'risk', title: 'two' },
    ],
  });
  l = applyUpdate(l, { close: [{ id: 'F1', note: 'done' }] });
  const open = openFindings(l);
  assert.equal(open.length, 1);
  assert.equal(open[0].id, 'F2');
  assert.equal(l.findings.find((f) => f.id === 'F1')?.note, 'done');
});

test('serialize → parse round-trips a populated ledger', () => {
  let l = applyUpdate(createLedger('sess-42', 'Multi\nline\ndirection'), {
    decisions: ['markdown over sqlite', 'one ledger per project'],
    findings: [
      { severity: 'bug', title: 'open auditor bug', loc: 'x.js:10', evidence: 'see test' },
      { severity: 'design', title: 'no evidence, no loc' },
      { severity: 'risk', title: 'user flagged this', loc: 'y.js:3', origin: 'user' },
    ],
    cursor: 7,
  });
  l = applyUpdate(l, { close: [{ id: 'F1', note: 'fixed in abc' }] });

  // serialize groups findings by section, so parse reconstructs them grouped
  // rather than in insertion order. Cross-section order is not meaningful, so we
  // compare findings as an id-sorted set; meta/direction/decisions compare exactly.
  const reparsed = parse(serialize(l));
  const byNumericId = (/** @type {{id: string}} */ a, /** @type {{id: string}} */ b) =>
    Number(a.id.slice(1)) - Number(b.id.slice(1));
  assert.deepEqual(
    { ...reparsed, findings: reparsed.findings.slice().sort(byNumericId) },
    { ...l, findings: l.findings.slice().sort(byNumericId) }
  );
});

test('parse maps the empty-direction placeholder back to an empty string', () => {
  const reparsed = parse(serialize(createLedger('s')));
  assert.equal(reparsed.direction, '');
});

test('store: ensureLedger creates then reads the same ledger', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artisan-'));
  try {
    const file = ledgerPath(dir);
    const created = ensureLedger(file, 'sess-store', NOW, 'initial direction');
    assert.equal(created.meta.session, 'sess-store');
    assert.ok(fs.existsSync(file));

    const reread = ensureLedger(file, 'ignored', NOW);
    assert.equal(reread.meta.session, 'sess-store');
    assert.equal(reread.direction, 'initial direction');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('store: writeLedger stamps updated and readLedger recovers state', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artisan-'));
  try {
    const file = ledgerPath(dir);
    const l = applyUpdate(createLedger('s'), {
      findings: [{ severity: 'bug', title: 'persisted', loc: 'z.js:1' }],
    });
    writeLedger(file, l, NOW);

    const back = readLedger(file);
    assert.ok(back);
    assert.equal(back.meta.updated, NOW);
    assert.equal(back.findings.length, 1);
    assert.equal(back.findings[0].title, 'persisted');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('coerceUpdate accepts a well-formed update and drops unknown fields', () => {
  const update = coerceUpdate({
    direction: 'new dir',
    decisions: ['chose markdown'],
    findings: [{ severity: 'bug', title: 'boom', loc: 'a.js:1', origin: 'user' }],
    close: [{ id: 'F1', note: 'fixed' }],
    cursor: 5,
    bogusField: 'ignored',
  });
  assert.deepEqual(update, {
    direction: 'new dir',
    decisions: ['chose markdown'],
    findings: [{ severity: 'bug', title: 'boom', loc: 'a.js:1', origin: 'user' }],
    close: [{ id: 'F1', note: 'fixed' }],
    cursor: 5,
  });
});

test('coerceUpdate output applies cleanly to a ledger', () => {
  const update = coerceUpdate({ findings: [{ severity: 'risk', title: 'flaky' }] });
  const l = applyUpdate(createLedger('s'), update);
  assert.equal(l.findings[0].title, 'flaky');
  assert.equal(l.findings[0].origin, 'auditor');
});

test('coerceUpdate rejects malformed input', () => {
  assert.throws(() => coerceUpdate(null), /must be an object/);
  assert.throws(() => coerceUpdate({ findings: [{ severity: 'nope', title: 'x' }] }), /severity must be one of/);
  assert.throws(() => coerceUpdate({ findings: [{ severity: 'bug', title: '  ' }] }), /title must be a non-empty string/);
  assert.throws(() => coerceUpdate({ findings: [{ severity: 'bug' }] }), /title must be a non-empty string/);
  assert.throws(() => coerceUpdate({ cursor: 'soon' }), /cursor must be a finite number/);
  assert.throws(() => coerceUpdate({ decisions: [42] }), /decisions\[0\] must be a non-empty string/);
  assert.throws(() => coerceUpdate({ decisions: ['  '] }), /decisions\[0\] must be a non-empty string/);
  assert.throws(() => coerceUpdate({ close: [{ note: 'no id' }] }), /close\[0\]\.id must be a non-empty string/);
  assert.throws(() => coerceUpdate({ close: [{ id: '' }] }), /close\[0\]\.id must be a non-empty string/);
  // `in` would let prototype members ("toString") through — own-key check must reject them.
  assert.throws(() => coerceUpdate({ findings: [{ severity: 'toString', title: 'x' }] }), /severity must be one of/);
});

test('store: readLedger returns null for a missing file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artisan-'));
  try {
    assert.equal(readLedger(ledgerPath(dir)), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
