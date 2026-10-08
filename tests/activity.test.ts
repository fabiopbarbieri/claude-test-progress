import { expect, mock, test } from 'claude-code/testing';
const running = { schemaVersion: 1, moduleId: 'api', runId: 'fixture-long-job', source: 'config',
  status: 'running', phase: 'executing-tests', total: 2, totalStable: false, resolved: 1,
  passed: 1, failed: 0, skipped: 0, percent: 50, exitCode: null, logPath: '/tmp/fixture.log',
  elapsedMs: 7200000, heartbeatAt: '2026-01-01T02:00:00.000Z', heartbeatAgeMs: 1000,
  lastOutputAt: '2026-01-01T00:00:01.000Z', lastProgressAt: '2026-01-01T00:00:01.000Z' };
const module = (id = 'api', label = 'API') => ({ id, label, language: null, order: 0,
  enabled: true, directoryPresent: true, origin: 'workspace', diagnostics: [] });
const data = (modules = { api: module() }, jobs = { api: running }) => ({ schemaVersion: 1, ok: true,
  modules, jobs, stateDiagnostics: {}, workspace: { moduleConfig: {
    status: 'valid', schemaVersion: 1, enabledIds: Object.keys(modules) }, stateBlocked: false } });
const response = (value = data()) => ({ value: { exitCode: 0, stderr: '', stdout: JSON.stringify(value) } });
const pane = { plugin: 'test-progress', component: 'Pane', requestId: 'claude-test-progress', surface: 'terminal',
  viewport: { columns: 80, rows: 25 }, props: { title: 'Test Progress', isFocused: true,
    bodyColumns: 70, placement: 'inline', scroll: { offset: 0, bodyRows: 20 }, view: {} } };

test('text status distinguishes quiet activity, uses module flag and short queries; start budget is 60s', async ($, on) => {
  const calls: any[] = [];
  on('session.cwd', () => ({ value: '/work' })); on('session.id', () => ({ value: 'owner' }));
  on('command.list', () => ({ value: [{ name: 'test-progress', source: 'plugin', plugin: 'test-progress' }] }));
  on('process.run', ($, e) => { calls.push(e); return response(); });
  const answer = await $.command.run({ command: 'test-progress', args: 'status --text' });
  for (const value of ['Em execução', '1 resolvidos', 'duração=7200s',
    'último sinal do executor=2026-01-01T02:00:00.000Z',
    'último progresso reconhecido=2026-01-01T00:00:01.000Z', 'exitCode=ainda desconhecido']) expect(answer.text).toContain(value);
  expect(calls[0].argv[2]).toBe('status'); expect(calls[0].init.timeoutMs).toBe(5000);
  expect(calls[0].argv).toContain('--module');
  await $.command.run({ command: 'test-progress', args: 'start api --text' });
  expect(calls[1].init.timeoutMs).toBe(60000);
});

test('native Windows uses Module and 15s query budget, with a 60s start budget', async ($, on) => {
  const calls: any[] = [];
  on('session.cwd', () => ({ value: 'C:\\work' })); on('session.id', () => ({ value: 'owner' }));
  on('command.list', () => ({ value: [{ name: 'test-progress', source: 'plugin', plugin: 'test-progress' }] }));
  on('env.get', () => ({ value: undefined }));
  on('process.run', ($, e) => { calls.push(e); return response(); });
  await $.command.run({ command: 'test-progress', args: 'status api --text' });
  expect(calls[0].argv).toContain('-Module');
  expect(calls[0].init.timeoutMs).toBe(15000);
  await $.command.run({ command: 'test-progress', args: 'start api --text' });
  expect(calls[1].init.timeoutMs).toBe(60000);
});

test('failed query retries without implicit start or cancel and an unknown schema is rejected', async ($, on) => {
  const actions: string[] = [];
  on('session.cwd', () => ({ value: '/work' })); on('session.id', () => ({ value: 'owner' }));
  on('command.list', () => ({ value: [{ name: 'test-progress', source: 'plugin', plugin: 'test-progress' }] }));
  on('process.run', ($, e) => {
    actions.push(e.argv[2]);
    if (actions.length === 1) return { deny: 'fixture query timed out' };
    if (actions.length === 3) return response({ ...data(), schemaVersion: 2 });
    return response();
  });
  expect((await $.command.run({ command: 'test-progress', args: '--text' })).text).toContain('fixture query timed out');
  expect((await $.command.run({ command: 'test-progress', args: '--text' })).text).toContain('runId=fixture-long-job');
  const unknown = await $.command.run({ command: 'test-progress', args: '--text' });
  expect(unknown.text).toContain('schemaVersion 1'); expect(unknown.text).toContain('runId=fixture-long-job');
  expect(actions).toEqual(['status', 'status', 'status']);
});

