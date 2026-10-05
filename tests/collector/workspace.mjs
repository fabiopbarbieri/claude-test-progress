// Configuration disappearance must not strand a v2 job or its ownership.
import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {spawnSync} from 'child_process';
import {fileURLToPath} from 'url';
import {namespace,readJson,files} from '../../runner/state.mjs';
import {sameProcess,groupState} from '../../runner/process-identity.mjs';
import {randomUUID,removePath} from '../../runner/runtime.mjs';
if(process.platform!=='linux'){console.log('SKIP: workspace cleanup requires Linux');process.exit(0);}
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const app=fs.mkdtempSync(path.join(os.tmpdir(),'test-progress-workspace-'));
const owner=randomUUID(),directory=namespace(app,owner).directory;
const configPath=path.join(app,'.claude/test-progress.json');fs.mkdirSync(path.dirname(configPath));
const suite={command:[process.execPath,path.join(root,'tests/collector/fixtures/events-suite.mjs'),'slow'],adapter:'events',language:'Python'};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function collect(action,moduleId='all',ok=true){
  const reply=spawnSync(process.execPath,[path.join(root,'runner/cli.mjs'),action,'--cwd',app,'--owner',owner,'--module',moduleId],{encoding:'utf8',timeout:60000});
  const data=JSON.parse(reply.stdout);assert.strictEqual(data.schemaVersion,2);assert.strictEqual(data.ok,ok,data.error);return data;
}
async function waitFor(moduleId,predicate){
  const deadline=Date.now()+12000;
  do{const job=collect('status').jobs[moduleId];if(predicate(job))return job;await sleep(80);}while(Date.now()<deadline);
  throw new Error('Workspace fixture timed out');
}
async function main(){
  try{
    assert.strictEqual(collect('status').workspace.moduleConfig.status,'absent');
    for(const moduleId of ['api','billing']){
      const disabled=moduleId==='api'?'billing':'api';
      fs.writeFileSync(configPath,JSON.stringify({schemaVersion:2,modules:{[moduleId]:suite,[disabled]:{enabled:false,command:null,cwd:'missing'}}}));
      const previous=collect('status').jobs[disabled]?.runId;
      const started=collect('start');assert.deepStrictEqual(started.workspace.moduleConfig.enabledIds,[moduleId]);
      assert.strictEqual(started.jobs[disabled]?.runId,previous);
      const initial=await waitFor(moduleId,job=>job?.status==='running'&&job.resolved===1);
      const claim=readJson(files(directory,moduleId).claim);fs.unlinkSync(configPath);
      const logs=collect('logs',moduleId);assert.strictEqual(logs.jobs[moduleId].runId,initial.runId);
      assert(logs.jobs[moduleId].logTail.some(line=>line.includes('@@TEST_PROGRESS@@')));
      assert.strictEqual(collect('status').workspace.moduleConfig.status,'absent');
      collect('cancel',moduleId);await waitFor(moduleId,job=>job?.status==='cancelled');
      const deadline=Date.now()+5000;while(sameProcess(claim.workerIdentity)&&Date.now()<deadline)await sleep(50);
      assert(!sameProcess(claim.workerIdentity));assert.strictEqual(groupState(claim.childIdentity),'empty');
      assert(!fs.existsSync(files(directory,moduleId).lock));
    }
    fs.writeFileSync(configPath,JSON.stringify({schemaVersion:2,modules:{}}));
    assert.deepStrictEqual(collect('status').workspace.moduleConfig.enabledIds,[]);collect('start','all',false);
    fs.writeFileSync(configPath,'{"env":"synthetic-secret",invalid');const invalid=collect('status');
    assert.strictEqual(invalid.workspace.moduleConfig.status,'invalid');assert(!JSON.stringify(invalid).includes('synthetic-secret'));
    collect('start','all',false);collect('logs');collect('cancel');
    console.log('V2 selection, removed-config management and safe diagnostics: OK');
  }finally{
    collect('cancel');for(const id of ['api','billing'])await waitFor(id,job=>!job||!['preparing','running'].includes(job.status));
    removePath(directory,{recursive:true,force:true});removePath(app,{recursive:true,force:true});
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
