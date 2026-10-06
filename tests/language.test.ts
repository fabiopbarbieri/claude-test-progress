import { expect, test } from 'claude-code/testing';
import { parseCommand, visibleModuleIds, validateEnvelope, progressText, sanitizeTail, moduleTitle,
  statusGlyph, progressBar, compactPercent, compactCounts, clock, readableTail, summaryLine, outcomeText } from '../runner/module-presentation.mjs';

test('titles preserve labels and IDs even when modules share a language or label', () => {
  expect(moduleTitle('api', { label: 'Suíte', language: 'Python' })).toBe('Suíte · api');
  expect(moduleTitle('worker', { label: 'Suíte', language: 'Python' })).toBe('Suíte · worker');
  expect(moduleTitle('backend', { label: 'Backend', language: 'Ruby' })).toBe('Backend · backend');
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
  expect(progressText({ total: null, percent: null })).toBe('— [ total desconhecido ]');
  expect(progressText({ total: 0, percent: null })).toBe('— [ sem testes ]');
  expect(sanitizeTail(['\u001b[31mvermelho\u001b[0m\r\u0000', '\u001b]8;;https://example.test\u0007link\u001b]8;;\u0007'])).toEqual(['vermelho', 'link']);
});

test('catalogue order plus retained recovery and state-only diagnostics exclude retired modules', () => {
  const modules = { z: { enabled: true, order: 2 }, b: { enabled: true, order: 1 }, a: { enabled: true, order: 1 }, old: { enabled: false, order: 0 } };
  const jobs = { old: { status: 'completed' }, retired: { status: 'completed' }, lost: { status: 'error', recoveryRequired: true }, running: { status: 'running' } };
  expect(visibleModuleIds(modules, jobs, { locked: [{ blocking: true }], '*': [{ blocking: true }] })).toEqual(['a', 'b', 'z', 'locked', 'lost', 'running']);
});

test('compact vocabulary: one-column glyphs, bars, partial totals, omitted zeros and clock', () => {
  expect(statusGlyph(undefined)).toEqual({ glyph: '○', color: 'inactive' });
  expect(statusGlyph({ status: 'running', phase: 'executing-tests' })).toEqual({ glyph: '●', color: 'warning' });
  expect(statusGlyph({ status: 'running', phase: 'cancellation-requested' })).toEqual({ glyph: '◌', color: 'inactive' });
  expect(statusGlyph({ status: 'completed', failed: 0 })).toEqual({ glyph: '✓', color: 'success' });
  expect(statusGlyph({ status: 'failed', failed: 2 })).toEqual({ glyph: '✗', color: 'error' });
  expect(statusGlyph({ status: 'cancelled' })).toEqual({ glyph: '■', color: 'inactive' });
  expect(statusGlyph({ status: 'error', recoveryRequired: true })).toEqual({ glyph: '!', color: 'error' });
  expect(progressBar({ total: 4, percent: 50 }, 4)).toEqual({ done: '━━', rest: '━━' });
  expect(progressBar({ total: null, percent: null }, 4)).toEqual({ done: '', rest: '╌╌╌╌' });
  expect(readableTail(['a', '@@TEST_PROGRESS@@{}', '', '', 'b', ''], '@@TEST_PROGRESS@@')).toEqual(['a', '', 'b']);
  expect(summaryLine(['a', 'b'], { a: { status: 'running' }, b: { status: 'failed', failed: 1 } }).map(part => part.text))
    .toEqual(['2 módulos', '1 rodando', '1 falha']);
  expect(outcomeText({ status: 'completed', total: 1 }).text).toBe('· 1 teste');
  expect(outcomeText({ status: 'completed', total: null, adapter: 'exit', exitCode: 0 }).text).toBe('exit 0');
  expect(outcomeText({ status: 'completed', total: null }).text).toBe('total desconhecido');
  expect(compactPercent({ total: 4, percent: 50, totalStable: true })).toBe('50%');
  expect(compactPercent({ status: 'running', total: 4, percent: 50, totalStable: false })).toBe('~50%');
  expect(compactPercent({ status: 'failed', total: 4, percent: 100, totalStable: false })).toBe('100%');
  expect(compactPercent({ total: null, percent: null })).toBe('—');
  expect(compactPercent({ total: 0, percent: null })).toBe('sem testes');
  expect(compactCounts({ passed: 4, failed: 0, skipped: 1 }).map(count => count.text)).toEqual(['✓4', '⊘ 1']);
  expect([clock(57000), clock(7200000), clock(undefined)]).toEqual(['0:57', '2:00:00', '']);
});