test('registration collision does not stop polling and repeated startup keeps one timer', async ($, on) => {
  const clock = mock.clock(on); const actions: string[] = [];
  let registered = 0;
  on('session.cwd', () => ({ value: '/work' })); on('session.id', () => ({ value: 'owner' }));
  on('session.start', () => ({ cwd: '/work' }));
  on('command.list', () => ({ value: [] }));
  on('command.register', () => { registered++; return { deny: 'name already belongs to another command' }; });
  on('command.run', { command: 'test-progress' }, () => ({ text: 'existing handler response', context: ['existing context'] }));
  on('process.run', ($, e) => { actions.push(e.argv[2]); return response(); });
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' });
  await clock.advance(2000); expect(actions).toEqual(['status', 'status', 'status']);
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' });
  await clock.advance(1000);
  expect(actions).toEqual(['status', 'status', 'status', 'status', 'status']); expect(registered).toBe(2);
  const ui = await $.ui.mount(pane);
  expect(await ui.find({ type: 'Text', text: /Registro:[\s\S]*name already belongs to another command/ })).toBeDefined();
  const answer = await $.command.run({ command: 'test-progress', args: 'start all --text' });
  expect(answer.text).toBe('existing handler response'); expect(answer.context).toEqual(['existing context']);
  expect(actions.every(action => action === 'status')).toBe(true);
  await ui.unmount();
});

test('polling refreshes the catalogue and all jobs, re-reading only the live selected log; owner changes clear tails and return restores jobs', async ($, on) => {
  const clock = mock.clock(on); let owner = 'A'; let current = data();
  const calls: any[] = [];
  on('session.cwd', () => ({ value: '/work' })); on('session.id', () => ({ value: owner }));
  on('session.start', () => ({ cwd: '/work' })); on('command.register', () => ({ value: undefined }));
  on('command.list', () => ({ value: [{ name: 'test-progress', source: 'plugin', plugin: 'test-progress' }] }));
  on('process.run', ($, e) => { calls.push(e.argv); return response(current); });
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' });
  const ui = await $.ui.mount(pane);
  current = data({ api: module('api', 'Renomeada') }, {}); await clock.advance(1000);
  expect(await ui.find({ type: 'Text', text: 'Renomeada' })).toBeDefined();
  current.jobs.api = { ...running, logTail: ['owner A log'] };
  await $.command.run({ command: 'test-progress', args: 'logs api --text' });
  current.modules.extra = module('extra', 'Nova'); await clock.advance(1000);
  expect(calls[calls.length - 1][2]).toBe('logs'); expect(calls[calls.length - 1].slice(-2)).toEqual(['--module', 'api']);
  expect(await ui.find({ key: 'module-extra' })).toBeDefined();
  owner = 'B'; current = data({}, {}); await clock.advance(1000);
  expect(await ui.find({ type: 'Text', text: 'owner A log' })).toBeUndefined();
  owner = 'A'; current = data(); await clock.advance(1000);
  expect(await ui.find({ key: 'module-api' })).toBeDefined();
  expect(calls.every(argv => ['logs', 'status'].includes(argv[2]))).toBe(true);
  await ui.unmount();
});

