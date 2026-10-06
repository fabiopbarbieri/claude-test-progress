import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { readJson, atomicJson, files, ownedClaim, updateClaim, validRecord, jobFile, releaseLock, timestamp, ACTIVE, inspectState } from './state.mjs';
import { processIdentity, processIdentities, sameProcess, sameProcesses, groupState, canKillOwnedOrphan, killOwnedOrphan } from './process-identity.mjs';
import { removePath } from './runtime.mjs';
import { windowsProof } from './windows-proof.mjs';
import { assertSourcesUnchanged } from './module-config.mjs';
import { batchFiles, readBatch, changeBatch, compensation, ACK_MS, ABORT_MS, finalAcknowledged, pause } from './module-batch.mjs';
import { SCHEMA_VERSION } from './schema.mjs';

async function main() {
  const requestPath = process.argv[2];
  const request = readJson(requestPath);
  if (!request || request.schemaVersion !== SCHEMA_VERSION || requestPath !== batchFiles(request.directory, request.batchId).request) throw new Error('Pedido do lote inválido');
  let manifest = readBatch(request.directory, request.batchId);
  const coordinatorIdentity = processIdentity(process.pid);
  if (!coordinatorIdentity || !sameProcess(manifest.launchIdentity)) throw new Error('Ownership de lançamento perdido');
  manifest = changeBatch(request.directory, request.batchId, (value) => ({ ...value, coordinatorIdentity }));
  const deadline = Date.parse(manifest.deadlineAt);
  const workerPath = fileURLToPath(new URL('./worker.mjs', import.meta.url));
  const workerLaunches = new Map();
  let stopping = false;
  let observationDeadline = null;
  let abortReason = null;

  function cancelAll(reason) {
    if (stopping) return;
    stopping = true;
    abortReason = reason;
    observationDeadline = Date.now() + ABORT_MS;
    manifest = changeBatch(request.directory, request.batchId, (current) => current.state === 'preparing' ?
      { ...current, state: 'aborted', abortedAt: timestamp(), error: reason } : { ...current, compensationReason: reason, compensationAt: timestamp() });
    for (const entry of manifest.entries) {
      try {
        if (finalAcknowledged(manifest, entry)) continue;
        const claim = ownedClaim(request.directory, entry.moduleId, entry.runId);
        if (claim.batchId !== request.batchId) continue;
        atomicJson(files(request.directory, entry.moduleId).cancel, { schemaVersion: SCHEMA_VERSION, ...entry, batchId: request.batchId, requestedAt: timestamp() });
      } catch { /* Continue cancelling every authenticated sibling. */ }
    }
  }
  function cleanLostWorker(entry, claim, snapshot) {
    const loc = files(request.directory, entry.moduleId);
    let identity = snapshot.childIdentity ?? claim.childIdentity;
    const proof = process.platform === 'win32' ? windowsProof(jobFile(request.directory, entry.moduleId, entry.runId), entry.runId, snapshot.pid ?? null) : null;
    if (proof) identity = proof.brokerIdentity;
    let tree = proof?.treeEmpty === true ? 'empty' : !claim.spawnAttemptAt ? 'empty' : groupState(identity);
    if (stopping && tree === 'present' && canKillOwnedOrphan(identity)) {
      killOwnedOrphan(identity);
      tree = groupState(identity);
    }
    if (tree !== 'empty') {
      atomicJson(loc.snapshot, { ...snapshot, status: 'error', phase: 'orphaned-command', recoveryRequired: true,
        childIdentity: identity ?? null, cancellable: canKillOwnedOrphan(identity), infrastructureFailure: true,
        error: 'Worker perdido; árvore presente ou desconhecida. Compensação solicitada, lock conservado.', updatedAt: timestamp() });
      return false;
    }
    atomicJson(loc.snapshot, { ...snapshot, status: stopping ? 'cancelled' : 'error', phase: stopping ? 'batch-aborted' : 'worker-unavailable',
      recoveryRequired: false, infrastructureFailure: true, error: abortReason || 'Worker perdido antes do resultado final seguro.',
      endedAt: timestamp(), updatedAt: timestamp(), exitCode: null, totalStable: false });
    releaseLock(request.directory, entry.moduleId, entry.runId);
    if (validRecord(readJson(loc.cancel), entry.moduleId, entry.runId)) removePath(loc.cancel, { force: true });
    removePath(jobFile(request.directory, entry.moduleId, entry.runId), { force: true });
    if (process.platform === 'win32') removePath(`${jobFile(request.directory, entry.moduleId, entry.runId)}.windows.json`, { force: true });
    return true;
  }
  function acknowledged(entry) {
    const latest = readBatch(request.directory, request.batchId);
    if (!finalAcknowledged(latest, entry)) return false;
    manifest = latest;
    return true;
  }
  async function supervise() {
    manifest = readBatch(request.directory, request.batchId);
    const queried = [];
    for (const entry of manifest.entries) {
      if (finalAcknowledged(manifest, entry)) continue;
      try { queried.push(readJson(files(request.directory, entry.moduleId).claim)?.workerIdentity ?? null); }
      catch { queried.push(null); }
      queried.push(workerLaunches.get(entry.moduleId) ?? null);
    }
    const present = sameProcesses(queried);
    const liveness = new Map(queried.map((identity, index) => [JSON.stringify(identity), present[index]]));
    const alive = identity => liveness.has(JSON.stringify(identity)) ? liveness.get(JSON.stringify(identity)) : sameProcess(identity);
    let allSafe = true;
    for (const entry of manifest.entries) {
      try {
        if (acknowledged(entry)) continue;
        const loc = files(request.directory, entry.moduleId);
        const snapshot = readJson(loc.snapshot);
        if (!validRecord(snapshot, entry.moduleId, entry.runId)) { if (acknowledged(entry)) continue; cancelAll('Snapshot substituído durante supervisão'); allSafe = false; continue; }
        const claim = readJson(loc.claim);
        if (!claim) {
          if (acknowledged(entry)) continue;
          if (ACTIVE.has(snapshot.status) || snapshot.recoveryRequired) { cancelAll('Claim perdido antes do resultado seguro'); allSafe = false; }
          else if (snapshot.infrastructureFailure) cancelAll(snapshot.error || 'Falha de infraestrutura');
          continue;
        }
        ownedClaim(request.directory, entry.moduleId, entry.runId);
        if (claim.batchId !== request.batchId || !sameIdentity(claim.coordinatorIdentity, coordinatorIdentity)) throw new Error('Identidade de coordenação substituída');
        allSafe = false;
        if (snapshot.infrastructureFailure) cancelAll(snapshot.error || 'Falha de infraestrutura');
        if (!alive(claim.workerIdentity)) {
          if (acknowledged(entry)) continue;
          const worker = workerLaunches.get(entry.moduleId);
          if (worker && alive(worker)) continue; // Worker has not yet published its own identity.
          if (snapshot.finalSafe === true && !snapshot.recoveryRequired && !ACTIVE.has(snapshot.status)) {
            const identity = snapshot.childIdentity ?? claim.childIdentity;
            if (groupState(identity) === 'empty') {
              releaseLock(request.directory, entry.moduleId, entry.runId);
              continue;
            }
          }
          cancelAll('Worker perdido antes do resultado final seguro');
          cleanLostWorker(entry, claim, snapshot);
        } else if (stopping) {
          // A delayed preparation is safe to stop: no command can pass an aborted barrier.
          if (!claim.spawnAttemptAt && Date.now() > observationDeadline - ABORT_MS + 500) process.kill(claim.workerIdentity.pid, 'SIGKILL');
          else if (claim.spawnAttemptAt && Date.now() > observationDeadline - 2500) {
            const identity = snapshot.childIdentity ?? claim.childIdentity;
            if (canKillOwnedOrphan(identity)) killOwnedOrphan(identity);
          }
        } else if (manifest.state === 'released' && !claim.spawnAcknowledgedAt && Date.now() > Date.parse(manifest.releasedAt) + ACK_MS) {
          cancelAll('Prazo de confirmação do spawn expirado');
        }
      } catch (error) {
        try { if (acknowledged(entry)) continue; } catch { /* Preserve the original failure. */ }
        cancelAll(error.message); allSafe = false;
      }
    }
    return allSafe;
  }
  function sameIdentity(left, right) { return left && right && JSON.stringify(left) === JSON.stringify(right); }
  process.on('SIGTERM', () => { try { cancelAll('Coordenador interrompido'); } catch { /* Retain state. */ } });
  try {
    assertSourcesUnchanged(request.revision);
    if (inspectState(request.directory, { recover: false }).blocked) throw new Error('Estado global incompatível durante preparação');
    for (const entry of manifest.entries) {
      if (Date.now() >= deadline) throw new Error('Prazo de preparação expirado');
      const claim = ownedClaim(request.directory, entry.moduleId, entry.runId);
      if (claim.batchId !== request.batchId || !sameIdentity(claim.launchIdentity, manifest.launchIdentity)) throw new Error('Claim de lançamento divergente');
      const job = readJson(jobFile(request.directory, entry.moduleId, entry.runId));
      if (!validRecord(job, entry.moduleId, entry.runId) || job.batchId !== request.batchId) throw new Error('Job não corresponde ao lote');
      updateClaim(request.directory, entry.moduleId, entry.runId, { coordinatorIdentity });
    }
    // Every job and claim has passed preflight before the first worker is prepared.
    const launched = [];
    for (const entry of manifest.entries) {
      const worker = spawn(process.execPath, [workerPath, jobFile(request.directory, entry.moduleId, entry.runId)],
        { detached: true, stdio: 'ignore', cwd: path.dirname(workerPath), windowsHide: true });
      await new Promise((resolve, reject) => { worker.once('error', reject); if (worker.pid) resolve(); });
      launched.push({ entry, pid: worker.pid });
      worker.unref();
    }
    const launchedIdentities = processIdentities(launched.map(value => value.pid));
    for (const [index, value] of launched.entries()) {
      const identity = launchedIdentities[index];
      if (!identity) throw new Error('Identidade do worker não confirmada');
      workerLaunches.set(value.entry.moduleId, identity);
    }
    for (;;) {
      let ready = true;
      const identities = [];
      for (const entry of manifest.entries) {
        const claim = ownedClaim(request.directory, entry.moduleId, entry.runId);
        if (!validRecord(readJson(files(request.directory, entry.moduleId).snapshot), entry.moduleId, entry.runId)) throw new Error('Snapshot substituído durante preparação');
        if (validRecord(readJson(files(request.directory, entry.moduleId).cancel), entry.moduleId, entry.runId)) throw new Error('Cancelamento antes da liberação');
        identities.push(claim.workerIdentity ?? workerLaunches.get(entry.moduleId));
        if (!claim.readyAt || !claim.workerIdentity) ready = false;
      }
      if (sameProcesses(identities).some(value => !value)) throw new Error('Worker perdido durante preparação');
      if (ready) break;
      if (stopping || Date.now() >= deadline) throw new Error('Prazo de preparação dos workers expirado');
      await pause();
    }
    assertSourcesUnchanged(request.revision);
    if (inspectState(request.directory, { recover: false }).blocked) throw new Error('Estado global incompatível durante preparação');
    manifest = changeBatch(request.directory, request.batchId, (current) => {
      if (current.state !== 'preparing' || !sameProcess(current.coordinatorIdentity) || Date.now() >= deadline) throw new Error('Barreira não pode ser liberada');
      const identities = [];
      for (const entry of current.entries) {
        const claim = ownedClaim(request.directory, entry.moduleId, entry.runId);
        if (!validRecord(readJson(files(request.directory, entry.moduleId).snapshot), entry.moduleId, entry.runId)) throw new Error('Snapshot substituído antes da liberação');
        if (!claim.readyAt || !sameIdentity(claim.coordinatorIdentity, coordinatorIdentity) ||
            validRecord(readJson(files(request.directory, entry.moduleId).cancel), entry.moduleId, entry.runId)) throw new Error('Preparo mudou antes da liberação');
        identities.push(claim.workerIdentity);
      }
      if (sameProcesses(identities).some(value => !value) || Date.now() >= deadline) throw new Error('Preparo ou prazo mudou antes da liberação');
      // The native query can take seconds. Revalidate ownership once more before
      // committing release; the query result never substitutes for the current claim.
      for (const [index, entry] of current.entries.entries()) {
        const claim = ownedClaim(request.directory, entry.moduleId, entry.runId);
        if (!claim.readyAt || !sameIdentity(claim.coordinatorIdentity, coordinatorIdentity) ||
            !sameIdentity(claim.workerIdentity, identities[index]) ||
            !validRecord(readJson(files(request.directory, entry.moduleId).snapshot), entry.moduleId, entry.runId) ||
            validRecord(readJson(files(request.directory, entry.moduleId).cancel), entry.moduleId, entry.runId)) throw new Error('Ownership mudou durante confirmação do preparo');
      }
      assertSourcesUnchanged(request.revision);
      if (Date.now() >= deadline) throw new Error('Prazo de preparação expirado antes de confirmar liberação');
      return { ...current, state: 'released', releasedAt: timestamp() };
    });
  } catch (error) { cancelAll(error.message); }
  for (;;) {
    try {
      const requestCompensation = compensation(request.directory, manifest);
      if (requestCompensation) cancelAll(requestCompensation.reason);
    } catch (error) { cancelAll(error.message); }
    if (await supervise()) break;
    if (stopping && Date.now() >= observationDeadline) {
      changeBatch(request.directory, request.batchId, (value) => ({ ...value, supervisionError: 'Observação do aborto terminou sem confirmar todas as árvores; locks conservados.' }));
      break;
    }
    await pause(75);
  }
  changeBatch(request.directory, request.batchId, (value) => ({ ...value, supervisionEndedAt: timestamp() }));
  removePath(requestPath, { force: true });
}
main().catch((error) => {
  process.stderr.write(`batch: ${error.message}\n`);
  process.exitCode = 1;
});
