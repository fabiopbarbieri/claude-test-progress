import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn, spawnSync } from 'child_process';
import { namespace, files, readJson, atomicJson } from '../../runner/state.mjs';
import { randomUUID, removePath } from '../../runner/runtime.mjs';
const cli = fileURLToPath(new URL('../../runner/cli.mjs', import.meta.url));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function atomicHeartbeatStress() {
  if (process.platform !== 'linux') { console.log('SKIP: accelerated real 12-module process stress requires Linux'); return; }
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-heartbeats-'));
  const owner = randomUUID();
  const context = namespace(cwd, owner);
  const config = path.join(cwd, 'config.json');
  const suite = path.join(cwd, 'silent.mjs');
  fs.writeFileSync(suite, 'setInterval(()=>{},1000);');
  const ids = Array.from({ length: 12 }, (_, index) => `worker${String(index + 1).padStart(2, '0')}`);
  fs.writeFileSync(config, JSON.stringify({ schemaVersion: 2, modules: Object.fromEntries(ids.map(id => [id, {
    runtime: 'inherit', command: [process.execPath, suite], cwd: '.', adapter: 'events', env: {}
  }])) }));
  function collect(action) {
    const result = spawnSync(process.execPath, [cli, action, '--cwd', cwd, '--owner', owner, '--module', 'all', '--config', config],
      { encoding: 'utf8', timeout: 20000 });
    assert(!result.error, result.error?.message);
    const value = JSON.parse(result.stdout);
    assert.strictEqual(value.ok, true, value.error);
    return value;
  }
  let writer;
  let writerResult;
  const duration = Number(process.env.TEST_PROGRESS_RACE_STRESS_MS || 12000);
  assert(Number.isFinite(duration) && duration >= 10000 && duration <= 180000);
  try {
    const started = collect('start');
    const batchId = started.actionResults[ids[0]].batchId;
    const runIds = Object.fromEntries(ids.map(id => [id, started.actionResults[id].runId]));
    const manifestPath = path.join(context.directory, `batch.${batchId}.json`);
    const stateModule = new URL('../../runner/state.mjs', import.meta.url).href;
    const runningBy = Date.now() + 8000;
    while (true) {
      const ready = collect('status');
      if (ids.every(id => ready.jobs[id]?.status === 'running')) break;
      assert(Date.now() < runningBy, 'all prepared silent workers must enter running before stress');
      await pause(40);
    }
    const writerCode = `import {files,readJson,atomicJson,timestamp} from ${JSON.stringify(stateModule)};
      const directory=${JSON.stringify(context.directory)}, runIds=${JSON.stringify(runIds)};
      let updates=0;
      const timer=setInterval(()=>{for(const [id,runId] of Object.entries(runIds)){
        const file=files(directory,id).snapshot, value=readJson(file);
        if(value?.runId===runId&&value.status==='running') {atomicJson(file,{...value,heartbeatAt:timestamp()});updates++;}
      }},25);
      function stop(){clearInterval(timer);console.log(updates);}
      process.once('SIGTERM',stop);process.once('SIGINT',stop);`;
    writer = spawn(process.execPath, ['--input-type=module', '-e', writerCode], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', errors = '';
    writer.stdout.on('data', chunk => { output += chunk; });
    writer.stderr.on('data', chunk => { errors += chunk; });
    writerResult = new Promise(resolve => writer.once('close', code => resolve({ code, output, errors })));
    const deadline = Date.now() + duration;
    let polls = 0;
    while (Date.now() < deadline) {
      const state = collect('status');
      for (const id of ids) {
        assert.strictEqual(state.jobs[id]?.status, 'running', `atomic updates must not cancel silent ${id}`);
        assert.strictEqual(state.jobs[id].runId, runIds[id]);
        assert(!state.jobs[id].cancellationRequestedAt);
      }
      const manifest = readJson(manifestPath);
      assert(!manifest.compensationReason && !manifest.compensationAt, 'normal atomic heartbeat replacements cannot request compensation');
      polls++;
      await pause(40);
    }
    writer.kill('SIGTERM');
    const result = await writerResult;
    writer = null;
    assert.strictEqual(result.code, 0, result.errors);
    assert(Number(result.output.trim()) > 1000, 'stress must exercise many actual atomic replacements');
    assert(polls > 20);
    collect('cancel');
    const cleanedBy = Date.now() + 12000;
    while (Date.now() < cleanedBy && ids.some(id => fs.existsSync(files(context.directory, id).lock))) { collect('status'); await pause(50); }
    assert(ids.every(id => !fs.existsSync(files(context.directory, id).lock)), 'all 12 owned locks must be safely released after explicit cancel');
    console.log(`12 silent modules, ${polls} status polls and ${Number(result.output.trim())} atomic heartbeat updates without compensation (${duration}ms): OK`);
  } finally {
    if (writer) { writer.kill('SIGTERM'); await writerResult; }
    try { collect('cancel'); } catch {}
    await pause(400);
    removePath(context.directory, { recursive: true, force: true });
    removePath(cwd, { recursive: true, force: true });
  }
}
async function main() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-races-'));
  const owner = randomUUID();
  const context = namespace(cwd, owner);
  const config = path.join(cwd, 'config.json');
  const suite = path.join(cwd, 'suite.mjs');
  fs.writeFileSync(suite, `import fs from 'fs';fs.writeFileSync(process.env.MARKER,'started');setInterval(()=>{},1000);`);
  const modules = Object.fromEntries(['api', 'ui'].map(id => [id, { runtime: 'inherit', command: [process.execPath, suite], cwd: '.', adapter: 'events', env: { MARKER: path.join(cwd, id) } }]));
  fs.writeFileSync(config, JSON.stringify({ schemaVersion: 2, modules }));
  const args = action => [cli, action, '--cwd', cwd, '--owner', owner, '--module', 'all', '--config', config];
  function launch(hooks) {
    const child = spawn(process.execPath, args('start'), { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, TEST_PROGRESS_INTERNAL_TEST_HOOKS: JSON.stringify(hooks || {}) } });
    let out = '';
    child.stdout.on('data', chunk => { out += chunk; });
    return new Promise((resolve, reject) => { child.on('error', reject); child.on('close', () => resolve(JSON.parse(out))); });
  }
  try {
    const readyGateFile = path.join(cwd, 'release-preparation');
    const launching = launch({ ui: { readyGateFile } });
    const deadline = Date.now() + 5000;
    while (!readJson(files(context.directory, 'api').claim)?.readyAt && Date.now() < deadline) await pause(25);
    assert(readJson(files(context.directory, 'api').claim)?.readyAt, 'api must be ready while ui is held before injecting ownership replacement');
    const original = readJson(files(context.directory, 'api').snapshot);
    const replaced = { ...original, runId: randomUUID() };
    atomicJson(files(context.directory, 'api').snapshot, replaced);
    fs.writeFileSync(readyGateFile, 'release');
    const result = await launching;
    assert.strictEqual(result.ok, false, 'snapshot ownership changed during preparation must abort');
    assert(!fs.existsSync(path.join(cwd, 'api')) && !fs.existsSync(path.join(cwd, 'ui')), 'ownership failure before release must execute zero commands');
    assert.strictEqual(readJson(files(context.directory, 'api').snapshot).runId, replaced.runId, 'foreign run snapshot must be preserved');
    console.log('module batch run ownership revalidated before release: OK');
  } finally {
    spawnSync(process.execPath, args('cancel'), { encoding: 'utf8', timeout: 15000 });
    await pause(500);
    removePath(context.directory, { recursive: true, force: true });
    removePath(cwd, { recursive: true, force: true });
  }
}
main().then(atomicHeartbeatStress).catch(error => { console.error(error); process.exitCode = 1; });
