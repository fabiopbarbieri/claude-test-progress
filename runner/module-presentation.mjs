// Pure presentation rules shared by native surfaces and text. No host APIs.
import { validModuleId } from './module-id.mjs';
import { SCHEMA_VERSION } from './schema.mjs';
export const ACTIVE = new Set(['preparing', 'running']);
export const labels = { preparing: 'Preparando', running: 'Em execução', completed: 'Encerrado',
  failed: 'Encerrado com falha', cancelled: 'Cancelado', error: 'Erro' };
const record = value => value && typeof value === 'object' && !Array.isArray(value);
export function validateEnvelope(data) {
  const config = data?.workspace?.moduleConfig;
  if (data?.schemaVersion !== SCHEMA_VERSION || typeof data.ok !== 'boolean' || !record(data.modules) ||
      !record(data.jobs) || !record(data.stateDiagnostics) || !record(config) ||
      !['absent', 'valid', 'invalid'].includes(config.status) ||
      ![SCHEMA_VERSION, null].includes(config.schemaVersion) || !Array.isArray(config.enabledIds)) {
    throw new Error(`Versão de resposta do coletor incompatível; requer schemaVersion ${SCHEMA_VERSION}.`);
  }
  for (const [id, module] of Object.entries(data.modules)) {
    if (!validModuleId(id) || module?.id !== id || typeof module.label !== 'string' ||
        !(module.language === null || typeof module.language === 'string') ||
        !Number.isFinite(module.order) || typeof module.enabled !== 'boolean' ||
        typeof module.directoryPresent !== 'boolean' || typeof module.origin !== 'string' || !Array.isArray(module.diagnostics)) {
      throw new Error('Catálogo de módulos inválido na resposta do coletor.');
    }
  }
  for (const [id, job] of Object.entries(data.jobs)) {
    if (!validModuleId(id) || job?.schemaVersion !== SCHEMA_VERSION || job.moduleId !== id ||
        typeof job.runId !== 'string' || !job.runId || job.source !== 'config' || !Object.prototype.hasOwnProperty.call(labels, job.status) ||
        typeof job.phase !== 'string' || job.command !== undefined && !Array.isArray(job.command)) {
      throw new Error('Snapshot de job incompatível na resposta do coletor.');
    }
  }
  for (const [id, items] of Object.entries(data.stateDiagnostics)) {
    if (id !== '*' && !validModuleId(id) || !Array.isArray(items)) throw new Error('Diagnósticos de estado inválidos na resposta do coletor.');
  }
  if (config.enabledIds.some(id => !validModuleId(id))) throw new Error('IDs de módulos inválidos na resposta do coletor.');
  return data;
}
export function parseCommand(raw) {
  const tokens = String(raw ?? '').trim().split(/\s+/).filter(Boolean);
  const text = tokens.includes('--text');
  const args = tokens.filter(token => token !== '--text');
  const action = args[0] ?? 'status';
  if (!['list', 'start', 'status', 'logs', 'cancel', 'help', 'paths'].includes(action) || args.length > 2 ||
      (['list', 'help', 'paths'].includes(action) && args.length > 1) ||
      (action === 'start' && args.length !== 2)) throw new Error('Use /test-progress help para consultar os comandos.');
  const moduleId = args[1] ?? 'all';
  if (moduleId !== 'all' && !validModuleId(moduleId)) throw new Error('ID de módulo inválido. Use list para ver os IDs.');
  return { action, moduleId, text };
}
export function visibleModuleIds(modules, jobs, diagnostics) {
  const enabled = Object.keys(modules).filter(id => modules[id].enabled)
    .sort((a, b) => modules[a].order - modules[b].order || a.localeCompare(b));
  const retained = new Set(Object.keys(jobs).filter(id => ACTIVE.has(jobs[id].status) || jobs[id].recoveryRequired));
  for (const id of Object.keys(diagnostics)) if (id !== '*' && validModuleId(id) && diagnostics[id]?.length) retained.add(id);
  return [...enabled, ...[...retained].filter(id => !enabled.includes(id)).sort()];
}
// Panel orderings, cycled by one toolbar button. `order` keeps the catalogue as visibleModuleIds returns it.
export const SORTS = ['order', 'name', 'recent', 'attention'];
export const sortLabels = { order: 'cadastro', name: 'nome', recent: 'recentes', attention: 'atenção' };
export const nextSort = sort => SORTS[(SORTS.indexOf(sort) + 1) % SORTS.length];
const startedAt = job => { const at = Date.parse(job?.startedAt ?? ''); return Number.isFinite(at) ? at : -Infinity; };
// What needs a look first: failures and orphans, live runs, cancellations, passes, then modules never run.
function attention(job) {
  if (!job) return 4;
  if (job.recoveryRequired || job.status === 'error') return 0;
  if (ACTIVE.has(job.status)) return 1;
  if (job.status === 'failed' || (job.failed ?? 0) > 0) return 0;
  return job.status === 'cancelled' ? 2 : 3;
}
export function sortModuleIds(ids, modules, jobs, sort) {
  const name = id => modules[id]?.label ?? id;
  const by = {
    name: (a, b) => name(a).localeCompare(name(b), 'pt-BR', { sensitivity: 'base', numeric: true }),
    // Most recent run first; modules without a run keep catalogue order at the end.
    recent: (a, b) => startedAt(jobs[b]) - startedAt(jobs[a]),
    attention: (a, b) => attention(jobs[a]) - attention(jobs[b]) || startedAt(jobs[b]) - startedAt(jobs[a]),
  }[sort];
  if (!by) return ids;
  const position = new Map(ids.map((id, i) => [id, i]));
  return [...ids].sort((a, b) => by(a, b) || position.get(a) - position.get(b));
}
export const moduleTitle =(id, module) => `${module?.label ?? id} · ${id}`;
export function percentage(job) {
  return typeof job.percent === 'number' && Number.isFinite(job.percent) ? `${job.percent.toFixed(job.percent % 1 ? 1 : 0)}%` : '—';
}
export function progressText(job) {
  if (job.total === 0) return '— [ sem testes ]';
  if (job.total === null || job.total === undefined || typeof job.percent !== 'number' || !Number.isFinite(job.percent)) return '— [ total desconhecido ]';
  const filled = Math.max(0, Math.min(16, Math.round(job.percent / 100 * 16)));
  return `${percentage(job)} [${'■'.repeat(filled)}${'·'.repeat(16 - filled)}]`;
}
export function countSummary(job) {
  const denominator = job.total == null ? 'total desconhecido' : `${job.total} no total${job.totalStable ? '' : ' · total parcial'}`;
  return `${job.resolved ?? 0} resolvidos / ${denominator}`;
}
export const diagnosticText = item => typeof item === 'string' ? item : item?.message ?? item?.code ?? 'Diagnóstico indisponível.';
export function sanitizeText(value) {
  return String(value ?? '').replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/\x1b[@-_]/g, '')
    .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '').replace(/\t/g, '    ');
}
// Log lines keep their SGR color sequences for the panel; every other escape and control goes.
const SGR = /\x1b\[[\d;:]*m/g;
export function sanitizeLogText(value) {
  const text = String(value ?? '').replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\)/g, '');
  let result = '', last = 0;
  for (const match of text.matchAll(SGR)) {
    result += sanitizeText(text.slice(last, match.index)) + match[0];
    last = match.index + match[0].length;
  }
  return result + sanitizeText(text.slice(last));
}
export const sanitizeTail = tail => Array.isArray(tail) ? tail.slice(-200).map(sanitizeLogText) : [];
export const plainTail = tail => Array.isArray(tail) ? tail.slice(-200).map(sanitizeText) : [];
// Named colors follow the person's terminal palette; the 256-color cube and truecolor become hex.
const NAMES = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'];
const named = index => (index < 8 ? NAMES[index] : `${NAMES[index - 8]}Bright`);
const hex = (r, g, b) => `#${[r, g, b].map(part => Math.max(0, Math.min(255, part | 0)).toString(16).padStart(2, '0')).join('')}`;
function palette(index) {
  if (!(index >= 0 && index <= 255)) return undefined;
  if (index < 16) return named(index);
  if (index >= 232) { const level = 8 + (index - 232) * 10; return hex(level, level, level); }
  const cube = index - 16, level = part => (part ? 55 + part * 40 : 0);
  return hex(level(Math.floor(cube / 36)), level(Math.floor(cube / 6) % 6), level(cube % 6));
}
// Reads the extended color that starts at params[i] (38/48), returning it and how many params it used.
function extended(params, i) {
  if (params[i].length > 1) {
    const parts = params[i];
    if (parts[1] === 5) return [palette(parts[2]), 1];
    if (parts[1] === 2) { const rgb = parts.slice(-3); return [rgb.length === 3 ? hex(...rgb) : undefined, 1]; }
    return [undefined, 1];
  }
  const mode = params[i + 1]?.[0];
  if (mode === 5) return [palette(params[i + 2]?.[0]), 3];
  if (mode === 2) return [hex(params[i + 2]?.[0], params[i + 3]?.[0], params[i + 4]?.[0]), 5];
  return [undefined, 1];
}
function applySgr(style, body) {
  const params = (body === '' ? '0' : body).split(';').map(param => param.split(':').map(part => (part === '' ? 0 : Number(part))));
  for (let i = 0; i < params.length;) {
    const code = params[i][0];
    if (code === 0) { for (const name of Object.keys(style)) delete style[name]; i++; continue; }
    if (code === 38 || code === 48) {
      const [color, used] = extended(params, i);
      if (color) style[code === 38 ? 'color' : 'backgroundColor'] = color;
      i += used; continue;
    }
    if (code === 1) style.bold = true;
    else if (code === 2) style.dimColor = true;
    else if (code === 3) style.italic = true;
    else if (code === 4) style.underline = true;
    else if (code === 7) style.inverse = true;
    else if (code === 9) style.strikethrough = true;
    else if (code === 22) { delete style.bold; delete style.dimColor; }
    else if (code === 23) delete style.italic;
    else if (code === 24) delete style.underline;
    else if (code === 27) delete style.inverse;
    else if (code === 29) delete style.strikethrough;
    else if (code >= 30 && code <= 37) style.color = named(code - 30);
    else if (code === 39) delete style.color;
    else if (code >= 40 && code <= 47) style.backgroundColor = named(code - 40);
    else if (code === 49) delete style.backgroundColor;
    else if (code >= 90 && code <= 97) style.color = named(code - 90 + 8);
    else if (code >= 100 && code <= 107) style.backgroundColor = named(code - 100 + 8);
    i++;
  }
}
// Splits a sanitized log line into runs of text and the SGR style each one carries (null when plain).
export function ansiSpans(line) {
  const text = String(line ?? '');
  const spans = [], style = {};
  let last = 0;
  const push = value => {
    if (!value) return;
    const current = Object.keys(style).length ? { ...style } : null;
    const previous = spans[spans.length - 1];
    if (previous && JSON.stringify(previous.style) === JSON.stringify(current)) previous.text += value;
    else spans.push({ text: value, style: current });
  };
  for (const match of text.matchAll(SGR)) {
    push(text.slice(last, match.index));
    applySgr(style, match[0].slice(2, -1));
    last = match.index + match[0].length;
  }
  push(text.slice(last));
  return spans;
}
// Compact panel and band vocabulary: one-column glyphs so terminal columns stay aligned.
export function statusGlyph(job) {
  if (!job) return { glyph: '○', color: 'inactive' };
  if (job.recoveryRequired || job.status === 'error') return { glyph: '!', color: 'error' };
  if (ACTIVE.has(job.status)) return job.phase === 'cancellation-requested' ?
    { glyph: '◌', color: 'inactive' } : { glyph: '●', color: 'warning' };
  if (job.status === 'cancelled') return { glyph: '■', color: 'inactive' };
  if (job.status === 'failed' || (job.failed ?? 0) > 0) return { glyph: '✗', color: 'error' };
  return { glyph: '✓', color: 'success' };
}
const knownPercent = job => job.total != null && job.total > 0 && typeof job.percent === 'number' && Number.isFinite(job.percent);
// A thin bar while a run is live: done cells in the accent, the rest subtle. Unknown totals draw dashes.
export function progressBar(job, cells = 12) {
  if (!knownPercent(job)) return { done: '', rest: '╌'.repeat(cells) };
  const filled = Math.max(0, Math.min(cells, Math.round(job.percent / 100 * cells)));
  return { done: '━'.repeat(filled), rest: '━'.repeat(cells - filled) };
}
// A finished run reads as its result, not as a full bar.
export function outcomeText(job) {
  if (job.status === 'error') return { text: 'erro', color: 'error' };
  if (job.status === 'cancelled') return { text: 'cancelado', color: 'inactive' };
  if (job.total === 0) return { text: '-', color: 'inactive' };
  // Under `exit` without events the exit code is the whole result.
  if (job.total == null && job.adapter === 'exit' && Number.isInteger(job.exitCode)) return { text: `exit ${job.exitCode}`, color: 'inactive' };
  if (job.total == null) return { text: 'total desconhecido', color: 'inactive' };
  return { text: `· ${job.total}`, color: 'inactive' };
}
// A finished run that failed: a failed or errored status, or any failed test.
export function finishedWithFailure(job) {
  return !!job && !ACTIVE.has(job.status) && !job.recoveryRequired &&
    (['failed', 'error'].includes(job.status) || (job.failed ?? 0) > 0);
}
// Toolbar summary S/E/T: modules that passed, modules that failed, all modules.
export function summaryCounts(ids, jobs) {
  const failed = ids.filter(id => finishedWithFailure(jobs[id])).length;
  const passed = ids.filter(id => jobs[id]?.status === 'completed' && !finishedWithFailure(jobs[id])).length;
  return { passed, failed, total: ids.length };
}
// Protocol lines are the collector's input, not the person's log; runs of blank lines collapse to one.
// A line holding only color sequences is as blank as an empty one.
const blank = line => !line.replace(SGR, '').trim();
export function readableTail(lines, prefix) {
  const kept = [];
  for (const line of lines) {
    if (line.includes(prefix)) continue;
    if (blank(line) && (!kept.length || blank(kept[kept.length - 1]))) continue;
    kept.push(line);
  }
  while (kept.length && blank(kept[kept.length - 1])) kept.pop();
  return kept;
}
export function compactPercent(job) {
  if (job.total === 0) return 'sem testes';
  if (!knownPercent(job)) return '—';
  // A finished run's total is final, whatever the stream last claimed.
  return `${ACTIVE.has(job.status) && !job.totalStable ? '~' : ''}${percentage(job)}`;
}
// ⊘ renders flush against the next digit in common terminal fonts, so it keeps a space.
export function compactCounts(job) {
  return [['passed', '✓', 'success'], ['failed', '✗', 'error'], ['skipped', '⊘ ', 'inactive']]
    .filter(([key]) => (job?.[key] ?? 0) > 0).map(([key, glyph, color]) => ({ text: `${glyph}${job[key]}`, color }));
}
export function clock(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return '';
  const total = Math.floor(ms / 1000), h = Math.floor(total / 3600), m = Math.floor(total % 3600 / 60), s = total % 60;
  const pad = value => String(value).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
export const configStatus = { valid: 'válido', absent: 'ausente', invalid: 'inválido' };
