import { expect, mock, test } from 'claude-code/testing';
import type { On } from 'claude-code';
const TOOL = 'mcp__test-progress__tests';
const module = (id = 'api', overrides = {}) => ({ id, label: 'API', language: null, order: 0,
  enabled: true, directoryPresent: true, origin: 'workspace', diagnostics: [], ...overrides });
const job = (moduleId = 'api', overrides = {}) => ({ schemaVersion: 1, moduleId, runId: `run-${moduleId}`, source: 'config',
  status: 'completed', phase: 'finished', total: 2, totalStable: true, resolved: 2, passed: 2, failed: 0, skipped: 0,
  percent: 100, exitCode: 0, logTail: ['ok'], ...overrides });
const data = (modules: Record<string, unknown> = { api: module() }, jobs: Record<string, unknown> = {}, extra = {}) => ({
  schemaVersion: 1, ok: true, modules, jobs, stateDiagnostics: {},
  workspace: { moduleConfig: { status: 'valid', schemaVersion: 1, enabledIds: Object.keys(modules) }, stateBlocked: false },
  sources: { state: '/state', paths: ['/work/.claude/test-progress.json'] }, collector: { path: '/usr/bin/node', source: 'path' }, ...extra });
const response = (value: { ok: boolean }) => ({ value: { exitCode: value.ok ? 0 : 1, stderr: '', stdout: JSON.stringify(value),
  isStdoutTruncated: false, isStderrTruncated: false } });
const session = (on: On, calls: string[][], current: () => unknown) => {
  on('session.cwd', () => ({ value: '/work' })); on('session.id', () => ({ value: 'owner' }));
  on('process.run', ($, e) => { calls.push([...e.argv]); return response(current() as { ok: boolean }); });
};
const actionsOf = (calls: string[][]) => calls.map(argv => `${argv[2]} ${argv[argv.indexOf('--module') + 1]}`);

test('session.start registers the tool in the prompt list, outside tool search', async ($, on) => {
  const specs: any[] = [];
  session(on, [], () => data());
  on('session.start', () => ({ cwd: '/work' })); on('command.list', () => ({ value: [] })); on('command.register', ($, e) => ({ value: { command: e.name } }));
  on('tool.register', ($, e) => { specs.push(e); return { value: { tool: TOOL } }; });
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' });
  expect(specs).toHaveLength(1);
  expect(specs[0]).toMatchObject({ name: 'tests', isDeferred: false,
    inputSchema: { required: ['action'], properties: { action: { enum: ['list', 'start', 'status', 'logs', 'cancel', 'history'] } } } });
});

test('reading needs no permission, uses the session folder and owner, and answers the envelope without bookkeeping', async ($, on) => {
  const calls: string[][] = []; let checks = 0;
  let current = data({ api: module() }, { api: job() });
  session(on, calls, () => current);
  on('tool.check', () => { checks++; return { decision: 'deny' }; });
  for (const action of ['list', 'status', 'logs']) {
    const answer = await $.tool.call({ tool: TOOL, action, module: 'api' } as never) as { result: string };
    const parsed = JSON.parse(answer.result);
    expect(parsed.jobs.api.logTail).toEqual(['ok']);
    expect(parsed.collector).toBeUndefined(); expect(parsed.sources).toBeUndefined();
  }
  expect(checks).toBe(0);
  expect(actionsOf(calls)).toEqual(['list all', 'status api', 'logs api']);
  expect(calls[0]).toEqual(expect.arrayContaining(['--cwd', '/work', '--owner', 'owner']));
  // One module answers with its own entry and job; list and all keep the catalogue.
  current = data({ api: module(), web: module('web') }, { api: job(), web: job('web') });
  const one = JSON.parse((await $.tool.call({ tool: TOOL, action: 'status', module: 'web' } as never) as { result: string }).result);
  expect(Object.keys(one.modules)).toEqual(['web']); expect(Object.keys(one.jobs)).toEqual(['web']);
  const every = JSON.parse((await $.tool.call({ tool: TOOL, action: 'status' } as never) as { result: string }).result);
  expect(Object.keys(every.jobs).sort()).toEqual(['api', 'web']);
});

