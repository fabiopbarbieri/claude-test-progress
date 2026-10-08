// Runners are asked for color the way each understands it, and the log tail keeps it.
import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {spawnSync} from 'child_process';
import {fileURLToPath} from 'url';
import {colorEnvironment} from '../../runner/color.mjs';
import {randomUUID,removePath} from '../../runner/runtime.mjs';
import {namespace} from '../../runner/state.mjs';

// Every module gets FORCE_COLOR; Maven and RSpec also get their own switch, appended to what is there.
assert.deepStrictEqual(colorEnvironment({PATH:'/bin'},['python3','-m','pytest'],'events'),{PATH:'/bin',FORCE_COLOR:'1'});
assert.deepStrictEqual(colorEnvironment({},['mvn','test'],'maven'),{FORCE_COLOR:'1',MAVEN_ARGS:'-Dstyle.color=always'});
assert.deepStrictEqual(colorEnvironment({MAVEN_ARGS:'-B'},['/opt/x/mvnw','test'],'auto'),{MAVEN_ARGS:'-B -Dstyle.color=always',FORCE_COLOR:'1'});
assert.deepStrictEqual(colorEnvironment({},['C:\\tools\\mvn.cmd','test'],'exit').MAVEN_ARGS,'-Dstyle.color=always');
assert.strictEqual(colorEnvironment({MAVEN_ARGS:'-Dstyle.color=never'},['mvn'],'maven').MAVEN_ARGS,'-Dstyle.color=never');
assert.strictEqual(colorEnvironment({},['bundle','exec','ruby','adapters/ruby/run.rb','rspec','spec'],'events').SPEC_OPTS,'--force-color');
assert.strictEqual(colorEnvironment({SPEC_OPTS:'--no-color'},['bundle','exec','rspec'],'events').SPEC_OPTS,'--no-color');
assert.strictEqual(colorEnvironment({},['node','ng.js','test'],'karma').MAVEN_ARGS,undefined);
// The person's NO_COLOR or explicit FORCE_COLOR turns the policy off, whatever the case of the name (Windows).
assert.deepStrictEqual(colorEnvironment({NO_COLOR:'1'},['mvn'],'maven'),{NO_COLOR:'1'});
assert.deepStrictEqual(colorEnvironment({FORCE_COLOR:'0'},['mvn'],'maven'),{FORCE_COLOR:'0'});
assert.deepStrictEqual(colorEnvironment({Force_Color:'0'},['mvn'],'maven'),{Force_Color:'0'});
assert.strictEqual(colorEnvironment({NO_COLOR:''},['node'],'exit').FORCE_COLOR,'1','An empty NO_COLOR is unset');
console.log('Color environment: FORCE_COLOR, Maven, RSpec and opt-out: OK');

if(process.platform==='win32'){console.log('SKIP: colored log tail check runs on POSIX');process.exit(0);}
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const app=fs.mkdtempSync(path.join(os.tmpdir(),'test-progress-color-'));
const owner=randomUUID(),directory=namespace(app,owner).directory;
const configPath=path.join(app,'.claude/test-progress.json');fs.mkdirSync(path.dirname(configPath));
const environment={...process.env};delete environment.NO_COLOR;delete environment.FORCE_COLOR;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const script="process.stdout.write('\\x1b[1A\\x1b[2K\\x1b[32mcolor='+process.env.FORCE_COLOR+'\\x1b[0m\\n')";
function collect(action,moduleId='all'){
  const reply=spawnSync(process.execPath,[path.join(root,'runner/cli.mjs'),action,'--cwd',app,'--owner',owner,'--module',moduleId],{encoding:'utf8',timeout:60000,env:environment});
  const data=JSON.parse(reply.stdout);assert.strictEqual(data.schemaVersion,1);return data;
}
async function settled(moduleId){
  const deadline=Date.now()+12000;
  do{const job=collect('status').jobs[moduleId];if(job&&!['preparing','running'].includes(job.status))return job;await sleep(80);}while(Date.now()<deadline);
  throw new Error('Color fixture timed out');
}
async function main(){
  try{
    fs.writeFileSync(configPath,JSON.stringify({schemaVersion:1,modules:{
      colored:{command:[process.execPath,'-e',script],adapter:'exit'},
      plain:{command:[process.execPath,'-e',script],adapter:'exit',env:{NO_COLOR:'1'}}}}));
    assert.strictEqual(collect('start').ok,true);
    await settled('colored');await settled('plain');
    // The tail keeps the color sequence and drops the cursor moves around it.
    assert.deepStrictEqual(collect('logs','colored').jobs.colored.logTail,['\x1b[32mcolor=1\x1b[0m']);
    assert.deepStrictEqual(collect('logs','plain').jobs.plain.logTail,['\x1b[32mcolor=undefined\x1b[0m']);
    console.log('Colored log tail: FORCE_COLOR reaches the runner, NO_COLOR opts out, SGR kept: OK');
  }finally{removePath(directory,{recursive:true,force:true});removePath(app,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exit(1);});
