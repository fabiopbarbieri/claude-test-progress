import fs from 'fs';
import path from 'path';
import { performance } from 'perf_hooks';

// The broker replaces the proof with File.Replace. Opening it during that window can
// briefly fail with a sharing error; retry only those codes, within the same budget
// atomicJson uses. Other failures report their code, never the file content.
function readProof(target) {
  const retryUntil = performance.now() + 750;
  const wait = new Int32Array(new SharedArrayBuffer(4));
  let pause = 5;
  for (;;) {
    try { return fs.readFileSync(target, 'utf8'); }
    catch (error) {
      if (error.code === 'ENOENT') throw error;
      const remaining = retryUntil - performance.now();
      if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || remaining <= 0) {
        throw new Error(`Leitura da prova Windows falhou (${error.code || 'sem código'}); conteúdo omitido.`);
      }
      Atomics.wait(wait, 0, 0, Math.min(pause, remaining));
      pause = Math.min(pause * 2, 20);
    }
  }
}
// The run-bound sidecar is private and written atomically by the native broker.
export function windowsProof(jobPath, runId, expectedPid = null) {
  let proof;
  try {
    if (!/^[a-z][a-z0-9-]{0,47}\.[0-9a-f-]{36}\.job\.json$/.test(path.basename(jobPath)) ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(runId) ||
        !path.basename(jobPath).endsWith(`.${runId}.job.json`)) throw new Error('Caminho de prova não autenticado');
    const target = `${jobPath}.windows.json`;
    let current = target;
    while (true) {
      if (fs.lstatSync(current).isSymbolicLink()) throw new Error('Link em caminho de prova');
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
    const info = fs.lstatSync(target);
    if (!info.isFile() || info.size > 65536 || (process.getuid && info.uid !== process.getuid())) throw new Error('Prova Windows insegura');
    const text = readProof(target);
    try { proof = JSON.parse(text); }
    catch { throw new Error('JSON de prova Windows inválido; conteúdo omitido.'); }
  }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  if (!proof || proof.schema !== 1 || proof.runId !== runId || proof.contained !== true) return null;
  const identity = proof.brokerIdentity;
  if (!identity || identity.platform !== 'win32' || identity.managedBroker !== true || identity.contained !== true ||
      !Number.isInteger(identity.pid) || identity.pid <= 0 ||
      (expectedPid !== null && identity.pid !== expectedPid) ||
      typeof identity.startTime !== 'string' || !/^\d+$/.test(identity.startTime) ||
      typeof identity.owner !== 'string' || !/^S-\d+(?:-\d+)+$/.test(identity.owner) ||
      !Number.isInteger(identity.sessionId) || identity.sessionId < 0 ||
      identity.jobName !== `Local\\claude-test-progress-${runId}` || proof.jobName !== identity.jobName ||
      typeof proof.treeEmpty !== 'boolean') return null;
  return proof;
}

// A broker's OS exit cannot substitute for its durable suite result.
export function windowsCompletion(proof, cancellationRequested = false) {
  const error = proof?.error ? `Broker Windows: ${proof.error}` :
    !cancellationRequested && !(proof?.treeEmpty === true && Number.isInteger(proof?.exitCode)) ?
      'O broker Windows terminou sem prova final segura e código de saída observado.' : null;
  return { infrastructureFailure: Boolean(error), error, exitCode: Number.isInteger(proof?.exitCode) ? proof.exitCode : null };
}
