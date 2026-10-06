import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import { namespace, files, readJson, atomicJson } from '../../runner/state.mjs';
import { randomUUID, removePath } from '../../runner/runtime.mjs';
const cli = fileURLToPath(new URL('../../runner/cli.mjs', import.meta.url));
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'module-batch-'));
const owner = randomUUID();
const context = namespace(cwd, owner);
const config = path.join(cwd, 'config.json');
const suite = path.join(cwd, 'suite.mjs');
fs.writeFileSync(suite, `import fs from 'fs';
fs.writeFileSync(process.env.MARKER, 'started');
console.log('@@TEST_PROGRESS@@'+JSON.stringify({scope:'suite',total:1,resolved:1,passed:1,failed:0,skipped:0,totalStable:true}));
if(process.env.FAIL==='1') process.exit(1);
setInterval(()=>{},1000);
`);
function descriptor(id, extra = {}) { return { label: id, runtime: 'inherit', command: [process.execPath, suite], cwd: '.', adapter: 'events',
  env: { MARKER: path.join(cwd, `${id}.marker`) }, ...extra }; }
function configure(modules) { fs.writeFileSync(config, JSON.stringify({ schemaVersion: 1, modules })); }
function collect(action, target = 'all', hooks = null) {
  const result = spawnSync(process.execPath, [cli, action, '--cwd', cwd, '--owner', owner, '--module', target, '--config', config],
    { encoding: 'utf8', timeout: 45000, env: { ...process.env, ...(hooks ? { TEST_PROGRESS_INTERNAL_TEST_HOOKS: JSON.stringify(hooks) } : {}) } });
  assert(!result.error, result.error?.message);
  return JSON.parse(result.stdout);
}
async function waitFor(predicate, ms = 12000) {
  const deadline = Date.now() + ms;
  let last;
  while (Date.now() < deadline) {
    const result = collect('status');
    last = result;
    if (predicate(result)) return result;
    await new Promise(resolve => setTimeout(resolve, 75));
  }
  throw new Error('Module batch behavior timed out: ' + JSON.stringify({
    jobs: Object.fromEntries(Object.entries(last?.jobs || {}).map(([id, job]) => [id, { status: job.status, phase: job.phase, error: job.error }])),
    diagnostics: last?.stateDiagnostics, error: last?.error }));
}
function settled(result, id, status = null) {
  const job = result.jobs[id];
  return Boolean(job && (status === null || job.status === status) && !result.stateDiagnostics[id]?.length &&
    !fs.existsSync(files(context.directory, id).lock) && !fs.existsSync(path.join(context.directory, `${id}.mutation`)));
}
async function main() {
  try {
    configure({ api: descriptor('api'), ui: descriptor('ui', { command: ['/definitely-missing-executable'] }) });
    assert.strictEqual(collect('start').ok, false);
    assert(!fs.existsSync(path.join(cwd, 'api.marker')), 'all preflight failure must execute zero commands');
    configure({ api: descriptor('api'), ui: descriptor('ui') });
    assert.strictEqual(collect('start', 'all', { ui: { readyFailure: true } }).ok, false);
    assert(!fs.existsSync(path.join(cwd, 'api.marker')), 'worker preparation failure must execute zero commands');
    assert(!fs.existsSync(path.join(cwd, 'ui.marker')));
    const started = collect('start');
    assert.strictEqual(started.schemaVersion, 1);
    assert.strictEqual(started.ok, true, started.error + ' ' + JSON.stringify(started.stateDiagnostics ?? collect('status').stateDiagnostics));
    await waitFor(() => fs.existsSync(path.join(cwd, 'api.marker')) && fs.existsSync(path.join(cwd, 'ui.marker')));
    assert.strictEqual(collect('cancel', 'api').ok, true);
    await waitFor(result => settled(result, 'api', 'cancelled'));
    assert.strictEqual(collect('status').jobs.ui.status, 'running', 'individual cancel after release must not cancel sibling');
    fs.unlinkSync(config);
    assert.strictEqual(collect('logs').ok, true, 'logs remains available when config removed');
    assert.strictEqual(collect('cancel', 'ui').ok, true);
    await waitFor(result => settled(result, 'ui', 'cancelled'));
    configure({ api: descriptor('api'), ui: descriptor('ui') });
    assert.strictEqual(collect('start', 'all', { api: { failAfterAckMs: 300 } }).ok, true);
    await waitFor(result => result.jobs.api?.infrastructureFailure && settled(result, 'api') && settled(result, 'ui', 'cancelled'));
    configure({ api: descriptor('api', { env: { MARKER: path.join(cwd, 'api.marker'), FAIL: '1' } }), ui: descriptor('ui') });
    assert.strictEqual(collect('start').ok, true);
    await waitFor(result => settled(result, 'api', 'failed'));
    assert.strictEqual(collect('status').jobs.ui.status, 'running', 'suite failure must not compensate sibling');
    assert.strictEqual(collect('start', 'api').ok, true, 'a finished module can restart while sibling remains active');
    await new Promise(resolve => setTimeout(resolve, 250));
    assert.strictEqual(collect('status').jobs.ui.status, 'running', 'old supervisor cannot compensate a safely finished run after its module restarts');
    atomicJson(files(context.directory, 'foreign').snapshot, { version: 'other', module: 'foreign', runId: 'old' });
    const rejected = collect('start', 'api');
    assert.strictEqual(rejected.ok, false);
    assert.strictEqual(rejected.workspace.stateBlocked, true);
    const cancelled = collect('cancel');
    assert.strictEqual(cancelled.ok, false, 'cancel all reports incompatible entry');
    assert.strictEqual(cancelled.actionResults.ui.ok, true, 'cancel all still processes healthy sibling');
    await waitFor(result => settled(result, 'ui', 'cancelled'));
    const shortcuts = spawnSync(process.execPath, [cli, 'demo', '--cwd', cwd, '--owner', owner], { encoding: 'utf8' });
    assert.strictEqual(shortcuts.status, 1);
    console.log('module batch real CLI: all preflight/ready zero effects, release, individual cancel, removed config, infrastructure compensation, normal failure isolation and incompatible-state blocking: OK');
  } finally {
    try { collect('cancel'); } catch { /* Retain failure evidence until teardown. */ }
    await new Promise(resolve => setTimeout(resolve, 400));
    removePath(context.directory, { recursive: true, force: true });
    removePath(cwd, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
