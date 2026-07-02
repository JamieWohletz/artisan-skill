// @ts-check
'use strict';

/**
 * Detached process launcher.
 *
 * The auto-audit hook (UserPromptSubmit/Stop) must kick off the auditor WITHOUT
 * blocking the turn: hooks run synchronously, so a long `claude -p` has to run as
 * a background process that outlives the hook. This wraps the Unix mechanism for
 * that — spawn with `detached: true`, detached stdio, then `unref()` so the parent
 * can exit while the child keeps running (reparented to init/launchd).
 *
 * Optionally redirects the child's stdout+stderr to a log file, because a fully
 * detached process with ignored stdio swallows its own errors — a log makes the
 * background auditor debuggable.
 */

const { spawn } = require('child_process');
const fs = require('fs');

/**
 * @typedef {Object} SpawnDetachedOptions
 * @property {string} [cwd]       Working directory for the child.
 * @property {string} [logFile]   If set, child stdout+stderr are appended here.
 */

/**
 * @what Launches a fully detached background process that outlives the caller.
 * @how Spawns the command with `detached: true` and either ignored stdio or (when a logFile is given) stdout/stderr redirected to an appended file descriptor, then calls `unref()` so the parent's event loop does not wait on the child; the parent closes its own copy of the log fd after spawning.
 * @why Hooks execute synchronously and would stall the turn if they waited on the auditor; detaching lets the hook return immediately while the auditor runs to completion in the background and writes its result to the ledger.
 *
 * @param {string} command The executable to run (e.g. "claude" or "node").
 * @param {string[]} args Arguments passed to the command.
 * @param {SpawnDetachedOptions} [options] Optional cwd and log file.
 * @returns {number | undefined} The child's pid, or undefined if it could not be determined.
 *
 * @sideeffects Spawns a detached OS process; may open and close a log file via fs.openSync/fs.closeSync.
 * @systemlayer Utility
 * @domain process, auditor
 * @tags spawn, detached, background, process, hook
 */
function spawnDetached(command, args, options = {}) {
  let logFd;
  /** @type {import('child_process').StdioOptions} */
  let stdio = 'ignore';
  if (options.logFile) {
    logFd = fs.openSync(options.logFile, 'a');
    stdio = ['ignore', logFd, logFd];
  }

  const child = spawn(command, args, { cwd: options.cwd, detached: true, stdio });
  child.unref();

  // The child inherited the fd; the parent no longer needs its own copy.
  if (logFd !== undefined) fs.closeSync(logFd);

  return child.pid;
}

module.exports = { spawnDetached };
