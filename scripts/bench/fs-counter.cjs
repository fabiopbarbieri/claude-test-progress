// Diagnostic preload for benchmark replays: NODE_OPTIONS="--require <this file>".
// It does nothing unless the process runs a script from the measured runner/, so the
// suites' own Node processes are untouched. It counts synchronous fs calls by kind of state
// file, bytes zero-filled by Buffer.alloc and the event loop delay, and writes
// <TP_BENCH_COUNT_DIR>/<pid>-<script>.json every 5 s (a watcher is killed, not ended).
// TP_BENCH_EPERM_EVERY=N makes every Nth renameSync fail with EPERM, as an antivirus would.
'use strict';
const fs = require('fs');
const path = require('path');
const { monitorEventLoopDelay } = require('perf_hooks');

// The report itself uses the originals, so it never counts itself.
const originalWrite = fs.writeFileSync;
const originalMkdir = fs.mkdirSync;
// TP_BENCH_RUNNER names the measured checkout's runner/ when it is not this one.
const runner = path.resolve(process.env.TP_BENCH_RUNNER || path.join(__dirname, '..', '..', 'runner')) + path.sep;
const script = process.argv[1] ? path.resolve(process.argv[1]) : '';
const directory = process.env.TP_BENCH_COUNT_DIR;
if (directory && script.startsWith(runner)) install(directory, path.basename(script, path.extname(script)));

function kind(target) {
  if (typeof target !== 'string' && !(target instanceof URL) && !Buffer.isBuffer(target)) return 'fd';
  const name = path.basename(String(target));
  // Module loading at startup, not state work.
  if (/\.(mjs|cjs|js|node)$/.test(name) || name === 'package.json' || name === 'node_modules') return 'module';
  if (/\.tmp$/.test(name)) return 'tmp';
  if (name === 'claim.json' || /\.lock$/.test(name)) return 'claim';
  if (/\.mutation$/.test(name)) return 'gate';
  if (/\.job\.json\.windows\.json$/.test(name)) return 'proof';
  if (/\.job\.json$/.test(name)) return 'job';
  if (/\.cancel\.json$/.test(name)) return 'cancel';
  if (/^batch\./.test(name)) return 'batch';
  if (/^acl-/.test(name)) return 'acl';
  if (/\.log$/.test(name)) return 'log';
  if (/^test-progress(\.registry)?\.json$/.test(name)) return 'config';
  if (/^[a-z][a-z0-9-]*\.json$/.test(name)) return 'snapshot';
  return 'other';
}

function install(outDirectory, name) {
  const started = Date.now();
  const calls = Object.create(null);
  const count = (op, target) => {
    const key = `${op}:${kind(target)}`;
    calls[key] = (calls[key] || 0) + 1;
  };
  let realpathSegments = 0;
  let allocBytes = 0;
  let allocCalls = 0;
  const every = Number(process.env.TP_BENCH_EPERM_EVERY) || 0;
  let renames = 0;
  let injected = 0;
  const wrap = (op, original) => function(target, ...rest) {
    count(op, target);
    return original.call(this, target, ...rest);
  };
  for (const op of ['lstatSync', 'statSync', 'fstatSync', 'openSync', 'closeSync', 'readSync', 'writeSync',
    'readFileSync', 'writeFileSync', 'appendFileSync', 'mkdirSync', 'rmdirSync', 'rmSync', 'unlinkSync',
    'readdirSync', 'existsSync', 'chmodSync']) {
    if (typeof fs[op] === 'function') fs[op] = wrap(op.replace(/Sync$/, ''), fs[op]);
  }
  const realpath = fs.realpathSync;
  const counted = function(target, ...rest) {
    count('realpath', target);
    realpathSegments += String(target).split(/[\\/]+/).filter(Boolean).length;
    return realpath.call(this, target, ...rest);
  };
  counted.native = realpath.native;
  fs.realpathSync = counted;
  const rename = fs.renameSync;
  fs.renameSync = function(from, to) {
    count('rename', to);
    renames += 1;
    if (every > 0 && renames % every === 0) {
      injected += 1;
      throw Object.assign(new Error('EPERM: operation not permitted (injected)'), { code: 'EPERM' });
    }
    return rename.call(this, from, to);
  };
  const alloc = Buffer.alloc;
  Buffer.alloc = function(size, ...rest) {
    allocCalls += 1;
    allocBytes += Number(size) || 0;
    return alloc.call(this, size, ...rest);
  };
  const delay = monitorEventLoopDelay({ resolution: 10 });
  delay.enable();
  const file = path.join(outDirectory, `${process.pid}-${name}.json`);
  const ms = (value) => Math.round(value / 1e4) / 100;
  const flush = () => {
    try {
      originalMkdir(outDirectory, { recursive: true });
      originalWrite(file, JSON.stringify({ pid: process.pid, script: name, seconds: (Date.now() - started) / 1000,
        calls, realpathSegments, allocCalls, allocMb: Math.round(allocBytes / 1048576 * 10) / 10,
        renames, injectedEperm: injected,
        eventLoopMs: { p50: ms(delay.percentile(50)), p99: ms(delay.percentile(99)), max: ms(delay.max) } }));
    } catch { /* Diagnostics never break the collector. */ }
  };
  setInterval(flush, 5000).unref();
  process.on('exit', flush);
}
