// @ts-check
'use strict';

/**
 * Integration test for the background audit orchestrator. Drives run-audit.js as
 * a real subprocess against a temp git repo, with a STUB auditor (so no live
 * model is needed) that echoes canned JSON. Verifies the full path: diff →
 * audit → ledger, plus change-detection and the single-flight no-op. Run: `node --test`.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const { withTempDir } = require('./lib/test-utils');

const RUNNER = path.join(__dirname, 'run-audit.js');

const STUB = [
  "const fs=require('fs');",
  "fs.readFileSync(0,'utf8');", // consume the prompt on stdin
  'process.stdout.write(JSON.stringify({',
  '  direction: "auto direction",',
  '  findings: [{ severity: "bug", title: "stub finding", loc: "a.txt:1", evidence: "from stub" }]',
  '}));',
].join('\n');

const gitIn = (/** @type {string} */ dir, /** @type {string} */ cmd) =>
  execFileSync('bash', ['-c', `cd "${dir}" && ${cmd}`], { encoding: 'utf8' });

const writeStub = (/** @type {string} */ dir) => {
  const stub = path.join(dir, 'stub.js');
  fs.writeFileSync(stub, STUB);
  return stub;
};

/** Init a git repo with one committed file and a clean tree (no diff vs HEAD). */
const initRepo = (/** @type {string} */ dir) => {
  gitIn(dir, 'git init -q && git config user.email a@b.c && git config user.name t');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'one\n');
  gitIn(dir, 'git add -A && git commit -q -m init');
};

/** Init a repo and leave an uncommitted change so there's a diff vs HEAD. */
const initRepoWithDiff = (/** @type {string} */ dir) => {
  initRepo(dir);
  fs.writeFileSync(path.join(dir, 'a.txt'), 'one\ntwo\n');
};

const runAudit = (/** @type {string} */ dir, /** @type {string} */ stubPath) =>
  execFileSync('node', [RUNNER, '--project', dir], {
    encoding: 'utf8',
    env: { ...process.env, ARTISAN_AUDITOR_BIN: 'node', ARTISAN_AUDITOR_ARGS: stubPath },
  });

test('run-audit: diff → stub auditor → ledger written', () =>
  withTempDir(async (dir) => {
    const stub = writeStub(dir);
    initRepoWithDiff(dir);

    runAudit(dir, stub);

    const ledger = fs.readFileSync(path.join(dir, '.artisan', 'ledger.md'), 'utf8');
    assert.match(ledger, /Direction\nauto direction/);
    assert.match(ledger, /stub finding/);
    assert.ok(fs.existsSync(path.join(dir, '.artisan', 'audit-state.json')));
    assert.match(fs.readFileSync(path.join(dir, '.artisan', 'hook.log'), 'utf8'), /audit: done/);
  }));

test('run-audit: second run with an unchanged diff is skipped (no re-audit)', () =>
  withTempDir(async (dir) => {
    const stub = writeStub(dir);
    initRepoWithDiff(dir);

    runAudit(dir, stub);
    runAudit(dir, stub); // same diff → should skip

    const ledger = fs.readFileSync(path.join(dir, '.artisan', 'ledger.md'), 'utf8');
    assert.equal((ledger.match(/stub finding/g) || []).length, 1);
    assert.match(fs.readFileSync(path.join(dir, '.artisan', 'hook.log'), 'utf8'), /diff unchanged — skipped/);
  }));

test('run-audit: no diff → skipped, no ledger created', () =>
  withTempDir(async (dir) => {
    const stub = writeStub(dir);
    initRepo(dir); // clean tree, no diff

    runAudit(dir, stub);
    assert.equal(fs.existsSync(path.join(dir, '.artisan', 'ledger.md')), false);
  }));
