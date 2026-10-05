import { expect, mock, test } from 'claude-code/testing';

const running = {
  runId: 'fixture-long-job', source: 'configured', status: 'running', phase: 'executing-tests',
  total: 2, totalStable: false, resolved: 1, passed: 1, failed: 0, skipped: 0, percent: 50,
  exitCode: null, logPath: '/tmp/fixture.log', elapsedMs: 7200000,
  heartbeatAt: '2026-01-01T02:00:00.000Z', heartbeatAgeMs: 1000,
  lastOutputAt: '2026-01-01T00:00:01.000Z', lastProgressAt: '2026-01-01T00:00:01.000Z',
};
const response = () => ({ value: { exitCode: 0, stderr: '', stdout: JSON.stringify({
  schema: 1, ok: true, lanes: { backend: running, frontend: null },
}) } });

test('text status distinguishes a quiet long job from test progress without waiting for completion', async ($, on) => {
  const calls: any[] = [];
  on('session.cwd', () => ({ value: '/work' }));
  on('session.id', () => ({ value: 'fixture-owner' }));
  on('process.run', ($, e) => { calls.push(e); return response(); });
  const answer = await $.command.run({ command: 'test-progress', args: 'status --text' });
  expect(answer.text).toContain('Em execução');
  expect(answer.text).toContain('1 resolvidos');
  expect(answer.text).toContain('duração=7200s');
  expect(answer.text).toContain('último sinal do executor=2026-01-01T02:00:00.000Z');
  expect(answer.text).toContain('último progresso reconhecido=2026-01-01T00:00:01.000Z');
  expect(answer.text).toContain('exitCode=ainda desconhecido');
  expect(calls.length).toBe(1);
  expect(calls[0].argv[2]).toBe('status');
  expect(calls[0].init.timeoutMs).toBe(5000);
});

test('a failed query can be retried without restarting or cancelling the suite', async ($, on) => {
  const actions: string[] = [];
  on('session.cwd', () => ({ value: '/work' }));
  on('session.id', () => ({ value: 'fixture-owner' }));
  on('process.run', ($, e) => {
    actions.push(e.argv[2]);
    return actions.length === 1 ? { deny: 'fixture query timed out' } : response();
  });
  const failed = await $.command.run({ command: 'test-progress', args: 'status --text' });
  expect(failed.text).toContain('fixture query timed out');
  const retried = await $.command.run({ command: 'test-progress', args: 'status --text' });
  expect(retried.text).toContain('runId=fixture-long-job');
  expect(retried.text).toContain('Em execução');
  expect(retried.text).not.toContain('fixture query timed out');
  expect(actions).toEqual(['status', 'status']);
});


test('session startup registers the command and polls with short queries, never starting a suite', async ($, on) => {
  const clock = mock.clock(on);
  const actions: string[] = [];
  const registered: string[] = [];
  on('session.cwd', () => ({ value: '/work' }));
  on('session.id', () => ({ value: 'fixture-owner' }));
  on('session.start', () => ({ cwd: '/work' }));
  on('command.register', ($, e) => { registered.push(e.name); return { value: undefined }; });
  on('process.run', ($, e) => {
    actions.push(e.argv[2]);
    expect(e.init.timeoutMs).toBe(5000);
    return response();
  });
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' });
  expect(registered).toEqual(['test-progress']);
  expect(actions).toEqual(['status']);
  await clock.advance(2000);
  expect(actions).toEqual(['status', 'status', 'status']);
});
