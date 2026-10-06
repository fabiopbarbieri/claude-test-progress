import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execFileSync } from 'child_process';
import { performance } from 'perf_hooks';
import { processIdentity, sameProcess, sameProcesses, groupState, canKillOwnedOrphan, validProcessIdentity } from './process-identity.mjs';
import { removePath, stateRoot } from './runtime.mjs';
import { windowsSecureDirectory } from './windows-process.mjs';
import { windowsProof } from './windows-proof.mjs';
import { validModuleId } from './module-id.mjs';
import { SCHEMA_VERSION } from './schema.mjs';

export const ACTIVE = new Set(['preparing', 'running']);
export const timestamp = () => new Date().toISOString();
export const validRunId = (id) => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id);
// Keep the state boundary independent from configuration and discovery.
const validId = validModuleId;
export function securePath(file, directory = false, absent = false) {
  for (let attempt = 0; attempt < 8; attempt++) {
    let info;
    try { info = fs.lstatSync(file); }
    catch (error) { if (absent && error.code === 'ENOENT') return null; throw error; }
    if (info.isSymbolicLink() || (directory ? !info.isDirectory() : !info.isFile()) ||
        (process.getuid && info.uid !== process.getuid())) throw new Error(`Caminho de estado inseguro: ${file}`);
    let resolved;
    try { resolved = fs.realpathSync(file); }
    catch (error) {
      // A normal teardown may remove an optional entry after lstat. Reauthenticate
      // from the beginning so a replacement link is still rejected.
      if (absent && error.code === 'ENOENT' && attempt < 7) continue;
      throw error;
    }
    if (resolved !== path.resolve(file)) throw new Error(`Link no caminho de estado: ${file}`);
    return info;
  }
}
// tail > 0 reads at most the file's last `tail` bytes, starting at a line boundary.
export function readPrivate(file, limit = 1024 * 1024, { tail = 0 } = {}) {
  const noFollow = fs.constants.O_NOFOLLOW || 0;
  for (let attempt = 0; attempt < 8; attempt++) {
    const info = securePath(file, false, true);
    if (!info) return null;
    let fd;
    try { fd = fs.openSync(file, fs.constants.O_RDONLY | noFollow); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    try {
      const opened = fs.fstatSync(fd);
      if (!opened.isFile() || (process.getuid && opened.uid !== process.getuid())) throw new Error('Arquivo de estado aberto inseguro');
      if (opened.size > limit) throw new Error('Arquivo de estado excede o limite');
      // atomicJson may replace the pathname between lstat and open. Authenticate
      // the actual fd, not its equality to an obsolete inode, before reading bytes.
      securePath(path.dirname(file), true);
      const current = securePath(file, false, true);
      if (!current) return null;
      // O_NOFOLLOW protects only the leaf. Bind the fd to the freshly authenticated
      // current leaf on every platform, covering transient parent substitutions.
      // A concurrent regular replacement is retried, never compared to old lstat.
      if (opened.dev !== current.dev || opened.ino !== current.ino) continue;
      const start = tail > 0 ? Math.max(0, opened.size - tail) : 0;
      const buffer = Buffer.alloc(tail > 0 ? Math.min(tail, limit) + 1 : limit + 1);
      let length = 0;
      while (length < buffer.length) {
        const count = fs.readSync(fd, buffer, length, buffer.length - length, start + length);
        if (!count) break;
        length += count;
      }
      if (start + length > limit) throw new Error('Arquivo de estado excede o limite durante leitura');
      // Cut on the byte level so a partial first line never leaves a broken UTF-8 sequence.
      const first = start > 0 ? buffer.indexOf(10) + 1 : 0;
      return buffer.subarray(first > 0 && first <= length ? first : 0, length).toString('utf8');
    } finally { fs.closeSync(fd); }
  }
  throw Object.assign(new Error('Não foi possível autenticar o arquivo de estado após novas tentativas'), { code: 'ESTATECHANGED' });
}

export const readJson = (file) => {
  const text = readPrivate(file);
  if (text === null) return null;
  try { return JSON.parse(text); } catch { throw new Error('JSON de estado inválido; conteúdo omitido.'); }
};
export function atomicJson(file, value) {
  securePath(path.dirname(file), true);
  securePath(file, false, true);
  const temporary = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600, flag: 'wx' });
  try {
    // Stay below the one-second mutation-gate wait. Wall-clock changes must not
    // extend this retry window; only the rename's sharing errors are retried.
    const retryUntil = performance.now() + 750;
    const wait = process.platform === 'win32' ? new Int32Array(new SharedArrayBuffer(4)) : null;
    let pause = 5;
    for (;;) {
      securePath(path.dirname(file), true);
      securePath(file, false, true);
      try { fs.renameSync(temporary, file); break; }
      catch (error) {
        // Windows readers can briefly prevent replacement even with delete
        // sharing. Preserve the old complete record while retrying.
        const remaining = retryUntil - performance.now();
        if (!wait || !['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || remaining <= 0) throw error;
        Atomics.wait(wait, 0, 0, Math.min(pause, remaining));
        pause = Math.min(pause * 2, 20);
      }
    }
  }
  finally { removePath(temporary, { force: true }); }
}
function privateDirectory(directory) {
  try { fs.mkdirSync(directory, { mode: 0o700 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  securePath(directory, true);
  fs.chmodSync(directory, 0o700);
}
export function namespace(cwd, owner) {
  if (!path.isAbsolute(cwd)) throw new Error('--cwd precisa ser absoluto');
  cwd = fs.realpathSync(cwd);
  if (!fs.statSync(cwd).isDirectory()) throw new Error('--cwd precisa ser um diretório');
  if (!owner || owner.length > 512 || owner.includes('\0')) throw new Error('--owner precisa identificar a sessão');
  const root = stateRoot();
  const id = crypto.createHash('sha256').update(`${cwd}\0${owner}`).digest('hex');
  const directory = path.join(root, id);
  if (process.platform === 'win32') {
    // Create with an explicit user SID: elevated Windows otherwise defaults to
    // the Administrators group, which cannot authenticate this private state.
    // One control call secures the root and then the workspace directory.
    windowsSecureDirectory(root, directory);
    securePath(root, true);
    securePath(directory, true);
  } else {
    privateDirectory(root);
    privateDirectory(directory);
  }
  return { cwd, directory };
}
export function files(directory, moduleId) {
  if (!validId(moduleId)) throw new Error('ID de módulo inválido');
  return { snapshot: path.join(directory, `${moduleId}.json`), lock: path.join(directory, `${moduleId}.lock`),
    claim: path.join(directory, `${moduleId}.lock`, 'claim.json'), cancel: path.join(directory, `${moduleId}.cancel.json`) };
}
export function jobFile(directory, moduleId, runId) {
  files(directory, moduleId);
  if (!validRunId(runId)) throw new Error('runId inválido');
  return path.join(directory, `${moduleId}.${runId}.job.json`);
}
export function validRecord(value, moduleId, runId = null) {
  return Boolean(value && value.schemaVersion === SCHEMA_VERSION && value.moduleId === moduleId && validRunId(value.runId) &&
    (runId === null || value.runId === runId));
}
export function ownedClaim(directory, moduleId, runId) {
  const loc = files(directory, moduleId);
  securePath(loc.lock, true);
  const claim = readJson(loc.claim);
  if (!validRecord(claim, moduleId, runId)) throw new Error(`Claim de ${moduleId} não corresponde à execução`);
  return claim;
}
export function updateClaim(directory, moduleId, runId, changes) {
  return mutateLock(directory, moduleId, () => {
    const claim = ownedClaim(directory, moduleId, runId);
    atomicJson(files(directory, moduleId).claim, { ...claim, ...changes });
  });
}
export function updateSnapshot(directory, moduleId, runId, operation) {
  return mutateLock(directory, moduleId, () => {
    ownedClaim(directory, moduleId, runId);
    const loc = files(directory, moduleId);
    const before = readJson(loc.snapshot);
    if (!validRecord(before, moduleId, runId)) throw new Error('Snapshot não corresponde à execução');
    const after = operation(before);
    if (!validRecord(after, moduleId, runId)) throw new Error('Identidade do snapshot é imutável');
    atomicJson(loc.snapshot, after);
    return after;
  });
}

function mutateLock(directory, moduleId, operation) {
  files(directory, moduleId);
  securePath(directory, true);
  const gate = path.join(directory, `${moduleId}.mutation`);
  const deadline = Date.now() + 1000;
  const wait = new Int32Array(new SharedArrayBuffer(4));
  for (;;) {
    try { fs.mkdirSync(gate, { mode: 0o700 }); break; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (Date.now() >= deadline) throw new Error(`Módulo ${moduleId} bloqueado por alteração de lock; recuperação manual necessária.`);
      try { securePath(gate, true); }
      catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      Atomics.wait(wait, 0, 0, 10);
    }
  }
  try { return operation(); }
  finally { securePath(gate, true); fs.rmdirSync(gate); }
}
export function releaseLock(directory, moduleId, runId) {
  if (!validRunId(runId)) throw new Error('runId inválido');
  return mutateLock(directory, moduleId, () => {
    const loc = files(directory, moduleId);
    if (!securePath(loc.lock, true, true)) return false;
    const claim = readJson(loc.claim);
    if (!validRecord(claim, moduleId, runId)) return false;
    // Remove only the authenticated claim and empty lock, never recursively follow contents.
    securePath(loc.claim);
    fs.unlinkSync(loc.claim);
    fs.rmdirSync(loc.lock);
    return true;
  });
}
export function acquireLock(directory, moduleId, runId, extra = {}) {
  if (!validRunId(runId)) throw new Error('runId inválido');
  return mutateLock(directory, moduleId, () => {
    const loc = files(directory, moduleId);
    if (securePath(loc.snapshot, false, true)) {
      const snapshot = readJson(loc.snapshot);
      if (!validRecord(snapshot, moduleId) || snapshot.recoveryRequired || ACTIVE.has(snapshot.status)) {
        throw new Error(`Módulo ${moduleId} bloqueado por estado anterior não resolvido`);
      }
    }
    try { fs.mkdirSync(loc.lock, { mode: 0o700 }); }
    catch (error) { if (error.code === 'EEXIST') throw new Error(`Já existe lock de execução em ${moduleId}`); throw error; }
    atomicJson(loc.claim, { ...extra, schemaVersion: SCHEMA_VERSION, moduleId, runId, launchIdentity: processIdentity(process.pid), createdAt: timestamp() });
  });
}
function activity(snapshot) {
  const reference = snapshot.endedAt ? Date.parse(snapshot.endedAt) : Date.now();
  const age = (value) => value && Number.isFinite(Date.parse(value)) ? Math.max(0, reference - Date.parse(value)) : null;
  return { ...snapshot, elapsedMs: age(snapshot.startedAt), heartbeatAgeMs: age(snapshot.heartbeatAt) };
}
export function stateIds(directory) {
  securePath(directory, true);
  const ids = new Set();
  for (const name of fs.readdirSync(directory)) {
    const match = /^(.+?)(?:\.cancel\.json|\.json|\.lock|\.mutation)$/.exec(name);
    if (match && validId(match[1])) ids.add(match[1]);
  }
  return [...ids].sort();
}
// Windows: a running worker rewrites its snapshot heartbeat every 5 s. A fresh heartbeat
// plus an existing worker PID answers "alive" for this read without starting PowerShell.
// A stale heartbeat or a missing PID falls back to the authenticated query, and any
// recovery still re-authenticates under the mutation gate; liveness never authorizes a kill.
const HEARTBEAT_FRESH_MS = 15000;
function workerBeating(snapshot, claim) {
  const identity = claim?.workerIdentity;
  if (!validRecord(claim, snapshot.moduleId, snapshot.runId) || !validProcessIdentity(identity) || snapshot.workerPid !== identity.pid) return false;
  const age = Date.now() - Date.parse(snapshot.heartbeatAt);
  if (!(age >= 0 && age < HEARTBEAT_FRESH_MS)) return false;
  try { process.kill(identity.pid, 0); return true; }
  catch (error) { return error.code === 'EPERM'; }
}
export function inspectState(directory, { recover = true } = {}) {
  securePath(directory, true);
  const jobs = Object.create(null);
  const stateDiagnostics = Object.create(null);
  let blocked = false;
  const diagnose = (id, message, global = false, code = 'state-unavailable') => { (stateDiagnostics[id] || (stateDiagnostics[id] = [])).push({ code, message, blocking: true }); if (global) blocked = true; };
  const ids = stateIds(directory);
  const queried = new Map();
  const beating = new Set();
  if (recover && process.platform === 'win32') {
    for (const moduleId of ids) {
      try {
        const loc = files(directory, moduleId);
        const snapshot = readJson(loc.snapshot);
        if (!snapshot || (!ACTIVE.has(snapshot.status) && !snapshot.recoveryRequired)) continue;
        const claim = readJson(loc.claim);
        if (workerBeating(snapshot, claim)) { beating.add(moduleId); continue; }
        for (const identity of [claim?.workerIdentity, claim?.coordinatorIdentity, claim?.launchIdentity]) {
          if (validProcessIdentity(identity)) queried.set(JSON.stringify(identity), identity);
        }
      } catch { /* The authenticated observation below reports any invalid record. */ }
    }
  }
  const presence = sameProcesses([...queried.values()]);
  const liveness = new Map([...queried.keys()].map((key, index) => [key, presence[index]]));
  const alive = identity => liveness.has(JSON.stringify(identity)) ? liveness.get(JSON.stringify(identity)) : sameProcess(identity);
  for (const moduleId of ids) {
    const loc = files(directory, moduleId);
    try {
      let snapshot, lock, claim, pendingCancel, gate;
      const observationUntil = performance.now() + 100;
      const observationWait = new Int32Array(new SharedArrayBuffer(4));
      let observationPause = 1;
      let busy = false;
      const pauseObservation = () => {
        const remaining = observationUntil - performance.now();
        if (remaining <= 0) return false;
        Atomics.wait(observationWait, 0, 0, Math.min(observationPause, remaining));
        observationPause = Math.min(observationPause * 2, 10);
        return true;
      };
      // A writer may be paused between claim removal and lock/gate removal.
      // Yield before reauthenticating; tight synchronous retries can all observe
      // that same intermediate state. The response budget never proves corruption.
      for (let attempt = 0; ; attempt++) {
        try {
          gate = securePath(path.join(directory, `${moduleId}.mutation`), true, true);
          snapshot = readJson(loc.snapshot);
          lock = securePath(loc.lock, true, true);
          claim = lock ? readJson(loc.claim) : null;
          pendingCancel = readJson(loc.cancel);
          const currentLock = securePath(loc.lock, true, true);
          const currentGate = securePath(path.join(directory, `${moduleId}.mutation`), true, true);
          const changed = Boolean(gate) !== Boolean(currentGate) || Boolean(lock) !== Boolean(currentLock) ||
            (lock && currentLock && (lock.dev !== currentLock.dev || lock.ino !== currentLock.ino)) ||
            (lock && !validRecord(claim, moduleId, snapshot?.runId ?? null));
          // Every heartbeat briefly holds the gate. Wait only when the gated
          // observation is inconsistent; a consistent one stays visible.
          if (changed && (gate || currentGate)) {
            if (pauseObservation()) { attempt = -1; continue; }
            busy = true;
            break;
          }
          if (attempt < 7 && changed) continue;
          if (!lock && snapshot && (ACTIVE.has(snapshot.status) || snapshot.recoveryRequired) && attempt < 7) {
            const latest = readJson(loc.snapshot);
            if (JSON.stringify(latest) !== JSON.stringify(snapshot)) continue;
          }
          break;
        } catch (error) {
          // A claim fd can remain open after its parent lock is removed. Retry
          // the whole observation rather than read through an unauthenticated parent.
          if ((error.code === 'ENOENT' && gate) || error.code === 'ESTATECHANGED') {
            if (pauseObservation()) { attempt = -1; continue; }
            if (gate) { busy = true; break; }
          }
          if (error.code === 'ENOENT' && attempt < 7) continue;
          throw error;
        }
      }
      if (busy) {
        // Complete incompatible records still block the namespace. A missing
        // claim under an authenticated gate is busy, not evidence of an incompatible record.
        if (snapshot && !validRecord(snapshot, moduleId)) { diagnose(moduleId, 'Snapshot incompatível; novos starts bloqueados.', true); continue; }
        if (claim && !validRecord(claim, moduleId)) { diagnose(moduleId, 'Claim incompatível; novos starts bloqueados.', true); continue; }
        if (pendingCancel && !validRecord(pendingCancel, moduleId)) diagnose(moduleId, 'Pedido de cancelamento inválido; conservado.', true);
        diagnose(moduleId, 'Alteração de estado em andamento; nova observação necessária.', false, 'state-busy');
        const terminal = readJson(loc.snapshot);
        if (validRecord(terminal, moduleId) && ['error', 'failed', 'completed', 'cancelled'].includes(terminal.status) &&
            terminal.finalSafe === true && !terminal.recoveryRequired &&
            terminal.logPath === path.join(directory, `${moduleId}.${terminal.runId}.log`)) jobs[moduleId] = activity(terminal);
        continue;
      }
      if (gate) diagnose(moduleId, 'Gate de alteração de lock presente; nenhuma recuperação por idade ou PID.');
      if (lock && !validRecord(claim, moduleId)) diagnose(moduleId, 'Lock desconhecido ou claim inválido; conservado.', true);
      if (snapshot && !validRecord(snapshot, moduleId)) { diagnose(moduleId, 'Snapshot incompatível; novos starts bloqueados.', true); continue; }
      if (pendingCancel && !validRecord(pendingCancel, moduleId)) diagnose(moduleId, 'Pedido de cancelamento inválido; conservado.', true);
      if (!snapshot) { if (lock) diagnose(moduleId, 'Lock sem snapshot; conservado.'); continue; }
      if (!['preparing', 'running', 'error', 'failed', 'completed', 'cancelled'].includes(snapshot.status)) {
        diagnose(moduleId, 'Status de snapshot desconhecido.', true); continue;
      }
      if (lock && (!validRecord(claim, moduleId, snapshot.runId))) { diagnose(moduleId, 'Snapshot e claim pertencem a execuções diferentes.'); continue; }
      if (snapshot.logPath !== undefined && snapshot.logPath !== path.join(directory, `${moduleId}.${snapshot.runId}.log`)) {
        diagnose(moduleId, 'logPath não autenticado.'); continue;
      }
      let current = snapshot;
      if (ACTIVE.has(snapshot.status) || snapshot.recoveryRequired) {
        if (!claim) { diagnose(moduleId, 'Execução ativa sem claim autenticado.'); }
        else if (recover && !beating.has(moduleId) && !alive(claim.workerIdentity) && !alive(claim.coordinatorIdentity) && !alive(claim.launchIdentity)) {
          current = mutateLock(directory, moduleId, () => {
            // Liveness can take seconds on Windows. Read again under the same gate used by workers.
            const latest = readJson(loc.snapshot);
            if (!validRecord(latest, moduleId)) throw new Error('Snapshot mudou para estado incompatível durante inspeção');
            if (latest.runId !== snapshot.runId || (!ACTIVE.has(latest.status) && !latest.recoveryRequired)) return latest;
            const latestClaim = ownedClaim(directory, moduleId, latest.runId);
            if (sameProcess(latestClaim.workerIdentity) || sameProcess(latestClaim.coordinatorIdentity) || sameProcess(latestClaim.launchIdentity)) return latest;
            // A terminal result may have been published just before acquiring the gate.
            const proof = process.platform === 'win32' ? windowsProof(jobFile(directory, moduleId, latest.runId), latest.runId, latest.pid ?? null) : null;
            const identity = proof?.brokerIdentity ?? latest.childIdentity ?? latestClaim.childIdentity;
            const tree = proof?.treeEmpty === true ? 'empty' : !latestClaim.spawnAttemptAt ? 'empty' : groupState(identity);
            const recoveryRequired = tree !== 'empty';
            const recovered = { ...latest, status: 'error', phase: recoveryRequired ? 'orphaned-command' : 'worker-unavailable',
              recoveryRequired, cancellable: recoveryRequired && canKillOwnedOrphan(identity), childIdentity: identity ?? null,
              error: recoveryRequired ? 'Worker ausente; árvore presente ou desconhecida. Lock conservado para recuperação segura.' :
                'Worker ausente; árvore vazia confirmada, resultado do comando não observado.',
              endedAt: recoveryRequired ? null : timestamp(), updatedAt: timestamp(), exitCode: null, totalStable: false, percent: null };
            atomicJson(loc.snapshot, recovered);
            return recovered;
          });
          if (current.runId === snapshot.runId && current.phase === 'worker-unavailable' && current.recoveryRequired === false) releaseLock(directory, moduleId, current.runId);

        }
        const cancellation = readJson(loc.cancel);
        if (cancellation && !validRecord(cancellation, moduleId)) diagnose(moduleId, 'Pedido de cancelamento incompatível.');
        if (ACTIVE.has(current.status) && validRecord(cancellation, moduleId, current.runId)) current = { ...current, phase: 'cancellation-requested', cancellationRequestedAt: cancellation.requestedAt };
      }
      if (current.logPath !== undefined && current.logPath !== path.join(directory, `${moduleId}.${current.runId}.log`)) { diagnose(moduleId, 'logPath não autenticado após inspeção.'); continue; }
      if (current.recoveryRequired) diagnose(moduleId, current.error || 'Árvore presente ou desconhecida; recuperação segura necessária.');
      jobs[moduleId] = activity(current);
    } catch (error) { diagnose(moduleId, error.message); }
  }
  // Files with names outside the state vocabulary also fail closed.
  for (const name of fs.readdirSync(directory)) {
    // Authenticate every entry before deciding whether its vocabulary is understood.
    try { if (!securePath(path.join(directory, name), /\.(?:lock|mutation)$/.test(name), true)) continue; }
    catch (error) { diagnose('*', error.message, true); continue; }
    const temporary = /^(?:[a-z][a-z0-9-]*\.(?:json|cancel\.json|[0-9a-f-]{36}\.job\.json)|claim\.json|batch\.[0-9a-f-]{36}\.(?:json|request\.json|compensate\.json))\.[1-9][0-9]*\.[0-9a-f]{8}\.tmp$/.test(name);
    const windowsTemporary = /^[a-z][a-z0-9-]*\.[0-9a-f-]{36}\.job\.json\.windows\.json\.[0-9a-f]{32}\.tmp$/.test(name);
    if (temporary || windowsTemporary) continue;
    const control = /^batch\.([0-9a-f-]{36})\.(request\.json|compensate\.json|mutation)$/.exec(name);
    if (control) {
      try {
        if (!validRunId(control[1])) throw new Error('Identidade de controle do lote inválida');
        const manifest = readJson(path.join(directory, `batch.${control[1]}.json`));
        if (!manifest || manifest.schemaVersion !== SCHEMA_VERSION || manifest.batchId !== control[1] || !Array.isArray(manifest.entries) ||
            !manifest.entries.length || manifest.entries.some(entry => !validId(entry.moduleId) || !validRunId(entry.runId))) throw new Error('Controle sem manifest autenticado');
        if (control[2] === 'mutation') { if (!securePath(path.join(directory, name), true, true)) continue; diagnose('*', 'Gate de controle do lote presente; nenhuma recuperação automática.', true); continue; }
        const value = readJson(path.join(directory, name));
        if (value === null && !securePath(path.join(directory, name), false, true)) continue;
        if (!value || value.schemaVersion !== SCHEMA_VERSION || value.batchId !== manifest.batchId) throw new Error('Controle do lote incompatível');
        if (control[2] === 'request.json') {
          if (value.directory !== directory || !Array.isArray(value.revision) || value.revision.some(source => !source ||
              typeof source.path !== 'string' || !path.isAbsolute(source.path) || !(source.digest === null || /^[0-9a-f]{64}$/.test(source.digest)))) throw new Error('Pedido de lote inválido');
        } else if (JSON.stringify(value.entries) !== JSON.stringify(manifest.entries) || !validProcessIdentity(value.requester) ||
            !manifest.entries.some(entry => entry.moduleId === value.moduleId && entry.runId === value.runId) || typeof value.reason !== 'string') throw new Error('Compensação sem identidade autenticada');
      } catch (error) { diagnose('*', error.message, true); }
      continue;
    }
    const jobMatch = /^([a-z][a-z0-9-]*)\.([0-9a-f-]{36})\.job\.json$/.exec(name);
    if (jobMatch && validId(jobMatch[1])) {
      try {
        const job = readJson(path.join(directory, name));
        if (job === null && !securePath(path.join(directory, name), false, true)) continue;
        if (!validRecord(job, jobMatch[1], jobMatch[2])) diagnose(jobMatch[1], 'Job incompatível; conservado.', true);
      } catch (error) { diagnose(jobMatch[1], error.message); }
    }
    const batchMatch = /^batch\.([0-9a-f-]{36})\.json$/.exec(name);
    if (batchMatch) {
      try {
        const batch = readJson(path.join(directory, name));
        if (!batch || batch.schemaVersion !== SCHEMA_VERSION || batch.batchId !== batchMatch[1] || !validRunId(batch.batchId) ||
            !['preparing', 'released', 'aborted'].includes(batch.state) || !Array.isArray(batch.entries) ||
            batch.entries.some(entry => !validId(entry.moduleId) || !validRunId(entry.runId))) diagnose('*', 'Manifest do lote inválido.', true);
        else if (batch.supervisionError) for (const entry of batch.entries) diagnose(entry.moduleId, batch.supervisionError);
      } catch (error) { diagnose('*', error.message, true); }
    }
    if (/^batch\.[0-9a-f-]{36}\.json$/.test(name)) continue;
    const regular = /^([a-z][a-z0-9-]*)\.(?:json|lock|mutation|cancel\.json|[0-9a-f-]{36}\.(?:job\.json(?:\.windows\.json)?|log))$/.exec(name);
    if (!regular || !validId(regular[1])) diagnose('*', `Entrada desconhecida no namespace: ${name}`, true);
  }
  return { jobs, stateDiagnostics, blocked };
}
export function snapshots(directory) { return inspectState(directory).jobs; }
export function revision(cwd) {
  try {
    const options = { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000 };
    return { head: execFileSync('git', ['rev-parse', 'HEAD'], options).trim(),
      dirty: Boolean(execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], options).trim()) };
  } catch { return { head: null, dirty: null }; }
}
