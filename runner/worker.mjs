import fs from 'fs';
import { spawn } from 'child_process';
import { Progress } from './progress.mjs';
import { readJson, atomicJson, files, releaseLock, timestamp } from './state.mjs';
import { processIdentity, groupState, canKillOwnedOrphan, killOwnedOrphan } from './process-identity.mjs';
import { removePath, mergeEnvironment } from './runtime.mjs';
import { windowsSpawnSpec } from './windows-process.mjs';
import { windowsProof } from './windows-proof.mjs';

const jobPath = process.argv[2];
const job = readJson(jobPath);
if (!job) throw new Error('Arquivo de execução ausente');
const locations = files(job.directory, job.lane);
let snapshot = readJson(locations.snapshot);
if (snapshot?.runId !== job.runId || readJson(locations.claim)?.runId !== job.runId) {
  throw new Error('A execução não possui mais o bloqueio da lane');
}
atomicJson(locations.claim, { ...readJson(locations.claim), workerPid: process.pid,
  workerIdentity: processIdentity(process.pid) });
const progress = new Progress(job.adapter);
const windows = process.platform === 'win32';
const windowsProofPath = `${jobPath}.windows.json`;
let child;
let ended = false;
let cancelling = false;
let fatalError = null;
let killTimer;
let poll;
let lastPersistedAt = 0;
const heartbeatIntervalMs = 5000;
const logLimit = 1024 * 1024;
let logBytes = 0;
const buffers = { stdout: '', stderr: '' };
const now = timestamp();
snapshot = { ...snapshot, workerPid: process.pid, updatedAt: now };
fs.writeFileSync(snapshot.logPath, '', { mode: 0o600, flag: 'wx' });

