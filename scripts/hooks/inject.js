#!/usr/bin/env node
// @ts-check
'use strict';

/**
 * UserPromptSubmit hook — ledger injection.
 *
 * Runs before each prompt the developer submits. Reads the project's ledger and,
 * if it has a direction or open findings, emits them as `additionalContext` so the
 * auditor's standing concerns are re-grounded into the session every turn. This is
 * the decay cure: the principles and findings stay present even as the conversation
 * grows.
 *
 * Robustness: the entire body is wrapped so this hook can NEVER disrupt a prompt.
 * The heavy modules are required inside the try, so even a load-time failure (e.g.
 * an old Node that can't parse newer syntax) degrades to a silent no-op + a best-
 * effort log line rather than a visible hook error. It always exits 0.
 */

/**
 * @what Injects the project ledger's open findings as additional context, never disrupting the prompt.
 * @how Parses stdin for `cwd`, then inside a guarded block requires the ledger modules, reads and renders the ledger, logs the firing, and prints the UserPromptSubmit `additionalContext` JSON when non-empty; any failure is caught, logged best-effort, and swallowed.
 * @why A hook on every prompt must be bulletproof — a missing/old Node, a malformed ledger, or any unexpected error must degrade to "no injection" rather than a user-facing hook error.
 *
 * @returns {void}
 *
 * @sideeffects Reads stdin and the ledger file; appends to the hook log; writes JSON to stdout.
 * @systemlayer Utility
 * @domain hooks, artisan-ledger
 * @tags hook, inject, context, userpromptsubmit, decay
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
    var ledgerMod = require('../lib/ledger');
    var store = require('../lib/ledger-store');
    var log = require('../lib/hook-log').logLine;

    var ledger = store.readLedger(store.ledgerPath(cwd));
    if (!ledger) return; // no ledger → nothing to inject, nothing to log

    var openCount = ledgerMod.openFindings(ledger).length;
    var context = ledgerMod.renderInjection(ledger);
    log(cwd, 'UserPromptSubmit: ' + openCount + ' open finding(s); injected ' + (context ? openCount + ' item(s)' : 'nothing'));
    if (!context) return;

    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: context },
      })
    );
  } catch (err) {
    try {
      var msg = err instanceof Error ? err.message : String(err);
      require('../lib/hook-log').logLine(cwd, 'UserPromptSubmit ERROR: ' + msg);
    } catch (logErr) {
      // best-effort only
    }
    // Never disrupt the prompt: fall through and exit 0.
  }
}

main();
