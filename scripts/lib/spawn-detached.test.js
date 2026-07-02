// @ts-check
'use strict';

/**
 * Spike + regression test for spawnDetached: proves the detached child outlives
 * the parent and that the call is non-blocking. This is the load-bearing
 * mechanism for the auto-audit hook (a hook must return immediately while the
 * auditor keeps running). Run: `node --test`.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { spawnDetached } = require('./spawn-detached');
const { withTempDir, waitForFile } = require('./test-utils');

test('spawnDetached returns immediately and the child outlives the parent', () =>
  withTempDir(async (dir) => {
    const marker = path.join(dir, 'marker.txt');
    // Child waits, then writes — so if it ran synchronously the marker would
    // already exist when spawnDetached returns.
    const script = `setTimeout(() => require('fs').writeFileSync(${JSON.stringify(marker)}, 'done'), 500);`;

    const started = process.hrtime.bigint();
    const pid = spawnDetached(process.execPath, ['-e', script], { cwd: dir });
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;

    assert.ok(typeof pid === 'number', 'should return a pid');
    assert.ok(elapsedMs < 300, `spawn should be non-blocking, took ${elapsedMs.toFixed(0)}ms`);
    assert.equal(fs.existsSync(marker), false, 'child should not have run synchronously');

    const done = await waitForFile(marker, (c) => c === 'done');
    assert.ok(done, 'detached child should complete after the parent returns');
  }));

test('spawnDetached redirects child output to a log file', () =>
  withTempDir(async (dir) => {
    const logFile = path.join(dir, 'child.log');
    spawnDetached(process.execPath, ['-e', "process.stdout.write('hello from child')"], { logFile });

    const logged = await waitForFile(logFile, (c) => /hello from child/.test(c));
    assert.ok(logged, 'child stdout should reach the log file');
  }));
