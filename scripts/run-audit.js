#!/usr/bin/env node
// @ts-check
'use strict';

/**
 * Background auto-audit orchestrator.
 *
 * Launched detached by the Stop hook. Deterministically: reads the working diff,
 * skips when nothing changed or another audit is in flight (single-flight lock),
 * calls the auditor headlessly with the diff + ledger inline, then validates and
 * merges its verdict into the ledger. The injection hook surfaces the result on
 * the next prompt. The auditor command is configurable (ARTISAN_AUDITOR_BIN /
 * ARTISAN_AUDITOR_ARGS) so the orchestration can be tested without a live model;
 * it defaults to `claude -p`.
 */

const fs = require('fs');
const path = require('path');
const { execSync, execFileSync } = require('child_process');
const { hashDiff, extractJson, buildAuditorPrompt } = require('./lib/audit-runner');
const { coerceUpdate, applyUpdate, openFindings, serialize } = require('./lib/ledger');
const { ledgerPath, ensureLedger, writeLedger } = require('./lib/ledger-store');
const { logLine } = require('./lib/hook-log');

const LOCK_STALE_MS = 10 * 60 * 1000;
const AUDIT_TIMEOUT_MS = 3 * 60 * 1000;
const MAX_BUFFER = 16 * 1024 * 1024;

/**
 * @what Resolves the target project directory from argv.
 * @how Returns the value after `--project`, defaulting to the current working directory.
 * @why The Stop hook passes the session cwd so the audit operates on the right repo.
 *
 * @param {string[]} argv Arguments after the node executable and script path.
 * @returns {string} The project directory.
 *
 * @sideeffects None
 * @systemlayer Utility
 * @domain auditor, cli
 * @tags audit, args, project
 */
function parseProject(argv) {
  const i = argv.indexOf('--project');
  return i !== -1 && argv[i + 1] ? argv[i + 1] : process.cwd();
}

/**
 * @what Returns the working-tree diff against HEAD for a project.
 * @how Runs `git diff HEAD` in the project; returns "" if git fails (no repo / no commits).
 * @why The diff is the ground truth the auditor judges; a non-git or empty repo simply yields nothing to audit.
 *
 * @param {string} project The project directory.
 * @returns {string} The diff text, or "" when unavailable.
 *
 * @sideeffects Runs git via execSync (reads the repo).
 * @systemlayer Data Layer
 * @domain auditor, git
 * @tags audit, git, diff
 */
function getDiff(project) {
  try {
    return execSync('git diff HEAD', { cwd: project, encoding: 'utf8', maxBuffer: MAX_BUFFER });
  } catch (err) {
    return '';
  }
}

/**
 * @what Acquires a single-flight lock for the audit, stealing a stale one.
 * @how Tries an exclusive create of the lock file; on conflict, steals it if older than LOCK_STALE_MS, otherwise fails.
 * @why Prevents overlapping background auditors from racing on the ledger while ensuring a crashed run's stale lock cannot block audits forever.
 *
 * @param {string} lockFile Path to the lock file.
 * @returns {boolean} True if the lock was acquired.
 *
 * @sideeffects Creates, stats, and may delete the lock file.
 * @systemlayer Data Layer
 * @domain auditor, concurrency
 * @tags audit, lock, single-flight, filesystem
 */
function acquireLock(lockFile) {
  try {
    fs.writeFileSync(lockFile, String(process.pid), { flag: 'wx' });
    return true;
  } catch (err) {
    try {
      const age = Date.now() - fs.statSync(lockFile).mtimeMs;
      if (age > LOCK_STALE_MS) {
        fs.unlinkSync(lockFile);
        fs.writeFileSync(lockFile, String(process.pid), { flag: 'wx' });
        return true;
      }
    } catch (stealErr) {
      // fall through
    }
    return false;
  }
}

/**
 * @what Releases the audit lock.
 * @how Best-effort unlink of the lock file.
 * @why The lock must be cleared when the audit finishes (or throws) so the next turn can audit.
 *
 * @param {string} lockFile Path to the lock file.
 * @returns {void}
 *
 * @sideeffects Deletes the lock file.
 * @systemlayer Data Layer
 * @domain auditor, concurrency
 * @tags audit, lock, release, filesystem
 */
