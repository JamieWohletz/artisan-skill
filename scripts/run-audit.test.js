// @ts-check
'use strict';

/**
 * Integration test for the background audit orchestrator. Drives run-audit.js as
 * a real subprocess against a temp git repo, with a STUB auditor (no live model).
 * Covers: tracked diff, NEW untracked files (regression — git diff HEAD omits
 * them), the per-repo opt-in gate, change-detection no-op, and the clean-tree
 * skip. The stub lives OUTSIDE the audited repo so it isn't seen as work.
 * Run: `node --test`.
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

/** Make a repo subdir plus a stub auditor OUTSIDE it (so the stub isn't counted as untracked work). */
const setup = (/** @type {string} */ base) => {
  const repo = path.join(base, 'repo');
  fs.mkdirSync(repo, { recursive: true });
  const stub = path.join(base, 'stub.js');
  fs.writeFileSync(stub, STUB);
  return { repo, stub };
};

/** Opt the repo in to auto-audit (what running /artisan:review would do). */
const activate = (/** @type {string} */ repo) => fs.mkdirSync(path.join(repo, '.artisan'), { recursive: true });

/** Init a git repo with one committed file and a clean tree (no diff vs HEAD). */
const initRepo = (/** @type {string} */ repo) => {
  gitIn(repo, 'git init -q && git config user.email a@b.c && git config user.name t');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'one\n');
  gitIn(repo, 'git add -A && git commit -q -m init');
};

/** Init a repo and leave an uncommitted change to a tracked file. */
const initRepoWithDiff = (/** @type {string} */ repo) => {
  initRepo(repo);
  fs.writeFileSync(path.join(repo, 'a.txt'), 'one\ntwo\n');
};

const runAudit = (/** @type {string} */ repo, /** @type {string} */ stubPath) =>
  execFileSync('node', [RUNNER, '--project', repo], {
    encoding: 'utf8',
    env: { ...process.env, ARTISAN_AUDITOR_BIN: 'node', ARTISAN_AUDITOR_ARGS: stubPath },
  });

test('activated repo with a tracked diff → stub auditor → ledger written', () =>
  withTempDir(async (base) => {
    const { repo, stub } = setup(base);
    initRepoWithDiff(repo);
    activate(repo);

    runAudit(repo, stub);

    const ledger = fs.readFileSync(path.join(repo, '.artisan', 'ledger.md'), 'utf8');
    assert.match(ledger, /Direction\nauto direction/);
    assert.match(ledger, /stub finding/);
    assert.match(fs.readFileSync(path.join(repo, '.artisan', 'hook.log'), 'utf8'), /audit: done/);
  }));

test('activated repo whose only change is a NEW untracked file → still audited', () =>
  withTempDir(async (base) => {
    const { repo, stub } = setup(base);
    initRepo(repo); // clean tracked tree
    activate(repo);
    fs.writeFileSync(path.join(repo, 'new-feature.js'), 'function f() { return 1; }\n'); // untracked

    runAudit(repo, stub);
    assert.ok(
      fs.existsSync(path.join(repo, '.artisan', 'ledger.md')),
      'new untracked files must trigger an audit (git diff HEAD omits them)'
    );
  }));

test('activated repo whose only untracked file is a secret (.env) → skipped, not sent to the model', () =>
  withTempDir(async (base) => {
    const { repo, stub } = setup(base);
    initRepo(repo); // clean tracked tree
    activate(repo);
    fs.writeFileSync(path.join(repo, '.env'), 'SECRET=hunter2\n'); // untracked secret

    runAudit(repo, stub);
    assert.equal(
      fs.existsSync(path.join(repo, '.artisan', 'ledger.md')),
      false,
      'a secret-only change must not trigger an audit — .env must never reach the model'
    );
  }));

test('un-activated repo (no .artisan) is skipped even with a diff', () =>
  withTempDir(async (base) => {
    const { repo, stub } = setup(base);
    initRepoWithDiff(repo);

    runAudit(repo, stub);
    assert.equal(fs.existsSync(path.join(repo, '.artisan')), false);
  }));

test('second run with an unchanged diff is skipped (no re-audit)', () =>
  withTempDir(async (base) => {
    const { repo, stub } = setup(base);
    initRepoWithDiff(repo);
    activate(repo);

    runAudit(repo, stub);
    runAudit(repo, stub); // same diff → should skip

    const ledger = fs.readFileSync(path.join(repo, '.artisan', 'ledger.md'), 'utf8');
    assert.equal((ledger.match(/stub finding/g) || []).length, 1);
    assert.match(fs.readFileSync(path.join(repo, '.artisan', 'hook.log'), 'utf8'), /diff unchanged — skipped/);
  }));

test('activated repo with no diff at all → skipped, no ledger created', () =>
  withTempDir(async (base) => {
    const { repo, stub } = setup(base);
    initRepo(repo); // clean tree; stub is outside the repo, .artisan is excluded
    activate(repo);

    runAudit(repo, stub);
    assert.equal(fs.existsSync(path.join(repo, '.artisan', 'ledger.md')), false);
  }));
