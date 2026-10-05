import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn, spawnSync } from 'child_process';
import { namespace } from '../../runner/state.mjs';
import { randomUUID, removePath } from '../../runner/runtime.mjs';
const cli = fileURLToPath(new URL('../../runner/cli.mjs', import.meta.url));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function workspace() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-faults-'));
  const owner = randomUUID();
  const config = path.join(cwd, 'config.json');
  const suite = path.join(cwd, 'suite.mjs');
  fs.writeFileSync(suite, `import fs from 'fs';fs.writeFileSync(process.env.MARKER,'started');console.log('alive');setInterval(()=>{},1000);`);
  const modules = Object.fromEntries(['api', 'ui'].map(id => [id, { runtime: 'inherit', command: [process.execPath, suite], cwd: '.', adapter: 'events', env: { MARKER: path.join(cwd, id) } }]));
  fs.writeFileSync(config, JSON.stringify({ schemaVersion: 2, modules }));
  const context = namespace(cwd, owner);
  const args = (action, id = 'all') => [cli, action, '--cwd', cwd, '--owner', owner, '--module', id, '--config', config];
  const collect = (action, id = 'all', hooks = null) => {
    const result = spawnSync(process.execPath, args(action, id), { encoding: 'utf8', timeout: 50000,
      env: { ...process.env, ...(hooks ? { TEST_PROGRESS_INTERNAL_TEST_HOOKS: JSON.stringify(hooks) } : {}) } });
    assert(!result.error, result.error?.message);
    return JSON.parse(result.stdout);
  };
  const launch = hooks => {
    const child = spawn(process.execPath, args('start'), { env: { ...process.env, TEST_PROGRESS_INTERNAL_TEST_HOOKS: JSON.stringify(hooks) }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    return new Promise((resolve, reject) => { child.on('error', reject); child.on('close', () => resolve(JSON.parse(output))); });
  };
  const waitFor = async predicate => {
    const deadline = Date.now() + 18000;
    while (Date.now() < deadline) { const state = collect('status'); if (predicate(state)) return state; await delay(75); }
    throw new Error('fault handling timed out');
  };
  const cleanup = async () => { try { collect('cancel'); } catch {} await delay(500); removePath(context.directory, { recursive: true, force: true }); removePath(cwd, { recursive: true, force: true }); };
  return { cwd, config, collect, launch, waitFor, cleanup };
}
async function main() {
  let w = workspace();
  try {
    const launching = w.launch({ ui: { readyDelayMs: 800 } });
    await delay(250);
    fs.appendFileSync(w.config, ' ');
    assert.strictEqual((await launching).ok, false);
    assert(!fs.existsSync(path.join(w.cwd, 'api')) && !fs.existsSync(path.join(w.cwd, 'ui')), 'source change before release must execute zero commands');
  } finally { await w.cleanup(); }
  w = workspace();
  try {
    assert.strictEqual(w.collect('start', 'all', { api: { dieAfterAck: true } }).ok, true);
    await w.waitFor(state => state.jobs.api.status === 'cancelled' && state.jobs.ui.status === 'cancelled');
  } finally { await w.cleanup(); }
  w = workspace();
  try {
    assert.strictEqual(w.collect('start', 'all', { api: { ackDelayMs: 11000 } }).ok, true);
    await w.waitFor(state => state.jobs.api.status === 'cancelled' && state.jobs.ui.status === 'cancelled');
  } finally { await w.cleanup(); }
  w = workspace();
  try {
    assert.strictEqual(w.collect('start', 'all', { ui: { readyDelayMs: 31000 } }).ok, false);
    assert(!fs.existsSync(path.join(w.cwd, 'api')) && !fs.existsSync(path.join(w.cwd, 'ui')), 'preparation timeout must execute zero commands');
  } finally { await w.cleanup(); }
  console.log('module batch source revalidation, hard worker loss after ack, ack deadline and preparation deadline: OK');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
