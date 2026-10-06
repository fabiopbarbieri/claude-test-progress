import fs from 'fs';
import path from 'path';
import { readJson, atomicJson, validRunId, validRecord, files, securePath, ownedClaim, timestamp } from './state.mjs';
import { sameProcess, validProcessIdentity } from './process-identity.mjs';
import { validModuleId } from './module-id.mjs';
import { SCHEMA_VERSION } from './schema.mjs';

export const PREPARE_MS = 30000;
export const ACK_MS = 10000;
export const ABORT_MS = 10000;
export const pause = (ms = 25) => new Promise((resolve) => setTimeout(resolve, ms));
export function batchFiles(directory, batchId) {
  if (!validRunId(batchId)) throw new Error('batchId inválido');
  return { manifest: path.join(directory, `batch.${batchId}.json`), request: path.join(directory, `batch.${batchId}.request.json`),
    compensate: path.join(directory, `batch.${batchId}.compensate.json`), gate: path.join(directory, `batch.${batchId}.mutation`) };
}
export function readBatch(directory, batchId) {
  const value = readJson(batchFiles(directory, batchId).manifest);
  if (!value || value.schemaVersion !== SCHEMA_VERSION || value.batchId !== batchId || !['preparing', 'released', 'aborted'].includes(value.state) ||
      !Array.isArray(value.entries) || !value.entries.length || value.entries.some((entry) => !validModuleId(entry.moduleId) || !validRunId(entry.runId)) ||
      new Set(value.entries.map((entry) => entry.moduleId)).size !== value.entries.length) throw new Error('Manifest do lote inválido');
  return value;
}
export function changeBatch(directory, batchId, operation) {
  const loc = batchFiles(directory, batchId);
  securePath(directory, true);
  const deadline = Date.now() + 1000;
  const wait = new Int32Array(new SharedArrayBuffer(4));
  for (;;) {
    try { fs.mkdirSync(loc.gate, { mode: 0o700 }); break; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (Date.now() >= deadline) throw new Error('Gate de lote ocupado; estado conservado');
      try { securePath(loc.gate, true); }
      catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      Atomics.wait(wait, 0, 0, 10);
    }
  }
  try {
    const before = readBatch(directory, batchId);
    const after = operation(before);
    if (before.state !== 'preparing' && after.state !== before.state) throw new Error('Estado final da barreira é imutável');
    if (after.batchId !== before.batchId || JSON.stringify(after.entries) !== JSON.stringify(before.entries)) throw new Error('Identidade do lote é imutável');
    atomicJson(loc.manifest, after);
    return after;
  } finally { securePath(loc.gate, true); fs.rmdirSync(loc.gate); }
}
export function requestCompensation(job, reason) {
  if (!job.batchId) return;
  const manifest = readBatch(job.directory, job.batchId);
  if (!manifest.entries.some((entry) => entry.moduleId === job.moduleId && entry.runId === job.runId)) throw new Error('Execução fora do lote');
  const claim = ownedClaim(job.directory, job.moduleId, job.runId);
  if (claim.batchId !== job.batchId || claim.workerIdentity?.pid !== process.pid || !sameProcess(claim.workerIdentity)) throw new Error('Solicitante da compensação não autenticado');
  changeBatch(job.directory, job.batchId, (current) => {
    atomicJson(batchFiles(job.directory, job.batchId).compensate, { schemaVersion: SCHEMA_VERSION, batchId: job.batchId,
      entries: current.entries, requester: claim.workerIdentity, moduleId: job.moduleId, runId: job.runId, reason, requestedAt: timestamp() });
    return current;
  });
}
export function compensation(directory, manifest) {
  const value = readJson(batchFiles(directory, manifest.batchId).compensate);
  if (!value) return null;
  if (value.schemaVersion !== SCHEMA_VERSION || value.batchId !== manifest.batchId || JSON.stringify(value.entries) !== JSON.stringify(manifest.entries) ||
      !manifest.entries.some((entry) => entry.moduleId === value.moduleId && entry.runId === value.runId)) throw new Error('Pedido de compensação inválido');
  const snapshot = readJson(files(directory, value.moduleId).snapshot);
  if (!validRecord(snapshot, value.moduleId, value.runId) || snapshot.workerPid !== value.requester?.pid || JSON.stringify(snapshot.workerIdentity) !== JSON.stringify(value.requester)) throw new Error('Identidade do pedido de compensação divergente');
  return value;
}

// Final acknowledgements survive per-module snapshot replacement by a later run.
export function publishFinalSafe(job, snapshot) {
  const claim = ownedClaim(job.directory, job.moduleId, job.runId);
  if (claim.batchId !== job.batchId || claim.workerIdentity?.pid !== process.pid || !sameProcess(claim.workerIdentity) ||
      !validRecord(snapshot, job.moduleId, job.runId) || snapshot.finalSafe !== true) throw new Error('Resultado final seguro não autenticado');
  changeBatch(job.directory, job.batchId, current => {
    if (!current.entries.some(entry => entry.moduleId === job.moduleId && entry.runId === job.runId)) throw new Error('Resultado fora do lote');
    const completed = Object.assign(Object.create(null), current.completed || {});
    completed[job.moduleId] = { schemaVersion: SCHEMA_VERSION, moduleId: job.moduleId, runId: job.runId, batchId: job.batchId,
      workerIdentity: claim.workerIdentity, finalSafe: true, observedAt: timestamp() };
    return { ...current, completed };
  });
}
export function finalAcknowledged(manifest, entry) {
  const result = manifest.completed?.[entry.moduleId];
  if (!result) return false;
  if (!validRecord(result, entry.moduleId, entry.runId) || result.batchId !== manifest.batchId || result.finalSafe !== true ||
      !validProcessIdentity(result.workerIdentity) || !Number.isFinite(Date.parse(result.observedAt))) throw new Error('Confirmação final do lote inválida');
  return true;
}