test('AbovePrompt is one line: active first, as many items as the width holds, and it steps aside once nothing is new', async ($, on) => {
  on('ui.render', ($, e) => $.ui.resolve(e).Box({ children: [] }));
  const modules = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`m${i}`, module(`m${i}`, `M${i}`)]));
  const jobs = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`m${i}`, { ...running, moduleId: `m${i}`, runId: `run${i}`, status: i === 11 ? 'running' : 'completed' }]));
  let current = data(modules, jobs);
  on('session.cwd', () => ({ value: '/work' })); on('session.id', () => ({ value: 'owner' }));
  on('command.list', () => ({ value: [{ name: 'test-progress', source: 'plugin', plugin: 'test-progress' }] }));
  on('process.run', () => response(current));
  await $.command.run({ command: 'test-progress', args: '--text' });
  const band = await $.ui.mount({ plugin: 'test-progress', component: 'AbovePrompt', surface: 'terminal',
    viewport: { columns: 80, rows: 25 }, props: { hasSurvey: false, isWorking: false, maxRows: 6,
      bodyColumns: 80, scroll: { offset: 0, bodyRows: 6 }, view: {} } });
  expect(await band.find({ key: 'band' })).toMatchObject({ props: { flexDirection: 'row' } });
  expect(await band.find({ key: 'summary-m11' })).toBeDefined();
  expect(await band.find({ type: 'Text', text: ' ~50%' })).toBeDefined();
  // Labels sort as text (M0, M1, M10, M2…): 80 columns hold the active item and six passed ones.
  expect(await band.find({ key: 'summary-m4' })).toBeDefined();
  expect(await band.find({ key: 'summary-m5' })).toBeUndefined();
  expect(await band.find({ type: 'Text', text: '  ·  +5' })).toBeDefined();
  // A narrow terminal still shows the first item, with the rest counted.
  const narrow = await $.ui.mount({ plugin: 'test-progress', component: 'AbovePrompt', surface: 'terminal',
    viewport: { columns: 30, rows: 25 }, props: { hasSurvey: false, isWorking: false, maxRows: 6,
      bodyColumns: 30, scroll: { offset: 0, bodyRows: 6 }, view: {} } });
  expect(await narrow.find({ key: 'summary-m11' })).toBeDefined();
  expect(await narrow.find({ key: 'summary-m0' })).toBeUndefined();
  expect(await narrow.find({ type: 'Text', text: '  ·  +11' })).toBeDefined();
  await narrow.unmount();
  expect(await band.find({ type: 'Text', text: /falha\(s\)|restante/ })).toBeUndefined();
  // Only finished, passing runs: nothing to report.
  current = data(modules, { ...jobs, m11: { ...jobs.m11, status: 'completed' } });
  await $.command.run({ command: 'test-progress', args: '--text' });
  expect(await band.find({ key: 'band' })).toBeUndefined();
  // An unseen failure shows in red until the pane is opened.
  current = data(modules, { ...jobs, m11: { ...jobs.m11, status: 'completed' }, m3: { ...jobs.m3, status: 'failed', failed: 2 } });
  await $.command.run({ command: 'test-progress', args: '--text' });
  expect(await band.find({ type: 'Text', text: ' ✗2' })).toMatchObject({ props: { color: 'error' } });
  // Using the pane acknowledges what it shows; drawing alone never writes.
  const ui = await $.ui.mount(pane);
  await $.command.run({ command: 'test-progress', args: '--text' });
  expect(await band.find({ type: 'Text', text: ' ✗2' })).toBeDefined();
  await ui.press({ key: 'help' });
  await ui.unmount();
  await $.command.run({ command: 'test-progress', args: '--text' });
  expect(await band.find({ key: 'band' })).toBeUndefined();
  current = data(modules, {}); await $.command.run({ command: 'test-progress', args: '--text' });
  expect(await band.find({ key: 'band' })).toBeUndefined();
  await band.unmount();
});

test('existing command of unknown or other ownership is preserved while polling continues', async ($, on) => {
  const clock = mock.clock(on); let registrations = 0; let calls = 0;
  on('session.cwd', () => ({ value: '/work' })); on('session.id', () => ({ value: 'owner' }));
  on('session.start', () => ({ cwd: '/work' }));
  on('command.list', () => ({ value: [{ name: 'test-progress', description: 'Other', source: 'plugin', plugin: 'other' }] }));
  on('command.register', () => { registrations++; return { value: undefined }; });
  on('command.run', { command: 'test-progress' }, () => ({ text: 'other plugin response', context: ['other context'] }));
  on('process.run', () => { calls++; return response(); });
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' });
  await clock.advance(1000);
  expect(registrations).toBe(0); expect(calls).toBe(2);
  const answer = await $.command.run({ command: 'test-progress', args: 'start api --text' });
  expect(answer.text).toBe('other plugin response'); expect(answer.context).toEqual(['other context']);
  expect(calls).toBe(2);
});

test('poll timer survives clear/resume/branch identity boundaries without implicit cancellation', async ($, on) => {
  const clock = mock.clock(on); let owner = 'A'; const actions: string[] = [];
  on('session.cwd', () => ({ value: '/work' })); on('session.id', () => ({ value: owner }));
  on('session.start', () => ({ cwd: '/work' })); on('command.list', () => ({ value: [] }));
  on('command.register', () => ({ value: undefined }));
  on('session.end', ($, e) => ({ sessionId: e.sessionId }));
  on('process.run', ($, e) => { actions.push(e.argv[2]); return response(owner === 'A' ? data() : data({}, {})); });
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' });
  for (const reason of ['clear', 'resume', 'other'] as const) {
    await $.session.end({ reason, sessionId: owner, resume: { sessionId: owner } });
    owner = owner === 'A' ? 'B' : 'A'; await clock.advance(1000);
  }
  expect(actions).toEqual(['status', 'status', 'status', 'status']);
});

