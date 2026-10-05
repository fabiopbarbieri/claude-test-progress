import { expect, test } from 'claude-code/testing';

const pane = (surface: 'terminal' | 'desktop', columns = 120) => ({
  plugin: 'test-progress', component: 'Pane', requestId: 'claude-test-progress', surface,
  viewport: { columns, rows: 25 }, props: { title: 'Test Progress', isFocused: true,
    bodyColumns: columns - 10, placement: 'inline', scroll: { offset: 0, bodyRows: 20 }, view: {} },
});
const module = (id: string, order = 0, overrides = {}) => ({ id, label: 'Suíte', language: 'Python',
  order, enabled: true, directoryPresent: true, origin: 'workspace', diagnostics: [], ...overrides });
const job = (moduleId: string, overrides = {}) => ({ schemaVersion: 2, moduleId, runId: `run-${moduleId}`,
  source: 'config', status: 'running', phase: 'executing-tests', total: 4, totalStable: false,
  resolved: 4, passed: 2, failed: 1, skipped: 1, percent: 100, cwd: '/work',
  command: ['python', 'suite.py'], exitCode: null, ...overrides });
const data = (modules = {}, jobs = {}, stateDiagnostics = {}, stateBlocked = false) => ({
  schemaVersion: 2, ok: true, modules, jobs, stateDiagnostics,
  workspace: { moduleConfig: { status: Object.keys(modules).length ? 'valid' : 'absent',
    schemaVersion: Object.keys(modules).length ? 2 : null,
    enabledIds: Object.keys(modules).filter(id => modules[id].enabled) }, stateBlocked },
});
const response = value => ({ value: { exitCode: value.ok ? 0 : 1, stderr: '', stdout: JSON.stringify(value) } });

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: 0/1/2/12 modules, stable IDs, native narrow column and bounded starts`, async ($, on) => {
    let current = data();
    const actions: string[] = [];
    on('session.cwd', () => ({ value: '/work' }));
    on('session.id', () => ({ value: 'owner' }));
  on('command.list', () => ({ value: [{ name: 'test-progress', source: 'plugin', plugin: 'test-progress' }] }));
    on('process.run', ($, e) => { actions.push(e.argv[2]); return response(current); });
    for (const size of [0, 1, 2, 12]) {
      current = data(Object.fromEntries(Array.from({ length: size }, (_, i) => [`m${i}`, module(`m${i}`, i)])));
      await $.command.run({ command: 'test-progress', args: 'list --text' });
      const ui = await $.ui.mount(pane(surface, 40));
      if (!size) expect(await ui.find({ type: 'Text', text: 'Nenhum módulo ativado neste workspace.' })).toBeDefined();
      for (let i = 0; i < size; i++) {
        expect(await ui.find({ key: `module-m${i}` })).toBeDefined();
        expect(await ui.find({ type: 'Text', text: `Suíte · m${i}` })).toBeDefined();
        expect(await ui.find({ key: `start-m${i}` })).toBeDefined();
      }
      if (size >= 2) expect(await ui.find({ key: 'start-all' })).toBeDefined();
      else expect(await ui.find({ key: 'start-all' })).toBeUndefined();
      expect(await ui.find({ key: 'module-list' })).toMatchObject({ props: { flexDirection: 'column' } });
      if (size === 12) {
        // The host owns this window; rendering another offset must preserve IDs.
        await ui.redraw({ ...pane(surface, 40).props, scroll: { offset: 14, bodyRows: 6 } });
        expect(await ui.find({ key: 'module-m11' })).toBeDefined();
        expect(await ui.findAll({ type: 'Button', text: /^Iniciar m/ })).toHaveLength(12);
      }
      expect(await ui.find({ key: 'demo' })).toBeUndefined();
      await ui.unmount();
    }
    expect(actions).toEqual(['list', 'list', 'list', 'list']);
  });

  test(`${surface}: outcomes, unknown versus zero, recovery and no silent all subset`, async ($, on) => {
    let current = data({ api: module('api'), web: module('web', 1) }, { api: job('api'), web: job('web', {
      total: null, percent: null, resolved: 0, passed: 0, failed: 0, skipped: 0 }) });
    const actions: string[] = [];
    on('session.cwd', () => ({ value: '/work' }));
    on('session.id', () => ({ value: 'owner' }));
  on('command.list', () => ({ value: [{ name: 'test-progress', source: 'plugin', plugin: 'test-progress' }] }));
    on('process.run', ($, e) => { actions.push(e.argv[2]); return response(current); });
    await $.command.run({ command: 'test-progress', args: '--text' });
    const ui = await $.ui.mount(pane(surface));
    expect(await ui.find({ type: 'Text', text: '2 ✅ · 1 ❌ · 1 ⏩' })).toBeDefined();
    expect(await ui.find({ type: 'Text', text: 'Em execução · executing-tests' })).toBeDefined();
    expect(await ui.find({ type: 'Text', text: '— [ total desconhecido ]' })).toBeDefined();
    await ui.press({ key: 'start-all' });
    expect(actions).toEqual(['status']);
    current = data({ api: module('api'), web: module('web', 1, { directoryPresent: false,
      diagnostics: [{ code: 'missing', message: 'Diretório ausente.' }] }) }, { api: job('api', {
      status: 'completed', total: 0, resolved: 0, passed: 0, failed: 0, skipped: 0, percent: null, exitCode: 0 }),
      lost: job('lost', { status: 'error', recoveryRequired: true, cancellable: false }) });
    await ui.press({ key: 'refresh' });
    expect(await ui.find({ type: 'Text', text: '— [ sem testes ]' })).toBeDefined();
    expect(await ui.find({ key: 'cancel-lost' })).toBeUndefined();
    await ui.press({ key: 'start-all' });
    expect(actions).toEqual(['status', 'status']);
    current.jobs.lost.cancellable = true;
    await ui.press({ key: 'refresh' });
    expect(await ui.find({ key: 'cancel-lost' })).toMatchObject({ props: { label: 'Cancelar órfão lost' } });
    await ui.unmount();
  });
}

test('logs all has separate text tails and pane asks for a selection; pinned run never auto switches', async ($, on) => {
  let current = data({ api: module('api'), web: module('web') }, { api: job('api', { logTail: ['\u001b[31mfirst\u001b[0m'] }), web: job('web', { logTail: ['second'] }) });
  on('session.cwd', () => ({ value: '/work' }));
  on('session.id', () => ({ value: 'owner' }));
  on('command.list', () => ({ value: [{ name: 'test-progress', source: 'plugin', plugin: 'test-progress' }] }));
  on('process.run', () => response(current));
  const answer = await $.command.run({ command: 'test-progress', args: 'logs all --text' });
  expect(answer.text).toContain('LOGS · api · run-api\nfirst');
  expect(answer.text).toContain('LOGS · web · run-web\nsecond');
  const ui = await $.ui.mount(pane('terminal'));
  expect(await ui.find({ type: 'Text', text: 'Escolha um módulo para ver os logs.' })).toBeDefined();
  await ui.press({ key: 'logs-api' });
  expect(await ui.find({ type: 'Text', text: 'first' })).toBeDefined();
  current.jobs.api = job('api', { runId: 'new-run', logTail: ['new output'] });
  await ui.press({ key: 'refresh' });
  expect(await ui.find({ type: 'Text', text: 'first' })).toBeDefined();
  expect(await ui.find({ type: 'Text', text: 'new output' })).toBeUndefined();
  expect(await ui.find({ key: 'select-current-logs' })).toBeDefined();
  await ui.press({ key: 'select-current-logs' });
  expect(await ui.find({ type: 'Text', text: 'new output' })).toBeDefined();
  await ui.unmount();
});

test('removed/disabled terminal jobs disappear, active jobs and state-only locks remain; global state blocks all starts', async ($, on) => {
  const current = data({ api: module('api'), disabled: module('disabled', 0, { enabled: false }) }, {
    disabled: job('disabled', { status: 'completed' }), retired: job('retired', { status: 'completed' }),
    orphan: job('orphan', { status: 'error', recoveryRequired: true, cancellable: true }) },
    { locked: [{ code: 'corrupt', message: 'Estado ilegível.', blocking: true }], '*': [{ code: 'legacy', message: 'Estado antigo.', blocking: true }] }, true);
  const actions: string[] = [];
  on('session.cwd', () => ({ value: '/work' })); on('session.id', () => ({ value: 'owner' }));
  on('command.list', () => ({ value: [{ name: 'test-progress', source: 'plugin', plugin: 'test-progress' }] }));
  on('process.run', ($, e) => { actions.push(e.argv[2]); return response(current); });
  await $.command.run({ command: 'test-progress', args: 'status --text' });
  const ui = await $.ui.mount(pane('terminal'));
  expect(await ui.find({ key: 'module-disabled' })).toBeUndefined();
  expect(await ui.find({ key: 'module-retired' })).toBeUndefined();
  expect(await ui.find({ key: 'module-locked' })).toBeDefined();
  expect(await ui.find({ key: 'module-*' })).toBeUndefined();
  expect(await ui.find({ key: 'cancel-orphan' })).toBeDefined();
  await ui.press({ key: 'start-api' });
  expect(actions).toEqual(['status']);
  await ui.unmount();
});

test('old callback refuses owner and catalogue changes before start; response changing owner is discarded', async ($, on) => {
  let owner = 'A'; let current = data({ api: module('api') });
  const actions: string[] = [];
  on('session.cwd', () => ({ value: '/work' })); on('session.id', () => ({ value: owner }));
  on('command.list', () => ({ value: [{ name: 'test-progress', source: 'plugin', plugin: 'test-progress' }] }));
  on('process.run', ($, e) => {
    actions.push(e.argv[2]);
    if (actions.length === 4) owner = 'C';
    return response(current);
  });
  await $.command.run({ command: 'test-progress', args: 'status --text' });
  const ui = await $.ui.mount(pane('terminal'));
  owner = 'B'; await ui.press({ key: 'start-api' });
  expect(actions).toEqual(['status']);
  await $.command.run({ command: 'test-progress', args: 'status --text' });
  current = data({ api: module('api', 0, { label: 'Renomeada' }) });
  await ui.press({ key: 'start-api' });
  expect(actions).toEqual(['status', 'status', 'status']);
  const stale = await $.command.run({ command: 'test-progress', args: 'status --text' });
  expect(stale.text).not.toContain('Renomeada · api');
  expect(stale.text).toContain('sessão mudou');
  await ui.unmount();
});

test('fallback text preserves jobs even when action result fails; closing never cancels', async ($, on) => {
  const actions: string[] = []; const closed: string[] = [];
  const current = { ...data({ api: module('api') }, { api: job('api') }), ok: false, error: 'Configuração inválida.' };
  on('session.cwd', () => ({ value: '/work' })); on('session.id', () => ({ value: 'owner' }));
  on('command.list', () => ({ value: [{ name: 'test-progress', source: 'plugin', plugin: 'test-progress' }] }));
  on('process.run', ($, e) => { actions.push(e.argv[2]); return response(current); });
  on('ui.open', () => ({ value: { isPlaced: false, reason: 'no room' } }));
  on('ui.close', ($, e) => { closed.push(e.id); return { value: undefined }; });
  const answer = await $.command.run({ command: 'test-progress', args: '' });
  expect(answer.text).toContain('runId=run-api'); expect(answer.text).toContain('Configuração inválida.');
  expect(answer.text).toContain('no room');
  const ui = await $.ui.mount(pane('desktop'));
  await ui.press({ key: 'close' });
  expect(actions).toEqual(['status']); expect(closed).toEqual(['claude-test-progress']);
  await ui.unmount();
});

test('native start performs preflight then starts exactly the ID; cancelled callback refuses replacement run', async ($, on) => {
  let current = data({ api: module('api'), web: module('web') }); const calls: any[] = [];
  on('session.cwd', () => ({ value: '/work' })); on('session.id', () => ({ value: 'owner' }));
  on('command.list', () => ({ value: [{ name: 'test-progress', source: 'plugin', plugin: 'test-progress' }] }));
  on('process.run', ($, e) => {
    calls.push(e);
    if (e.argv[2] === 'start') current.jobs.api = job('api');
    return response(current);
  });
  await $.command.run({ command: 'test-progress', args: '--text' });
  const ui = await $.ui.mount(pane('terminal'));
  await ui.press({ key: 'start-api' });
  expect(calls.map(call => call.argv[2])).toEqual(['status', 'status', 'start']);
  expect(calls[2].argv.slice(-2)).toEqual(['--module', 'api']); expect(calls[2].init.timeoutMs).toBe(60000);
  current.jobs.api = job('api', { runId: 'replacement-run' });
  await ui.press({ key: 'cancel-api' });
  expect(calls.map(call => call.argv[2])).toEqual(['status', 'status', 'start', 'status']);
  expect(await ui.find({ type: 'Text', text: 'O cadastro ou a execução mudou. Revise o módulo antes de agir.' })).toBeDefined();
  await ui.unmount();
});

test('invalid catalogue cause and per-ID action errors stay separate from retained running jobs', async ($, on) => {
  const current = { ...data({}, { api: job('api') }), ok: false,
    actionResults: { api: { ok: false, action: 'cancel', error: 'Árvore ainda desconhecida.' } } };
  current.workspace.moduleConfig = { status: 'invalid', schemaVersion: null, enabledIds: [],
    diagnostics: [{ code: 'INVALID_SCHEMA', message: 'O cadastro requer schemaVersion 2.' }] };
  on('session.cwd', () => ({ value: '/work' })); on('session.id', () => ({ value: 'owner' }));
  on('command.list', () => ({ value: [{ name: 'test-progress', source: 'plugin', plugin: 'test-progress' }] }));
  on('process.run', () => response(current));
  const answer = await $.command.run({ command: 'test-progress', args: 'cancel api --text' });
  expect(answer.text).toContain('Configuração: O cadastro requer schemaVersion 2.');
  expect(answer.text).toContain('api: Árvore ainda desconhecida.'); expect(answer.text).toContain('runId=run-api');
  const ui = await $.ui.mount(pane('desktop'));
  expect(await ui.find({ key: 'cancel-api' })).toBeDefined();
  expect(await ui.find({ key: 'start-api' })).toBeUndefined();
  await ui.unmount();
});

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: pane shows observed duration, keeps it after completion and marks missing duration unknown`, async ($, on) => {
    const current = data({ api: module('api') }, { api: job('api', { elapsedMs: 7200000 }) });
    on('session.cwd', () => ({ value: '/work' })); on('session.id', () => ({ value: 'owner' }));
    on('command.list', () => ({ value: [{ name: 'test-progress', source: 'plugin', plugin: 'test-progress' }] }));
    on('process.run', () => response(current));
    const answer = await $.command.run({ command: 'test-progress', args: 'status --text' });
    expect(answer.text).toContain('duração=7200s');
    const ui = await $.ui.mount(pane(surface));
    expect(await ui.find({ type: 'Text', text: 'Duração: 7200s' })).toBeDefined();
    current.jobs.api = { ...current.jobs.api, status: 'completed', phase: 'finished', exitCode: 0 };
    await ui.press({ key: 'refresh' });
    expect(await ui.find({ type: 'Text', text: 'Duração: 7200s' })).toBeDefined();
    expect(await ui.find({ type: 'Text', text: /ETA|tempo restante/i })).toBeUndefined();
    delete current.jobs.api.elapsedMs;
    await ui.press({ key: 'refresh' });
    expect(await ui.find({ type: 'Text', text: 'Duração: desconhecida' })).toBeDefined();
    expect(await ui.find({ type: 'Text', text: 'Duração: 7200s' })).toBeUndefined();
    await ui.unmount();
  });
}
