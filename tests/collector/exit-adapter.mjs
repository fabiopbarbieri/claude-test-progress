// The exit adapter settles runs without progress events by exit code alone.
import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {spawnSync} from 'child_process';
import {fileURLToPath} from 'url';
import {randomUUID,removePath} from '../../runner/runtime.mjs';
import {namespace} from '../../runner/state.mjs';
if(process.platform==='win32'){console.log('SKIP: exit adapter check runs on POSIX');process.exit(0);}
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const app=fs.mkdtempSync(path.join(os.tmpdir(),'test-progress-exit-'));
const owner=randomUUID(),directory=namespace(app,owner).directory;
const configPath=path.join(app,'.claude/test-progress.json');fs.mkdirSync(path.dirname(configPath));
const node=script=>[process.execPath,'-e',script];
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function collect(action,moduleId='all'){
  const reply=spawnSync(process.execPath,[path.join(root,'runner/cli.mjs'),action,'--cwd',app,'--owner',owner,'--module',moduleId],{encoding:'utf8',timeout:60000});
  const data=JSON.parse(reply.stdout);assert.strictEqual(data.schemaVersion,1);return data;
}
async function settled(moduleId){
  const deadline=Date.now()+12000;
  do{const job=collect('status').jobs[moduleId];if(job&&!['preparing','running'].includes(job.status))return job;await sleep(80);}while(Date.now()<deadline);
  throw new Error('Exit adapter fixture timed out');
}
async function main(){
  try{
    fs.writeFileSync(configPath,JSON.stringify({schemaVersion:1,modules:{
      clean:{command:node("console.log('no events here')"),adapter:'exit'},
      broken:{command:node('process.exit(3)'),adapter:'exit'},
      counted:{command:node("console.log('@@TEST_PROGRESS@@'+JSON.stringify({scope:'s',total:1,resolved:1,passed:1,failed:0,skipped:0,final:true}))"),adapter:'exit'},
      silent:{command:node("console.log('no events here')"),adapter:'auto'}}}));
    assert.strictEqual(collect('start').ok,true);
    const clean=await settled('clean');
    assert.strictEqual(clean.status,'completed');assert.strictEqual(clean.phase,'finished');
    assert.strictEqual(clean.total,null);assert.strictEqual(clean.exitCode,0);assert.strictEqual(clean.error,undefined);
    const broken=await settled('broken');
    assert.strictEqual(broken.status,'failed');assert.strictEqual(broken.exitCode,3);
    const counted=await settled('counted');
    assert.strictEqual(counted.status,'completed');assert.strictEqual(counted.passed,1);assert.strictEqual(counted.total,1);
    // auto keeps refusing to call a silent run a success.
    const silent=await settled('silent');
    assert.strictEqual(silent.status,'error');assert.strictEqual(silent.phase,'no-progress-observed');
    console.log('Exit adapter: clean exit, failing exit, honoured events and auto unchanged: OK');
  }finally{removePath(directory,{recursive:true,force:true});removePath(app,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exit(1);});
