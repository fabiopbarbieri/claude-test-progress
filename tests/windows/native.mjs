import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { namespace, files, readJson, jobFile } from '../../runner/state.mjs';
import { windowsProof } from '../../runner/windows-proof.mjs';
import { windowsGroupState, windowsIdentity, windowsKillOwnedBroker } from '../../runner/windows-process.mjs';
import { randomUUID, removePath } from '../../runner/runtime.mjs';

assert.strictEqual(process.platform, 'win32', 'Native Windows APIs must actually execute');
const root = fileURLToPath(new URL('../../', import.meta.url));
const engine = process.env.TEST_PROGRESS_POWERSHELL;
const projectNode = process.env.TEST_PROGRESS_PROJECT_NODE;
assert(path.isAbsolute(engine) && path.isAbsolute(projectNode));
const app = fs.mkdtempSync(path.join(os.tmpdir(), 'test progress Windows '));
const owner = `windows-gate-${randomUUID()}`;
const context = namespace(app, owner);
const config = path.join(app, 'modules.json');
const suite = path.join(app, 'tree with spaces.mjs');
const capturedTrees = [];
const parentPath = process.env.PATH;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
fs.writeFileSync(suite, `import fs from 'fs';
import {spawn} from 'child_process';
const role=process.argv[2]||'parent';
fs.writeFileSync(process.env.MARKER+'.'+role+'.pid',String(process.pid));
if(role!=='grandchild') spawn(process.execPath,[process.argv[1],role==='parent'?'child':'grandchild'],{stdio:'ignore'});
if(role==='parent') {
  fs.writeFileSync(process.env.MARKER+'.runtime',process.version);
  fs.writeFileSync(process.env.MARKER+'.argv',JSON.stringify(process.argv.slice(3)));
  console.log('@@TEST_PROGRESS@@'+JSON.stringify({scope:'native-tree',total:2,resolved:1,passed:1,failed:0,skipped:0,totalStable:false}));
}
setInterval(()=>{},250);
`);
function module(id, extra = {}) {
  return { label: id, command: [process.execPath, suite, 'parent', 'literal space', 'quote"value', 'trailing\\'],
    cwd: '.', adapter: 'events', runtime: 'inherit', env: { MARKER: path.join(app, id) }, ...extra };
}
function configure(modules) { fs.writeFileSync(config, JSON.stringify({ schemaVersion: 2, modules })); }
function shell(args, env = process.env) {
  const result = spawnSync(engine, ['-NoLogo', '-NoProfile', '-NonInteractive', ...args],
    { cwd: app, env, encoding: 'utf8', timeout: 65000, windowsHide: true });
  assert(!result.error, result.error && result.error.message);
  return result;
}
function collect(action, target = 'all', env = process.env) {
  const result = shell(['-File', path.join(root, 'scripts/run-collector.ps1'), '-Action', action,
    '-Cwd', app, '-Owner', owner, '-Module', target, '-Config', config], env);
  const value = JSON.parse(result.stdout.replace(/^\uFEFF/, '').trim());
  assert.strictEqual(value.schemaVersion, 2);
  assert(!('lanes' in value) && !('schema' in value));
  assert.strictEqual(result.status, value.ok ? 0 : 1);
  return value;
}
async function waitFor(predicate, timeout = 45000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    last = collect('status');
    if (predicate(last)) return last;
    if (Object.values(last.jobs).some(job => job.status === 'error')) break;
    await sleep(100);
  }
  const diagnostics = Object.keys(last.jobs).map(id => {
    const job = last.jobs[id];
    const logs = collect('logs', id);
    return { id, status: job.status, phase: job.phase, error: job.error,
      exitCode: job.exitCode, log: logs.jobs[id]?.logTail };
  });
  const detail = JSON.stringify(diagnostics).split(app).join('<fixture>').split(context.directory).join('<private-state>');
  throw new Error(`Native Windows did not reach the expected state: ${detail}`);
}
function captureTree(id, job) {
  const proof = windowsProof(jobFile(context.directory, id, job.runId), job.runId, job.pid);
  assert(proof && proof.contained === true && proof.resumed === true, 'Command acknowledged only after contained and resumed proof');
  assert.strictEqual(windowsGroupState(proof.brokerIdentity), 'present');
  capturedTrees.push(proof.brokerIdentity);
  return proof;
}
function assertEmpty(identity) { assert.strictEqual(windowsGroupState(identity), 'empty', 'Named Job Object must prove tree empty'); }
function assertPidsGone(id) {
  for (const role of ['parent', 'child', 'grandchild']) {
    const pid = Number(fs.readFileSync(path.join(app, `${id}.${role}.pid`), 'utf8'));
    assert.strictEqual(windowsIdentity(pid), null, `${role} survived cancellation`);
  }
}
function assertPrivateCreation() {
  const control = path.join(root, 'runtime/windows-process.ps1');
  const secure = directory => shell(['-File', control, '-Action', 'SecureDirectory', '-Directory', directory]);
  const describe = directory => shell(['-Command', '$acl=Get-Acl -LiteralPath $env:TEST_PROGRESS_GATE_DIRECTORY; ' +
    '$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value; ' +
    '@{sddl=$acl.Sddl; owner=$acl.GetOwner([Security.Principal.SecurityIdentifier]).Value; user=$sid} | ConvertTo-Json -Compress'],
    { ...process.env, TEST_PROGRESS_GATE_DIRECTORY: directory });
  const fresh = path.join(app, 'private creation');
  assert.strictEqual(secure(fresh).status, 0, 'First creation must assign the token user as owner');
  const created = JSON.parse(describe(fresh).stdout.trim());
  assert.strictEqual(created.owner, created.user);
  assert.strictEqual(secure(fresh).status, 0, 'Existing private directory must remain usable');
  assert.strictEqual(JSON.parse(describe(fresh).stdout.trim()).sddl, created.sddl, 'Reopening must not rewrite ACLs');

  const insecure = path.join(app, 'untrusted existing');
  fs.mkdirSync(insecure);
  const before = JSON.parse(describe(insecure).stdout.trim());
  assert.notStrictEqual(secure(insecure).status, 0, 'Existing inherited ACL or foreign owner must be rejected');
  assert.strictEqual(JSON.parse(describe(insecure).stdout.trim()).sddl, before.sddl, 'Rejected state must not be adopted');

  const target = path.join(app, 'junction target');
  const link = path.join(app, 'junction link');
  fs.mkdirSync(target);
  fs.symlinkSync(target, link, 'junction');
  assert.notStrictEqual(secure(link).status, 0, 'A junction leaf must be rejected');
  assert.notStrictEqual(secure(path.join(link, 'new state')).status, 0, 'A junction ancestor must be rejected before creation');
  assert(!fs.existsSync(path.join(target, 'new state')), 'Rejected ancestor must have zero effects outside the namespace');
  console.log('Atomic user-owned private creation, unchanged existing/rejected ACLs and junction rejection: OK');
}
async function main() {
  let safeToRemove = false;
  try {
    assertPrivateCreation();
    // The selected command is independent of other malformed registrations.
    configure({ api: module('api'), broken: module('broken', { command: ['missing-gate-executable.exe'] }) });
    assert.strictEqual(collect('start').ok, false);
    assert(!fs.existsSync(path.join(app, 'api.parent.pid')), 'Invalid all must have zero command effects');
    assert.strictEqual(collect('start', 'api').ok, true);
    let state = await waitFor(value => value.jobs.api && value.jobs.api.resolved === 1 &&
      fs.existsSync(path.join(app, 'api.grandchild.pid')));
    const firstProof = captureTree('api', state.jobs.api);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(app, 'api.argv'), 'utf8')),
      ['literal space', 'quote"value', 'trailing\\']);
    const acl = shell(['-Command', '$acl=Get-Acl -LiteralPath $env:TEST_PROGRESS_GATE_STATE; ' +
      '$owner=$acl.GetOwner([Security.Principal.SecurityIdentifier]).Value; $rules=@($acl.Access | ForEach-Object { $_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value }); ' +
      '$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value; ' +
      'if($owner -ne $sid -or -not $acl.AreAccessRulesProtected -or @($rules|Where-Object { $_ -ne $sid -and $_ -ne "S-1-5-18" }).Count -ne 0) { exit 1 }; "private-dacl"'],
      { ...process.env, TEST_PROGRESS_GATE_STATE: context.directory });
    assert.strictEqual(acl.status, 0, 'State DACL must be private and inheritance disabled');
    fs.unlinkSync(config);
    assert.strictEqual(collect('logs', 'api').ok, true);
    assert.strictEqual(collect('cancel', 'api').ok, true);
    await waitFor(value => value.jobs.api.status === 'cancelled' && !fs.existsSync(files(context.directory, 'api').lock));
    assertEmpty(firstProof.brokerIdentity);
    assertPidsGone('api');
    console.log('Wrapper, spaces, literal argv, selected preflight, DACL, parent/child/grandchild cancellation and removed config: OK');

    // Two IDs use the same language/runtime but keep independent run identities.
    configure({ api: module('api'), billing: module('billing') });
    assert.strictEqual(collect('start').ok, true);
    state = await waitFor(value => value.jobs.api.resolved === 1 && value.jobs.billing.resolved === 1 &&
      fs.existsSync(path.join(app, 'billing.grandchild.pid')));
    assert.notStrictEqual(state.jobs.api.runId, state.jobs.billing.runId);
    const apiProof = captureTree('api', state.jobs.api);
    const billingProof = captureTree('billing', state.jobs.billing);
    assert.strictEqual(collect('cancel', 'api').ok, true);
    await waitFor(value => value.jobs.api.status === 'cancelled');
    assert.strictEqual(collect('status').jobs.billing.status, 'running');
    assertEmpty(apiProof.brokerIdentity);
    assert.strictEqual(collect('cancel', 'billing').ok, true);
    await waitFor(value => value.jobs.billing.status === 'cancelled');
    assertEmpty(billingProof.brokerIdentity);
    assertPidsGone('billing');
    console.log('All barrier and independent module cancellation: OK');

    for (const invalid of [ { con: module('con') }, { api: module('api', { env: { PATH: 'a', Path: 'b' } }) } ]) {
      configure(invalid);
      assert.strictEqual(collect('start').ok, false);
    }
    for (const option of ['-Lane', '-Unknown']) {
      const rejected = shell(['-File', path.join(root, 'scripts/run-collector.ps1'), '-Action', 'start',
        '-Cwd', app, '-Owner', owner, option, 'api']);
      assert.notStrictEqual(rejected.status, 0, 'Legacy or unknown wrapper option accepted');
    }
    const rejected = spawnSync(process.execPath, [path.join(root, 'runner/cli.mjs'), 'start',
      '--cwd', app, '--owner', owner, '--lane', 'api'], { encoding: 'utf8' });
    assert.strictEqual(rejected.status, 1);
    console.log('Reserved IDs, case-insensitive environment collisions and removed lane options: OK');

    // A real batch command accepts a simple literal argument; shell control is rejected before reservation.
    const batch = path.join(app, 'safe command.cmd');
    const batchSuite = path.join(app, 'batch events.mjs');
    fs.writeFileSync(batchSuite, "console.log('@@TEST_PROGRESS@@'+JSON.stringify({scope:'native-batch',total:1,resolved:1,passed:1,failed:0,skipped:0,totalStable:true}));\n");
    fs.writeFileSync(batch, `@echo off\r\necho %~1> "batch-result.txt"\r\n"${process.execPath}" "${batchSuite}"\r\nexit /b 0\r\n`);
    configure({ batch: module('batch', { command: [batch, 'simple value'], adapter: 'events' }) });
    assert.strictEqual(collect('start', 'batch').ok, true);
    await waitFor(value => value.jobs.batch && value.jobs.batch.status === 'completed');
    assert.strictEqual(fs.readFileSync(path.join(app, 'batch-result.txt'), 'utf8').trim(), 'simple value');
    configure({ batch: module('batch', { command: [batch, 'value&unexpected'], adapter: 'events' }) });
    assert.strictEqual(collect('start', 'batch').ok, false);
    console.log('Native cmd literal quoting and preflight rejection of shell controls: OK');

    const appVersion = spawnSync(projectNode, ['--version'], { encoding: 'utf8' }).stdout.trim();
    assert.notStrictEqual(appVersion, process.version, 'App and collector must use different Node versions');
    fs.writeFileSync(path.join(app, '.nvmrc'), appVersion + '\n');
    const runtimeEnv = { ...process.env };
    const pathKey = Object.keys(runtimeEnv).find(key => key.toUpperCase() === 'PATH');
    runtimeEnv[pathKey] = path.dirname(projectNode) + ';' + runtimeEnv[pathKey];
    configure({ web: module('web', { command: ['node', suite, 'parent'], runtime: 'node-project' }) });
    assert.strictEqual(collect('start', 'web', runtimeEnv).ok, true);
    state = await waitFor(value => value.jobs.web && value.jobs.web.resolved === 1 &&
      fs.existsSync(path.join(app, 'web.grandchild.pid')));
    const webProof = captureTree('web', state.jobs.web);
    assert.strictEqual(fs.readFileSync(path.join(app, 'web.runtime'), 'utf8'), appVersion);
    assert.strictEqual(state.jobs.web.collectorRuntime.version, process.version);
    assert.strictEqual(process.env.PATH, parentPath, 'Parent PATH changed');
    assert.strictEqual(collect('cancel', 'web').ok, true);
    await waitFor(value => value.jobs.web.status === 'cancelled');
    assertEmpty(webProof.brokerIdentity);
    assertPidsGone('web');
    console.log(`Independent app ${appVersion} / collector ${process.version} runtimes and unchanged parent PATH: OK`);

    // Kill only an authenticated broker belonging to this gate; its Job Object closes the entire tree.
    fs.unlinkSync(path.join(app, '.nvmrc'));
    configure({ api: module('api'), billing: module('billing') });
    assert.strictEqual(collect('start').ok, true);
    state = await waitFor(value => value.jobs.api.resolved === 1 && value.jobs.billing.resolved === 1);
    const lostBroker = captureTree('api', state.jobs.api);
    const compensated = captureTree('billing', state.jobs.billing);
    windowsKillOwnedBroker(lostBroker.brokerIdentity);
    await waitFor(value => value.jobs.api.infrastructureFailure === true && value.jobs.billing.status === 'cancelled');
    assertEmpty(lostBroker.brokerIdentity);
    assertEmpty(compensated.brokerIdentity);
    console.log('Authenticated broker loss, Job Object tree cleanup and detached batch compensation: OK');
    safeToRemove = true;
  } finally {
    try { collect('cancel'); } catch { /* Preserve uncertain state for inspection. */ }
    if (safeToRemove) {
      for (const identity of capturedTrees) assertEmpty(identity);
      const state = collect('status');
      assert(!state.workspace.stateBlocked, 'Unexpected blocked state remains');
      for (const id of Object.keys(state.jobs)) assert(!fs.existsSync(files(context.directory, id).lock));
      removePath(context.directory, { recursive: true, force: true });
      removePath(app, { recursive: true, force: true });
    } else {
      console.error('Native gate failed; its private temporary namespace was retained for inspection.');
    }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
