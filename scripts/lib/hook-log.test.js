// @ts-check
'use strict';

/**
 * Tests for the best-effort hook activity log. Run: `node --test`.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { logLine } = require('./hook-log');
const { withTempDir } = require('./test-utils');

test('logLine appends timestamped lines when .artisan exists', () =>
  withTempDir(async (dir) => {
    fs.mkdirSync(path.join(dir, '.artisan'));
    logLine(dir, 'hello');
    logLine(dir, 'world');
    const lines = fs.readFileSync(path.join(dir, '.artisan', 'hook.log'), 'utf8').trim().split('\n');
    assert.equal(lines.length, 2);
    assert.match(lines[0], / hello$/);
    assert.match(lines[1], / world$/);
  }));

test('logLine is a no-op when .artisan is absent (no litter, no throw)', () =>
  withTempDir(async (dir) => {
    logLine(dir, 'should not write');
    assert.equal(fs.existsSync(path.join(dir, '.artisan')), false);
  }));
