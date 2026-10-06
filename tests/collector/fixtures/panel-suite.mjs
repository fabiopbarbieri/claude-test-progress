// Public interactive fixture. Run only inside a disposable project.
// Write partial/full/unknown/zero/finished to <moduleId>-mode.
// Until finished or cancelled the process deliberately stays alive.
import fs from 'fs';
import { validModuleId } from '../../../runner/module-id.mjs';

const moduleId = process.argv[2];
if (!validModuleId(moduleId)) throw new Error('Expected a safe module ID');
const initial = process.argv[3] || 'partial';
let previous = '';
const timer = setInterval(() => {
  const file = `${moduleId}-mode`;
  const mode = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim() : initial;
  if (mode === previous) return;
  const outcome = mode === 'finished' ? previous || initial : mode;
  previous = mode;
  const full = outcome === 'full' || (mode === 'finished' && !['zero', 'unknown'].includes(outcome));
  const zero = outcome === 'zero';
  const unknown = outcome === 'unknown';
  const value = {
    scope: moduleId, total: zero ? 0 : unknown ? null : 4,
    resolved: zero || unknown ? 0 : full ? 4 : 1,
    passed: zero || unknown ? 0 : full ? 2 : 1,
    failed: full ? 1 : 0, skipped: full ? 1 : 0,
    totalStable: !unknown, final: mode === 'finished',
    phase: full ? 'awaiting-process-exit' : zero ? 'zero-tests' : 'public-synthetic-fixture',
  };
  console.log('@@TEST_PROGRESS@@' + JSON.stringify(value));
  console.log(`PUBLIC FIXTURE: ${moduleId} / ${mode}`);
  if (mode === 'finished') {
    clearInterval(timer);
    process.exitCode = full ? 1 : 0;
  }
}, 100);
