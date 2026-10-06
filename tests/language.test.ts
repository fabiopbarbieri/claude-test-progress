import { expect, test } from 'claude-code/testing';
import { parseCommand, visibleModuleIds, validateEnvelope, progressText, sanitizeTail, moduleTitle } from '../runner/module-presentation.mjs';

test('v2 titles preserve labels and IDs even when modules share a language or label', () => {
  expect(moduleTitle('api', { label: 'Suíte', language: 'Python' })).toBe('Suíte · api');
  expect(moduleTitle('worker', { label: 'Suíte', language: 'Python' })).toBe('Suíte · worker');
  expect(moduleTitle('backend', { label: 'Backend', language: 'Ruby' })).toBe('Backend · backend');
});

test('slash requires explicit start and rejects removed demo and lane shortcuts', () => {
  expect(parseCommand('')).toEqual({ action: 'status', moduleId: 'all', text: false });
  expect(parseCommand('start api --text')).toEqual({ action: 'start', moduleId: 'api', text: true });
  for (const raw of ['backend', 'frontend', 'all', 'demo', '--demo', 'start', 'start ../api', 'list api', 'help api', 'start API', 'status --lane api']) expect(() => parseCommand(raw)).toThrow();
});

test('v2 collector envelope rejects legacy data and malformed snapshots', () => {
  const envelope = { schemaVersion: 2, ok: true, modules: {}, jobs: {}, workspace: {
    moduleConfig: { status: 'absent', schemaVersion: null, enabledIds: [] }, stateBlocked: false }, stateDiagnostics: {} };
  expect(validateEnvelope(envelope)).toBe(envelope);
  expect(() => validateEnvelope({ schema: 1, ok: true, lanes: {} })).toThrow();
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
