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
    for (const text of ['BACKEND', 'FRONTEND', '4 resolvidos / 4 descobertos · total parcial',
      '2 passaram · 1 falharam · 1 ignorados', 'Em execução · executing-tests',
      '0 resolvidos / total desconhecido', 'Exit: desconhecido · revisão: abcdef12',
      '100% não confirma encerramento. Confira status, falhas e exit.']) {
      expect(await ui.find({ type: 'Text', text })).toBeDefined();
    }
    expect(await ui.find({ type: 'Text', text: /^100% / })).toBeDefined();
    expect(await ui.find({ key: 'cancel-backend' })).toBeDefined();
    await ui.unmount();
  });

  test(`${surface}: zero tests, logs/cancel and close/reopen preserve the job`, async ($, on) => {
    const actions: string[] = [];
    let current = job();
    on('session.cwd', () => ({ value: '/work/public-fixture' }));
    on('session.id', () => ({ value: 'public-owner' }));
    on('ui.open', () => ({ value: { isPlaced: true } }));
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
    expect(await ui.find({ type: 'Text', text: '0 resolvidos / 0 no total' })).toBeDefined();
    expect(await ui.find({ key: 'cancel-frontend' })).toBeUndefined();
    await ui.press({ key: 'logs-backend' });
    expect(await ui.find({ type: 'Text', text: 'public synthetic output' })).toBeDefined();
    await ui.press({ key: 'hide-logs' });
    expect(await ui.find({ type: 'Text', text: 'public synthetic output' })).toBeUndefined();
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
  expect(await ui.find({ type: 'Text', text: '2 passaram · 1 falharam · 1 ignorados' })).toBeDefined();
  expect(await ui.find({ key: 'cancel-backend' })).toBeUndefined();
  cancellable = true;
  await ui.press({ key: 'refresh' });
  expect(await ui.find({ key: 'cancel-backend' })).toMatchObject({ props: { label: 'Cancelar órfão' } });
  await ui.unmount();
});
