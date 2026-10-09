import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { atomicJson, files, inspectState, pruneHistory } from '../../runner/state.mjs';
import { randomUUID, removePath } from '../../runner/runtime.mjs';

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'state-history-')));
const nativeLstat = fs.lstatSync;
const at = '2026-10-09T12:00:00.000Z';
function namespace(name) {
  const directory = path.join(root, name);
  fs.mkdirSync(directory, { mode: 0o700 });
  return directory;
}
function batch(directory, entries, extra = {}) {
  const batchId = randomUUID();
  atomicJson(path.join(directory, `batch.${batchId}.json`), { schemaVersion: 1, batchId, state: 'released', entries,
    createdAt: at, deadlineAt: at, releasedAt: at, supervisionEndedAt: at, ...extra });
  return batchId;
}
function run(directory, moduleId, extra = {}) {
  const runId = randomUUID();
  fs.writeFileSync(path.join(directory, `${moduleId}.${runId}.log`), 'output\n', { mode: 0o600 });
  return { moduleId, runId, batchId: batch(directory, [{ moduleId, runId }], extra) };
}
function snapshot(directory, { moduleId, runId, batchId }, extra = {}) {
  atomicJson(files(directory, moduleId).snapshot, { schemaVersion: 1, moduleId, runId, batchId, status: 'completed', phase: 'finished',
    finalSafe: true, recoveryRequired: false, startedAt: at, endedAt: at, updatedAt: at, logPath: path.join(directory, `${moduleId}.${runId}.log`), ...extra });
}
const listing = (directory) => fs.readdirSync(directory).filter(name => !name.endsWith('.json') || name.startsWith('batch.')).sort();
const names = (...runs) => runs.flatMap(({ moduleId, runId, batchId }) => [`${moduleId}.${runId}.log`, `batch.${batchId}.json`]).sort();
try {
  // Earlier runs of a module go; its current run, and a run a lock still holds, stay.
  const history = namespace('history');
  const old = [run(history, 'api'), run(history, 'api')];
  const latest = run(history, 'api');
  snapshot(history, latest);
  const finished = run(history, 'web');
  const live = run(history, 'web', { state: 'preparing', supervisionEndedAt: undefined });
  snapshot(history, live, { status: 'running', phase: 'running', finalSafe: false, endedAt: null });
  fs.mkdirSync(files(history, 'web').lock, { mode: 0o700 });
  atomicJson(files(history, 'web').claim, { schemaVersion: 1, moduleId: 'web', runId: live.runId, batchId: live.batchId, createdAt: at });
  const removed = run(history, 'gone');
  pruneHistory(history);
  assert.deepStrictEqual(listing(history), [...names(latest, live), 'web.lock'].sort(),
    'Only the logs and batches a snapshot or claim names remain');
  assert([...old, finished, removed].every(({ moduleId, runId }) => !fs.existsSync(path.join(history, `${moduleId}.${runId}.log`))));
  const state = inspectState(history, { recover: false });
  assert.strictEqual(state.blocked, false);
  assert.deepStrictEqual(Object.keys(state.stateDiagnostics), []);
  assert.strictEqual(state.jobs.api.runId, latest.runId);
  assert.strictEqual(state.jobs.web.status, 'running');

  // An unfinished or contested batch is evidence: it stays, with its log while a record names it.
  const evidence = namespace('evidence');
  const current = run(evidence, 'api');
  snapshot(evidence, current);
  const kept = [
    batch(evidence, [{ moduleId: 'api', runId: randomUUID() }], { supervisionError: 'Observação do aborto terminou sem confirmar todas as árvores; locks conservados.' }),
    batch(evidence, [{ moduleId: 'api', runId: randomUUID() }], { supervisionEndedAt: undefined }),
    batch(evidence, [{ moduleId: 'api', runId: randomUUID() }], { state: 'preparing', supervisionEndedAt: undefined }),
  ];
  const requested = batch(evidence, [{ moduleId: 'api', runId: randomUUID() }], { state: 'aborted' });
  atomicJson(path.join(evidence, `batch.${requested}.request.json`), { schemaVersion: 1, batchId: requested, directory: evidence, revision: [] });
  // A start reserves the lock before it writes the new snapshot.
  snapshot(evidence, run(evidence, 'ui'));
  const reserved = run(evidence, 'ui');
  fs.mkdirSync(files(evidence, 'ui').lock, { mode: 0o700 });
  atomicJson(files(evidence, 'ui').claim, { schemaVersion: 1, moduleId: 'ui', runId: reserved.runId, batchId: reserved.batchId, createdAt: at });
  const gated = batch(evidence, [{ moduleId: 'api', runId: randomUUID() }]);
  fs.mkdirSync(path.join(evidence, `batch.${gated}.mutation`), { mode: 0o700 });
  const outside = path.join(root, 'outside.log');
  fs.writeFileSync(outside, 'not state\n');
  const link = `api.${randomUUID()}.log`;
  // Windows creates file links only with developer mode or elevation.
  try { fs.symlinkSync(outside, path.join(evidence, link)); }
  catch (error) { if (process.platform !== 'win32' || error.code !== 'EPERM') throw error; }
  const before = fs.readdirSync(evidence).sort();
  pruneHistory(evidence);
  assert.deepStrictEqual(fs.readdirSync(evidence).sort(), before, 'Unfinished, contested, controlled and unsafe entries stay');
  assert(kept.every(id => fs.existsSync(path.join(evidence, `batch.${id}.json`))) && fs.existsSync(outside));

  // An unreadable record leaves the whole history in place.
  const unreadable = namespace('unreadable');
  const stale = run(unreadable, 'api');
  snapshot(unreadable, run(unreadable, 'api'));
  fs.writeFileSync(files(unreadable, 'web').snapshot, '{', { mode: 0o600 });
  assert.throws(() => pruneHistory(unreadable), /JSON de estado inválido/);
  assert(fs.existsSync(path.join(unreadable, `api.${stale.runId}.log`)) && fs.existsSync(path.join(unreadable, `batch.${stale.batchId}.json`)));

  // Inspection lists the namespace, then reads each manifest: a prune between the two is not corruption.
  const race = namespace('race');
  const running = run(race, 'api');
  snapshot(race, running);
  const pruned = batch(race, [{ moduleId: 'api', runId: randomUUID() }]);
  const ended = batch(race, [{ moduleId: 'api', runId: randomUUID() }]);
  const request = path.join(race, `batch.${ended}.request.json`);
  atomicJson(request, { schemaVersion: 1, batchId: ended, directory: race, revision: [] });
  const vanish = new Map([[path.join(race, `batch.${pruned}.json`), [path.join(race, `batch.${pruned}.json`)]],
    [request, [request, path.join(race, `batch.${ended}.json`)]]]);
  fs.lstatSync = function(file, ...rest) {
    const info = nativeLstat.call(this, file, ...rest);
    const targets = vanish.get(file);
    if (targets) { vanish.delete(file); for (const target of targets) fs.unlinkSync(target); }
    return info;
  };
  let raced;
  try { raced = inspectState(race, { recover: false }); }
  finally { fs.lstatSync = nativeLstat; }
  assert.strictEqual(vanish.size, 0, 'Both removals happened during the inspection');
  assert.strictEqual(raced.blocked, false, JSON.stringify(raced.stateDiagnostics));
  assert.deepStrictEqual(Object.keys(raced.stateDiagnostics), []);
  console.log('State history: earlier logs and finished batches pruned, current/live/contested/unsafe entries kept, unreadable records stop the prune, inspection tolerates a concurrent prune: OK');
} finally {
  fs.lstatSync = nativeLstat;
  removePath(root, { recursive: true, force: true });
}