test('start refreshes first and refuses what the pane refuses: a live run, diagnostics, an unknown ID', async ($, on) => {
  const calls: string[][] = [];
  let current = data({ api: module(), web: module('web', { diagnostics: [{ code: 'missing', message: 'Diretório ausente.' }] }) },
    { api: job('api', { status: 'running', exitCode: null }) });
  session(on, calls, () => current);
  on('tool.check', () => ({ decision: 'allow' }));
  const live = await $.tool.call({ tool: TOOL, action: 'start', module: 'api' } as never) as { deny?: string };
  expect(live.deny).toContain('acompanhe com status');
  const broken = await $.tool.call({ tool: TOOL, action: 'start', module: 'web' } as never) as { deny?: string };
  expect(broken.deny).toContain('Diretório ausente.');
  const unknown = await $.tool.call({ tool: TOOL, action: 'start', module: 'nope' } as never) as { deny?: string };
  expect(unknown.deny).toContain('não cadastrado');
  const all = await $.tool.call({ tool: TOOL, action: 'start', module: 'all' } as never) as { deny?: string };
  expect(all.deny).toContain('api:'); expect(all.deny).toContain('web:');
  expect(actionsOf(calls).every(action => action === 'status all')).toBe(true);
  current = data({ api: module() }, { api: job() });
  const started = await $.tool.call({ tool: TOOL, action: 'start', module: 'api' } as never) as { result: string };
  expect(JSON.parse(started.result).ok).toBe(true);
  expect(actionsOf(calls).slice(-2)).toEqual(['status all', 'start api']);
});

test('start and cancel follow the permission rules: deny refuses, ask asks the person', async ($, on) => {
  const calls: string[][] = []; let decision = 'deny'; let answer = 'Recusar'; const questions: string[] = [];
  session(on, calls, () => data({ api: module() }, { api: job('api', { status: 'running', exitCode: null, cancellable: true }) }));
  // On 2.1.323 the person's question (AskUserQuestion) passes its own tool.check too (2.1.301 raises none): only this tool's verdict is the test's.
  let checks = 0;
  on('tool.check', ($, e, next) => {
    if (e.tool !== TOOL) return next(e);
    checks++; return { decision, reason: 'regra do projeto' } as never;
  });
  on('tool.call', { tool: 'AskUserQuestion' }, ($, e: any) => {
    questions.push(e.questions[0].question);
    return { result: { questions: e.questions, answers: { [e.questions[0].question]: answer } } };
  });
  const denied = await $.tool.call({ tool: TOOL, action: 'cancel', module: 'api' } as never) as { deny?: string };
  expect(denied.deny).toContain('regra do projeto');
  decision = 'ask';
  const refused = await $.tool.call({ tool: TOOL, action: 'cancel', module: 'api' } as never) as { deny?: string };
  expect(refused.deny).toContain('recusou');
  expect(calls).toHaveLength(0);
  answer = 'Permitir';
  const cancelled = await $.tool.call({ tool: TOOL, action: 'cancel', module: 'api' } as never) as { result?: string };
  expect(cancelled.result).toBeDefined();
  expect(questions).toEqual(['Cancelar os testes do módulo api?', 'Cancelar os testes do módulo api?']);
  expect(actionsOf(calls)).toEqual(['cancel api']);
  expect(checks).toBe(3);
});

