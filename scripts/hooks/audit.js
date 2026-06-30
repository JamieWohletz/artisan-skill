#!/usr/bin/env node
// @ts-check
'use strict';

/**
 * Stop hook — launch the background auto-audit.
 *
 * Fires when Claude finishes a turn (the natural "work just happened, review it"
 * beat). It does nothing expensive itself: it spawns the run-audit orchestrator
 * detached and returns immediately, so the turn ends without waiting. The
 * orchestrator decides whether there's anything to audit. Bulletproof by design —
 * any failure is swallowed so the Stop event is never disrupted.
 */

/**
 * @what Launches the detached background auditor for the session's project.
 * @how Parses `cwd` from the Stop hook's stdin payload, then spawns `node run-audit.js --project <cwd>` detached (via spawnDetached) and returns; all errors are swallowed.
 * @why The audit must run off the turn's critical path; the hook only kicks it off, and must never turn a failed launch into a visible Stop-hook error.
 *
 * @returns {void}
 *
 * @sideeffects Reads stdin; spawns a detached background process; best-effort hook log.
 * @systemlayer Utility
 * @domain hooks, auditor
 * @tags hook, stop, audit, detached, launch
 */
function main() {
  var cwd = process.cwd();
  try {
    var fs = require('fs');
    var input = JSON.parse(fs.readFileSync(0, 'utf8'));
    if (input && typeof input.cwd === 'string') cwd = input.cwd;
  } catch (stdinErr) {
    // No or invalid stdin — fall back to process.cwd().
  }

  try {
    var path = require('path');
    var spawnDetached = require('../lib/spawn-detached').spawnDetached;
    var runner = path.join(__dirname, '..', 'run-audit.js');
    spawnDetached(process.execPath, [runner, '--project', cwd], { cwd: cwd });
    try {
      require('../lib/hook-log').logLine(cwd, 'Stop: launched background audit');
    } catch (logErr) {
      // best-effort
    }
  } catch (err) {
    // Never disrupt the Stop event.
  }
}

main();