test('poll and commands never overlap; a command waits for a pending request instead of being rejected', async ($, on) => {
  const clock = mock.clock(on); let release: (() => void) | undefined; let pending = false;
  const calls: string[] = []; let entered: (() => void) | undefined; let inFlight = 0; let maxInFlight = 0;
  const started = new Promise<void>(resolve => { entered = resolve; });
  on('session.cwd', () => ({ value: '/work' })); on('session.id', () => ({ value: 'owner' }));
  on('session.start', () => ({ cwd: '/work' })); on('command.list', () => ({ value: [{ name: 'test-progress', source: 'plugin', plugin: 'test-progress' }] }));
  on('command.register', () => ({ value: undefined }));
  on('process.run', async ($, e) => {
    calls.push(e.argv[2]); inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
    if (pending) { pending = false; entered?.(); await new Promise<void>(resolve => { release = resolve; }); }
    inFlight--; return response();
  });
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' });
  pending = true;
  const command = $.command.run({ command: 'test-progress', args: 'status --text' });
  await started; await clock.advance(2000);
  const waiting = $.command.run({ command: 'test-progress', args: 'start api --text' });
  expect(calls).toEqual(['status', 'status']);
  release?.(); await command;
  expect((await waiting).text).not.toContain('ocupado');
  expect(calls).toEqual(['status', 'status', 'start']); expect(maxInFlight).toBe(1);
});

test('idle workspaces poll every ten seconds and live jobs every second', async ($, on) => {
  const clock = mock.clock(on); let current = data({ api: module() }, {}); const calls: string[] = [];
  on('session.cwd', () => ({ value: '/work' })); on('session.id', () => ({ value: 'owner' }));
  on('session.start', () => ({ cwd: '/work' })); on('command.register', () => ({ value: undefined }));
  on('command.list', () => ({ value: [{ name: 'test-progress', source: 'plugin', plugin: 'test-progress' }] }));
  on('process.run', ($, e) => { calls.push(e.argv[2]); return response(current); });
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' });
  await clock.advance(9000); expect(calls).toEqual(['status']);
  await clock.advance(1000); expect(calls).toEqual(['status', 'status']);
  current = data();
  await $.command.run({ command: 'test-progress', args: 'start api --text' });
  await clock.advance(2000); expect(calls).toEqual(['status', 'status', 'start', 'status', 'status']);
});

test('later queries reuse the bootstrapped collector Node and fall back once when it disappears', async ($, on) => {
  const calls: any[] = []; let deny = false;
  on('session.cwd', () => ({ value: '/work' })); on('session.id', () => ({ value: 'owner' }));
  on('command.list', () => ({ value: [{ name: 'test-progress', source: 'plugin', plugin: 'test-progress' }] }));
  on('process.run', ($, e) => {
    calls.push(e);
    if (deny && e.argv[0] === '/opt/node/bin/node') return { deny: 'node removed' };
    return response({ ...data(), collector: { path: '/opt/node/bin/node', source: 'nvm' } });
  });
  await $.command.run({ command: 'test-progress', args: 'status --text' });
  await $.command.run({ command: 'test-progress', args: 'status --text' });
  expect(calls[0].argv[0]).toBe('bash');
  expect(calls[1].argv[0]).toBe('/opt/node/bin/node'); expect(calls[1].argv[1]).toMatch(/runner\/cli\.mjs$/);
  expect(calls[1].argv[2]).toBe('status'); expect(calls[1].init.env).toEqual({ TEST_PROGRESS_NODE_SOURCE: 'nvm' });
  deny = true;
  const answer = await $.command.run({ command: 'test-progress', args: 'status --text' });
  expect(answer.text).toContain('runId=fixture-long-job');
  expect(calls.slice(2).map(call => call.argv[0])).toEqual(['/opt/node/bin/node', 'bash']);
});

