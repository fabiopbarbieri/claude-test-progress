import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { performance } from 'perf_hooks';
import { atomicJson, files, inspectState } from '../../runner/state.mjs';
import { randomUUID, removePath } from '../../runner/runtime.mjs';

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'state-inspection-')));
const nativeWait = Atomics.wait;
const originalDateNow = Date.now;
function fixture(name) {
  const directory = path.join(root, name);
  fs.mkdirSync(directory, { mode: 0o700 });
  const loc = files(directory, 'api');
  const runId = randomUUID();
  const snapshot = { schemaVersion: 1, moduleId: 'api', runId, status: 'failed', phase: 'finished',
    finalSafe: true, recoveryRequired: false, infrastructureFailure: false, exitCode: 1,
    total: 2, resolved: 2, passed: 1, failed: 1, skipped: 0, totalStable: true,
    startedAt: '2026-10-05T12:00:00.000Z', endedAt: '2026-10-05T12:00:01.000Z',
    updatedAt: '2026-10-05T12:00:01.000Z', logPath: path.join(directory, `api.${runId}.log`) };
  atomicJson(loc.snapshot, snapshot);
  return { directory, loc, snapshot, gate: path.join(directory, 'api.mutation'),
    bytes: fs.readFileSync(loc.snapshot, 'utf8') };
}
function terminalPreserved(state, test) {
  assert(state.jobs.api, 'An authenticated final result must remain visible during claim teardown');
  for (const [key, value] of Object.entries(test.snapshot)) {
    assert.deepStrictEqual(state.jobs.api[key], value, `Inspection must preserve terminal ${key}`);
  }
  assert.strictEqual(fs.readFileSync(test.loc.snapshot, 'utf8'), test.bytes, 'Read-only inspection must not rewrite the snapshot');
}
function healthy(state, test) {
  terminalPreserved(state, test);
  assert.strictEqual(state.blocked, false, 'A completed teardown must not block the namespace');
  assert.deepStrictEqual(Object.keys(state.stateDiagnostics), [], 'Discarded observations must not leave diagnostics');
}
try {
  const resumed = fixture('writer-resumed');
  fs.mkdirSync(resumed.loc.lock, { mode: 0o700 });
  fs.mkdirSync(resumed.gate, { mode: 0o700 });
  let writerResumed = false;
  Atomics.wait = function(...args) {
    if (!writerResumed) {
      writerResumed = true;
      // releaseLock already unlinked claim.json. Resume its remaining teardown
      // exactly when inspection yields, without a timing-dependent child.
      fs.rmdirSync(resumed.loc.lock);
      fs.rmdirSync(resumed.gate);
    }
    return nativeWait(...args);
  };
  try {
    const state = inspectState(resumed.directory, { recover: false });
    assert(writerResumed, 'Inspection must yield so the gated writer can finish its teardown');
    healthy(state, resumed);
  } finally { Atomics.wait = nativeWait; }

  const held = fixture('writer-still-holds-gate');
  fs.mkdirSync(held.loc.lock, { mode: 0o700 });
  fs.mkdirSync(held.gate, { mode: 0o700 });
  const waits = [];
  Atomics.wait = function(...args) { waits.push(args[3]); return nativeWait(...args); };
  // Wall-clock adjustments must not make the bounded observation wait forever.
  Date.now = () => 1;
  const started = performance.now();
  let busy;
  try { busy = inspectState(held.directory, { recover: false }); }
  finally { Atomics.wait = nativeWait; Date.now = originalDateNow; }
  const elapsed = performance.now() - started;
  terminalPreserved(busy, held);
  assert.strictEqual(busy.blocked, false, 'An authenticated busy gate is local, not incompatible global state');
  assert(waits.length > 0 && waits.every(delay => delay > 0 && delay <= 10), 'Observation must yield with bounded backoff');
  assert(elapsed >= 75 && elapsed < 1000, `The monotonic 100 ms observation must stay bounded (${Math.round(elapsed)} ms)`);
  assert(busy.stateDiagnostics.api?.some(item => item.code === 'state-busy' && item.blocking === true));
  assert(!busy.stateDiagnostics['*'], 'The busy module must not create a global diagnostic');
  assert(!JSON.stringify(busy.stateDiagnostics).includes('incompatível'), 'An in-progress teardown is not an incompatible claim');
  assert(fs.existsSync(held.loc.lock) && fs.existsSync(held.gate), 'Inspection must leave writer-owned gates untouched');
  fs.rmdirSync(held.loc.lock);
  fs.rmdirSync(held.gate);
  healthy(inspectState(held.directory, { recover: false }), held);

  // Heartbeats hold the gate briefly while lock and claim stay consistent.
  // A running job must remain visible without waiting for that writer.
  const heartbeat = fixture('heartbeat-gate');
  const running = { ...heartbeat.snapshot, status: 'running', phase: 'running', finalSafe: false, endedAt: null, exitCode: null };
  atomicJson(heartbeat.loc.snapshot, running);
  fs.mkdirSync(heartbeat.loc.lock, { mode: 0o700 });
  atomicJson(heartbeat.loc.claim, { schemaVersion: 1, moduleId: 'api', runId: running.runId, createdAt: running.startedAt });
  fs.mkdirSync(heartbeat.gate, { mode: 0o700 });
  let heartbeatWaited = false;
  Atomics.wait = function(...args) { heartbeatWaited = true; return nativeWait(...args); };
  let heartbeatState;
  try { heartbeatState = inspectState(heartbeat.directory, { recover: false }); }
  finally { Atomics.wait = nativeWait; }
  assert.strictEqual(heartbeatWaited, false, 'A consistent gated observation must not wait for the writer');
  assert.strictEqual(heartbeatState.jobs.api?.status, 'running', 'A running job must stay visible while its heartbeat holds the gate');
  assert.strictEqual(heartbeatState.blocked, false);
  assert(!JSON.stringify(heartbeatState.stateDiagnostics).includes('incompatível'));

  const foreign = fixture('stable-foreign-claim');
  fs.mkdirSync(foreign.loc.lock, { mode: 0o700 });
  atomicJson(foreign.loc.claim, { version: 'other', module: 'api', runId: 'foreign' });
  const foreignState = inspectState(foreign.directory, { recover: false });
  assert.strictEqual(foreignState.blocked, true, 'A stable incompatible claim still blocks the namespace');
  assert.strictEqual(foreignState.jobs.api, undefined, 'An incompatible claim must not authenticate the terminal result');
  assert(foreignState.stateDiagnostics.api?.some(item => /incompatível|desconhecido/.test(item.message)));
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(foreign.loc.claim, 'utf8')), { version: 'other', module: 'api', runId: 'foreign' });

  const unsafe = fixture('unsafe-gate');
  fs.mkdirSync(unsafe.loc.lock, { mode: 0o700 });
  const outside = path.join(root, 'outside-gate');
  fs.mkdirSync(outside, { mode: 0o700 });
  fs.symlinkSync(outside, unsafe.gate, process.platform === 'win32' ? 'junction' : 'dir');
  let unsafeWaited = false;
  Atomics.wait = function(...args) { unsafeWaited = true; return nativeWait(...args); };
  let unsafeState;
  try { unsafeState = inspectState(unsafe.directory, { recover: false }); }
  finally { Atomics.wait = nativeWait; }
  assert.strictEqual(unsafeWaited, false, 'An unauthenticated gate must be rejected rather than retried');
  assert.strictEqual(unsafeState.blocked, true);
  assert.strictEqual(unsafeState.jobs.api, undefined);
  assert(JSON.stringify(unsafeState.stateDiagnostics).match(/inseguro|Link/));
  assert(fs.lstatSync(unsafe.gate).isSymbolicLink() && fs.existsSync(unsafe.loc.lock), 'Inspection must not recover or remove unsafe state');
  console.log('Read-only state inspection yields for authenticated teardown, preserves busy terminal results and rejects incompatible/unsafe gates: OK');
} finally {
  Atomics.wait = nativeWait;
  Date.now = originalDateNow;
  removePath(root, { recursive: true, force: true });
}
