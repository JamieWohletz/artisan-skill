// @ts-check
'use strict';

/**
 * Tests for the auto-audit pure helpers. Run: `node --test`.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { hashDiff, extractJson, buildAuditorPrompt, isSensitivePath } = require('./audit-runner');

test('hashDiff is stable and distinguishes different diffs', () => {
  assert.equal(hashDiff('abc'), hashDiff('abc'));
  assert.notEqual(hashDiff('abc'), hashDiff('abd'));
});

test('extractJson reads a bare JSON object', () => {
  assert.equal(extractJson('{"findings":[]}'), '{"findings":[]}');
});

test('extractJson reads JSON from a ```json fence amid prose', () => {
  const out = 'Here is my verdict:\n```json\n{"findings":[{"severity":"bug","title":"x"}]}\n```\nDone.';
  assert.deepEqual(JSON.parse(extractJson(out)), { findings: [{ severity: 'bug', title: 'x' }] });
});

test('extractJson reads the first balanced object from prose with nested braces', () => {
  const out = 'reasoning... {"a":{"b":1},"c":"}"} trailing text';
  assert.deepEqual(JSON.parse(extractJson(out)), { a: { b: 1 }, c: '}' });
});

test('extractJson throws when there is no JSON object', () => {
  assert.throws(() => extractJson('no json here'), /no JSON object/);
});

test('buildAuditorPrompt embeds the diff and ledger', () => {
  const out = buildAuditorPrompt('CORE', 'LEDGER-MD', 'DIFF-TEXT');
  assert.match(out, /CORE/);
  assert.match(out, /## Current ledger\n\nLEDGER-MD/);
  assert.match(out, /## Diff under review\n\n```diff\nDIFF-TEXT\n```/);
});

test('buildAuditorPrompt uses a placeholder when there is no ledger', () => {
  assert.match(buildAuditorPrompt('CORE', '', 'DIFF'), /\(no ledger yet\)/);
});

test('isSensitivePath flags secret-bearing files and passes ordinary code', () => {
  for (const p of ['.env', '.env.local', 'config/.env.production', 'deploy/server.pem', 'x.key', 'certs/site.p12', '.ssh/id_rsa', 'my-secret.txt', 'aws-credentials.json']) {
    assert.equal(isSensitivePath(p), true, `${p} should be sensitive`);
  }
  for (const p of ['index.js', 'src/app.tsx', 'README.md', 'test/foo.test.js', 'keyboard.js']) {
    assert.equal(isSensitivePath(p), false, `${p} should not be sensitive`);
  }
});