test('ownership taken after registration passes the full result to the new handler and polling stays alive', async ($, on) => {
  const clock = mock.clock(on); let plugin = 'test-progress'; const actions: string[] = [];
  on('session.cwd', () => ({ value: '/work' })); on('session.id', () => ({ value: 'owner' }));
  on('session.start', () => ({ cwd: '/work' }));
  on('command.list', () => ({ value: [{ name: 'test-progress', source: 'plugin', plugin }] }));
  on('command.register', () => ({ value: undefined }));
  on('command.run', { command: 'test-progress' }, () => ({ text: 'new owner output', context: ['new owner context'] }));
  on('process.run', ($, e) => { actions.push(e.argv[2]); return response(); });
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' });
  plugin = 'other';
  const answer = await $.command.run({ command: 'test-progress', args: 'start all --text' });
  expect(answer).toMatchObject({ text: 'new owner output', context: ['new owner context'] });
  await clock.advance(1000);
  expect(actions).toEqual(['status', 'status']);
});

test('unavailable ownership metadata passes through without parsing or collecting a start', async ($, on) => {
  const actions: string[] = [];
  on('command.list', () => ({ deny: 'command inventory unavailable' }));
  on('command.run', { command: 'test-progress' }, () => ({ text: 'host output', context: ['host context'] }));
  on('process.run', ($, e) => { actions.push(e.argv[2]); return response(); });
  const answer = await $.command.run({ command: 'test-progress', args: 'start api --text' });
  expect(answer).toMatchObject({ text: 'host output', context: ['host context'] });
  expect(actions).toEqual([]);
});

test('a placed pane acknowledges failed runs and the band steps aside', async ($, on) => {
  on('ui.render', ($, e) => $.ui.resolve(e).Box({ children: [] }));
  const current = data({ api: module() }, { api: { ...running, status: 'failed', failed: 1 } });
  on('session.cwd', () => ({ value: '/work' })); on('session.id', () => ({ value: 'owner' }));
  on('command.list', () => ({ value: [{ name: 'test-progress', source: 'plugin', plugin: 'test-progress' }] }));
  on('process.run', () => response(current));
  on('ui.panes', () => ({ value: [] }));
  on('ui.open', () => ({ value: { isPlaced: true } }));
  await $.command.run({ command: 'test-progress', args: '--text' });
  const band = await $.ui.mount({ plugin: 'test-progress', component: 'AbovePrompt', surface: 'terminal',
    viewport: { columns: 80, rows: 25 }, props: { hasSurvey: false, isWorking: false, maxRows: 6,
      bodyColumns: 80, scroll: { offset: 0, bodyRows: 6 }, view: {} } });
  expect(await band.find({ type: 'Text', text: ' ✗1' })).toBeDefined();
  await $.command.run({ command: 'test-progress', args: '' });
  expect(await band.find({ key: 'band' })).toBeUndefined();
  await band.unmount();
});

