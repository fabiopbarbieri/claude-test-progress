import { expect, test } from 'claude-code/testing';
import { parseCommand, visibleModuleIds, validateEnvelope, progressText, sanitizeTail, plainTail, ansiSpans, moduleTitle,
  statusGlyph, progressBar, progressSvg, compactPercent, compactCounts, clock, readableTail, summaryCounts, outcomeText, sortModuleIds,
  nextSort } from '../runner/module-presentation.mjs';
import type { ModuleSort } from '../runner/module-presentation.mjs';
import type { TestProgressJob, TestProgressModule } from '../types/index.d.ts';

// These pure functions read only the fields each case gives; the fixtures stay partial on purpose,
// so a missing status or total keeps meaning "absent" instead of a filled-in default.
const job = (fields: Partial<TestProgressJob>) => fields as TestProgressJob;
const mod = (fields: Partial<TestProgressModule>) => fields as TestProgressModule;
const jobs = (record: Record<string, Partial<TestProgressJob>>) => record as Record<string, TestProgressJob>;
const mods = (record: Record<string, Partial<TestProgressModule>>) => record as Record<string, TestProgressModule>;

test('titles preserve labels and IDs even when modules share a language or label', () => {
  expect(moduleTitle('api', mod({ label: 'Suíte', language: 'Python' }))).toBe('Suíte · api');
  expect(moduleTitle('worker', mod({ label: 'Suíte', language: 'Python' }))).toBe('Suíte · worker');
  expect(moduleTitle('backend', mod({ label: 'Backend', language: 'Ruby' }))).toBe('Backend · backend');
});

test('slash requires explicit start and rejects unknown actions and options', () => {
  expect(parseCommand('')).toEqual({ action: 'status', moduleId: 'all', text: false });
  expect(parseCommand('start api --text')).toEqual({ action: 'start', moduleId: 'api', text: true });
  for (const raw of ['backend', 'all', 'unknown', '--unknown', 'start', 'start ../api', 'list api', 'help api', 'start API', 'status --module api']) expect(() => parseCommand(raw)).toThrow();
});

test('collector envelope rejects unknown versions and malformed snapshots', () => {
  const envelope = { schemaVersion: 1, ok: true, modules: {}, jobs: {}, workspace: {
    moduleConfig: { status: 'absent', schemaVersion: null, enabledIds: [] }, stateBlocked: false }, stateDiagnostics: {} };
  expect(validateEnvelope(envelope)).toBe(envelope);
  expect(() => validateEnvelope({ ...envelope, schemaVersion: 2 })).toThrow();
  expect(() => validateEnvelope({ ok: true, modules: {} })).toThrow();
  expect(() => validateEnvelope({ ...envelope, jobs: { api: { schemaVersion: 1 } } })).toThrow();
  expect(() => validateEnvelope({ ...envelope, modules: { api: { id: 'other' } } })).toThrow();
});

test('unknown and zero totals differ and log controls are sanitized', () => {
  expect(progressText(job({ total: null, percent: null }))).toBe('— [ total desconhecido ]');
  expect(progressText(job({ total: 0, percent: null }))).toBe('— [ sem testes ]');
  const tail = ['\u001b[31mvermelho\u001b[0m\r\u0000', '\u001b]8;;https://example.test\u0007link\u001b]8;;\u0007', '\u001b[1A\u001b[2Kok'];
  // The panel keeps color (SGR) and drops cursor moves, links and controls; text surfaces get plain lines.
  expect(sanitizeTail(tail)).toEqual(['\u001b[31mvermelho\u001b[0m', 'link', 'ok']);
  expect(plainTail(tail)).toEqual(['vermelho', 'link', 'ok']);
});

test('color sequences become styled runs; reset, 256 colors and truecolor', () => {
  expect(ansiSpans('plain')).toEqual([{ text: 'plain', style: null }]);
  expect(ansiSpans('\u001b[1;32mOK\u001b[0m (3 tests)')).toEqual([{ text: 'OK', style: { bold: true, color: 'green' } }, { text: ' (3 tests)', style: null }]);
  expect(ansiSpans('\u001b[91mE\u001b[39m \u001b[38;5;214mw\u001b[38;2;1;2;3mx\u001b[38:2::255:0:0my\u001b[m.')).toEqual([
    { text: 'E', style: { color: 'redBright' } }, { text: ' ', style: null }, { text: 'w', style: { color: '#ffaf00' } },
    { text: 'x', style: { color: '#010203' } }, { text: 'y', style: { color: '#ff0000' } }, { text: '.', style: null }]);
  expect(ansiSpans('\u001b[2mdim\u001b[22m\u001b[44mbg\u001b[49m')).toEqual([{ text: 'dim', style: { dimColor: true } }, { text: 'bg', style: { backgroundColor: 'blue' } }]);
  expect(readableTail(['a', '\u001b[0m', '\u001b[0m', 'b', '\u001b[0m'], '@@')).toEqual(['a', '\u001b[0m', 'b']);
});

