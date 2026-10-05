#!/usr/bin/env node
// Real detached collector + fresh Claude process per query; no model or API key.
import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import { randomUUID, removePath } from '../runner/runtime.mjs';
import { namespace } from '../runner/state.mjs';
import { sameProcess, processIdentity } from '../runner/process-identity.mjs';

assert.strictEqual(process.platform, 'linux', 'This controlled soak requires Linux process identity');
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sourceSha = spawnSync('git', ['rev-parse', 'HEAD'],
  {cwd:root,encoding:'utf8',timeout:2000}).stdout.trim();
const seconds = Number(process.argv[2] || 900);
assert(Number.isFinite(seconds) && seconds >= 10 && seconds <= 1800);
const app = fs.mkdtempSync(path.join(os.tmpdir(), 'test-progress-soak-'));
const owner = randomUUID();
const state = namespace(app, owner);
const environment = { ...process.env, CLAUDE_CONFIG_DIR: path.join(app, 'claude-config'),
  DISABLE_UPDATES: '1', DISABLE_AUTOUPDATER: '1' };
for (const key of Object.keys(environment)) {
  if (/^(ANTHROPIC_|CLAUDE_CODE_OAUTH|CLAUDE_CODE_USE_)/.test(key)) delete environment[key];
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let job;
const timings = [];
function query(action) {
  const started = Date.now();
  const result = spawnSync('claude', ['--plugin-dir', root, '--setting-sources', '',
    '--session-id', owner, '--no-session-persistence', '-p', `/test-progress ${action} --text`],
  { cwd: app, env: environment, encoding: 'utf8', timeout: 10000 });
  timings.push(Date.now() - started);
  assert.strictEqual(result.status, 0, 'Claude query must finish within 10s');
  assert(result.stdout.includes('Test Progress'), 'Mod command must answer without a model');
  assert(!result.stdout.includes('Erro:'), 'Mod query reported an error');
  return result.stdout;
}
function status() {
  const result = spawnSync(process.execPath, [path.join(root, 'runner/cli.mjs'), 'status',
    '--cwd', app, '--owner', owner, '--lane', 'backend'], { encoding: 'utf8', timeout: 5000 });
  assert.strictEqual(result.status, 0);
  const data = JSON.parse(result.stdout);
  assert(data.ok);
  job = data.lanes.backend;
  return job;
}
async function until(predicate) {
  const deadline = Date.now() + 12000;
  do { if (predicate(status())) return job; await sleep(100); } while (Date.now() < deadline);
  throw new Error('Fixture transition timed out');
}
async function main() {
  try {
    fs.mkdirSync(path.join(app, '.claude'));
    fs.writeFileSync(path.join(app, 'suite.mjs'), `import fs from 'fs';
  const event = n => console.log('@@TEST_PROGRESS@@' + JSON.stringify({scope:'soak',total:2,
  resolved:n,passed:n,failed:0,skipped:0,totalStable:true,final:n===2}));
  event(1);
  const timer=setInterval(()=>{if(fs.existsSync('release')){clearInterval(timer);event(2);}},100);
  `);
    fs.writeFileSync(path.join(app, '.claude/test-progress.json'), JSON.stringify({schemaVersion:1,
      backend:{command:[process.execPath,path.join(app,'suite.mjs')],cwd:'.',adapter:'events'}}));
    query('backend');
    const first = await until(value => value?.resolved === 1);
    const workerIdentity = processIdentity(first.workerPid);
    assert(workerIdentity, 'Fixture worker identity must be observed');
    const started = Date.now();
    const startedAt = new Date(started).toISOString();
    let lastHeartbeat = first.heartbeatAt;
    console.log(JSON.stringify({event:'started',seconds,startedAt,node:process.version}));
    while (Date.now() - started < seconds * 1000) {
      // Even the final interval must span a heartbeat; do not fail a healthy
      // worker merely because the remaining duration was less than five seconds.
      await sleep(Math.min(30000, Math.max(6000, seconds * 1000 - (Date.now() - started))));
      const text = query('status');
      const active = status();
      assert.strictEqual(active.runId, first.runId);
      assert.strictEqual(active.status, 'running');
      assert.strictEqual(active.resolved, 1);
      assert.strictEqual(active.lastOutputAt, first.lastOutputAt);
      assert.strictEqual(active.lastProgressAt, first.lastProgressAt);
      assert(active.heartbeatAt > lastHeartbeat);
      assert(active.heartbeatAgeMs < 6000);
      assert(text.includes(`runId=${first.runId}`) && text.includes('Em execução'));
      lastHeartbeat = active.heartbeatAt;
      console.log(JSON.stringify({event:'quiet-query',elapsedSeconds:Math.floor((Date.now()-started)/1000),
        heartbeatAgeMs:active.heartbeatAgeMs,queryMs:timings[timings.length-1]}));
    }
    fs.writeFileSync(path.join(app, 'release'), '');
    const final = await until(value => value.status === 'completed');
    assert.strictEqual(final.resolved, 2);
    assert.strictEqual(final.exitCode, 0);
    const persisted = query('status');
    assert(persisted.includes(`runId=${first.runId}`) && persisted.includes('Encerrado'));
    assert.strictEqual(status().elapsedMs, final.elapsedMs);
    await sleep(500);
    assert(!sameProcess(workerIdentity), 'Fixture worker must be gone');
    assert(!sameProcess(final.childIdentity), 'Fixture command must be gone');
    const claimPath = path.join(state.directory, 'backend.lock');
    assert(!fs.existsSync(claimPath), 'Fixture lock must be released');
    console.log(JSON.stringify({event:'completed',startedAt,endedAt:new Date().toISOString(),
      durationSeconds:(Date.now()-started)/1000,queries:timings.length,maxQueryMs:Math.max(...timings),
      node:process.version,claude:spawnSync('claude',['--version'],{encoding:'utf8',timeout:5000}).stdout.trim(),
      sha:sourceSha,
      status:final.status,resolved:final.resolved,exitCode:final.exitCode,lockReleased:true,workerGone:true,commandGone:true}));
  } finally {
    try {
      if (status() && (['running','preparing'].includes(job.status) || job.recoveryRequired)) {
        query('cancel backend');
        await until(value => !['running','preparing'].includes(value.status) && !value.recoveryRequired);
      }
      // Only this fixture's namespace, never another session's state.
      removePath(state.directory, {recursive:true,force:true});
      removePath(app, {recursive:true,force:true});
    } catch { console.error('Fixture cleanup needs inspection; state retained.'); process.exitCode = 1; }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
