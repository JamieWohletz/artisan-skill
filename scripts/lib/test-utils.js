// @ts-check
'use strict';

/**
 * Shared helpers for the test suite — temp-directory lifecycle and bounded
 * polling. Kept in one place so individual test files don't re-implement (and
 * subtly diverge on) setup/teardown and wait loops.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * @what Resolves after a delay.
 * @how Wraps setTimeout in a Promise.
 * @why Lets bounded poll loops yield between checks without busy-waiting.
 *
 * @param {number} ms Milliseconds to wait.
 * @returns {Promise<void>} Resolves when the delay elapses.
 *
 * @sideeffects Schedules a timer.
 * @systemlayer Utility
 * @domain test
 * @tags test, delay, async, timer
 */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @what Runs a function with a fresh temp directory, cleaning it up afterward.
 * @how Creates a unique temp dir, awaits the callback with it, and removes the dir recursively in a finally block so cleanup runs even on failure.
 * @why Every IO test needs an isolated scratch dir with guaranteed teardown; centralizing it avoids duplicated, drift-prone setup/cleanup.
 *
 * @param {(dir: string) => Promise<void> | void} fn Callback receiving the temp dir path.
 * @returns {Promise<void>} Resolves after the callback completes and cleanup runs.
 *
 * @sideeffects Creates and removes a temporary directory on disk.
 * @systemlayer Utility
 * @domain test, filesystem
 * @tags test, tempdir, fixture, cleanup, filesystem
 */
async function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artisan-test-'));
  try {
    await fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * @what Polls until a file exists and (optionally) its contents satisfy a predicate, up to a bound.
 * @how Re-checks existence and the predicate every `interval` ms for at most `tries` attempts, yielding via delay between checks; returns whether the condition was met.
 * @why Detached/background work finishes asynchronously; content-polling (rather than a fixed sleep) avoids both flakiness and unnecessary waiting.
 *
 * @param {string} file Path to watch.
 * @param {(contents: string) => boolean} [predicate] Optional check on the file's UTF-8 contents; defaults to existence only.
 * @param {{ tries?: number, interval?: number }} [options] Bound and cadence of polling.
 * @returns {Promise<boolean>} True if the condition was met within the bound.
 *
 * @sideeffects Reads the filesystem repeatedly.
 * @systemlayer Utility
 * @domain test, filesystem
 * @tags test, poll, wait, file, async
 */
async function waitForFile(file, predicate, options = {}) {
  const { tries = 60, interval = 50 } = options;
  for (let i = 0; i < tries; i++) {
    if (fs.existsSync(file) && (!predicate || predicate(fs.readFileSync(file, 'utf8')))) return true;
    await delay(interval);
  }
  return false;
}

module.exports = { delay, withTempDir, waitForFile };
