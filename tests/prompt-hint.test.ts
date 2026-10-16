import { expect, test } from 'claude-code/testing';
import type { PromptEditInput, PromptEditResult } from 'claude-code';

const module = (id: string, order = 0, overrides = {}) => ({ id, label: 'Suíte', language: 'Python',
  order, enabled: true, directoryPresent: true, origin: 'workspace', diagnostics: [], ...overrides });
const data = (modules = {}) => ({
  schemaVersion: 1, ok: true, modules, jobs: {}, stateDiagnostics: {},
  workspace: { moduleConfig: { status: Object.keys(modules).length ? 'valid' : 'absent',
    schemaVersion: Object.keys(modules).length ? 1 : null,
    enabledIds: Object.keys(modules).filter(id => modules[id].enabled) }, stateBlocked: false },
});
const response = value => ({ value: { exitCode: value.ok ? 0 : 1, stderr: '', stdout: JSON.stringify(value) } });
// The kit raises the event through `$.prompt.edit`; the typings list it among events, not calls.
type Edit = (e: PromptEditInput) => Promise<PromptEditResult>;
// The person types `text`'s last character at the end of the draft before it.
const typing = (text: string): PromptEditInput => ({ origin: { kind: 'composer' }, text: text.slice(0, -1),
  cursor: text.length - 1, start: text.length - 1, end: text.length - 1, inputText: text.slice(-1) });
const hint = async ($, text: string) => {
  const box = await ($.prompt as unknown as { edit: Edit }).edit(typing(text));
  return (box.decorations ?? []).map(d => d.virtualText).filter(Boolean).join('');
};

function engine(on, version: string) {
  on('session.cwd', () => ({ value: '/work' }));
  on('session.id', () => ({ value: 'owner' }));
  on('session.version', () => ({ value: { version, base: version } }));
  on('session.start', () => ({ cwd: '/work' }));
  on('command.list', () => ({ value: [] }));
  on('command.register', () => ({ value: undefined }));
  on('tool.register', () => ({ value: { tool: 'mcp__test-progress__tests' } }));
  on('process.run', () => response(data({ api: module('api', 0, { label: 'Backend' }), web: module('web', 1, { label: 'Frontend' }) })));
  on('prompt.edit', ($, e: PromptEditInput) => {
    const text = e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end);
    return { text, cursor: e.start + e.inputText.length };
  });
}

test('the draft shows the module an action waits for, and the rest of the one row a start names', async ($, on) => {
  engine(on, '2.1.301');
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' });
  expect(await hint($, '/test-progress start ')).toBe('módulo | all');
  expect(await hint($, '/test-progress logs --text ')).toBe('módulo | all');
  expect(await hint($, '/test-progress star')).toBe('t');
  expect(await hint($, '/test-progress start w')).toBe('eb');
  // Two rows still fit, the bare command keeps the engine's own hint, and other drafts get none.
  expect(await hint($, '/test-progress st')).toBe('');
  expect(await hint($, '/test-progress start a')).toBe('');
  expect(await hint($, '/test-progress ')).toBe('');
  expect(await hint($, '/test-progress help ')).toBe('');
  expect(await hint($, 'start w')).toBe('');
});

test('an engine before 2.1.300 paints no hint', async ($, on) => {
  engine(on, '2.1.299');
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' });
  expect(await hint($, '/test-progress start ')).toBe('');
});
