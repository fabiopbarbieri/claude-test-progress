#!/usr/bin/env node
// Compares bench-heavy.ps1 results of two collector versions, or summarizes fs-counter.cjs
// reports, as Markdown for a PR description.
//
//   node compare.mjs --a base-1.json base-2.json --b cand-1.json cand-2.json [--all]
//   node compare.mjs --counters <TP_BENCH_COUNT_DIR>
//
// Only valid runs count. Runs with the same scenario, variant, entry, module and action are
// one group; each metric shows median (min-max, n) per side. Every metric is lower-is-better.
// A change is "better" or "worse" only past 10 % with non-overlapping ranges; otherwise "~".
import fs from 'fs';
import path from 'path';

const METRICS = ['wallMs', 'startMs', 'kpi.collectorCpuMsPer1kTests', 'kpi.avCpuMsPer1kTests', 'kpi.overheadPct',
  'groups.collector.cpuS', 'groups.collector.wsPeakMb', 'groups.collector.privPeakMb', 'groups.mod.cpuS',
  'groups.av.cpuS', 'groups.tests.cpuS', 'diagnose.allocMb', 'diagnose.statPerS', 'diagnose.eventLoopP99Ms',
  'diagnose.eventLoopMaxMs', 'coldMs', 'p50Ms', 'p95Ms', 'stateFiles'];

function readRuns(files) {
  return files.flatMap((file) => {
    const report = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
    return (report.runs || []).filter((run) => run.valid !== false);
  });
}
const valueAt = (run, key) => key.split('.').reduce((value, part) => (value == null ? undefined : value[part]), run);
const groupOf = (run) => [run.scenario, run.variant, run.entry, run.module, run.action].filter(Boolean).join(' / ');
function stats(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  return { median, min: sorted[0], max: sorted[sorted.length - 1], n: sorted.length };
}
const number = (value) => (Math.abs(value) >= 100 ? value.toFixed(0) : Math.abs(value) >= 10 ? value.toFixed(1) : value.toFixed(2));
const cell = (s) => (s ? `${number(s.median)} (${number(s.min)}-${number(s.max)}, n=${s.n})` : '-');

function compare(aFiles, bFiles, all) {
  const sides = { a: readRuns(aFiles), b: readRuns(bFiles) };
  const groups = [...new Set([...sides.a, ...sides.b].map(groupOf))].sort();
  console.log('| Group | Metric | A | B | Delta | Verdict |\n| --- | --- | ---: | ---: | ---: | --- |');
  for (const group of groups) {
    for (const metric of METRICS) {
      const values = (side) => sides[side].filter((run) => groupOf(run) === group).map((run) => valueAt(run, metric))
        .filter((value) => typeof value === 'number' && Number.isFinite(value));
      const a = values('a').length ? stats(values('a')) : null;
      const b = values('b').length ? stats(values('b')) : null;
      if (!a && !b) continue;
      let delta = '-';
      let verdict = '';
      if (a && b) {
        const change = a.median === 0 ? (b.median === 0 ? 0 : Infinity) : (b.median - a.median) / Math.abs(a.median);
        const overlap = !(b.max < a.min || b.min > a.max);
        delta = Number.isFinite(change) ? `${change >= 0 ? '+' : ''}${(change * 100).toFixed(1)} %` : 'new';
        verdict = change <= -0.1 && !overlap ? 'better' : change >= 0.1 && !overlap ? 'worse' : '~';
        if (!all && verdict === '~' && Math.abs(change) < 0.05) continue;
      }
      console.log(`| ${group} | ${metric} | ${cell(a)} | ${cell(b)} | ${delta} | ${verdict} |`);
    }
  }
}

function counters(directory) {
  const reports = fs.readdirSync(directory).filter((name) => name.endsWith('.json'))
    .map((name) => JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8')));
  if (!reports.length) throw new Error(`No fs-counter reports in ${directory}`);
  console.log('| Script | PID | Seconds | stat-like calls/s | Alloc MB | Alloc MB/s | Loop p99 ms | Loop max ms | EPERM injected |\n| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const report of reports.sort((a, b) => a.script.localeCompare(b.script) || a.pid - b.pid)) {
    const stat = Object.entries(report.calls).filter(([key]) => /^(lstat|stat|fstat):/.test(key))
      .reduce((sum, [, count]) => sum + count, report.realpathSegments || 0);
    const seconds = Math.max(report.seconds, 0.001);
    console.log(`| ${report.script} | ${report.pid} | ${report.seconds.toFixed(1)} | ${(stat / seconds).toFixed(0)} | ${report.allocMb} | ${(report.allocMb / seconds).toFixed(1)} | ${report.eventLoopMs.p99} | ${report.eventLoopMs.max} | ${report.injectedEperm} |`);
  }
  const totals = new Map();
  for (const report of reports) for (const [key, count] of Object.entries(report.calls)) totals.set(key, (totals.get(key) || 0) + count);
  console.log('\n| Call:file kind | Count |\n| --- | ---: |');
  for (const [key, count] of [...totals].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`| ${key} | ${count} |`);
}

const argv = process.argv.slice(2);
try {
  if (argv[0] === '--counters' && argv[1]) counters(argv[1]);
  else {
    const a = [];
    const b = [];
    let side = null;
    let all = false;
    for (const value of argv) {
      if (value === '--a' || value === '--b') side = value === '--a' ? a : b;
      else if (value === '--all') all = true;
      else if (side) side.push(value);
      else throw new Error(`Unexpected argument: ${value}`);
    }
    if (!a.length || !b.length) throw new Error('Usage: compare.mjs --a <json>... --b <json>... [--all] | --counters <dir>');
    compare(a, b, all);
  }
} catch (error) {
  process.stderr.write(`compare: ${error.message}\n`);
  process.exitCode = 2;
}
