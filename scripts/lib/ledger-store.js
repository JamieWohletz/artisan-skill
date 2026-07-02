// @ts-check
'use strict';

/**
 * Artisan ledger — IO layer.
 *
 * The ONLY place that touches the filesystem. Wraps the pure core in ledger.js
 * with read / atomic-write / ensure helpers. Keeping IO isolated here means the
 * parse/serialize/merge logic stays deterministic and unit-testable.
 */

const fs = require('fs');
const path = require('path');
const { parse, serialize, createLedger } = require('./ledger');

/** @typedef {import('./ledger').Ledger} Ledger */

/**
 * @what Computes the default ledger file path for a project.
 * @how Joins the project directory with `.artisan/ledger.md`.
 * @why Centralizes the on-disk location so hooks and the review skill agree on where the ledger lives; one active ledger per project for now, with per-session keying deferred until it proves necessary.
 *
 * @param {string} projectDir The project root directory.
 * @returns {string} Absolute path to the project's ledger file.
 *
 * @sideeffects None
 * @systemlayer Data Layer
 * @domain artisan-ledger, filesystem
 * @tags ledger, path, project, filesystem
 */
function ledgerPath(projectDir) {
  return path.join(projectDir, '.artisan', 'ledger.md');
}

/**
 * @what Reads and parses the ledger at a path, returning null when it does not exist.
 * @how Reads the file as UTF-8 and parses it; swallows ENOENT into null and rethrows any other error.
 * @why Callers need to distinguish "no ledger yet" (create one) from a real IO failure (surface it).
 *
 * @param {string} file Path to the ledger file.
 * @returns {Ledger | null} The parsed ledger, or null when absent.
 *
 * @sideeffects Reads from disk via fs.readFileSync.
 * @systemlayer Data Layer
 * @domain artisan-ledger, filesystem
 * @tags ledger, read, parse, file-io, enoent
 */
function readLedger(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') return null;
    throw err;
  }
  return parse(text);
}

/**
 * @what Writes a ledger to disk atomically, stamping the write time.
 * @how Ensures the directory exists, serializes a copy with `updated` set to `now`, writes it to a pid-suffixed temp file in the same directory, then renames it over the target; on rename failure it unlinks the temp file before rethrowing.
 * @why The rename is atomic on POSIX, so a concurrent reader (the gate or injection hook) never sees a half-written ledger; cleaning up the temp file on the error path avoids leaking files we own.
 *
 * @param {string} file Path to the ledger file.
 * @param {Ledger} ledger The ledger to persist.
 * @param {string} now ISO timestamp for the write (passed in — no hidden clock).
 * @returns {void}
 *
 * @sideeffects Creates directories and writes/renames/unlinks files via fs.mkdirSync, fs.writeFileSync, fs.renameSync, fs.unlinkSync.
 * @systemlayer Data Layer
 * @domain artisan-ledger, filesystem
 * @tags ledger, write, atomic, file-io, serialize
 */
function writeLedger(file, ledger, now) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const stamped = { ...ledger, meta: { ...ledger.meta, updated: now } };
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, serialize(stamped), 'utf8');
  try {
    fs.renameSync(tmp, file);
  } catch (err) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      // best-effort cleanup; surface the original rename error
    }
    throw err;
  }
}

/**
 * @what Reads the ledger at a path, creating and persisting a fresh one when absent.
 * @how Delegates to readLedger; on null, builds an empty ledger with createLedger, writes it via writeLedger, and returns it.
 * @why Gives the review skill and hooks a single call that always yields a usable ledger on first run.
 *
 * @param {string} file Path to the ledger file.
 * @param {string} session Session id for a freshly created ledger.
 * @param {string} now ISO timestamp.
 * @param {string} [direction] Optional initial direction for a new ledger.
 * @returns {Ledger} The existing or newly created ledger.
 *
 * @sideeffects May create directories and write a new ledger file to disk via writeLedger.
 * @systemlayer Data Layer
 * @domain artisan-ledger, filesystem
 * @tags ledger, ensure, create, persist, file-io
 */
function ensureLedger(file, session, now, direction = '') {
  const existing = readLedger(file);
  if (existing) return existing;
  const fresh = createLedger(session, direction);
  writeLedger(file, fresh, now);
  return fresh;
}

module.exports = { ledgerPath, readLedger, writeLedger, ensureLedger };
