import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { Progress } from './progress.mjs';
import { readJson, atomicJson, files, releaseLock, timestamp, ownedClaim, updateClaim, updateSnapshot, validRecord, jobFile, securePath } from './state.mjs';
import { processIdentity, sameProcess, groupState, canKillOwnedOrphan, killOwnedOrphan, WINDOWS_LIVENESS_MS } from './process-identity.mjs';
import { removePath, mergeEnvironment, readUpTo } from './runtime.mjs';
import { windowsSpawnSpec } from './windows-process.mjs';
import { windowsProof, windowsCompletion } from './windows-proof.mjs';
import { readBatch, requestCompensation, publishFinalSafe, pause } from './module-batch.mjs';
import { SCHEMA_VERSION } from './schema.mjs';
import { createLineDecoder, windowsAnsiEncoding } from './output-decoder.mjs';
import { colorEnvironment } from './color.mjs';

// Platforms where the coordinator runs every worker of its batch in its own process.
// Each worker process costs a whole Node runtime; on Windows that is ~50 MB per module.
// The broker ends its tree when the worker's process ends, so a lost coordinator
// still leaves no command running. TEST_PROGRESS_WORKERS=process|inprocess overrides.
export function inProcessWorkers(environment = process.env, platform = process.platform) {
  const mode = environment.TEST_PROGRESS_WORKERS;
  if (mode === 'process' || mode === 'inprocess') return mode === 'inprocess';
  return platform === 'win32';
}

// Runs one module's worker until its final state is written. Standalone, it is the whole
// process; in process, `hostAlive` answers whether the coordinator still supervises it and
// the promise settles when this worker is done, as its process exit would.
export function runWorker(jobPath, { inProcess = false, coordinatorPipe = false, hostAlive = () => true } = {}) {
  let settle;
  const done = new Promise((resolve) => { settle = resolve; });
  const failures = { handler: null };
  return { done: work(jobPath, { inProcess, coordinatorPipe, hostAlive }, settle, failures).then(() => done),
    fail: (error) => failures.handler?.(error) };
}

