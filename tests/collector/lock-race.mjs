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

// Release has the same read/remove race as recovery. A competing release +
// reserve must not replace a lock while the first release still owns the gate.
const releaseDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'test-progress-release-'));
const releaseLocations = files(releaseDirectory, 'backend');
let releaseInterleaved = false;
try {
  acquireLock(releaseDirectory, 'backend', 'old-run');
  fs[method] = function(target, options) {
    if (target === releaseLocations.lock && !releaseInterleaved) {
      releaseInterleaved = true;
      const code = `import { acquireLock, releaseLock } from ${JSON.stringify(state)};
        try {
          releaseLock(${JSON.stringify(releaseDirectory)}, 'backend', 'old-run');
          acquireLock(${JSON.stringify(releaseDirectory)}, 'backend', 'new-run');
          console.log('reserved');
        } catch { console.log('blocked'); }`;
      const result = spawnSync(process.execPath, ['--input-type=module', '-e', code],
        { encoding: 'utf8', timeout: 4000 });
      assert.strictEqual(result.status, 0, result.stderr);
      assert.strictEqual(result.stdout.trim(), 'blocked');
    }
    return original(target, options);
  };
  releaseLock(releaseDirectory, 'backend', 'old-run');
  assert(releaseInterleaved);
  fs[method] = original;
  acquireLock(releaseDirectory, 'backend', 'new-run');
  releaseLock(releaseDirectory, 'backend', 'old-run');
  assert.strictEqual(readJson(releaseLocations.claim).runId, 'new-run');
  releaseLock(releaseDirectory, 'backend', 'new-run');

  // A killed gate holder is deliberately not reclaimed using another racy
  // stale check; an old gate leaves all lane data intact and returns promptly.
  const gate = path.join(releaseDirectory, 'backend.mutation');
  fs.mkdirSync(gate);
  fs.utimesSync(gate, new Date(0), new Date(0));
  const started = Date.now();
  assert.throws(() => acquireLock(releaseDirectory, 'backend', 'unsafe-recovery'), /recuperação manual/);
  assert(Date.now() - started < 2500);
  assert(fs.existsSync(gate));
  assert(!fs.existsSync(releaseLocations.lock));
  console.log('release serialization and abandoned mutation gate fail closed: OK');
} finally {
  fs[method] = original;
  removePath(releaseDirectory, { recursive: true, force: true });
}