test('catalogue order plus retained recovery and state-only diagnostics exclude retired modules', () => {
  const modules = mods({ z: { enabled: true, order: 2 }, b: { enabled: true, order: 1 }, a: { enabled: true, order: 1 }, old: { enabled: false, order: 0 } });
  const catalogueJobs = jobs({ old: { status: 'completed' }, retired: { status: 'completed' }, lost: { status: 'error', recoveryRequired: true }, running: { status: 'running' } });
  expect(visibleModuleIds(modules, catalogueJobs, { locked: [{ blocking: true }], '*': [{ blocking: true }] })).toEqual(['a', 'b', 'z', 'locked', 'lost', 'running']);
});

test('orderings: catalogue, name, most recent run and what needs attention', () => {
  const modules = mods({ web: { label: 'Web' }, api: { label: 'api' }, e2e: { label: 'E2E' }, docs: { label: 'Docs' } });
  const runs = jobs({
    web: { status: 'completed', failed: 0, startedAt: '2026-10-08T10:00:00Z' },
    api: { status: 'failed', failed: 2, startedAt: '2026-10-08T09:00:00Z' },
    e2e: { status: 'running', startedAt: '2026-10-08T11:00:00Z' },
  });
  const ids = ['web', 'api', 'e2e', 'docs'];
  expect(sortModuleIds(ids, modules, runs, 'order')).toEqual(ids);
  expect(sortModuleIds(ids, modules, runs, 'name')).toEqual(['api', 'docs', 'e2e', 'web']);
  expect(sortModuleIds(ids, modules, runs, 'recent')).toEqual(['e2e', 'web', 'api', 'docs']);
  expect(sortModuleIds(ids, modules, runs, 'attention')).toEqual(['api', 'e2e', 'web', 'docs']);
  // Ties keep the catalogue position.
  expect(sortModuleIds(['b', 'a'], {}, {}, 'recent')).toEqual(['b', 'a']);
  expect((['order', 'name', 'recent', 'attention'] as ModuleSort[]).map(nextSort)).toEqual(['name', 'recent', 'attention', 'order']);
});

test('compact vocabulary: one-column glyphs, bars, partial totals, omitted zeros and clock', () => {
  expect(statusGlyph(undefined)).toEqual({ glyph: '○', color: 'inactive' });
  expect(statusGlyph(job({ status: 'running', phase: 'executing-tests' }))).toEqual({ glyph: '●', color: 'warning' });
  expect(statusGlyph(job({ status: 'running', phase: 'cancellation-requested' }))).toEqual({ glyph: '◌', color: 'inactive' });
  expect(statusGlyph(job({ status: 'completed', failed: 0 }))).toEqual({ glyph: '✓', color: 'success' });
  expect(statusGlyph(job({ status: 'failed', failed: 2 }))).toEqual({ glyph: '✗', color: 'error' });
  expect(statusGlyph(job({ status: 'cancelled' }))).toEqual({ glyph: '■', color: 'inactive' });
  expect(statusGlyph(job({ status: 'error', recoveryRequired: true }))).toEqual({ glyph: '!', color: 'error' });
  expect(progressBar(job({ total: 4, percent: 50 }), 4)).toEqual({ done: '━━', rest: '━━' });
  expect(progressBar(job({ total: null, percent: null }), 4)).toEqual({ done: '', rest: '╌╌╌╌' });
  expect(progressSvg(job({ total: 4, percent: 25 }), 40)).toContain('width="10" height="4" rx="2" fill="#4f8ff7"');
  expect(progressSvg(job({ total: 4, percent: 25 }), 40, true)).toContain('fill="#888"');
  expect(progressSvg(job({ total: 4, percent: 0 }), 40)).not.toContain('#4f8ff7');
  expect(progressSvg(job({ total: null, percent: null }), 40)).toContain('stroke-dasharray');
  expect(readableTail(['a', '@@TEST_PROGRESS@@{}', '', '', 'b', ''], '@@TEST_PROGRESS@@')).toEqual(['a', '', 'b']);
  expect(summaryCounts(['a', 'b', 'c', 'd'], jobs({ a: { status: 'running' }, b: { status: 'failed', failed: 1 },
    c: { status: 'completed', failed: 0 }, d: { status: 'completed', failed: 2 } }))).toEqual({ passed: 1, failed: 2, total: 4 });
  expect(outcomeText(job({ status: 'completed', total: 1 })).text).toBe('· 1');
  expect(outcomeText(job({ status: 'completed', total: 0 })).text).toBe('-');
  expect(outcomeText(job({ status: 'completed', total: null, adapter: 'exit', exitCode: 0 })).text).toBe('exit 0');
  expect(outcomeText(job({ status: 'completed', total: null })).text).toBe('total desconhecido');
  expect(compactPercent(job({ total: 4, percent: 50, totalStable: true }))).toBe('50%');
  expect(compactPercent(job({ status: 'running', total: 4, percent: 50, totalStable: false }))).toBe('~50%');
  expect(compactPercent(job({ status: 'failed', total: 4, percent: 100, totalStable: false }))).toBe('100%');
  expect(compactPercent(job({ total: null, percent: null }))).toBe('—');
  expect(compactPercent(job({ total: 0, percent: null }))).toBe('sem testes');
  expect(compactCounts(job({ passed: 4, failed: 0, skipped: 1 })).map(count => count.text)).toEqual(['✓4', '⊘ 1']);
  expect([clock(57000), clock(7200000), clock(undefined)]).toEqual(['0:57', '2:00:00', '']);
});
