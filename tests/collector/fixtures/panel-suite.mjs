// Public interactive fixture. Run only inside a disposable project.
// Write initial/full/finished to backend-mode, or initial/zero/finished to
// frontend-mode. Until finished or cancelled the process deliberately stays alive.
import fs from 'fs';

const lane = process.argv[2];
if (!['backend', 'frontend'].includes(lane)) throw new Error('Expected backend or frontend');
let previous = '';
const timer = setInterval(() => {
  const file = `${lane}-mode`;
  const mode = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim() : 'initial';
  if (mode === previous) return;
  previous = mode;
  const full = lane === 'backend' && ['full', 'finished'].includes(mode);
  const zero = lane === 'frontend' && ['zero', 'finished'].includes(mode);
  const value = {
    scope: lane, total: lane === 'backend' ? 4 : zero ? 0 : null,
    resolved: lane === 'backend' ? (full ? 4 : 1) : 0,
    passed: lane === 'backend' ? (full ? 2 : 1) : 0,
    failed: full ? 1 : 0, skipped: full ? 1 : 0,
    totalStable: lane === 'backend' || zero, final: mode === 'finished',
    phase: full ? 'awaiting-process-exit' : zero ? 'zero-tests' : 'public-synthetic-fixture',
  };
  console.log('@@TEST_PROGRESS@@' + JSON.stringify(value));
  console.log(`PUBLIC FIXTURE: ${lane} / ${mode}`);
  if (mode === 'finished') {
    clearInterval(timer);
    process.exitCode = full ? 1 : 0;
  }
}, 100);
