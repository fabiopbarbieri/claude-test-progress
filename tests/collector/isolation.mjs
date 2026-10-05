// Linux integration: the collector and both demo lanes see an empty PATH.
// No optional interpreter, framework, build tool, or Git can be discovered.
import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { namespace } from '../../runner/state.mjs';
import { randomUUID, removePath } from '../../runner/runtime.mjs';

if (process.platform !== 'linux') {
  console.log('SKIP: empty-PATH integration requires Linux process identity');
  process.exit(0);
}
const root = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const app = fs.mkdtempSync(path.join(os.tmpdir(), 'test-progress-isolation-'));
const owner = randomUUID();
const directory = namespace(app, owner).directory;
const emptyPath = path.join(app, 'empty-bin');
fs.mkdirSync(emptyPath);
const env = { PATH: emptyPath, HOME: app, TMPDIR: os.tmpdir(), LANG: 'C.UTF-8' };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let lanes = {};
function collect(action, lane = 'all', ok = true) {
  const reply = spawnSync(process.execPath, [path.join(root, 'runner/cli.mjs'), action,
    '--cwd', app, '--owner', owner, '--lane', lane], {env,encoding:'utf8',timeout:5000});
  const data = JSON.parse(reply.stdout);
  assert.strictEqual(data.ok, ok, data.error);
  lanes = data.lanes;
  return data;
}
async function finished(lane) {
  const deadline = Date.now() + 15000;
  do {
    collect('status');
    if (!['preparing','running'].includes(lanes[lane]?.status)) return lanes[lane];
    await sleep(80);
  } while (Date.now() < deadline);
  throw new Error('Fixture timed out');
}
async function main() {
  try {
    for (const tool of ['python', 'python3', 'ruby', 'bundle', 'java', 'mvn', 'karma', 'rails', 'git']) {
      assert.strictEqual(spawnSync(tool, ['--version'], {env,timeout:1000}).error?.code, 'ENOENT');
    }
    collect('status');
    assert.strictEqual(lanes.backend, null);
    collect('demo');
    const backend = await finished('backend');
    const frontend = await finished('frontend');
    assert.strictEqual(backend.status, 'failed');
    assert.strictEqual(backend.resolved, 8);
    assert.strictEqual(backend.failed, 1);
    assert.strictEqual(frontend.status, 'completed');
    assert.strictEqual(frontend.resolved, 12);
    assert.strictEqual(frontend.skipped, 1);
    assert.strictEqual(frontend.exitCode, 0);
    console.log('Node-only core and two demo lanes with optional tools absent: OK');

    fs.mkdirSync(path.join(app, '.claude'));
    // An invalid unselected frontend must not be validated for a backend command.
    fs.writeFileSync(path.join(app, '.claude/test-progress.json'), JSON.stringify({schemaVersion:1,
      backend:{command:['python3','synthetic.py'],cwd:'.',adapter:'events'},
      frontend:{command:null,cwd:'missing-project'}}));
    collect('start', 'backend');
    const missing = await finished('backend');
    assert.strictEqual(missing.status, 'error');
    assert(missing.error.includes('python3') && missing.error.includes('ENOENT'));
    assert.strictEqual(missing.resolved, 0);
    assert.strictEqual(missing.total, null);
    assert.strictEqual(lanes.frontend.runId, frontend.runId);
    assert(!fs.existsSync(path.join(directory, 'backend.lock')));
    console.log('Selected missing command names python3/ENOENT; unselected lane untouched: OK');
  } finally {
    collect('cancel');
    await finished('backend');
    await finished('frontend');
    removePath(directory, {recursive:true,force:true});
    removePath(app, {recursive:true,force:true});
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
