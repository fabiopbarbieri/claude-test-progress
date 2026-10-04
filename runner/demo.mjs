import { PREFIX } from './progress.mjs';

// An event producer for the visual demo; this does not run a test suite.
const lane = process.argv[2] === 'frontend' ? 'frontend' : 'backend';
const total = lane === 'frontend' ? 12 : 8;
let resolved = 0;
const timer = setInterval(() => {
  resolved++;
  const failed = lane === 'backend' && resolved >= 6 ? 1 : 0;
  const skipped = lane === 'frontend' && resolved >= 10 ? 1 : 0;
  process.stdout.write(`${PREFIX}${JSON.stringify({ scope: `demo-${lane}`, total,
    resolved, passed: resolved - failed - skipped, failed, skipped,
    final: resolved === total, totalStable: true, phase: 'demo-running' })}\n`);
  if (lane === 'backend' && resolved === 6) process.stderr.write('DEMO: falha simulada em um teste de backend.\n');
  if (resolved === total) {
    clearInterval(timer);
    // Keep the process alive briefly to show that counters alone do not complete a run.
    setTimeout(() => { process.exitCode = failed ? 1 : 0; }, 400);
  }
}, 650);