function persist(overrides = {}) {
  const now = timestamp();
  snapshot = { ...snapshot, ...progress.values(), ...overrides, updatedAt: now, heartbeatAt: now };
  if (cancelling && !ended) snapshot.phase = 'cancellation-requested';
  atomicJson(locations.snapshot, snapshot);
  lastPersistedAt = Date.now();
}
function log(text) {
  fs.appendFileSync(snapshot.logPath, text, { mode: 0o600 });
  logBytes += Buffer.byteLength(text);
  if (logBytes > logLimit) {
    const contents = fs.readFileSync(snapshot.logPath);
    const tail = contents.subarray(Math.max(0, contents.length - logLimit / 2));
    fs.writeFileSync(snapshot.logPath, tail, { mode: 0o600 });
    logBytes = tail.length;
  }
}
function consume(stream, chunk) {
  const text = chunk.toString('utf8');
  log(text);
  snapshot.lastOutputAt = timestamp();
  buffers[stream] += text;
  // Treat carriage-return progress redraws as records, too.
  const lines = buffers[stream].split(/\r?\n|\r/);
  buffers[stream] = lines.pop();
  if (buffers[stream].length > 131072) buffers[stream] = '';
  let changed = false;
  for (const line of lines) changed = progress.line(line) || changed;
  if (changed) {
    snapshot.lastProgressAt = timestamp();
    persist();
  }
}
function terminate(signal) {
  if (!child?.pid) return;
  try {
    if (windows) {
      // The broker observes the bound request and terminates its entire Job.
      try { atomicJson(locations.cancel, { runId: job.runId, requestedAt: timestamp() }); }
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
    atomicJson(locations.claim, { ...readJson(locations.claim), childIdentity: identity });
    persist({ childIdentity: identity });
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
function checkCancellation() {
  refreshWindowsProof();
  if (readJson(locations.cancel)?.runId === job.runId) cancel();
}
async function finish(code, signal) {
  if (ended) return;
  try { checkCancellation(); }
  catch (error) { fatalError = fatalError ?? error.message; cancelling = true; }
  ended = true;
  clearInterval(poll);
  if (cancelling) terminate('SIGKILL');
  clearTimeout(killTimer);
  try {
    for (const stream of Object.keys(buffers)) {
      if (buffers[stream] && progress.line(buffers[stream])) snapshot.lastProgressAt = timestamp();
    }
    const proof = refreshWindowsProof();
    if (proof?.error) fatalError = fatalError ?? `Broker Windows: ${proof.error}`;
    if (proof?.cancelled) cancelling = true;
    if (Number.isInteger(proof?.exitCode)) code = proof.exitCode;
    const identity = snapshot.childIdentity;
    const deadline = Date.now() + 1500;
    let group = windows && proof?.treeEmpty === true ? 'empty' : child?.pid ? groupState(identity) : 'empty';
    while (cancelling && group === 'present' && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      group = groupState(identity);
    }
    if (group !== 'empty') {
      // A closed leader does not prove its descendants have exited. Unknown also keeps the gate.
      persist({ ...progress.values(true, false), status: 'error', phase: 'orphaned-command',
        recoveryRequired: true, cancellable: canKillOwnedOrphan(identity), endedAt: null,
        exitCode: Number.isInteger(code) ? code : null, exitSignal: signal ?? null,
        error: 'A saída do processo foi observada, mas o grupo ainda está ativo ou desconhecido. A lane permanece bloqueada para recuperação segura.' });
      return;
    }
    const values = progress.values(true, !cancelling && !fatalError && code === 0);
    const status = fatalError ? 'error' : cancelling ? 'cancelled' :
      code !== 0 || values.failed > 0 ? 'failed' : values.progressObserved ? 'completed' : 'error';
    const error = fatalError ?? (status === 'error' ?
      'O comando terminou sem eventos de progresso reconhecidos; nenhum teste foi confirmado.' : null);
    persist({ ...values, status, phase: cancelling ? 'cancelled' :
      values.progressObserved ? 'finished' : 'no-progress-observed', endedAt: timestamp(),
      exitCode: Number.isInteger(code) ? code : null, exitSignal: signal ?? null,
      ...(error ? { error } : {}) });
    releaseLock(job.directory, job.lane, job.runId);
    if (readJson(locations.cancel)?.runId === job.runId) removePath(locations.cancel, { force: true });
    // The job may contain an explicit environment override; keep no finished copy.
    removePath(jobPath, { force: true });
    if (windows) removePath(windowsProofPath, { force: true });
  } catch (error) {
    // A failed final write keeps the lock. A later status call can recover only a proven empty group.
    fatalError = fatalError ?? error.message;
  }
}

process.on('SIGTERM', () => cancel());
process.on('SIGINT', () => cancel());
process.on('uncaughtException', (error) => {
  fatalError = error.message;
  if (child?.pid && !ended) cancel('worker-error');
  else finish(null, null);
});
process.on('unhandledRejection', (error) => {
  fatalError = String(error?.message ?? error);
  if (child?.pid && !ended) cancel('worker-error');
  else finish(null, null);
});

checkCancellation();
if (cancelling) {
  finish(null, null);
} else {
  try {
    const environment = mergeEnvironment(process.env, job.env);
    const launch = windows ? windowsSpawnSpec(jobPath, environment) :
      { file: job.command[0], args: job.command.slice(1), options: {} };
    child = spawn(launch.file, launch.args, {
      ...launch.options, cwd: job.cwd, env: environment, shell: false,
      detached: !windows, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    });
    // Install lifecycle handlers before any fallible filesystem write after spawn.
    child.on('close', finish);
    child.on('error', (error) => {
      fatalError = `Não foi possível iniciar ${job.command[0]}: ${error.code ?? error.message}`;
      try { log(`\nRunner: ${fatalError}\n`); } catch { /* Keep close handling independent of logs. */ }
    });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => consume('stdout', chunk));
    child.stderr.on('data', (chunk) => consume('stderr', chunk));
    // Persist identity immediately after spawn, before accepting stream events.
    // A crash before this write leaves an unknown orphan and deliberately keeps the lock.
    const childIdentity = processIdentity(child.pid);
    if (child.pid) {
      // Retain identity in memory even if the first disk write fails.
      snapshot = { ...snapshot, pid: child.pid, childIdentity };
      atomicJson(locations.claim, { ...readJson(locations.claim), childIdentity });
      persist({ status: 'running', pid: child.pid, childIdentity });
    }
    poll = setInterval(() => {
      checkCancellation();
      // Silence is not failure: record worker activity without inventing test progress.
      if (!ended && Date.now() - lastPersistedAt >= heartbeatIntervalMs) persist();
    }, 150);
    persist();
  } catch (error) {
    fatalError = error.message;
    if (child?.pid) cancel('worker-error');
    else finish(null, null);
  }
}
