import { expect, test } from 'claude-code/testing';
import type { PromptAutocompleteInput, PromptAutocompleteResult } from 'claude-code';

const module = (id: string, order = 0, overrides = {}) => ({ id, label: 'Suíte', language: 'Python',
  order, enabled: true, directoryPresent: true, origin: 'workspace', diagnostics: [], ...overrides });
const job = (moduleId: string, overrides = {}) => ({ schemaVersion: 1, moduleId, runId: `run-${moduleId}`,
  source: 'config', status: 'running', phase: 'executing-tests', total: 4, totalStable: false,
  resolved: 4, passed: 2, failed: 1, skipped: 1, percent: 100, cwd: '/work',
  command: ['python', 'suite.py'], exitCode: null, ...overrides });
const data = (modules = {}, jobs = {}) => ({
  schemaVersion: 1, ok: true, modules, jobs, stateDiagnostics: {},
  workspace: { moduleConfig: { status: Object.keys(modules).length ? 'valid' : 'absent',
    schemaVersion: Object.keys(modules).length ? 1 : null,
    enabledIds: Object.keys(modules).filter(id => modules[id].enabled) }, stateBlocked: false },
});
const response = value => ({ value: { exitCode: value.ok ? 0 : 1, stderr: '', stdout: JSON.stringify(value) } });
// The kit raises the event through `$.prompt.autocomplete`; the typings list it among events, not calls.
type Autocomplete = (e: PromptAutocompleteInput) => Promise<PromptAutocompleteResult>;
const typed = (text: string) => { const start = text.search(/\S*$/); return { text, cursor: text.length, token: text.slice(start), start }; };
const offered = async ($, text: string) =>
  (await ($.prompt as unknown as { autocomplete: Autocomplete }).autocomplete(typed(text))).suggestions.map(row => row.text);

function engine(on, current, owner = 'test-progress') {
  on('session.cwd', () => ({ value: '/work' }));
  on('session.id', () => ({ value: 'owner' }));
  on('command.list', () => ({ value: [{ name: 'test-progress', source: 'plugin', plugin: owner }] }));
  on('process.run', () => response(current()));
  on('prompt.autocomplete', () => ({ suggestions: [{ text: 'beneath' }] }));
}

test('suggests actions, then the modules each action reaches, with labels beside them', async ($, on) => {
  const current = data({ api: module('api', 0, { label: 'Backend' }), web: module('web', 1, { label: 'Frontend' }),
    old: module('old', 2, { enabled: false }) });
  engine(on, () => current);
  await $.command.run({ command: 'test-progress', args: 'list --text' });
  // No run to stop: cancel stays out.
  expect(await offered($, '/test-progress s')).toEqual(['beneath', 'start', 'status']);
  expect(await offered($, '/test-progress c')).toEqual(['beneath']);
  expect(await offered($, '/test-progress l')).toEqual(['beneath', 'logs', 'list']);
  // A disabled module is never offered; `all` closes the list.
  expect(await offered($, '/test-progress start a')).toEqual(['beneath', 'api', 'all']);
  expect(await offered($, '/test-progress start --text w')).toEqual(['beneath', 'web']);
  expect(await offered($, '/test-progress logs front')).toEqual(['beneath', 'web']);
  const rows = (await ($.prompt as unknown as { autocomplete: Autocomplete }).autocomplete(typed('/test-progress start a'))).suggestions;
  expect(rows[1]).toEqual({ text: 'api', description: 'Backend' });
  expect(await offered($, '/test-progress start -')).toEqual(['beneath', '--text']);
  // Past the module, after an action without one, and on other drafts: nothing of ours.
  expect(await offered($, '/test-progress start api a')).toEqual(['beneath']);
  expect(await offered($, '/test-progress help x')).toEqual(['beneath']);
  expect(await offered($, '/other s')).toEqual(['beneath']);
  expect(await offered($, 'start a')).toEqual(['beneath']);
});

test('cancel appears with a live run and offers only the runs it can stop', async ($, on) => {
  const current = data({ api: module('api'), web: module('web', 1) }, { api: job('api'),
    web: job('web', { status: 'completed', exitCode: 0 }) });
  engine(on, () => current);
  await $.command.run({ command: 'test-progress', args: 'list --text' });
  expect(await offered($, '/test-progress c')).toEqual(['beneath', 'cancel']);
  expect(await offered($, '/test-progress cancel a')).toEqual(['beneath', 'api', 'all']);
  expect(await offered($, '/test-progress cancel w')).toEqual(['beneath']);
  const rows = (await ($.prompt as unknown as { autocomplete: Autocomplete }).autocomplete(typed('/test-progress start a'))).suggestions;
  expect(rows[1]).toEqual({ text: 'api', description: 'Suíte (api) · em execução' });
});

test('a command name owned elsewhere gets no suggestions from this plugin', async ($, on) => {
  engine(on, () => data({ api: module('api') }), 'another');
  on('command.run', () => ({}));
  await $.command.run({ command: 'test-progress', args: 'list --text' });
  expect(await offered($, '/test-progress s')).toEqual(['beneath']);
});