function releaseLock(lockFile) {
  try {
    fs.unlinkSync(lockFile);
  } catch (err) {
    // already gone
  }
}

/**
 * @what Invokes the configured auditor with the prompt on stdin and returns its stdout.
 * @how Runs ARTISAN_AUDITOR_BIN (default "claude") with ARTISAN_AUDITOR_ARGS (default "-p"), piping the prompt to stdin, under a timeout.
 * @why Isolating and parameterizing the model call lets the orchestration be tested with a stub and keeps the (uncertain) headless invocation in one place.
 *
 * @param {string} prompt The full auditor prompt.
 * @returns {string} The auditor's stdout.
 *
 * @sideeffects Spawns the auditor subprocess.
 * @systemlayer Data Layer
 * @domain auditor, process
 * @tags audit, claude, subprocess, headless
 */
function runAuditor(prompt) {
  const bin = process.env.ARTISAN_AUDITOR_BIN || 'claude';
  const args = (process.env.ARTISAN_AUDITOR_ARGS || '-p').split(' ').filter(Boolean);
  return execFileSync(bin, args, {
    input: prompt,
    encoding: 'utf8',
    maxBuffer: MAX_BUFFER,
    timeout: AUDIT_TIMEOUT_MS,
  });
}

/**
 * @what Runs one background audit cycle for a project, end to end.
 * @how Diffs the project; skips on empty/unchanged diff (via a stored hash) or a held lock; otherwise locks, builds the prompt from the template + ledger + diff, runs the auditor, validates and merges the verdict, persists the ledger and new diff hash, logs throughout, and always releases the lock.
 * @why This is the autonomous trigger: it turns the manual review into a continuous one without touching the primary session's context.
 *
 * @returns {void}
 *
 * @sideeffects Reads git/diff and files, spawns the auditor, writes the ledger, audit-state, and hook log, and manages the lock file.
 * @systemlayer Data Layer
 * @domain auditor, orchestration
 * @tags audit, orchestrate, autonomous, ledger
 */
function main() {
  const project = parseProject(process.argv.slice(2));

  // Per-repo opt-in: the Stop hook is user-scope and fires in every repo, so only
  // auto-audit projects the developer has activated by creating `.artisan/` (which
  // running /artisan:review does). Without this, the auditor would run — and cost
  // and litter — in every repo with uncommitted changes.
  const artisanDir = path.join(project, '.artisan');
  if (!fs.existsSync(artisanDir)) return;

  const diff = getDiff(project);
  if (!diff.trim()) {
    logLine(project, 'audit: no diff — skipped');
    return;
  }

  const hash = hashDiff(diff);
  const statePath = path.join(artisanDir, 'audit-state.json');
  let lastHash = '';
  try {
    lastHash = JSON.parse(fs.readFileSync(statePath, 'utf8')).diffHash;
  } catch (err) {
    // no prior state
  }
  if (hash === lastHash) {
    logLine(project, 'audit: diff unchanged — skipped');
    return;
  }

  fs.mkdirSync(artisanDir, { recursive: true });
  const lockFile = path.join(artisanDir, 'audit.lock');
  if (!acquireLock(lockFile)) {
    logLine(project, 'audit: another run in progress — skipped');
    return;
  }

  try {
    const file = ledgerPath(project);
    const before = ensureLedger(file, 'auto', new Date().toISOString());
    const template = fs.readFileSync(path.join(__dirname, 'auditor-prompt.md'), 'utf8');
    const prompt = buildAuditorPrompt(template, serialize(before), diff);

    logLine(project, 'audit: launching auditor');
    const out = runAuditor(prompt);
    const update = coerceUpdate(JSON.parse(extractJson(out)));
    const after = applyUpdate(before, update);
    writeLedger(file, after, new Date().toISOString());
    fs.writeFileSync(statePath, JSON.stringify({ diffHash: hash }));

    const added = after.findings.length - before.findings.length;
    logLine(project, `audit: done — +${added} finding(s), ${openFindings(after).length} open`);
  } catch (err) {
    logLine(project, 'audit ERROR: ' + (err instanceof Error ? err.message : String(err)));
  } finally {
    releaseLock(lockFile);
  }
}

main();
