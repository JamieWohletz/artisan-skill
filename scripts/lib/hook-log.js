// @ts-check
'use strict';

/**
 * Hook activity log.
 *
 * A best-effort, append-only trail so the developer can watch the auditor work
 * (`tail -f .artisan/hook.log`). Deliberately conservative: it only writes when a
 * project's `.artisan/` directory already exists (so the user-scope hook never
 * litters `.artisan/` into unrelated repos), and it swallows every IO error —
 * logging must never be the reason a hook fails. Uses only widely-supported
 * syntax so it loads even on older Node runtimes.
 */

const fs = require('fs');
const path = require('path');

/**
 * @what Appends a timestamped line to a project's hook activity log, best-effort.
 * @how No-ops unless `<projectDir>/.artisan/` exists; otherwise appends "<ISO> <message>" to `.artisan/hook.log`, catching and ignoring any IO error.
 * @why Gives an observable trail of hook firings and audits without littering inactive projects or ever disrupting a hook on a logging failure.
 *
 * @param {string} projectDir The project root whose `.artisan/` dir holds the log.
 * @param {string} message The line to record.
 * @returns {void}
 *
 * @sideeffects Best-effort append to `<projectDir>/.artisan/hook.log`; reads dir existence; swallows all errors.
 * @systemlayer Utility
 * @domain hooks, observability
 * @tags hook, log, observability, append, best-effort
 */
function logLine(projectDir, message) {
  try {
    const dir = path.join(projectDir, '.artisan');
    if (!fs.existsSync(dir)) return;
    fs.appendFileSync(path.join(dir, 'hook.log'), new Date().toISOString() + ' ' + message + '\n');
  } catch (err) {
    // Logging is best-effort; never let it break a hook.
  }
}

module.exports = { logLine };
