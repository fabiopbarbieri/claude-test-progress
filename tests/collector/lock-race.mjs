// Both release and reserve hold the mutation gate across ownership checks/removal.
import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { acquireLock, releaseLock, files, atomicJson, readJson } from '../../runner/state.mjs';
import { randomUUID, removePath } from '../../runner/runtime.mjs';
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'test-progress-lock-'));
const state = new URL('../../runner/state.mjs', import.meta.url).href;
const oldRun = randomUUID();
const newRun = randomUUID();
const locations = files(directory, 'api');
const original = fs.unlinkSync;
let interleaved = false;
try {
  acquireLock(directory, 'api', oldRun);
  fs.unlinkSync = function(target) {
    if (target === locations.claim && !interleaved) {
      interleaved = true;
      const code = `import { acquireLock, releaseLock } from ${JSON.stringify(state)};
        try {
          releaseLock(${JSON.stringify(directory)}, 'api', ${JSON.stringify(oldRun)});
          acquireLock(${JSON.stringify(directory)}, 'api', ${JSON.stringify(newRun)});
          console.log('reserved');
        } catch { console.log('blocked'); }`;
      const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', timeout: 4000 });
      assert.strictEqual(result.status, 0, result.stderr);
      assert.strictEqual(result.stdout.trim(), 'blocked');
    }
    return original(target);
  };
  releaseLock(directory, 'api', oldRun);
  assert(interleaved);
  fs.unlinkSync = original;
  acquireLock(directory, 'api', newRun);
  releaseLock(directory, 'api', oldRun);
  assert.strictEqual(readJson(locations.claim).runId, newRun, 'old release must not remove new run');
  releaseLock(directory, 'api', newRun);
  fs.mkdirSync(locations.lock);
  atomicJson(locations.claim, { schema: 1, runId: 'old', launchPid: 2147483647 });
  fs.utimesSync(locations.lock, new Date(0), new Date(0));
  assert.throws(() => acquireLock(directory, 'api', randomUUID()), /lock/);
  assert(fs.existsSync(locations.lock), 'old unknown locks never expire by age or PID');
  fs.unlinkSync(locations.claim);
  fs.rmdirSync(locations.lock);
  const gate = path.join(directory, 'api.mutation');
  fs.mkdirSync(gate);
  fs.utimesSync(gate, new Date(0), new Date(0));
  const before = Date.now();
  assert.throws(() => acquireLock(directory, 'api', randomUUID()), /recuperação manual/);
  assert(Date.now() - before < 2500);
  assert(fs.existsSync(gate));
  console.log('v2 release/reserve serialization, run ownership and unknown locks fail closed: OK');
} finally {
  fs.unlinkSync = original;
  removePath(directory, { recursive: true, force: true });
}
