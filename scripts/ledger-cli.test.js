// @ts-check
'use strict';

/**
 * Tests for the ledger CLI: parseArgs as a unit, plus real subprocess runs of
 * `apply`/`show` against a temp project (the only way to exercise the IO + the
 * untrusted-JSON boundary the way the skill does). Run: `node --test`.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const { parseArgs } = require('./ledger-cli');

const CLI = path.join(__dirname, 'ledger-cli.js');

/**
 * Runs the CLI as a subprocess. Returns { status, stdout, stderr }; never throws
 * on a non-zero exit so tests can assert on failures.
 * @param {string[]} args
 * @returns {{ status: number, stdout: string, stderr: string }}
 */
const runCli = (/** @type {string[]} */ args) => {
  try {
    const stdout = execFileSync('node', [CLI, ...args], { encoding: 'utf8' });
    return { status: 0, stdout, stderr: '' };
  } catch (err) {
    const e = /** @type {{ status: number, stdout: string, stderr: string }} */ (err);
    return { status: e.status, stdout: e.stdout || '', stderr: e.stderr || '' };
  }
};

const writeUpdate = (/** @type {string} */ dir, /** @type {object} */ obj) => {
  const file = path.join(dir, 'update.json');
  fs.writeFileSync(file, JSON.stringify(obj), 'utf8');
  return file;
};

test('parseArgs defaults project to cwd and finds no update file', () => {
  const opts = parseArgs(['show']);
  assert.equal(opts.command, 'show');
  assert.equal(opts.project, process.cwd());
  assert.equal(opts.updateFile, undefined);
});

test('parseArgs reads positional update file and flag values', () => {
  const opts = parseArgs(['apply', 'u.json', '--project', '/tmp/p', '--session', 's1']);
  assert.equal(opts.command, 'apply');
  assert.equal(opts.updateFile, 'u.json');
  assert.equal(opts.project, '/tmp/p');
  assert.equal(opts.session, 's1');
});

test('apply then show round-trips through the real CLI', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artisan-cli-'));
  try {
    const upd = writeUpdate(dir, {
      direction: 'test direction',
      findings: [
        { severity: 'bug', title: 'boom', loc: 'a.js:1', evidence: 'see here' },
        { severity: 'question', title: 'really?', origin: 'user' },
      ],
      cursor: 4,
    });
    const applied = runCli(['apply', upd, '--project', dir]);
    assert.equal(applied.status, 0);
    assert.match(applied.stdout, /\+2 finding\(s\), 0 closed, cursor 4; 2 open/);

    const shown = runCli(['show', '--project', dir]);
    assert.match(shown.stdout, /## Direction\ntest direction/);
    assert.match(shown.stdout, /## Open findings/);
    assert.match(shown.stdout, /## User-raised/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('apply rejects a prototype-chain severity (the coerce boundary holds)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artisan-cli-'));
  try {
    const upd = writeUpdate(dir, { findings: [{ severity: 'toString', title: 'sneaky' }] });
    const res = runCli(['apply', upd, '--project', dir]);
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /severity must be one of/);
    assert.equal(fs.existsSync(path.join(dir, '.artisan', 'ledger.md')), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('closed count reflects only findings that were actually open', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artisan-cli-'));
  try {
    runCli(['apply', writeUpdate(dir, { findings: [{ severity: 'bug', title: 'x', loc: 'a:1' }] }), '--project', dir]);
    const closeUpd = writeUpdate(dir, { close: [{ id: 'F1', note: 'fixed' }] });

    const first = runCli(['apply', closeUpd, '--project', dir]);
    assert.match(first.stdout, /1 closed/);

    const second = runCli(['apply', closeUpd, '--project', dir]);
    assert.match(second.stdout, /0 closed/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