test('a refused collector answer still reaches the model with its catalogue; bad input never runs it', async ($, on) => {
  const calls: string[][] = [];
  session(on, calls, () => data({ api: module() }, {}, { ok: false, error: 'Estado bloqueado pelo fixture.' }));
  const answer = await $.tool.call({ tool: TOOL, action: 'status' } as never) as { result: string };
  expect(JSON.parse(answer.result)).toMatchObject({ ok: false, error: 'Estado bloqueado pelo fixture.', modules: { api: { id: 'api' } } });
  for (const input of [{ action: 'help' }, { action: 'status', module: '../x' }, { action: 'status', module: 3 }]) {
    expect((await $.tool.call({ tool: TOOL, ...input } as never) as { deny?: string }).deny).toBeDefined();
  }
  expect(calls).toHaveLength(1);
});

test('a subagent in another folder is refused, one in the pane folder is served, before the collector or the pane identity is touched', async ($, on) => {
  const calls: string[][] = []; let cwd = '/work';
  on('session.cwd', () => ({ value: cwd })); on('session.id', () => ({ value: 'owner' }));
  on('session.version', () => ({ value: { version: '2.1.296', base: '2.1.296' } }));
  on('process.run', ($, e) => { calls.push([...e.argv]); return response(data()); });
  await $.tool.call({ tool: TOOL, action: 'status' } as never);
  cwd = '/work/.claude/worktrees/agent-x';
  const refused = await $.tool.call({ tool: TOOL, action: 'status', agentId: 'agent-x' } as never) as { deny?: string };
  expect(refused.deny).toContain('test-progress:run-tests');
  expect(calls).toHaveLength(1);
  // The same folder as the pane is served like the main session.
  cwd = '/work';
  const served = await $.tool.call({ tool: TOOL, action: 'status', agentId: 'agent-y' } as never) as { result?: string };
  expect(served.result).toBeDefined();
  expect(calls).toHaveLength(2);
});

test('before 2.1.296 a subagent is refused even in the pane folder, since its own folder is unknown', async ($, on) => {
  const calls: string[][] = []; let base = '2.1.295';
  on('session.cwd', () => ({ value: '/work' })); on('session.id', () => ({ value: 'owner' }));
  on('session.version', () => ({ value: { version: base, base } }));
  on('process.run', ($, e) => { calls.push([...e.argv]); return response(data()); });
  await $.tool.call({ tool: TOOL, action: 'status' } as never);
  const refused = await $.tool.call({ tool: TOOL, action: 'status', agentId: 'agent-x' } as never) as { deny?: string };
  expect(refused.deny).toContain('não informa o diretório de um subagente');
  expect(calls).toHaveLength(1);
  base = '2.1.296';
  const served = await $.tool.call({ tool: TOOL, action: 'status', agentId: 'agent-x' } as never) as { result?: string };
  expect(served.result).toBeDefined();
});

