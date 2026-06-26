#!/usr/bin/env node
// @ts-check
'use strict';

/**
 * Artisan ledger CLI.
 *
 * The controller-side entry point used by the /artisan:review skill (and, later,
 * the auditor hooks) to apply an auditor's verdict and render the ledger. The
 * auditor subagent never writes the ledger directly — it returns a JSON
 * LedgerUpdate, and this CLI validates it (coerceUpdate) and merges it through
 * the tested pure core. Keeps the untrusted LLM output behind a typed boundary.
 *
 * Usage:
 *   ledger-cli.js show  [--project DIR]
 *   ledger-cli.js apply <update.json> [--project DIR] [--session ID]
 */

const fs = require('fs');
const { applyUpdate, coerceUpdate, openFindings, serialize } = require('./lib/ledger');
const { ledgerPath, readLedger, ensureLedger, writeLedger } = require('./lib/ledger-store');

/**
 * @typedef {Object} CliOptions
 * @property {string} command           Subcommand: "show" or "apply".
 * @property {string} project           Project directory whose ledger we operate on.
 * @property {string} [session]         Session id for a freshly created ledger.
 * @property {string} [updateFile]      Path to the JSON update file (apply only).
 */

/**
 * @what Parses CLI argv into a structured options object.
 * @how Reads the leading subcommand, treats the first non-flag remainder as the update file, and pulls --project/--session flag values; defaults project to the current working directory.
 * @why Centralizes argument handling so the command functions receive validated, defaulted options.
 *
 * @param {string[]} argv Arguments after the node executable and script path.
 * @returns {CliOptions} The parsed options.
 *
 * @sideeffects None
 * @systemlayer Utility
 * @domain artisan-ledger, cli
 * @tags cli, args, parse, options
 */
function parseArgs(argv) {
  const command = argv[0] || '';
  /** @type {CliOptions} */
  const opts = { command, project: process.cwd() };
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--project') opts.project = argv[++i];
    else if (arg === '--session') opts.session = argv[++i];
    else if (!arg.startsWith('--') && !opts.updateFile) opts.updateFile = arg;
  }
  return opts;
}

/**
 * @what Prints the rendered ledger for a project to stdout.
 * @how Reads the ledger file; prints a placeholder line when none exists, otherwise prints its serialized markdown.
 * @why The /artisan:review skill calls this to show the user the current ledger state.
 *
 * @param {CliOptions} opts Parsed CLI options.
 * @returns {void}
 *
 * @sideeffects Reads the ledger from disk and writes to stdout.
 * @systemlayer Utility
 * @domain artisan-ledger, cli
 * @tags cli, show, render, ledger
 */
function cmdShow(opts) {
  const ledger = readLedger(ledgerPath(opts.project));
  process.stdout.write(ledger ? serialize(ledger) : '(no ledger yet)\n');
}

/**
 * @what Applies a JSON LedgerUpdate file to a project's ledger and prints a summary.
 * @how Reads and JSON-parses the update file, validates it via coerceUpdate, ensures a ledger exists, merges with applyUpdate, writes atomically with the current timestamp, then prints how many findings were added/closed and how many remain open.
 * @why This is the only path by which an auditor verdict reaches the ledger, so validation and the tested merge live here.
 *
 * @param {CliOptions} opts Parsed CLI options; updateFile is required.
 * @returns {void}
 *
 * @sideeffects Reads the update file and ledger from disk, writes the ledger, and writes a summary to stdout.
 * @systemlayer Utility
 * @domain artisan-ledger, cli
 * @tags cli, apply, update, merge, persist
 */
function cmdApply(opts) {
  if (!opts.updateFile) throw new Error('apply requires an <update.json> path');
  const raw = JSON.parse(fs.readFileSync(opts.updateFile, 'utf8'));
  const update = coerceUpdate(raw);
  const now = new Date().toISOString();
  const file = ledgerPath(opts.project);

  const before = ensureLedger(file, opts.session || 'manual', now);
  const after = applyUpdate(before, update);
  writeLedger(file, after, now);

  const added = after.findings.length - before.findings.length;
  const closed = (update.close || []).filter((c) =>
    before.findings.some((f) => f.id === c.id && f.status === 'open')
  ).length;
  process.stdout.write(
    `applied: +${added} finding(s), ${closed} closed, cursor ${after.meta.cursor}; ${openFindings(after).length} open\n`
  );
}

/**
 * @what Dispatches a parsed CLI invocation to the matching command.
 * @how Routes "show" and "apply" to their handlers; for any other command, prints usage to stderr and exits non-zero.
 * @why Single dispatch point keeps the executable's control flow in one place.
 *
 * @param {string[]} argv Arguments after the node executable and script path.
 * @returns {void}
 *
 * @sideeffects Delegates to commands that perform IO; may write usage to stderr and call process.exit.
 * @systemlayer Utility
 * @domain artisan-ledger, cli
 * @tags cli, dispatch, main, entrypoint
 */
function main(argv) {
  const opts = parseArgs(argv);
  if (opts.command === 'show') return cmdShow(opts);
  if (opts.command === 'apply') return cmdApply(opts);
  process.stderr.write('usage: ledger-cli.js <show|apply> [args]\n');
  process.exit(2);
}

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`ledger-cli: ${/** @type {Error} */ (err).message}\n`);
    process.exit(1);
  }
}

module.exports = { parseArgs };
