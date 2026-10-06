// Internal fixture, invoked only through an ordinary module configuration.
import fs from 'fs';
const mode = process.argv[2] || 'pass';
if (process.env.START_MARKER) fs.writeFileSync(process.env.START_MARKER, 'started');
const total = mode === 'zero' ? 0 : mode === 'unknown' ? null : 2;
function event(resolved, final = false) {
  const failed = mode === 'fail' && resolved === 2 ? 1 : 0;
  console.log('@@TEST_PROGRESS@@' + JSON.stringify({scope:'internal-fixture',total,
    resolved,passed:resolved-failed,failed,skipped:0,totalStable:total!==null,final,
    phase:final?'finished':'fixture-running'}));
}
if (mode === 'silent') setInterval(() => {},1000);
else if (mode === 'slow' || mode === 'unknown') {
  event(mode === 'unknown' ? 0 : 1);
  const timer=setInterval(() => {
    if (fs.existsSync('release')) {clearInterval(timer);event(2,true);}
  },50);
} else {
  event(0);
  setTimeout(() => {event(total,true);process.exitCode=mode==='fail'?1:0;},120);
}
