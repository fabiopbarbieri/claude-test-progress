// Quiescent adoption/rollback proof using the prior artifact, only in a private fixture.
import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import { namespace, files } from '../../runner/state.mjs';
import { processIdentity, sameProcess, groupState } from '../../runner/process-identity.mjs';
import { randomUUID, removePath } from '../../runner/runtime.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
// A published main artifact, available in full repository history after squash merges.
const base = '3111299bbd5322221256825ee4237f25874feb9b';
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'module-rollout-'));
const artifact = path.join(temporary, 'prior artifact');
const app = path.join(temporary, 'project with spaces');
fs.mkdirSync(artifact); fs.mkdirSync(app); fs.mkdirSync(path.join(app, '.claude'));
const owner = `rollout-${randomUUID()}`;
const context = namespace(app, owner);
const environment = { ...process.env, CLAUDE_CONFIG_DIR: path.join(temporary, 'empty-registry') };
const config = path.join(app, '.claude/test-progress.json');
const suite = fileURLToPath(new URL('./fixtures/events-suite.mjs', import.meta.url));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const captured = [];
let currentArtifact = root, currentVersion = 2;
function collect(action, moduleId = currentVersion === 2 ? 'api' : 'backend', version = currentVersion, source = currentArtifact) {
  const result = spawnSync(process.execPath, [path.join(source, 'runner/cli.mjs'), action,
    '--cwd', app, '--owner', owner, version === 2 ? '--module' : '--lane', moduleId],
    { encoding: 'utf8', env: environment, timeout: 60000 });
  assert(!result.error, result.error && result.error.message);
  const data = JSON.parse(result.stdout);
  assert.strictEqual(data.ok, result.status === 0);
  return data;
}
async function waitFor(predicate) {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    const data = collect('status');
    if (predicate(data)) return data;
    await sleep(75);
  }
  throw new Error('Quiescent rollout fixture timed out');
}
function writeConfig(version) {
  const item = { command: [process.execPath, suite, 'slow'], cwd: '.', adapter: 'events' };
  fs.writeFileSync(config, JSON.stringify(version === 2 ? { schemaVersion: 2,
    modules: { api: { ...item, runtime: 'inherit' } } } : { schemaVersion: 1, backend: item }));
}
async function finishAndRetire() {
  const id = currentVersion === 2 ? 'api' : 'backend';
  const running = await waitFor(data => (currentVersion === 2 ? data.jobs : data.lanes)[id]?.resolved === 1);
  const job = (currentVersion === 2 ? running.jobs : running.lanes)[id];
  const worker = processIdentity(job.workerPid);
  assert(worker && job.childIdentity);
  captured.push({ worker, child: job.childIdentity });
  assert.strictEqual(collect('cancel').ok, true);
  await waitFor(data => (currentVersion === 2 ? data.jobs : data.lanes)[id]?.status === 'cancelled');
  const deadline = Date.now() + 3000;
  while (sameProcess(worker) && Date.now() < deadline) await sleep(50);
  assert(!sameProcess(worker));
  assert.strictEqual(groupState(job.childIdentity), 'empty');
  assert(!fs.existsSync(path.join(context.directory, `${id}.lock`)));
  assert(!fs.existsSync(path.join(context.directory, `${id}.mutation`)));
  return job;
}
function retireNamespace() {
  for (const run of captured) {
    assert(!sameProcess(run.worker));
    assert.strictEqual(groupState(run.child), 'empty');
  }
  // This directory belongs to this test's random owner, and all its trees are proven empty.
  removePath(context.directory, { recursive: true, force: true });
  namespace(app, owner);
}
async function main() {
  let cleaned = false;
  try {
    const archive = spawnSync('git', ['archive', base], { cwd: root, maxBuffer: 8 * 1024 * 1024 });
    assert.strictEqual(archive.status, 0, 'Prior artifact must exist locally; no remote fetch required');
    const extracted = spawnSync('tar', ['-x', '-C', artifact], { input: archive.stdout });
    assert.strictEqual(extracted.status, 0);
    currentArtifact = artifact; currentVersion = 1;
    writeConfig(1);
    assert.strictEqual(collect('start').ok, true);
    const original = await finishAndRetire();
    // A stopped v1 snapshot still blocks adoption; the v2 product does not adapt it.
    const legacy = collect('status', 'all', 2, root);
    assert.strictEqual(legacy.workspace.stateBlocked, true);
    assert.strictEqual(collect('start', 'api', 2, root).ok, false);
    retireNamespace();
    currentArtifact = root; currentVersion = 2;
    writeConfig(2);
    assert.strictEqual(collect('start').ok, true);
    const adopted = await finishAndRetire();
    assert.notStrictEqual(adopted.runId, original.runId);
    assert.strictEqual(adopted.schemaVersion, 2);
    assert.strictEqual(adopted.moduleId, 'api');
    assert(!fs.existsSync(files(context.directory, 'api').lock));
    retireNamespace();
    currentArtifact = artifact; currentVersion = 1;
    writeConfig(1);
    assert.strictEqual(collect('start').ok, true);
    const restored = await finishAndRetire();
    assert.notStrictEqual(restored.runId, adopted.runId);
    assert.strictEqual(restored.schema, 1);
    retireNamespace();
    cleaned = true;
    console.log('Prior artifact -> quiescent v2 adoption -> quiescent rollback; all trees empty, no mixed-version operations: OK');
  } finally {
    if (cleaned) {
      removePath(context.directory, { recursive: true, force: true });
      removePath(temporary, { recursive: true, force: true });
    } else {
      try { collect('cancel'); } catch { /* Never delete state with an uncertain tree. */ }
      console.error('Rollout fixture failed; its private temporary state was retained.');
    }
  }
}
if (process.platform === 'linux') main().catch(error => { console.error(error); process.exitCode = 1; });
else console.log('Quiescent prior-artifact rollout requires the Linux identity gate; native Windows has its separate gate.');
