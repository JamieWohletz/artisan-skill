// @ts-check
'use strict';

/**
 * Auto-audit — pure helpers.
 *
 * Side-effect-free logic for the background auditor: change detection, extracting
 * the auditor's JSON verdict from its (possibly prose-wrapped) output, and
 * composing the headless prompt. The IO/orchestration lives in run-audit.js.
 */

const crypto = require('crypto');

/**
 * @what Computes a stable hash of a diff for change detection.
 * @how SHA-1 of the diff text, hex-encoded.
 * @why The auto-audit re-runs only when the working diff actually changes; comparing hashes avoids re-auditing (and re-paying for) an unchanged diff every turn.
 *
 * @param {string} diff The diff text to fingerprint.
 * @returns {string} Hex SHA-1 of the diff.
 *
 * @sideeffects None
 * @systemlayer Utility
 * @domain auditor, change-detection
 * @tags audit, diff, hash, throttle
 */
function hashDiff(diff) {
  return crypto.createHash('sha1').update(diff).digest('hex');
}

/**
 * @what Extracts the first balanced top-level JSON object from auditor output.
 * @how Prefers the contents of a ```json fenced block if present, then scans for the first '{' and walks the string tracking brace depth and string/escape state to find its matching '}'.
 * @why The auditor is instructed to return only JSON but may wrap it in reasoning prose or a code fence; this recovers the object without a brittle regex.
 *
 * @param {string} text The raw auditor output.
 * @returns {string} The JSON object substring, ready for JSON.parse.
 * @throws {Error} When no balanced JSON object is found.
 *
 * @sideeffects None
 * @systemlayer Utility
 * @domain auditor, parsing
 * @tags audit, json, extract, parse, boundary
 */
function extractJson(text) {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fence ? fence[1] : text;
  const start = candidate.indexOf('{');
  if (start === -1) throw new Error('no JSON object found in auditor output');

  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < candidate.length; i++) {
    const ch = candidate[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') {
      inStr = true;
    } else if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) return candidate.slice(start, i + 1);
    }
  }
  throw new Error('unbalanced JSON in auditor output');
}

/**
 * @what Composes the headless auditor prompt from the core template plus the live ledger and diff.
 * @how Appends a "Current ledger" section (the serialized ledger, or a placeholder) and a fenced "Diff under review" section to the template, so the headless auditor needs no tools to gather context.
 * @why The background auditor runs as a tool-less `claude -p`; providing the diff and ledger inline keeps it independent of tool-permission setup and makes its input fully deterministic.
 *
 * @param {string} template The core auditor instructions (auditor-prompt.md).
 * @param {string} ledgerMarkdown The serialized current ledger, or "" if none.
 * @param {string} diff The diff under review.
 * @returns {string} The full prompt to send to the auditor.
 *
 * @sideeffects None
 * @systemlayer Utility
 * @domain auditor, prompt
 * @tags audit, prompt, compose, headless
 */
function buildAuditorPrompt(template, ledgerMarkdown, diff) {
  return (
    template +
    '\n\n---\n\n## Current ledger\n\n' +
    (ledgerMarkdown && ledgerMarkdown.trim() ? ledgerMarkdown : '(no ledger yet)') +
    '\n\n## Diff under review\n\n```diff\n' +
    diff +
    '\n```\n'
  );
}

module.exports = { hashDiff, extractJson, buildAuditorPrompt };
