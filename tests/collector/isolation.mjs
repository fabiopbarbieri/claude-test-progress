// Node-only public CLI with optional tools absent and no product demo.
import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {spawnSync} from 'child_process';
import {fileURLToPath} from 'url';
import {namespace} from '../../runner/state.mjs';
import {randomUUID,removePath} from '../../runner/runtime.mjs';
if (process.platform !== 'linux') {console.log('SKIP: empty-PATH isolation requires Linux');process.exit(0);}
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const app=fs.mkdtempSync(path.join(os.tmpdir(),'test-progress-isolation-'));
const owner=randomUUID(),directory=namespace(app,owner).directory;
const emptyPath=path.join(app,'empty-bin');fs.mkdirSync(emptyPath);
fs.mkdirSync(path.join(app,'.claude'));
const config=path.join(app,'.claude/test-progress.json');
const env={PATH:emptyPath,HOME:app,TMPDIR:os.tmpdir(),LANG:'C.UTF-8'};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let jobs={};
function collect(action,moduleId='all',ok=true) {
  const reply=spawnSync(process.execPath,[path.join(root,'runner/cli.mjs'),action,
    '--cwd',app,'--owner',owner,'--module',moduleId],{env,encoding:'utf8',timeout:60000});
  const data=JSON.parse(reply.stdout);assert.strictEqual(data.schemaVersion,2);
  assert.strictEqual(data.ok,ok,data.error);assert(!Object.prototype.hasOwnProperty.call(data,'lanes'));
  jobs=data.jobs;return data;
}
async function finished(moduleId) {
  const deadline=Date.now()+15000;
  let state;
  do {state=collect('status');if(jobs[moduleId]&&!['preparing','running'].includes(jobs[moduleId].status))return jobs[moduleId];await sleep(80);}while(Date.now()<deadline);
  throw new Error(`Fixture ${moduleId} timed out: ${JSON.stringify(state)}`);
}
const fixture=mode=>({command:[process.execPath,path.join(root,'tests/collector/fixtures/events-suite.mjs'),mode],adapter:'events'});
async function main() {
  try {
    for(const tool of ['python','python3','ruby','bundle','java','mvn','karma','rails','git'])
      assert.strictEqual(spawnSync(tool,['--version'],{env,timeout:1000}).error?.code,'ENOENT');
    assert.strictEqual(Object.keys(collect('status').modules).length,0);
    fs.writeFileSync(config,JSON.stringify({schemaVersion:2,modules:{api:fixture('fail'),billing:fixture('pass')}}));
    collect('start');const api=await finished('api'),billing=await finished('billing');
    assert.strictEqual(api.status,'failed');assert.strictEqual(api.failed,1);assert.strictEqual(api.resolved,2);
    assert.strictEqual(billing.status,'completed');assert.strictEqual(billing.exitCode,0);
    assert.notStrictEqual(api.runId,billing.runId);
    console.log('Node-only configured modules with optional tools absent: OK');
    fs.writeFileSync(config,JSON.stringify({schemaVersion:2,modules:{
      api:{command:['python3','synthetic.py'],adapter:'events'},web:{command:null,cwd:'missing-project'}}}));
    collect('start','api',false);
    assert.strictEqual(jobs.api.runId,api.runId,'preflight cannot replace a previous job');
    assert.strictEqual(jobs.billing.runId,billing.runId);
    assert(!fs.existsSync(path.join(directory,'api.lock')));assert(!fs.existsSync(path.join(directory,'web.lock')));
    console.log('Missing selected executable fails before reservation; other module untouched: OK');
    collect('demo','all',false);
  } finally {
    collect('cancel');await finished('api');await finished('billing');
    removePath(directory,{recursive:true,force:true});removePath(app,{recursive:true,force:true});
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