test('history keeps each finished run between sessions and answers it as named series, without the collector', async ($, on) => {
  const calls: string[][] = []; let cwd = '/work';
  mock.store(on);
  on('session.cwd', () => ({ value: cwd })); on('session.id', () => ({ value: 'owner' }));
  let current = data({ api: module(), web: module('web') }, {
    api: job('api', { runId: 'r1', passed: 40, failed: 2, startedAt: '2026-11-20T10:00:00.000Z', endedAt: '2026-11-20T10:05:00.000Z' }),
    web: job('web', { status: 'running', exitCode: null, endedAt: null }) });
  on('process.run', ($, e) => { calls.push([...e.argv]); return response(current); });
  const history = async (module?: string) =>
    (await $.tool.call({ tool: TOOL, action: 'history', ...(module ? { module } : {}) } as never) as { result: string }).result;
  expect(await history('api')).toContain('Sem histórico do módulo api');
  await $.tool.call({ tool: TOOL, action: 'status' } as never);
  // A refresh that sees the same run again records it once; cancelled, error and running runs stay out.
  current = data({ api: module(), web: module('web') }, {
    api: job('api', { runId: 'r1', passed: 40, failed: 2, startedAt: '2026-11-20T10:00:00.000Z', endedAt: '2026-11-20T10:05:00.000Z' }),
    web: job('web', { runId: 'w1', status: 'cancelled', endedAt: '2026-11-20T11:00:00.000Z' }) });
  await $.tool.call({ tool: TOOL, action: 'status' } as never);
  current = data({ api: module(), web: module('web') }, {
    api: job('api', { runId: 'r2', passed: 43, failed: 0, skipped: 0, endedAt: '2026-11-21T10:00:00.000Z' }),
    web: job('web', { runId: 'w2', status: 'error', endedAt: '2026-11-21T11:00:00.000Z' }) });
  await $.tool.call({ tool: TOOL, action: 'status' } as never);
  const before = calls.length;
  expect(JSON.parse(await history('api'))).toEqual({ series: [
    { name: 'passed', data: [['2026-11-20T10:05:00.000Z', 40], ['2026-11-21T10:00:00.000Z', 43]] },
    { name: 'failed', data: [['2026-11-20T10:05:00.000Z', 2], ['2026-11-21T10:00:00.000Z', 0]] }] });
  expect(calls).toHaveLength(before);
  expect(await history('web')).toContain('Sem histórico do módulo web');
  // all names each series by module; skipped appears where some run skipped tests.
  current = data({ api: module(), web: module('web') }, { web: job('web', { runId: 'w3', passed: 5, skipped: 1, endedAt: '2026-11-22T09:00:00.000Z' }) });
  await $.tool.call({ tool: TOOL, action: 'status' } as never);
  expect(JSON.parse(await history()).series.map((item: { name: string }) => item.name))
    .toEqual(['api passed', 'api failed', 'web passed', 'web failed', 'web skipped']);
  // Another folder has its own history.
  cwd = '/other';
  expect(await history()).toContain('Sem histórico neste diretório');
});

test('history keeps the newest 50 runs of a module', async ($, on) => {
  mock.store(on);
  on('session.cwd', () => ({ value: '/work' })); on('session.id', () => ({ value: 'owner' }));
  let index = 0;
  on('process.run', () => response(data({ api: module() }, { api: job('api', { runId: `r${index}`, passed: index,
    endedAt: new Date(Date.UTC(2026, 10, 1) + index * 60000).toISOString() }) })));
  for (; index < 55; index++) await $.tool.call({ tool: TOOL, action: 'status', module: 'api' } as never);
  const passed = JSON.parse((await $.tool.call({ tool: TOOL, action: 'history', module: 'api' } as never) as { result: string }).result).series[0].data;
  expect(passed).toHaveLength(50);
  expect(passed[0][1]).toBe(5); expect(passed[49][1]).toBe(54);
});

test('a store read that fails records nothing and erases nothing; the next refresh records the run', async ($, on) => {
  const kept: Record<string, unknown> = {}; let failRead = false;
  on('store.get', ($, e) => { if (failRead) throw new Error('store unavailable'); return { value: kept[e.key] }; });
  on('store.set', ($, e) => { kept[e.key] = e.value; return { value: undefined }; });
  on('session.cwd', () => ({ value: '/work' })); on('session.id', () => ({ value: 'owner' }));
  let current = data({ api: module() }, { api: job('api', { runId: 'r1', passed: 1, endedAt: '2026-11-20T10:00:00.000Z' }) });
  on('process.run', () => response(current));
  await $.tool.call({ tool: TOOL, action: 'status' } as never);
  failRead = true;
  current = data({ api: module() }, { api: job('api', { runId: 'r2', passed: 2, endedAt: '2026-11-21T10:00:00.000Z' }) });
  await $.tool.call({ tool: TOOL, action: 'status' } as never);
  expect((kept.history as any)['/work'].api.map((run: { runId: string }) => run.runId)).toEqual(['r1']);
  failRead = false;
  await $.tool.call({ tool: TOOL, action: 'status' } as never);
  expect((kept.history as any)['/work'].api.map((run: { runId: string }) => run.runId)).toEqual(['r1', 'r2']);
});
