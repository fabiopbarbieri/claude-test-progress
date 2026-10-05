import { expect, test } from 'claude-code/testing';

const pane = (surface: 'terminal' | 'desktop') => ({
  plugin: 'test-progress', component: 'Pane', requestId: 'claude-test-progress', surface,
  viewport: { columns: 120, rows: 60 },
  props: { title: 'Test Progress', isFocused: true, bodyColumns: 110, placement: 'inline',
    scroll: { offset: 0, bodyRows: 55 }, view: {} },
});
const job = (overrides = {}) => ({
  runId: 'public-fixture', source: 'config', status: 'running', phase: 'executing-tests',
  total: 4, totalStable: false, resolved: 4, passed: 2, failed: 1, skipped: 1, percent: 100,
  cwd: '/work/public-fixture', command: ['node', 'suite.mjs'], exitCode: null,
  revision: { head: 'abcdef123456', dirty: false }, ...overrides,
});

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: known/unknown progress, outcomes and 100% still running`, async ($, on) => {
    on('session.cwd', () => ({ value: '/work/public-fixture' }));
    on('session.id', () => ({ value: 'public-owner' }));
    on('process.run', () => ({ value: { exitCode: 0, stderr: '', stdout: JSON.stringify({
      schema: 1, ok: true, lanes: { backend: job(), frontend: job({ total: null, percent: null,
        resolved: 0, passed: 0, failed: 0, skipped: 0, phase: 'no-progress-observed' }) },
    }) } }));
    await $.command.run({ command: 'test-progress', args: 'status --text' });
    const ui = await $.ui.mount(pane(surface));
    for (const text of ['JavaScript', '4 🏁 / 4 🧪 · total parcial',
      '2 ✅ · 1 ❌ · 1 ⏩', 'Em execução · executing-tests',
      '0 🏁 / 🧪 sem testes', 'revisão: abcdef12']) {
      expect(await ui.find({ type: 'Text', text })).toBeDefined();
    }
    expect(await ui.find({ type: 'Text', text: /^100% / })).toBeDefined();
    expect(await ui.find({ key: 'cancel-backend' })).toBeDefined();
    await ui.unmount();
  });

  test(`${surface}: zero tests, logs/cancel and close/reopen preserve the job`, async ($, on) => {
    const actions: string[] = [];
    const closed: string[] = [];
    let current = job();
    on('session.cwd', () => ({ value: '/work/public-fixture' }));
    on('session.id', () => ({ value: 'public-owner' }));
    on('ui.open', () => ({ value: { isPlaced: true } }));
    on('ui.close', ($, e) => { closed.push(e.id); return { value: undefined }; });
    on('process.run', ($, e) => {
      const action = e.argv[2];
      actions.push(action);
      if (action === 'cancel') current = job({ status: 'cancelled', phase: 'cancelled' });
      return { value: { exitCode: 0, stderr: '', stdout: JSON.stringify({ schema: 1, ok: true,
        lanes: { backend: { ...current, logTail: ['public synthetic output'] }, frontend: job({
          status: 'completed', phase: 'finished', total: 0, resolved: 0, passed: 0,
          failed: 0, skipped: 0, percent: null, totalStable: true, exitCode: 0 }) },
      }) } };
    });
    await $.command.run({ command: 'test-progress', args: 'status' });
    let ui = await $.ui.mount(pane(surface));
    expect(await ui.find({ type: 'Text', text: '0 🏁 / 0 🧪' })).toBeDefined();
    expect(await ui.find({ type: 'Text', text: '— [ sem testes ]' })).toBeDefined();
    expect(await ui.find({ key: 'cancel-frontend' })).toBeUndefined();
    await ui.press({ key: 'logs-backend' });
    expect(await ui.find({ type: 'Text', text: 'public synthetic output' })).toBeDefined();
    await ui.press({ key: 'hide-logs' });
    expect(await ui.find({ type: 'Text', text: 'public synthetic output' })).toBeUndefined();
    await ui.press({ key: 'close' });
    expect(closed).toEqual(['claude-test-progress']);
    expect(actions).toEqual(['status', 'logs']);
    await ui.unmount();
    await $.command.run({ command: 'test-progress', args: 'status' });
    ui = await $.ui.mount(pane(surface));
    expect(await ui.find({ type: 'Text', text: 'Em execução · executing-tests' })).toBeDefined();
    await ui.press({ key: 'cancel-backend' });
    expect(await ui.find({ type: 'Text', text: 'Cancelado · cancelled' })).toBeDefined();
    expect(actions).toEqual(['status', 'logs', 'status', 'cancel']);
    await ui.unmount();
  });
}

test('resumed owner reloads its own persistent state without starting a suite', async ($, on) => {
  let owner = 'session-A';
  const actions: string[] = [];
  on('session.cwd', () => ({ value: '/work/public-fixture' }));
  on('session.id', () => ({ value: owner }));
  on('process.run', ($, e) => {
    actions.push(e.argv[2]);
    expect(e.argv[e.argv.indexOf('--owner') + 1]).toBe(owner);
    return { value: { exitCode: 0, stderr: '', stdout: JSON.stringify({ schema: 1, ok: true,
      lanes: { backend: owner === 'session-A' ? job() : null, frontend: null },
    }) } };
  });
  expect((await $.command.run({command:'test-progress',args:'status --text'})).text).toContain('runId=public-fixture');
  owner = 'session-B';
  expect((await $.command.run({command:'test-progress',args:'status --text'})).text).not.toContain('runId=public-fixture');
  owner = 'session-A';
  expect((await $.command.run({command:'test-progress',args:'status --text'})).text).toContain('runId=public-fixture');
  expect(actions).toEqual(['status', 'status', 'status']);
});

test('demo button requires --demo; opening either view never starts tests', async ($, on) => {
  const actions: string[] = [];
  on('session.cwd', () => ({ value: '/work/public-fixture' }));
  on('session.id', () => ({ value: 'public-owner' }));
  on('ui.open', () => ({ value: { isPlaced: true } }));
  on('process.run', ($, e) => {
    actions.push(e.argv[2]);
    return { value: { exitCode: 0, stderr: '', stdout: JSON.stringify({
      schema: 1, ok: true, lanes: { backend: null, frontend: null },
    }) } };
  });
  for (const args of ['', '--demo', 'status']) {
    await $.command.run({ command: 'test-progress', args });
    const ui = await $.ui.mount(pane('terminal'));
    if (args === '--demo') {
      expect(await ui.find({ key: 'demo' })).toBeDefined();
      expect(actions).toEqual(['status', 'status']);
      await ui.press({ key: 'demo' });
      expect(actions).toEqual(['status', 'status', 'demo']);
    } else expect(await ui.find({ key: 'demo' })).toBeUndefined();
    await ui.unmount();
  }
  expect(actions).toEqual(['status', 'status', 'demo', 'status']);
});

test('pane shows only directories outside the current workspace, including after a workspace change', async ($, on) => {
  let workspace = '/work/app';
  let directory = workspace;
  on('session.cwd', () => ({ value: workspace }));
  on('session.id', () => ({ value: 'public-owner' }));
  on('env.get', () => ({ value: undefined }));
  on('process.run', () => ({ value: { exitCode: 0, stderr: '', stdout: JSON.stringify({
    schema: 1, ok: true, lanes: { backend: job({ cwd: directory }), frontend: null },
  }) } }));
  for (const [root, cwd, visible] of [
    ['/work/app', '/work/app', false],
    ['/work/app/', '/work/app/frontend', false],
    ['/work/app', '/work/app-other', true],
    ['/work/app', '/work/App', true],
    ['/', '/work/app', false],
    ['C:\\work\\app', 'c:/WORK/app/frontend', false],
    ['C:\\work\\app', 'C:\\work\\app-other', true],
    ['C:\\work\\app', 'D:\\work\\app', true],
    ['\\\\server\\share\\app', '\\\\SERVER\\share\\app\\frontend', false],
    ['\\\\server\\share\\app', '\\\\server\\share\\external', true],
  ] as const) {
    workspace = root;
    directory = cwd;
    await $.command.run({ command: 'test-progress', args: 'status --text' });
    const ui = await $.ui.mount(pane('terminal'));
    const label = await ui.find({ type: 'Text', text: `Diretório: ${cwd}` });
    if (visible) expect(label).toBeDefined();
    else expect(label).toBeUndefined();
    await ui.unmount();
  }
});

test('worker loss retains counts, unknown exit and only offers proven orphan cancellation', async ($, on) => {
  let cancellable = false;
  on('session.cwd', () => ({ value: '/work/public-fixture' }));
  on('session.id', () => ({ value: 'public-owner' }));
  on('process.run', () => ({ value: { exitCode: 0, stderr: '', stdout: JSON.stringify({
    schema: 1, ok: true, lanes: { backend: job({ status: 'error', phase: 'orphaned-command',
      total: null, percent: null, recoveryRequired: true, cancellable,
      error: 'Fixture worker disappeared; command identity requires recovery.' }), frontend: null },
  }) } }));
  await $.command.run({ command: 'test-progress', args: 'status --text' });
  const ui = await $.ui.mount(pane('terminal'));
  expect(await ui.find({ type: 'Text', text: 'Erro · orphaned-command' })).toBeDefined();
  expect(await ui.find({ type: 'Text', text: '2 ✅ · 1 ❌ · 1 ⏩' })).toBeDefined();
  expect(await ui.find({ key: 'cancel-backend' })).toBeUndefined();
  cancellable = true;
  await ui.press({ key: 'refresh' });
  expect(await ui.find({ key: 'cancel-backend' })).toMatchObject({ props: { label: '■ Cancelar órfão' } });
  await ui.unmount();
});
