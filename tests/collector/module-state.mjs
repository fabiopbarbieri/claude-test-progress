import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { performance } from 'perf_hooks';
import { namespace, inspectState, files, readJson, readPrivate, atomicJson, acquireLock, releaseLock } from '../../runner/state.mjs';
import { processIdentity } from '../../runner/process-identity.mjs';
import { batchFiles, changeBatch } from '../../runner/module-batch.mjs';
import { randomUUID, removePath } from '../../runner/runtime.mjs';
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'module-state-'));
const context = namespace(cwd, randomUUID());
try {
  const replacementFile = files(context.directory, 'replacement').snapshot;
  const originalValue = { schemaVersion: 1, moduleId: 'replacement', runId: randomUUID(), status: 'running', heartbeatAt: '2026-01-01T00:00:00.000Z' };
  const replacementValue = { ...originalValue, heartbeatAt: '2026-01-01T00:00:05.000Z' };
  atomicJson(replacementFile, originalValue);
  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  const originalRename = fs.renameSync;
  Object.defineProperty(process, 'platform', { ...originalPlatform, value: 'win32' });
  try {
    let attempts = 0;
    fs.renameSync = function(from, to) {
      if (to === replacementFile && ++attempts <= 3) throw Object.assign(new Error('Transient sharing violation'), { code: 'EPERM' });
      return originalRename(from, to);
    };
    atomicJson(replacementFile, replacementValue);
    assert.strictEqual(attempts, 4);
    assert.deepStrictEqual(readJson(replacementFile), replacementValue, 'Sharing retries publish the complete new record');
    const heldUntil = performance.now() + 450;
    attempts = 0;
    fs.renameSync = function(from, to) {
      attempts++;
      if (performance.now() < heldUntil) throw Object.assign(new Error('Held sharing violation'), { code: 'EPERM' });
      return originalRename(from, to);
    };
    atomicJson(replacementFile, originalValue);
    assert(attempts > 1, 'A bounded sharing hold longer than 300 ms must be retried');
    assert.deepStrictEqual(readJson(replacementFile), originalValue, 'The complete new record publishes after the held reader releases');
    atomicJson(replacementFile, replacementValue);
    attempts = 0;
    fs.renameSync = function() { attempts++; throw Object.assign(new Error('Persistent sharing violation'), { code: 'EPERM' }); };
    const started = performance.now();
    const originalNow = Date.now;
    Date.now = () => 0;
    try { assert.throws(() => atomicJson(replacementFile, originalValue), /Persistent sharing/); }
    finally { Date.now = originalNow; }
    assert(attempts > 1 && performance.now() - started < 1500, 'Persistent sharing failure must remain bounded even if the wall clock stops');
    assert.deepStrictEqual(readJson(replacementFile), replacementValue, 'Failure preserves the previous complete record');
    assert(!fs.readdirSync(context.directory).some(name => name.endsWith('.tmp')), 'Failed writes must remove only their own temporary file');
    const substituted = path.join(cwd, 'outside-retry.json');
    fs.writeFileSync(substituted, JSON.stringify({ outside: true }));
    fs.renameSync = function(from, to) {
      fs.unlinkSync(to);
      fs.symlinkSync(substituted, to);
      throw Object.assign(new Error('Sharing violation during substitution'), { code: 'EPERM' });
    };
    assert.throws(() => atomicJson(replacementFile, originalValue), /inseguro|Link/,
      'Each sharing retry must authenticate the destination again');
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(substituted, 'utf8')), { outside: true });
    fs.unlinkSync(replacementFile);
  } finally { fs.renameSync = originalRename; Object.defineProperty(process, 'platform', originalPlatform); }
  atomicJson(replacementFile, originalValue);
  const originalOpen = fs.openSync;
  let atomicReplacement = false;
  fs.openSync = function(target, ...args) {
    if (target === replacementFile && !atomicReplacement) {
      atomicReplacement = true;
      atomicJson(replacementFile, replacementValue);
    }
    return originalOpen(target, ...args);
  };
  try {
    assert.deepStrictEqual(readJson(replacementFile), replacementValue,
      'authenticated atomic replacement between stat and open is a normal state read');
    assert(atomicReplacement);
  } finally { fs.openSync = originalOpen; }
  const finalReplacement = { ...replacementValue, heartbeatAt: '2026-01-01T00:00:10.000Z' };
  atomicReplacement = false;
  fs.openSync = function(target, ...args) {
    const fd = originalOpen(target, ...args);
    if (target === replacementFile && !atomicReplacement) {
      atomicReplacement = true;
      atomicJson(replacementFile, finalReplacement);
    }
    return fd;
  };
  try {
    const observed = readJson(replacementFile);
    assert([replacementValue.heartbeatAt, finalReplacement.heartbeatAt].includes(observed.heartbeatAt));
    assert.strictEqual(observed.runId, originalValue.runId, 'fd read remains a complete authenticated version after rename');
  } finally { fs.openSync = originalOpen; }
  const outsideRead = path.join(cwd, 'outside-state.json');
  fs.writeFileSync(outsideRead, JSON.stringify({ private: 'outside-sentinel' }));
  for (const afterOpen of [false, true]) {
    atomicJson(replacementFile, finalReplacement);
    atomicReplacement = false;
    fs.openSync = function(target, ...args) {
      if (target !== replacementFile || atomicReplacement) return originalOpen(target, ...args);
      atomicReplacement = true;
      const fd = afterOpen ? originalOpen(target, ...args) : null;
      fs.unlinkSync(replacementFile);
      fs.symlinkSync(outsideRead, replacementFile);
      return afterOpen ? fd : originalOpen(target, ...args);
    };
    try { assert.throws(() => readJson(replacementFile), undefined, 'symlink replacement before or after open cannot escape the namespace'); }
    finally { fs.openSync = originalOpen; fs.unlinkSync(replacementFile); }
  }
  const privateParent = path.join(context.directory, 'read-parent');
  const savedParent = path.join(context.directory, 'saved-parent');
  const outsideParent = path.join(cwd, 'outside-parent');
  fs.mkdirSync(privateParent, { mode: 0o700 });
  fs.mkdirSync(outsideParent, { mode: 0o700 });
  const parentTarget = path.join(privateParent, 'state.json');
  const trustedParentValue = { content: 'trusted-state' };
  atomicJson(parentTarget, trustedParentValue);
  atomicJson(path.join(outsideParent, 'state.json'), { content: 'outside-sentinel' });
  let parentReplaced = false;
  fs.openSync = function(target, ...args) {
    if (target !== parentTarget || parentReplaced) return originalOpen(target, ...args);
    parentReplaced = true;
    fs.renameSync(privateParent, savedParent);
    fs.symlinkSync(outsideParent, privateParent, process.platform === 'win32' ? 'junction' : 'dir');
    try { return originalOpen(target, ...args); }
    finally { fs.unlinkSync(privateParent); fs.renameSync(savedParent, privateParent); }
  };
  try {
    assert.deepStrictEqual(readJson(parentTarget), trustedParentValue,
      'O_NOFOLLOW cannot authenticate a temporarily replaced parent; retry must read the restored trusted leaf');
    assert(parentReplaced);
  } finally { fs.openSync = originalOpen; removePath(privateParent, { recursive: true, force: true }); }
  atomicJson(replacementFile, { content: 'x'.repeat(2048) });
  assert.throws(() => readPrivate(replacementFile, 1024), /limite/, 'the opened fd must still obey the byte limit');
  fs.unlinkSync(replacementFile);
  const tailFile = path.join(context.directory, 'tail.log');
  fs.writeFileSync(tailFile, `${'é'.repeat(40)}\nsecond\nthird\n`, { mode: 0o600 });
  assert.strictEqual(readPrivate(tailFile, 1024, { tail: 10 }), 'third\n', 'a tail starts after the first, partial line');
  assert.strictEqual(readPrivate(tailFile, 1024, { tail: 15 }), 'second\nthird\n', 'a split UTF-8 character is dropped with its line');
  assert.strictEqual(readPrivate(tailFile, 1024, { tail: 4096 }), fs.readFileSync(tailFile, 'utf8'), 'a short file is read whole');
  assert.throws(() => readPrivate(tailFile, 16, { tail: 8 }), /limite/, 'a tail read still obeys the file limit');
  fs.unlinkSync(tailFile);
  const teardown = namespace(cwd, randomUUID());
  try {
    const loc = files(teardown.directory, 'api');
    const terminal = { schemaVersion: 1, moduleId: 'api', runId: randomUUID(), status: 'completed', exitCode: 0 };
    for (const step of ['mutation-realpath', 'lock-realpath', 'claim-realpath', 'claim-open', 'claim-after-open', 'cancel-realpath']) {
      atomicJson(loc.snapshot, terminal);
      fs.mkdirSync(loc.lock, { mode: 0o700 });
      atomicJson(loc.claim, terminal);
      atomicJson(loc.cancel, terminal);
      const gate = path.join(teardown.directory, 'api.mutation');
      fs.mkdirSync(gate, { mode: 0o700 });
      const originalRealpath = fs.realpathSync;
      const originalOpen = fs.openSync;
      let injected = false;
      const target = step.startsWith('mutation') ? gate : step.startsWith('lock') ? loc.lock : step.startsWith('claim') ? loc.claim : loc.cancel;
      function removeObserved() {
        injected = true;
        fs.unlinkSync(loc.claim);
        fs.rmdirSync(loc.lock);
        fs.unlinkSync(loc.cancel);
        fs.rmdirSync(gate);
      }
      fs.realpathSync = function(file, ...args) {
        if (!step.endsWith('open') && file === target && !injected) removeObserved();
        return originalRealpath(file, ...args);
      };
      fs.openSync = function(file, ...args) {
        if (step === 'claim-after-open' && file === target && !injected) {
          const fd = originalOpen(file, ...args);
          removeObserved();
          return fd;
        }
        if (step.endsWith('open') && file === target && !injected) removeObserved();
        return originalOpen(file, ...args);
      };
      try {
        const observed = inspectState(teardown.directory);
        assert(injected, `teardown injection ${step} must execute`);
        assert.strictEqual(observed.jobs.api?.status, 'completed', `${step} must preserve the authenticated terminal snapshot`);
        assert.strictEqual(observed.blocked, false, `${step} must not create incompatible-state diagnostics from obsolete reads`);
        assert(!observed.stateDiagnostics.api, `${step} must not retain diagnostics from a discarded observation`);
      } finally { fs.realpathSync = originalRealpath; fs.openSync = originalOpen; }
    }
    fs.unlinkSync(loc.snapshot);
    const gate = path.join(teardown.directory, 'api.mutation');
    fs.mkdirSync(gate, { mode: 0o700 });
    const originalLstat = fs.lstatSync;
    let releasedBetweenAttempts = false;
    fs.lstatSync = function(file, ...args) {
      if (file === gate && !releasedBetweenAttempts) {
        releasedBetweenAttempts = true;
        fs.rmdirSync(gate);
      }
      return originalLstat(file, ...args);
    };
    const retryRun = randomUUID();
    try {
      acquireLock(teardown.directory, 'api', retryRun);
      assert(releasedBetweenAttempts, 'The previous mutation must disappear after EEXIST');
      assert.strictEqual(readJson(loc.claim).runId, retryRun, 'Lock acquisition must retry a normally released mutation');
    } finally { fs.lstatSync = originalLstat; }
    releaseLock(teardown.directory, 'api', retryRun);
    fs.mkdirSync(gate, { mode: 0o700 });
    const started = Date.now();
    assert.throws(() => acquireLock(teardown.directory, 'api', randomUUID()), /bloqueado por alteração/);
    assert(Date.now() - started < 2000, 'A persistent mutation remains bounded and requires recovery');
    fs.rmdirSync(gate);
    fs.symlinkSync(cwd, gate, process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => acquireLock(teardown.directory, 'api', randomUUID()), /inseguro|Link/);
    fs.unlinkSync(gate);
    const batchId = randomUUID();
    const batch = batchFiles(teardown.directory, batchId);
    atomicJson(batch.manifest, { schemaVersion: 1, batchId, state: 'preparing', entries: [{ moduleId: 'api', runId: retryRun }] });
    fs.mkdirSync(batch.gate, { mode: 0o700 });
    releasedBetweenAttempts = false;
    fs.lstatSync = function(file, ...args) {
      if (file === batch.gate && !releasedBetweenAttempts) {
        releasedBetweenAttempts = true;
        fs.rmdirSync(batch.gate);
      }
      return originalLstat(file, ...args);
    };
    try {
      const updated = changeBatch(teardown.directory, batchId, value => ({ ...value, observed: true }));
      assert(releasedBetweenAttempts && updated.observed, 'Batch changes must also retry a normally released mutation');
    } finally { fs.lstatSync = originalLstat; }
  } finally { removePath(teardown.directory, { recursive: true, force: true }); }
  const runId = randomUUID();
  acquireLock(context.directory, 'api', runId);
  assert(inspectState(context.directory).stateDiagnostics.api.length, 'lock without snapshot is visible');
  assert.throws(() => acquireLock(context.directory, 'api', randomUUID()), /bloquead|execução|lock/);
  releaseLock(context.directory, 'api', randomUUID());
  assert(fs.existsSync(files(context.directory, 'api').lock));
  releaseLock(context.directory, 'api', runId);
  atomicJson(files(context.directory, 'old').snapshot, { version: 'other', runId: 'old', module: 'old' });
  atomicJson(files(context.directory, 'good').snapshot, { schemaVersion: 1, moduleId: 'good', runId: randomUUID(), status: 'completed' });
  const state = inspectState(context.directory);
  assert.strictEqual(state.blocked, true);
  assert(state.stateDiagnostics.old.length);
  assert.strictEqual(state.jobs.good.status, 'completed');
  assert.strictEqual(state.jobs.old, undefined);
  fs.symlinkSync(path.join(cwd, 'outside'), files(context.directory, 'unsafe').snapshot);
  assert(inspectState(context.directory).stateDiagnostics.unsafe.length);
  assert.throws(() => files(context.directory, '../escape'));
  const orphanRun = randomUUID();
  atomicJson(path.join(context.directory, `hidden.${orphanRun}.job.json`), { version: 'other', runId: orphanRun, module: 'hidden' });
  assert(inspectState(context.directory).stateDiagnostics.hidden?.length, 'standalone incompatible job must be enumerated');
  atomicJson(files(context.directory, 'cancel-only').cancel, { schema: 1, runId: 'old' });
  assert(inspectState(context.directory).stateDiagnostics['cancel-only']?.length, 'standalone incompatible cancellation must be enumerated');
  fs.writeFileSync(files(context.directory, 'broken').snapshot, 'private-secret-invalid-json');
  assert(!JSON.stringify(inspectState(context.directory)).includes('private-secret'), 'corrupt state diagnostics cannot expose file contents');
  if (process.platform === 'linux') {
    const fastRun = randomUUID();
    acquireLock(context.directory, 'fast', fastRun);
    const dead = { ...processIdentity(process.pid), pid: 2147483647, group: 2147483647 };
    atomicJson(files(context.directory, 'fast').claim, { schemaVersion: 1, moduleId: 'fast', runId: fastRun, workerIdentity: dead, childIdentity: dead, spawnAttemptAt: new Date().toISOString() });
    const running = { schemaVersion: 1, moduleId: 'fast', runId: fastRun, status: 'running', childIdentity: dead };
    atomicJson(files(context.directory, 'fast').snapshot, running);
    const originalRead = fs.readFileSync;
    let finishedDuringLiveness = false;
    fs.readFileSync = function(target, ...args) {
      if (target === '/proc/2147483647/stat' && !finishedDuringLiveness) {
        finishedDuringLiveness = true;
        atomicJson(files(context.directory, 'fast').snapshot, { ...running, status: 'completed', finalSafe: true, exitCode: 0 });
      }
      return originalRead(target, ...args);
    };
    try {
      const observed = inspectState(context.directory).jobs.fast;
      assert.strictEqual(observed.status, 'completed', 'status cannot overwrite a terminal result written during liveness inspection');
      assert.strictEqual(observed.exitCode, 0);
    } finally { fs.readFileSync = originalRead; }
  }
  const controls = namespace(cwd, randomUUID());
  try {
    fs.symlinkSync(path.join(cwd, 'outside'), path.join(controls.directory, 'unexpected.tmp'));
    const unsafeTemp = inspectState(controls.directory);
    assert.strictEqual(unsafeTemp.blocked, true);
    assert(unsafeTemp.stateDiagnostics['*']?.length, 'unclassified temporary links must be diagnosed globally');
    fs.unlinkSync(path.join(controls.directory, 'unexpected.tmp'));
    const controlId = randomUUID();
    fs.symlinkSync(path.join(cwd, 'outside'), path.join(controls.directory, `batch.${controlId}.request.json`));
    assert.strictEqual(inspectState(controls.directory).blocked, true, 'batch control files must authenticate paths even without modules');
  } finally { removePath(controls.directory, { recursive: true, force: true }); }
  console.log('module state, incompatible-state blocking, independent enumeration and run ownership: OK');
} finally {
  removePath(context.directory, { recursive: true, force: true });
  removePath(cwd, { recursive: true, force: true });
}
