// Deterministically interleave a second *process* at the stale lock deletion seam.
import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { acquireLock, releaseLock, files, atomicJson, readJson } from '../../runner/state.mjs';
import { removePath } from '../../runner/runtime.mjs';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'test-progress-lock-'));
const locations = files(directory, 'backend');
const state = new URL('../../runner/state.mjs', import.meta.url).href;
const original = fs.rmSync || fs.rmdirSync;
const method = fs.rmSync ? 'rmSync' : 'rmdirSync';
let rival;
let interleaved = false;
try {
  fs.mkdirSync(locations.lock);
  atomicJson(locations.claim, { runId: 'stale', launchPid: 2147483647 });
  fs.utimesSync(locations.lock, new Date(0), new Date(0));
  fs[method] = function(target, options) {
    if (target === locations.lock && !interleaved) {
      interleaved = true;
      const code = `import { acquireLock, files, atomicJson, readJson } from ${JSON.stringify(state)};
        try {
          acquireLock(${JSON.stringify(directory)}, 'backend', 'run-B');
          const loc = files(${JSON.stringify(directory)}, 'backend');
          atomicJson(loc.claim, {...readJson(loc.claim), workerPid: ${process.pid}});
          atomicJson(loc.snapshot, {runId: 'run-B', status: 'running'});
          console.log('reserved');
        } catch { console.log('blocked'); }`;
      const result = spawnSync(process.execPath, ['--input-type=module', '-e', code],
        { encoding: 'utf8', timeout: 4000 });
      assert.strictEqual(result.status, 0, result.stderr);
      rival = result.stdout.trim();
    }
    return original(target, options);
  };
  acquireLock(directory, 'backend', 'run-A');
  assert.strictEqual(interleaved, true);
  assert.strictEqual(rival, 'blocked', 'A must exclude B throughout stale-lock removal');
  assert.strictEqual(readJson(locations.claim).runId, 'run-A');
  releaseLock(directory, 'backend', 'wrong-owner');
  assert.strictEqual(readJson(locations.claim).runId, 'run-A');
  releaseLock(directory, 'backend', 'run-A');
  acquireLock(directory, 'backend', 'run-C');
  releaseLock(directory, 'backend', 'run-A');
  assert.strictEqual(readJson(locations.claim).runId, 'run-C');
  console.log('stale recovery and owner-bound release: OK');
} finally {
  fs[method] = original;
  removePath(directory, { recursive: true, force: true });
}
