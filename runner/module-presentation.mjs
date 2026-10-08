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
export const sanitizeTail = tail => Array.isArray(tail) ? tail.slice(-200).map(sanitizeText) : [];
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
  if (job.total === 0) return { text: 'sem testes', color: 'inactive' };
  // Under `exit` without events the exit code is the whole result.
  if (job.total == null && job.adapter === 'exit' && Number.isInteger(job.exitCode)) return { text: `exit ${job.exitCode}`, color: 'inactive' };
  if (job.total == null) return { text: 'total desconhecido', color: 'inactive' };
  return { text: `· ${job.total} ${job.total === 1 ? 'teste' : 'testes'}`, color: 'inactive' };
}
// Toolbar summary: how many modules, and only the states worth a glance.
export function summaryLine(ids, jobs) {
  const live = ids.filter(id => jobs[id] && (ACTIVE.has(jobs[id].status) || jobs[id].recoveryRequired)).length;
  const failed = ids.filter(id => jobs[id] && !ACTIVE.has(jobs[id].status) &&
    (['failed', 'error'].includes(jobs[id].status) || (jobs[id].failed ?? 0) > 0)).length;
  return [{ text: `${ids.length} ${ids.length === 1 ? 'módulo' : 'módulos'}` },
    ...(live ? [{ text: `${live} rodando`, color: 'warning' }] : []),
    ...(failed ? [{ text: `${failed} ${failed === 1 ? 'falha' : 'falhas'}`, color: 'error' }] : [])];
}
// Protocol lines are the collector's input, not the person's log; runs of blank lines collapse to one.
export function readableTail(lines, prefix) {
  const kept = [];
  for (const line of lines) {
    if (line.includes(prefix)) continue;
    if (!line.trim() && (!kept.length || !kept[kept.length - 1].trim())) continue;
    kept.push(line);
  }
  while (kept.length && !kept[kept.length - 1].trim()) kept.pop();
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
