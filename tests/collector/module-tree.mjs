import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import { namespace, files, readJson } from '../../runner/state.mjs';
import { processIdentity, sameProcess, groupState } from '../../runner/process-identity.mjs';
import { randomUUID, removePath } from '../../runner/runtime.mjs';
if (process.platform !== 'linux') { console.log('SKIP: real orphan process-group test requires Linux'); process.exit(0); }
const cli = fileURLToPath(new URL('../../runner/cli.mjs', import.meta.url));
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'module-tree-'));
const owner = randomUUID();
const context = namespace(cwd, owner);
const config = path.join(cwd, 'config.json');
const suite = path.join(cwd, 'suite.mjs');
const pidFile = path.join(cwd, 'descendant.json');
fs.writeFileSync(suite, `import fs from 'fs';import {spawn} from 'child_process';
if (process.env.ORPHAN === '1') {
 const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
 fs.writeFileSync(${JSON.stringify(pidFile)},JSON.stringify({pid:child.pid}));child.unref();setTimeout(()=>process.exit(0),250);
} else setInterval(()=>{},1000);
`);
fs.writeFileSync(config, JSON.stringify({ schemaVersion: 1, modules: {
  api: { runtime: 'inherit', command: [process.execPath, suite], cwd: '.', adapter: 'events', env: { ORPHAN: '1' } },
  ui: { runtime: 'inherit', command: [process.execPath, suite], cwd: '.', adapter: 'events', env: {} }
} }));
function collect(action, target = 'all') {
  const result = spawnSync(process.execPath, [cli, action, '--cwd', cwd, '--owner', owner, '--module', target, '--config', config], { encoding: 'utf8', timeout: 18000 });
  assert(!result.error, result.error?.message);
  return JSON.parse(result.stdout);
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function main() {
  let descendant;
  let identity;
  try {
    assert.strictEqual(collect('start').ok, true);
    const deadline = Date.now() + 6000;
    let state;
    while (Date.now() < deadline) {
      state = collect('status');
      if (state.jobs.api?.recoveryRequired && state.jobs.ui?.status === 'cancelled') break;
      await pause(75);
    }
    assert.strictEqual(state.jobs.api.recoveryRequired, true);
    assert.strictEqual(state.jobs.ui.status, 'cancelled');
    assert(state.stateDiagnostics.api.length);
    assert(fs.existsSync(files(context.directory, 'api').lock), 'leader close cannot release a nonempty process group');
    const claim = readJson(files(context.directory, 'api').claim);
    assert.strictEqual(groupState(claim.childIdentity), 'present');
    descendant = JSON.parse(fs.readFileSync(pidFile, 'utf8')).pid;
    identity = processIdentity(descendant);
    assert.strictEqual(collect('start', 'api').ok, false);
    assert.strictEqual(collect('cancel', 'api').ok, false, 'dead leader cannot authorize orphan group signalling');
    assert(sameProcess(identity), 'unproven orphan must not be signalled');
    process.kill(descendant, 'SIGKILL');
    await pause(250);
    // The supervisor observes the independently emptied group and releases only its bound run.
    const cleanedBy = Date.now() + 12000;
    while (fs.existsSync(files(context.directory, 'api').lock) && Date.now() < cleanedBy) { collect('status'); await pause(75); }
    assert(!fs.existsSync(files(context.directory, 'api').lock));
    assert.strictEqual(groupState(claim.childIdentity), 'empty');
    console.log('real descendant tree retained after leader close; authenticated sibling compensation and proven-empty cleanup: OK');
  } finally {
    if (identity && sameProcess(identity)) process.kill(descendant, 'SIGKILL');
    try { collect('cancel'); } catch {}
    await pause(300);
    removePath(context.directory, { recursive: true, force: true });
    removePath(cwd, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
