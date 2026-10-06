import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { windowsCompletion, windowsProof } from '../../runner/windows-proof.mjs';
import { removePath } from '../../runner/runtime.mjs';
assert.strictEqual(windowsCompletion({ resumed: true, treeEmpty: false, exitCode: null }, false).infrastructureFailure, true,
  'broker death after resume without final proof is infrastructure failure');
assert.strictEqual(windowsCompletion({ resumed: true, treeEmpty: true, exitCode: 1 }, false).infrastructureFailure, false,
  'observed suite exit 1 is a normal result');
assert.strictEqual(windowsCompletion({ resumed: true, treeEmpty: true, exitCode: 0 }, false).exitCode, 0);
assert.strictEqual(windowsCompletion(null, false).infrastructureFailure, true);
assert.strictEqual(windowsCompletion({ resumed: true, treeEmpty: false, exitCode: null }, true).infrastructureFailure, false,
  'individual cancellation with an independently empty Job must not compensate siblings');
assert.strictEqual(windowsCompletion({ treeEmpty: true, exitCode: 125, error: 'broker failure' }, true).infrastructureFailure, true);
console.log('Windows final proof: lost broker infrastructure, normal suite exit and individual cancellation: OK');

// Proof reads: transient sharing errors from the broker's File.Replace are retried
// within a bounded window; other read failures and malformed JSON fail closed.
const runId = '0f1e2d3c-4b5a-4968-8776-655443322110';
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'windows-proof-read-'));
const jobPath = path.join(directory, `api.${runId}.job.json`);
const target = `${jobPath}.windows.json`;
const jobName = `Local\\claude-test-progress-${runId}`;
fs.writeFileSync(target, JSON.stringify({ schema: 1, runId, contained: true, jobName, treeEmpty: true,
  brokerIdentity: { platform: 'win32', managedBroker: true, contained: true, pid: 4242, startTime: '1',
    owner: 'S-1-5-21-1', sessionId: 1, jobName } }), { mode: 0o600 });
const originalRead = fs.readFileSync;
function failReads(code, times) {
  let failures = 0;
  fs.readFileSync = function (file, ...args) {
    if (file === target && failures < times) { failures++; throw Object.assign(new Error(code), { code }); }
    return originalRead.call(this, file, ...args);
  };
  return () => failures;
}
try {
  let failures = failReads('EPERM', 2);
  assert.strictEqual(windowsProof(jobPath, runId, 4242).brokerIdentity.pid, 4242, 'transient EPERM must be retried');
  assert.strictEqual(failures(), 2);
  failReads('EBUSY', Infinity);
  const started = Date.now();
  assert.throws(() => windowsProof(jobPath, runId), /Leitura da prova Windows falhou \(EBUSY\)/);
  assert(Date.now() - started < 2000, 'sharing retries must stay bounded');
  failures = failReads('EIO', Infinity);
  assert.throws(() => windowsProof(jobPath, runId), /Leitura da prova Windows falhou \(EIO\)/);
  assert.strictEqual(failures(), 1, 'non-sharing read errors must not be retried');
  fs.readFileSync = originalRead;
  fs.writeFileSync(target, '{"schema":1,', { mode: 0o600 });
  assert.throws(() => windowsProof(jobPath, runId), /JSON de prova Windows inválido; conteúdo omitido\./);
  fs.unlinkSync(target);
  assert.strictEqual(windowsProof(jobPath, runId), null, 'a missing proof is absent, not an error');
} finally {
  fs.readFileSync = originalRead;
  removePath(directory, { recursive: true, force: true });
}
console.log('Windows proof reads: bounded sharing retries, coded read failures and malformed JSON: OK');
