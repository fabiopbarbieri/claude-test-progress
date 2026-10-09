#!/usr/bin/env node
// Runs one registered module outside the collector, exactly as the collector would launch it
// (same command, cwd, env and Node runtime), and records each stdout/stderr chunk with its
// time offset for replay.mjs. This is also the "no collector" baseline: the last stdout line
// is a JSON summary with the wall time and exit code.
//
//   node capture.mjs --workspace <dir> --module <id> --out <file.jsonl.gz>
//
// Format (gzip, one JSON per line): a header {v, moduleId, adapter, platform, startedAt},
// chunks {t, s: 'o'|'e', d: base64} with t in ms since spawn, and a trailer {t, exit, signal}.
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { spawn } from 'child_process';
import { discoverModules, prepareSelection } from '../../runner/module-config.mjs';
import { mergeEnvironment } from '../../runner/runtime.mjs';
import { colorEnvironment } from '../../runner/color.mjs';

function options(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    if (!['--workspace', '--module', '--out'].includes(argv[index]) || !argv[index + 1]) throw new Error(`Invalid argument: ${argv[index]}`);
    result[argv[index].slice(2)] = argv[index + 1];
  }
  if (!result.workspace || !result.module || !result.out) throw new Error('Usage: capture.mjs --workspace <dir> --module <id> --out <file.jsonl.gz>');
  return result;
}

async function main() {
  const { workspace, module: moduleId, out } = options(process.argv.slice(2));
  const configuration = prepareSelection(discoverModules({ cwd: path.resolve(workspace) }), moduleId).configurations[moduleId];
  const environment = colorEnvironment(mergeEnvironment(process.env, configuration.env), configuration.command, configuration.adapter);
  const launch = configuration.windowsCommand ||
    { file: configuration.command[0], args: configuration.command.slice(1) };
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  const gzip = zlib.createGzip();
  const written = new Promise((resolve, reject) => {
    gzip.pipe(fs.createWriteStream(out)).on('finish', resolve).on('error', reject);
  });
  const record = value => gzip.write(`${JSON.stringify(value)}\n`);
  record({ v: 1, moduleId, adapter: configuration.adapter, platform: process.platform, startedAt: new Date().toISOString() });
  const started = process.hrtime.bigint();
  const elapsed = () => Math.round(Number(process.hrtime.bigint() - started) / 1e4) / 100;
  const bytes = { o: 0, e: 0 };
  let chunks = 0;
  const child = spawn(launch.file, launch.args, {
    cwd: configuration.cwd, env: environment, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    // cmd.exe gets the command line windowsCommand quoted for it.
    windowsVerbatimArguments: /(^|[\\/])cmd\.exe$/i.test(launch.file),
  });
  for (const [stream, key] of [[child.stdout, 'o'], [child.stderr, 'e']]) {
    stream.on('data', (chunk) => {
      bytes[key] += chunk.length;
      chunks += 1;
      record({ t: elapsed(), s: key, d: chunk.toString('base64') });
    });
  }
  const [code, signal] = await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (exitCode, exitSignal) => resolve([exitCode, exitSignal]));
  });
  const wallMs = elapsed();
  record({ t: wallMs, exit: code, signal: signal || null });
  gzip.end();
  await written;
  process.stdout.write(`${JSON.stringify({ moduleId, exitCode: code, signal: signal || null, wallMs, chunks, stdoutBytes: bytes.o, stderrBytes: bytes.e })}\n`);
}

main().catch((error) => {
  process.stderr.write(`capture: ${error.message}\n`);
  process.exitCode = 1;
});
