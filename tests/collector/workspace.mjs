// Public CLI regression: only enabled workspace suites start, while removed
// configuration cannot strand a live command or its logs/cancellation.
import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { namespace, readJson, files } from '../../runner/state.mjs';
import { sameProcess, groupState } from '../../runner/process-identity.mjs';
import { randomUUID, removePath } from '../../runner/runtime.mjs';

if (process.platform !== 'linux') {
  console.log('SKIP: workspace process-cleanup proof requires Linux process identity');
  process.exit(0);
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const app = fs.mkdtempSync(path.join(os.tmpdir(), 'test-progress-workspace-'));
const owner = randomUUID();
const directory = namespace(app, owner).directory;
const configPath = path.join(app, '.claude/test-progress.json');
fs.mkdirSync(path.dirname(configPath));
const suite = lane => ({ command: [process.execPath,
  path.join(root, 'tests/collector/fixtures/panel-suite.mjs'), lane], cwd: '.', adapter: 'events',
  env: { PATH: path.dirname(process.execPath) + path.delimiter + process.env.PATH } });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function collect(action, lane = 'all', ok = true) {
  const reply = spawnSync(process.execPath, [path.join(root, 'runner/cli.mjs'), action,
    '--cwd', app, '--owner', owner, '--lane', lane], { encoding: 'utf8', timeout: 5000 });
  const data = JSON.parse(reply.stdout);
  assert.strictEqual(data.ok, ok, data.error);
  return data;
}
async function waitFor(lane, predicate) {
  const deadline = Date.now() + 10000;
  do {
    const job = collect('status').lanes[lane];
    if (predicate(job)) return job;
    await sleep(80);
  } while (Date.now() < deadline);
  throw new Error('Workspace fixture timed out');
}
async function main() {
  try {
    assert.deepStrictEqual(collect('status').workspace,
      { configStatus: 'missing', configuredLanes: [] });
    for (const lane of ['backend', 'frontend']) {
      const other = lane === 'backend' ? 'frontend' : 'backend';
      // Disabled entries must never trigger cwd/runtime/command validation.
      fs.writeFileSync(configPath, JSON.stringify({ schemaVersion: 1, [lane]: suite(lane),
        [other]: { enabled: false, command: null, cwd: 'does-not-exist' } }));
      const previous = collect('status').lanes[other]?.runId;
      const started = collect('start');
      assert.deepStrictEqual(started.workspace, { configStatus: 'ready', configuredLanes: [lane] });
      assert.strictEqual(started.lanes[other]?.runId, previous);
      await waitFor(lane, job => job?.status === 'running' && job.progressObserved);
      const claim = readJson(files(directory, lane).claim);
      fs.unlinkSync(configPath);
      assert(collect('logs', lane).lanes[lane].logTail.some(line => line.includes('PUBLIC FIXTURE')));
      assert.strictEqual(collect('status').workspace.configStatus, 'missing');
      collect('cancel', lane);
      await waitFor(lane, job => job?.status === 'cancelled');
      const deadline = Date.now() + 5000;
      while (sameProcess(claim.workerIdentity) && Date.now() < deadline) await sleep(50);
      assert(!sameProcess(claim.workerIdentity));
      assert(!sameProcess(claim.childIdentity));
      assert.strictEqual(groupState(claim.childIdentity), 'empty');
      assert(!fs.existsSync(files(directory, lane).lock));
    }
    fs.writeFileSync(configPath, JSON.stringify({ schemaVersion: 1, backend: false, frontend: null }));
    assert.deepStrictEqual(collect('status').workspace.configuredLanes, []);
    assert(collect('start', 'all', false).error.includes('Nenhuma suíte'));
    assert(collect('start', 'backend', false).error.includes('desativada'));
    fs.writeFileSync(configPath, '{"private-example": "synthetic-value", invalid');
    const invalid = collect('status');
    assert.strictEqual(invalid.workspace.configStatus, 'invalid');
    assert(!JSON.stringify(invalid.workspace).includes('synthetic-value'));
    assert(collect('start', 'all', false).error.includes('arquivo JSON'));
    collect('logs');
    collect('cancel');
    console.log('Workspace backend/frontend-only start, removed-config recovery and redacted errors: OK');
  } finally {
    collect('cancel');
    for (const lane of ['backend', 'frontend']) {
      await waitFor(lane, job => !job || !['preparing', 'running'].includes(job.status));
    }
    removePath(directory, { recursive: true, force: true });
    removePath(app, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
