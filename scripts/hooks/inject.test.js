// @ts-check
'use strict';

/**
 * Tests the UserPromptSubmit injection hook as a real subprocess: given a project
 * ledger with open findings, it must emit valid additionalContext JSON; with no
 * ledger it must stay silent. Run: `node --test`.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { execFileSync } = require('child_process');

const { createLedger, applyUpdate } = require('../lib/ledger');
const { writeLedger, ledgerPath } = require('../lib/ledger-store');
const { withTempDir } = require('../lib/test-utils');

const HOOK = path.join(__dirname, 'inject.js');

const runHook = (/** @type {string} */ cwd) =>
  execFileSync('node', [HOOK], { input: JSON.stringify({ cwd, hook_event_name: 'UserPromptSubmit' }), encoding: 'utf8' });

test('inject hook emits additionalContext for a ledger with open findings', () =>
  withTempDir(async (dir) => {
    const l = applyUpdate(createLedger('s', 'Build the gate'), {
      findings: [{ severity: 'bug', title: 'boom', loc: 'a.js:1' }],
    });
    writeLedger(ledgerPath(dir), l, '2026-06-26T00:00:00Z');

    const out = runHook(dir);
    const parsed = JSON.parse(out);
    assert.equal(parsed.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
    assert.match(parsed.hookSpecificOutput.additionalContext, /boom/);
    assert.match(parsed.hookSpecificOutput.additionalContext, /Direction: Build the gate/);
  }));

test('inject hook stays silent when there is no ledger', () =>
  withTempDir(async (dir) => {
    assert.equal(runHook(dir), '');
  }));
