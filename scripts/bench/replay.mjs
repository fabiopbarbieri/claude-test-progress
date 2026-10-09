#!/usr/bin/env node
// Replays a capture.mjs recording: writes each chunk to the same stream, keeping the recorded
// timing divided by --speed (`max` writes as fast as the pipe drains), and exits with the
// recorded code. Registered as a module, it gives the collector the exact output of a real
// suite without Java, Chrome or the project's Node.
//
//   node replay.mjs <file.jsonl.gz> [--speed 1|10|max]
import fs from 'fs';
import zlib from 'zlib';
import readline from 'readline';

const [file, flag, value] = process.argv.slice(2);
if (!file || (flag && (flag !== '--speed' || !value))) {
  process.stderr.write('Usage: replay.mjs <file.jsonl.gz> [--speed 1|10|max]\n');
  process.exit(2);
}
const speed = !flag ? 1 : value === 'max' ? Infinity : Number(value);
if (!(speed > 0)) {
  process.stderr.write('replay: --speed must be a positive number or max\n');
  process.exit(2);
}

const write = (stream, data) => new Promise((resolve) => {
  if (stream.write(data)) resolve();
  else stream.once('drain', resolve);
});
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const lines = readline.createInterface({ input: fs.createReadStream(file).pipe(zlib.createGunzip()), crlfDelay: Infinity });
  const started = Date.now();
  let exit = 0;
  for await (const line of lines) {
    if (!line) continue;
    const entry = JSON.parse(line);
    if (entry.v !== undefined) continue;
    if (speed !== Infinity) {
      const due = entry.t / speed - (Date.now() - started);
      if (due > 1) await sleep(due);
    }
    if (entry.exit !== undefined) { exit = Number.isInteger(entry.exit) ? entry.exit : 1; break; }
    await write(entry.s === 'e' ? process.stderr : process.stdout, Buffer.from(entry.d, 'base64'));
  }
  process.exitCode = exit;
}

main().catch((error) => {
  process.stderr.write(`replay: ${error.message}\n`);
  process.exitCode = 1;
});
