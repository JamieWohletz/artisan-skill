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
 * grows. It is read-only and fast; it never blocks the turn on anything expensive.
 */

const fs = require('fs');
const { renderInjection } = require('../lib/ledger');
const { readLedger, ledgerPath } = require('../lib/ledger-store');

/**
 * @what Reads the hook's JSON payload from stdin.
 * @how Reads fd 0 synchronously; returns an empty string if stdin is closed or unreadable.
 * @why Claude Code delivers hook input as JSON on stdin; we need the `cwd` to locate the project ledger.
 *
 * @returns {string} The raw stdin contents, or "" when unavailable.
 *
 * @sideeffects Reads from file descriptor 0 (stdin).
 * @systemlayer Utility
 * @domain hooks, artisan-ledger
 * @tags hook, stdin, read, input
 */
function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

/**
 * @what Injects the project ledger's open findings as additional context for the upcoming prompt.
 * @how Parses the stdin payload for `cwd`, reads that project's ledger, renders it for injection, and — when non-empty — prints the UserPromptSubmit `additionalContext` JSON; otherwise prints nothing.
 * @why Re-grounding the session in standing findings each turn is what keeps the auditor's guidance from decaying out of context.
 *
 * @returns {void}
 *
 * @sideeffects Reads stdin and the ledger file; writes JSON to stdout.
 * @systemlayer Utility
 * @domain hooks, artisan-ledger
 * @tags hook, inject, context, userpromptsubmit, decay
 */
function main() {
  let cwd = process.cwd();
  try {
    const input = JSON.parse(readStdin());
    if (input && typeof input.cwd === 'string') cwd = input.cwd;
  } catch {
    // No/invalid stdin — fall back to process.cwd().
  }

  const ledger = readLedger(ledgerPath(cwd));
  if (!ledger) return;

  const context = renderInjection(ledger);
  if (!context) return;

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: context },
    })
  );
}

main();