async function work(jobPath, { inProcess, coordinatorPipe, hostAlive }, settle, failures) {

// Windows: the coordinator holds our stdin pipe; its close means the coordinator ended.
let coordinatorGone = false;
if (coordinatorPipe) {
  process.stdin.on('error', () => { coordinatorGone = true; });
  process.stdin.on('close', () => { coordinatorGone = true; });
  process.stdin.on('end', () => { coordinatorGone = true; });
  process.stdin.on('data', () => { /* The coordinator never writes; discard. */ });
  process.stdin.unref?.();
}
const job = readJson(jobPath);
if (!job || !validRecord(job, job.moduleId) || jobPath !== jobFile(job.directory, job.moduleId, job.runId)) throw new Error('Arquivo de execução inválido');
securePath(job.directory, true);
const claim = ownedClaim(job.directory, job.moduleId, job.runId);
if (claim.batchId !== job.batchId) throw new Error('Lote do claim divergente');
const locations = files(job.directory, job.moduleId);
let snapshot = readJson(locations.snapshot);
if (!validRecord(snapshot, job.moduleId, job.runId) || snapshot.logPath !== path.join(job.directory, `${job.moduleId}.${job.runId}.log`) || readJson(locations.claim)?.runId !== job.runId) {
  throw new Error('A execução não possui mais o bloqueio do módulo');
}
const workerIdentity = processIdentity(process.pid);
if (!workerIdentity) throw new Error('Identidade do worker não confirmada');
updateClaim(job.directory, job.moduleId, job.runId, { workerPid: process.pid, workerIdentity });
const progress = new Progress(job.adapter);
const windows = process.platform === 'win32';
const windowsProofPath = `${jobPath}.windows.json`;
let child;
let ended = false;
let cancelling = false;
let fatalError = null;
let acknowledged = false;
let compensationSent = false;
function compensate(reason) {
  if (compensationSent) return;
  compensationSent = true;
  try { requestCompensation(job, reason); } catch (error) { fatalError = fatalError ?? error.message; }
}
let killTimer;
let poll;
let lastPersistedAt = 0;
let progressPending = false;
const heartbeatIntervalMs = 5000;
// Fast suites report many results per second; coalesce them into a few snapshot writes.
// On Windows the antivirus scans every snapshot write's temporary file and every control
// read, and the panel reads once a second: a snapshot is written at most that often, and
// the control loop runs less often too.
const progressIntervalMs = windows ? 1000 : 250;
const pollIntervalMs = windows ? 500 : 150;
const logLimit = 1024 * 1024;
let logBytes = 0;
const buffers = { stdout: '', stderr: '' };
// Non-UTF-8 lines fall back to the ANSI code page on Windows only.
const fallbackEncoding = windows ? windowsAnsiEncoding : null;
const decoders = { stdout: createLineDecoder(fallbackEncoding), stderr: createLineDecoder(fallbackEncoding) };
const now = timestamp();
snapshot = { ...snapshot, workerPid: process.pid, workerIdentity, updatedAt: now };
fs.writeFileSync(snapshot.logPath, '', { mode: 0o600, flag: 'wx' });

// updateSnapshot authenticates the claim and the current snapshot under the mutation gate.
function persist(overrides = {}) {
  const now = timestamp();
  snapshot = { ...snapshot, ...progress.values(), ...overrides, updatedAt: now, heartbeatAt: now };
  if (cancelling && !ended) snapshot.phase = 'cancellation-requested';
  updateSnapshot(job.directory, job.moduleId, job.runId, () => snapshot);
  lastPersistedAt = Date.now();
  progressPending = false;
}
// The log stays open from its first output until the final state. On Windows the antivirus
// scans a written file again on every close, and suites print a line per test, so an open
// and a close per chunk cost the antivirus more CPU than the whole collector.
let logFd = null;
let logClosed = false;
function writeLog(bytes, position) {
  for (let offset = 0; offset < bytes.length;) offset += fs.writeSync(logFd, bytes, offset, bytes.length - offset, position + offset);
}
function log(text) {
  if (logClosed) return;
  if (logFd === null) logFd = fs.openSync(snapshot.logPath, 'r+');
  const bytes = Buffer.from(text);
  writeLog(bytes, logBytes);
  logBytes += bytes.length;
  if (logBytes > logLimit) {
    const tail = readUpTo(logFd, logLimit / 2, logLimit / 2, logBytes - logLimit / 2);
    writeLog(tail, 0);
    fs.ftruncateSync(logFd, tail.length);
    logBytes = tail.length;
  }
}
function closeLog() {
  logClosed = true;
  if (logFd === null) return;
  const fd = logFd;
  logFd = null;
  fs.closeSync(fd);
}
function consume(stream, chunk) {
  snapshot.lastOutputAt = timestamp();
  // An unfinished line waits for its end, so it is decoded as a whole.
  const text = decoders[stream].push(chunk);
  if (!text) return;
  log(text);
  buffers[stream] += text;
  // Treat carriage-return progress redraws as records, too.
  const lines = buffers[stream].split(/\r?\n|\r/);
  buffers[stream] = lines.pop();
  if (buffers[stream].length > 131072) buffers[stream] = '';
  let changed = false;
  for (const line of lines) changed = progress.line(line) || changed;
  if (changed) {
    snapshot.lastProgressAt = timestamp();
    if (Date.now() - lastPersistedAt >= progressIntervalMs) persist();
    else progressPending = true;
  }
}
function terminate(signal) {
  if (!child?.pid) return;
  try {
    if (windows) {
      // The broker observes the bound request and terminates its entire Job.
      try { atomicJson(locations.cancel, { schemaVersion: SCHEMA_VERSION, moduleId: job.moduleId, runId: job.runId, requestedAt: timestamp() }); }
      catch (error) { fatalError = fatalError ?? error.message; }
      try { refreshWindowsProof(); }
      catch (error) { fatalError = fatalError ?? error.message; }
      if (signal === 'SIGKILL' && canKillOwnedOrphan(snapshot.childIdentity)) {
        // Closing the broker's last Job handle also terminates all descendants.
        killOwnedOrphan(snapshot.childIdentity);
      }
    }
    else process.kill(-child.pid, signal);
  } catch (error) {
    // Termination must never depend on a writable log or snapshot.
    if (error.code !== 'ESRCH') fatalError = fatalError ?? `Não foi possível enviar ${signal}: ${error.message}`;
  }
}
function refreshWindowsProof() {
  if (!windows) return null;
  const proof = windowsProof(jobPath, job.runId, child?.pid ?? null);
  if (!proof) return null;
  const identity = proof.brokerIdentity;
  if (proof.contained === true && identity?.managedBroker === true && identity?.contained === true &&
      identity.pid === child?.pid && snapshot.childIdentity?.managedBroker !== true) {
    snapshot = { ...snapshot, childIdentity: identity };
    updateClaim(job.directory, job.moduleId, job.runId, { childIdentity: identity });
    persist({ childIdentity: identity });
  }
  if (proof.resumed === true && !acknowledged) {
    acknowledged = true;
    updateClaim(job.directory, job.moduleId, job.runId, { spawnAcknowledgedAt: timestamp() });
  }
  return proof;
}
function cancel(reason = 'cancellation-requested') {
  if (ended || cancelling) return;
  cancelling = true;
  terminate('SIGTERM');
  killTimer = setTimeout(() => terminate('SIGKILL'), 2500);
  try { persist({ phase: reason, cancellationRequestedAt: timestamp() }); }
  catch (error) { fatalError = fatalError ?? error.message; }
}
let coordinatorSeenAt = -Infinity;
let coordinatorAuthenticated = false;
// The pipe answers only after one authenticated check that the recorded coordinator is alive.
function coordinatorAlive(identity) {
  if (inProcess) return hostAlive();
  if (coordinatorPipe && coordinatorAuthenticated) return !coordinatorGone;
  const alive = sameProcess(identity);
  if (alive && coordinatorPipe && !coordinatorGone) coordinatorAuthenticated = true;
  return alive && !coordinatorGone;
}
// In process or behind an authenticated pipe, the answer needs no manifest read.
function coordinatorLost() {
  if (inProcess) return !hostAlive();
  if (coordinatorPipe && coordinatorAuthenticated) return coordinatorGone;
  return !coordinatorAlive(readBatch(job.directory, job.batchId).coordinatorIdentity);
}
function checkCancellation(force = false) {
  if (child?.pid && !ended && (force || !windows || inProcess || coordinatorPipe || Date.now() - coordinatorSeenAt >= WINDOWS_LIVENESS_MS)) {
    if (!coordinatorLost()) coordinatorSeenAt = Date.now();
    else {
      fatalError = fatalError ?? 'Coordenador perdido durante execução';
      compensate(fatalError);
      cancel('supervision-lost');
    }
  }
  // Once the contained broker resumed the command, only the final proof matters.
  if (force || !acknowledged || snapshot.childIdentity?.managedBroker !== true) refreshWindowsProof();
  if (validRecord(readJson(locations.cancel), job.moduleId, job.runId)) cancel();
}
async function finish(code, signal) {
  if (ended) return;
  try { await settleFinish(code, signal); }
  finally {
    try { closeLog(); } catch { /* The final state never depends on the log. */ }
    settle();
  }
}
async function settleFinish(code, signal) {
  try { checkCancellation(true); }
  catch (error) { fatalError = fatalError ?? error.message; cancelling = true; }
  ended = true;
  clearInterval(poll);
  if (cancelling) terminate('SIGKILL');
  clearTimeout(killTimer);
  try {
    for (const stream of Object.keys(buffers)) {
      const rest = decoders[stream].flush();
      if (rest) {
        try { log(rest); } catch { /* The final state must not depend on a writable log. */ }
        buffers[stream] += rest;
      }
      if (buffers[stream] && progress.line(buffers[stream])) snapshot.lastProgressAt = timestamp();
    }
    const proof = refreshWindowsProof();
    if (proof?.cancelled) cancelling = true;
    if (windows) {
      const completion = windowsCompletion(proof, cancelling);
      if (completion.infrastructureFailure) fatalError = fatalError ?? completion.error;
    }
    if (fatalError) compensate(fatalError);
    if (Number.isInteger(proof?.exitCode)) code = proof.exitCode;
    const identity = snapshot.childIdentity;
    const deadline = Date.now() + 1500;
    let group = windows && proof?.treeEmpty === true ? 'empty' : child?.pid ? groupState(identity) : 'empty';
    while (cancelling && group === 'present' && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      group = groupState(identity);
    }
    if (group !== 'empty') {
      compensate('Árvore do comando não vazia ao finalizar');
      // A closed leader does not prove its descendants have exited. Unknown also keeps the gate.
      persist({ ...progress.values(true, false), status: 'error', phase: 'orphaned-command',
        recoveryRequired: true, cancellable: canKillOwnedOrphan(identity), endedAt: null,
        exitCode: Number.isInteger(code) ? code : null, exitSignal: signal ?? null,
        error: 'A saída do processo foi observada, mas o grupo ainda está ativo ou desconhecido. O módulo permanece bloqueada para recuperação segura.' });
      return;
    }
    const values = progress.values(true, !cancelling && !fatalError && code === 0);
    // Under `exit` a clean exit is the result even when no test was counted.
    const settled = values.progressObserved || job.adapter === 'exit';
    const status = fatalError ? 'error' : cancelling ? 'cancelled' :
      code !== 0 || values.failed > 0 ? 'failed' : settled ? 'completed' : 'error';
    const error = fatalError ?? (status === 'error' ?
      'O comando terminou sem eventos de progresso reconhecidos; nenhum teste foi confirmado.' : null);
    persist({ ...values, status, finalSafe: true, recoveryRequired: false, infrastructureFailure: Boolean(fatalError), phase: cancelling ? 'cancelled' :
      settled ? 'finished' : 'no-progress-observed', endedAt: timestamp(),
      exitCode: Number.isInteger(code) ? code : null, exitSignal: signal ?? null,
      ...(error ? { error } : {}) });
    publishFinalSafe(job, snapshot);
    releaseLock(job.directory, job.moduleId, job.runId);
    if (readJson(locations.cancel)?.runId === job.runId) removePath(locations.cancel, { force: true });
    // The job may contain an explicit environment override; keep no finished copy.
    removePath(jobPath, { force: true });
    if (windows) removePath(windowsProofPath, { force: true });
  } catch (error) {
    // A failed final write keeps the lock. A later status call can recover only a proven empty group.
    fatalError = fatalError ?? error.message;
    compensate(fatalError);
  }
}

// Any failure after setup ends this worker's own run, as an uncaught error ends its process.
function fail(error) {
  fatalError = String(error?.message ?? error);
  compensate(fatalError);
  if (child?.pid && !ended) cancel('worker-error');
  else finish(null, null).catch(() => { /* The final state keeps its lock. */ });
}
failures.handler = fail;
// Callbacks of a worker in a shared process report to this worker, never to its siblings.
const guard = (callback) => (...values) => {
  try { return callback(...values); } catch (error) { fail(error); }
};
if (!inProcess) {
  process.on('SIGTERM', () => cancel());
  process.on('SIGINT', () => cancel());
  process.on('uncaughtException', fail);
  process.on('unhandledRejection', fail);
}

// Ready means all worker-local preparation succeeded, with no user command spawned.
const hooks = job.testHooks || {};
if (hooks.readyFailure) throw new Error('Falha injetada na preparação do worker');
if (hooks.readyDelayMs) await pause(hooks.readyDelayMs);
if (hooks.readyGateFile) {
  // A test can hold preparation until it has injected its ownership race.
  // The real batch deadline and abort still bound the wait.
  for (;;) {
    const manifest = readBatch(job.directory, job.batchId);
    if (manifest.state === 'aborted' || Date.now() >= Date.parse(manifest.deadlineAt) ||
        fs.existsSync(hooks.readyGateFile)) break;
    await pause();
  }
}
updateClaim(job.directory, job.moduleId, job.runId, { readyAt: timestamp() });
persist({ phase: 'ready' });
for (;;) {
  const manifest = readBatch(job.directory, job.batchId);
  ownedClaim(job.directory, job.moduleId, job.runId);
  if (!validRecord(readJson(locations.snapshot), job.moduleId, job.runId)) throw new Error('Snapshot substituído antes da execução');
  if (!manifest.entries.some((entry) => entry.moduleId === job.moduleId && entry.runId === job.runId)) throw new Error('Worker fora do lote');
  if (manifest.state === 'aborted' || validRecord(readJson(locations.cancel), job.moduleId, job.runId)) {
    cancelling = true;
    await finish(null, null);
    return;
  }
  if (!coordinatorAlive(manifest.coordinatorIdentity)) throw new Error('Coordenador perdido antes da execução');
  if (Date.now() >= Date.parse(manifest.deadlineAt) && manifest.state === 'preparing') throw new Error('Prazo de preparação expirado');
  if (manifest.state === 'released') break;
  await pause();
}
if (hooks.dieAfterRelease) process.exit(92);
checkCancellation();
if (cancelling) {
  await finish(null, null);
} else {
  try {
    // Durable attempt distinguishes a known no-spawn preparation from an unknown orphan.
    if (!validRecord(readJson(locations.snapshot), job.moduleId, job.runId)) throw new Error('Snapshot substituído antes do spawn');
    updateClaim(job.directory, job.moduleId, job.runId, { spawnAttemptAt: timestamp() });

    const environment = colorEnvironment(mergeEnvironment(process.env, job.env), job.command, job.adapter);
    const launch = windows ? windowsSpawnSpec(jobPath, environment) :
      { file: job.command[0], args: job.command.slice(1), options: {} };
    child = spawn(launch.file, launch.args, {
      ...launch.options, cwd: job.cwd, env: environment, shell: false,
      detached: !windows, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    });
    // Install lifecycle handlers before any fallible filesystem write after spawn.
    child.on('close', (code, signal) => { finish(code, signal).catch(fail); });
    child.on('error', (error) => {
      fatalError = `Não foi possível iniciar ${job.command[0]}: ${error.code ?? error.message}`;
      compensate(fatalError);
      try { log(`\nRunner: ${fatalError}\n`); } catch { /* Keep close handling independent of logs. */ }
    });
    child.stdout.on('data', guard((chunk) => consume('stdout', chunk)));
    child.stderr.on('data', guard((chunk) => consume('stderr', chunk)));
    // Persist identity immediately after spawn, before accepting stream events.
    // A crash before this write leaves an unknown orphan and deliberately keeps the lock.
    const childIdentity = processIdentity(child.pid);
    if (child.pid) {
      // Retain identity in memory even if the first disk write fails.
      snapshot = { ...snapshot, pid: child.pid, childIdentity };
      updateClaim(job.directory, job.moduleId, job.runId, { childIdentity });
      persist({ status: 'running', pid: child.pid, childIdentity });
      if (!windows && childIdentity && !hooks.ackDelayMs) {
        acknowledged = true;
        updateClaim(job.directory, job.moduleId, job.runId, { spawnAcknowledgedAt: timestamp() });
      }
      if (hooks.ackDelayMs) setTimeout(guard(() => {
        if (!ended) { acknowledged = true; updateClaim(job.directory, job.moduleId, job.runId, { spawnAcknowledgedAt: timestamp() }); }
      }), hooks.ackDelayMs);
      if (hooks.dieAfterAck) process.exit(93);
      if (hooks.failAfterAckMs) setTimeout(guard(() => { throw new Error('Falha injetada após ack'); }), hooks.failAfterAckMs);
    }
    poll = setInterval(guard(() => {
      checkCancellation();
      // Silence is not failure: record worker activity without inventing test progress.
      const age = Date.now() - lastPersistedAt;
      if (!ended && ((progressPending && age >= progressIntervalMs) || age >= heartbeatIntervalMs)) persist();
    }), pollIntervalMs);
    persist();
  } catch (error) {
    fatalError = error.message;
    compensate(fatalError);
    if (child?.pid) cancel('worker-error');
    else await finish(null, null);
  }
}

}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runWorker(process.argv[2], { coordinatorPipe: process.platform === 'win32' && process.argv[3] === '--coordinator-pipe' }).done.catch((error) => {
    process.stderr.write(`worker: ${error.message}\n`);
    process.exitCode = 1;
  });
}
