#!/usr/bin/env node
// Summarizes V8 .cpuprofile files (node --cpu-prof): self time per function and per source
// file, as Markdown, so a benchmark run can name its hot spots without opening DevTools.
//
//   node cpuprofile-top.mjs <file-or-dir>... [--top 25] [--match <text in script name>]
import fs from 'fs';
import path from 'path';

const argv = process.argv.slice(2);
const inputs = [];
let top = 25;
let match = '';
for (let index = 0; index < argv.length; index++) {
  if (argv[index] === '--top') top = Number(argv[++index]);
  else if (argv[index] === '--match') match = argv[++index] || '';
  else inputs.push(argv[index]);
}
if (!inputs.length || !(top > 0)) {
  process.stderr.write('Usage: cpuprofile-top.mjs <file-or-dir>... [--top 25] [--match <text>]\n');
  process.exit(2);
}

const files = inputs.flatMap((input) => fs.statSync(input).isDirectory() ?
  fs.readdirSync(input).filter((name) => name.endsWith('.cpuprofile')).map((name) => path.join(input, name)) : [input]);
const short = (url) => (url ? decodeURIComponent(url.replace(/^file:\/\/\/?/, '')).split(/[\\/]/).slice(-2).join('/') : '');

for (const file of files.sort()) {
  const profile = JSON.parse(fs.readFileSync(file, 'utf8'));
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
  const self = new Map();
  // Each sample owns the time until the next one.
  for (let index = 0; index < profile.samples.length; index++) {
    const delta = profile.timeDeltas[index + 1] ?? 0;
    self.set(profile.samples[index], (self.get(profile.samples[index]) || 0) + delta);
  }
  const functions = new Map();
  const sources = new Map();
  let total = 0;
  for (const [id, micros] of self) {
    const { functionName, url, lineNumber } = nodes.get(id).callFrame;
    total += micros;
    const name = functionName || (url ? '(anonymous)' : '(native)');
    const key = `${name}\t${url ? `${short(url)}:${lineNumber + 1}` : ''}`;
    functions.set(key, (functions.get(key) || 0) + micros);
    const source = url ? short(url) : name;
    sources.set(source, (sources.get(source) || 0) + micros);
  }
  if (match && !path.basename(file).includes(match) && ![...sources.keys()].some((source) => source.includes(match))) continue;
  const busy = total - (functions.get('(idle)\t') || 0);
  const ms = (micros) => (micros / 1000).toFixed(1);
  const pct = (micros) => (busy > 0 ? (micros / busy * 100).toFixed(1) : '0.0');
  const rows = (map) => [...map].filter(([key]) => !key.startsWith('(idle)')).sort((a, b) => b[1] - a[1]).slice(0, top);
  console.log(`## ${path.basename(file)}\n`);
  console.log(`Sampled ${ms(total)} ms, busy ${ms(busy)} ms (idle excluded from the shares).\n`);
  console.log('| Self ms | Busy % | Function | Location |\n| ---: | ---: | --- | --- |');
  for (const [key, micros] of rows(functions)) {
    const [name, location] = key.split('\t');
    console.log(`| ${ms(micros)} | ${pct(micros)} | ${name} | ${location} |`);
  }
  console.log('\n| Self ms | Busy % | Source |\n| ---: | ---: | --- |');
  for (const [source, micros] of rows(sources)) console.log(`| ${ms(micros)} | ${pct(micros)} | ${source} |`);
  console.log('');
}
