import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { execFileSync } from 'child_process';
import { processIdentity, sameProcess, groupState, canKillOwnedOrphan } from './process-identity.mjs';
import { removePath } from './runtime.mjs';
import { windowsSecureDirectory } from './windows-process.mjs';
import { windowsProof } from './windows-proof.mjs';

export const LANES = ['backend', 'frontend'];
export const ACTIVE = new Set(['preparing', 'running']);
export const timestamp = () => new Date().toISOString();
export const readJson = (file) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
};
export function atomicJson(file, value) {
  const temporary = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600, flag: 'wx' });
  fs.renameSync(temporary, file);
}
function privateDirectory(directory) {
  try { fs.mkdirSync(directory, { mode: 0o700 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  const info = fs.lstatSync(directory);
  if (!info.isDirectory() || info.isSymbolicLink() ||
      (process.getuid && info.uid !== process.getuid())) {
    throw new Error(`Diretório de estado inseguro: ${directory}`);
  }
  if (process.platform === 'win32') windowsSecureDirectory(directory);
  else fs.chmodSync(directory, 0o700);
}
export function namespace(cwd, owner) {
  if (!path.isAbsolute(cwd)) throw new Error('--cwd precisa ser absoluto');
  cwd = fs.realpathSync(cwd);
  if (!fs.statSync(cwd).isDirectory()) throw new Error('--cwd precisa ser um diretório');
  if (!owner || owner.length > 512) throw new Error('--owner precisa identificar a sessão');
  const root = path.join(os.tmpdir(), `claude-test-progress-${process.getuid?.() ?? 'user'}`);
  privateDirectory(root);
  const id = crypto.createHash('sha256').update(`${cwd}\0${owner}`).digest('hex');
  const directory = path.join(root, id);
  privateDirectory(directory);
  return { cwd, directory };
}
export function files(directory, lane) {
  return {
    snapshot: path.join(directory, `${lane}.json`),
    lock: path.join(directory, `${lane}.lock`),
    claim: path.join(directory, `${lane}.lock`, 'claim.json'),
    cancel: path.join(directory, `${lane}.cancel.json`),
  };
}
export function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code === 'EPERM'; }
}
export function releaseLock(directory, lane, runId) {
  const locations = files(directory, lane);
  if (readJson(locations.claim)?.runId === runId) {
    removePath(locations.lock, { recursive: true, force: true });
  }
}
export function acquireLock(directory, lane, runId) {
  const locations = files(directory, lane);
  if (readJson(locations.snapshot)?.recoveryRequired) {
    throw new Error(`A lane ${lane} exige recuperação do comando órfão antes de uma nova execução.`);
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.mkdirSync(locations.lock, { mode: 0o700 });
      atomicJson(locations.claim, { runId, launchPid: process.pid,
        launchIdentity: processIdentity(process.pid), createdAt: timestamp() });
      return;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const claim = readJson(locations.claim);
      const age = Date.now() - fs.statSync(locations.lock).mtimeMs;
      if (alive(claim?.workerPid) || alive(claim?.launchPid) || age < 5000) {
        throw new Error(`Já existe uma execução ativa em ${lane}`);
      }
      const snapshot = readJson(locations.snapshot);
      if (snapshot?.runId === claim?.runId &&
          (snapshot.recoveryRequired || ACTIVE.has(snapshot.status))) {
        throw new Error(`A lane ${lane} está bloqueada após perda do worker; use cancel para recuperação segura e consulte status.`);
      }
      removePath(locations.lock, { recursive: true, force: true });
    }
  }
  throw new Error(`Não foi possível reservar ${lane}`);
}
export function snapshots(directory) {
  return Object.fromEntries(LANES.map((lane) => {
    const locations = files(directory, lane);
    let snapshot = readJson(locations.snapshot);
    // Old worker-unavailable snapshots did not retain the lock or a process identity.
    // Treat them as unresolved rather than silently permitting a duplicate after upgrade.
    if (snapshot?.phase === 'worker-unavailable' && snapshot.recoveryRequired === undefined) {
      snapshot = { ...snapshot, recoveryRequired: true };
      atomicJson(locations.snapshot, snapshot);
    }
    if (snapshot && (ACTIVE.has(snapshot.status) || snapshot.recoveryRequired)) {
      const claim = readJson(locations.claim);
      const age = Date.now() - Date.parse(snapshot.startedAt);
      const workerAlive = claim?.workerIdentity ? sameProcess(claim.workerIdentity) : alive(claim?.workerPid);
      const launchAlive = !claim?.workerPid && (claim?.launchIdentity ? sameProcess(claim.launchIdentity) : alive(claim?.launchPid));
      if (!workerAlive && !launchAlive && age > 5000) {
        // Re-read after the liveness checks: a worker may have just published its final result.
        snapshot = readJson(locations.snapshot);
        if (!snapshot || (!ACTIVE.has(snapshot.status) && !snapshot.recoveryRequired)) return [lane, snapshot];
        const proof = process.platform === 'win32' ? windowsProof(
          path.join(directory, `${lane}.${snapshot.runId}.job.json`), snapshot.runId, snapshot.pid ?? null) : null;
        const identity = proof?.brokerIdentity ?? snapshot.childIdentity ?? claim?.childIdentity;
        const recoveryRequired = (proof?.treeEmpty === true ? 'empty' : groupState(identity)) !== 'empty';
        snapshot = { ...snapshot, status: 'error',
          phase: recoveryRequired ? 'orphaned-command' : 'worker-unavailable', recoveryRequired,
          cancellable: recoveryRequired && canKillOwnedOrphan(identity),
          ...(proof ? { childIdentity: identity } : {}),
          error: recoveryRequired ? (canKillOwnedOrphan(identity) ?
            'O worker desapareceu e o comando continua vivo. A lane permanece bloqueada; use cancel para recuperação segura.' :
            'O worker desapareceu e não foi possível confirmar a identidade do grupo restante. A lane permanece bloqueada e exige recuperação manual; nenhum PID presumido será sinalizado.') :
            'O worker desapareceu; o grupo do comando terminou, mas seu código de saída não foi confirmado.',
          updatedAt: timestamp(), endedAt: recoveryRequired ? null : timestamp(),
          exitCode: null, total: null, percent: null, totalStable: false };
        atomicJson(locations.snapshot, snapshot);
        if (!recoveryRequired) releaseLock(directory, lane, snapshot.runId);
      }
      const cancellation = readJson(locations.cancel);
      if (ACTIVE.has(snapshot.status) && cancellation?.runId === snapshot.runId) {
        snapshot = { ...snapshot, phase: 'cancellation-requested',
          cancellationRequestedAt: cancellation.requestedAt };
      }
    }
    return [lane, snapshot];
  }));
}
export function revision(cwd) {
  try {
    const options = { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000 };
    return {
      head: execFileSync('git', ['rev-parse', 'HEAD'], options).trim(),
      dirty: Boolean(execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], options).trim()),
    };
  } catch { return { head: null, dirty: null }; }
}