test('when every run has ended, unseen failures open the pane once on the first failed log, without focus', async ($, on) => {
  const clock = mock.clock(on); const opened: any[] = []; const logs: string[] = []; let panes: any[] = [];
  const modules = { api: module(), web: module('web', 'Web') };
  const failedApi = { ...running, status: 'failed', failed: 1, logTail: ['FAILED test_api - AssertionError'] };
  let current = data(modules, {});
  on('session.cwd', () => ({ value: '/work' })); on('session.id', () => ({ value: 'owner' }));
  on('session.start', () => ({ cwd: '/work' })); on('command.register', () => ({ value: undefined }));
  on('command.list', () => ({ value: [{ name: 'test-progress', source: 'plugin', plugin: 'test-progress' }] }));
  on('process.run', ($, e) => { if (e.argv[2] === 'logs') logs.push(e.argv[e.argv.indexOf('--module') + 1]); return response(current); });
  on('ui.panes', () => ({ value: panes }));
  on('ui.open', ($, e) => { opened.push(e); return { value: { isPlaced: true } }; });
  on('ui.render', ($, e) => $.ui.resolve(e).Box({ children: [] }));
  const notified: any[] = []; on('ui.notify', ($, e) => { notified.push(e); return { value: { isSent: true, channel: 'kitty' } }; });
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' });
  // A failure mid-run, or one module done while another still runs, waits for the whole batch.
  current = data(modules, { api: { ...running, failed: 1 }, web: { ...running, moduleId: 'web', runId: 'web-1' } }); await clock.advance(10000);
  current = data(modules, { api: failedApi, web: { ...running, moduleId: 'web', runId: 'web-1' } }); await clock.advance(3000);
  expect(opened).toEqual([]); expect(notified).toEqual([]);
  // Everything ended: one open, on the first failed module's log.
  current = data(modules, { api: failedApi, web: { ...running, moduleId: 'web', runId: 'web-1', status: 'failed', failed: 2 } });
  await clock.advance(1000);
  expect(opened).toHaveLength(1);
  expect(opened[0]).toMatchObject({ id: 'claude-test-progress', title: 'Test Progress' });
  expect(opened[0].focus).toBeUndefined();
  expect(logs).toEqual(['api']);
  // One native notification names every failed module with its count.
  expect(notified).toEqual([{ text: 'Falharam: API (1 ✗), Web (2 ✗)', title: 'Test Progress' }]);
  const view = await $.ui.mount(pane);
  expect(await view.find({ type: 'Text', text: /AssertionError/ })).toBeDefined();
  await view.unmount();
  // Closed again, it stays closed for those runs.
  await clock.advance(20000); expect(opened).toHaveLength(1); expect(notified).toHaveLength(1);
  // An existing pane is left as it is, even for a new failure.
  panes = [{ id: 'claude-test-progress', title: 'Test Progress', isShown: false }];
  current = data(modules, { api: { ...failedApi, runId: 'second' } }); await clock.advance(10000);
  expect(opened).toHaveLength(1);
  // The pane may wait for width or sit hidden; the notification still goes out.
  expect(notified.at(-1)).toMatchObject({ text: 'Falharam: API (1 ✗)' });
  // Passing runs never open it; a run that errors does.
  panes = []; current = data(modules, { api: { ...running, runId: 'third', status: 'completed' } });
  await clock.advance(10000); expect(opened).toHaveLength(1); expect(notified).toHaveLength(2);
  current = data(modules, { api: { ...running, runId: 'fourth', status: 'error' } }); await clock.advance(10000);
  expect(opened).toHaveLength(2);
  expect(notified.at(-1)).toMatchObject({ text: 'Falharam: API (erro)' });
});

test('a live job streams status from one watcher instead of a query per second, and polling resumes when it ends', async ($, on) => {
  const clock = mock.clock(on); const actions: string[] = []; const spawned: string[][] = [];
  const collector = { path: '/node/bin/node', source: 'path' };
  let current: any = { ...data(), collector };
  on('session.cwd', () => ({ value: '/work' })); on('session.id', () => ({ value: 'owner' }));
  on('session.start', () => ({ cwd: '/work' })); on('command.register', () => ({ value: undefined }));
  on('command.list', () => ({ value: [{ name: 'test-progress', source: 'plugin', plugin: 'test-progress' }] }));
  on('process.run', ($, e) => { actions.push(e.argv[2]); return response(current); });
  let emit: ((line: string) => void) | undefined, end: (() => void) | undefined;
  on('process.spawn', async function* ($, e) {
    spawned.push([...e.argv]);
    const queue: string[] = []; let wake: (() => void) | undefined, ended = false;
    emit = line => { queue.push(line); wake?.(); };
    end = () => { ended = true; wake?.(); };
    for (;;) {
      while (queue.length) yield { stream: 'stdout' as const, text: `${queue.shift()}\n` };
      if (ended) return { value: { code: 0, signal: null } };
      await new Promise<void>(resolve => { wake = resolve; });
    }
  });
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' });
  expect(actions).toEqual(['status']);
  await clock.advance(1000);
  expect(spawned).toHaveLength(1);
  expect(spawned[0]).toEqual(['/node/bin/node', '--max-semi-space-size=1', expect.stringMatching(/runner\/cli\.mjs$/), 'watch', '--cwd', '/work', '--owner', 'owner', '--module', 'all']);
  emit!(JSON.stringify({ ...data(), jobs: { api: { ...running, resolved: 2, percent: 100 } } }));
  await clock.advance(3000);
  expect(actions).toEqual(['status']);
  const ui = await $.ui.mount(pane);
  expect(await ui.find({ type: 'Text', text: /2\/2|100/ })).toBeDefined();
  await ui.unmount();
  // The run ends: the watcher reports it and exits; the panel goes back to idle polling.
  emit!(JSON.stringify({ ...data(), jobs: { api: { ...running, status: 'completed', resolved: 2, percent: 100 } } }));
  end!();
  current = { ...data({ api: module() }, { api: { ...running, status: 'completed' } }), collector };
  await clock.advance(10000);
  expect(spawned).toHaveLength(1);
  expect(actions.length).toBeGreaterThanOrEqual(2);
  expect(actions.every(action => action === 'status')).toBe(true);
});
