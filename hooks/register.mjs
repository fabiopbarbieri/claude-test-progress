// Claude Code Mods 2.1.287+. No host Node APIs run inside the Mod sandbox.
// The documented process.run API invokes a short CLI; its external worker owns the job.
const PANE = 'claude-test-progress';
const LANES = ['backend', 'frontend'];
const ACTIVE = new Set(['preparing', 'running']);
const EMPTY = () => ({ backend: null, frontend: null });
let lanes = EMPTY();
let identity = '';
let identityGeneration = 0;
let sessionOwner = '';
let busy = false;
let lastError = '';
let selectedLogs = '';
let logTail = [];
let registrationError = '';

const labels = {
  preparing: 'Preparando', running: 'Em execução', completed: 'Encerrado',
  failed: 'Encerrado com falha', cancelled: 'Cancelado', error: 'Erro',
};

function percentage(job) {
  if (typeof job.percent !== 'number' || !Number.isFinite(job.percent)) return '—';
  return `${job.percent.toFixed(job.percent % 1 ? 1 : 0)}%`;
}

function progressBar(job) {
  if (typeof job.percent !== 'number') return '[ total desconhecido ]';
  const filled = Math.max(0, Math.min(16, Math.round(job.percent / 100 * 16)));
  return `[${'■'.repeat(filled)}${'·'.repeat(16 - filled)}]`;
}

function countSummary(job) {
  const denominator = job.total === null ? 'total desconhecido' :
    `${job.total} ${job.totalStable ? 'no total' : 'descobertos · total parcial'}`;
  return `${job.resolved} resolvidos / ${denominator}`;
}

function shortSummary(lane, job) {
  if (!job) return `${lane}: sem execução`;
  const ratio = percentage(job);
  const partial = job.total !== null && !job.totalStable ? ' parcial' : '';
  const simulation = job.source === 'demo' ? ' DEMO' : '';
  return `${lane}${simulation}: ${ratio}${partial} · ${labels[job.status] ?? job.status} · ${job.failed} falha(s)`;
}

function textSummary() {
  const rows = ['Test Progress'];
  if (sessionOwner) rows.push(`owner=${sessionOwner}`);
  for (const lane of LANES) {
    const job = lanes[lane];
    rows.push(shortSummary(lane, job));
    if (job) {
      rows.push(`  ${countSummary(job)}; passed=${job.passed}, failed=${job.failed}, skipped=${job.skipped}`);
      rows.push(`  origem=${job.source}; fase=${job.phase}; exitCode=${job.exitCode ?? 'ainda desconhecido'}`);
      rows.push(`  runId=${job.runId}; log=${job.logPath}`);
      if (job.collectorRuntime) rows.push(`  Node coletor=${job.collectorRuntime.version} (${job.collectorRuntime.source})`);
      if (job.nodeRuntime) rows.push(`  Node no PATH frontend=${job.nodeRuntime.version} (${job.nodeRuntime.source}); .nvmrc=${job.nodeRuntime.nvmrc ?? 'ausente'}`);
      if (job.error) rows.push(`  ${job.error}`);
    }
  }
  if (lastError) rows.push(`Erro: ${lastError}`);
  if (registrationError) rows.push(`Registro: ${registrationError}`);
  return rows.join('\n');
}

async function synchronizeIdentity($) {
  // session.start is not emitted again for /clear, /resume or /branch.
  const cwd = await $.session.cwd();
  const owner = await $.session.id();
  const key = `${cwd}\n${owner}`;
  if (identity !== key) {
    identityGeneration += 1;
    identity = key;
    sessionOwner = owner;
    lanes = EMPTY();
    selectedLogs = '';
    logTail = [];
    lastError = '';
  }
  return { cwd, owner };
}

async function collect($, action = 'status', lane = 'all') {
  const context = await synchronizeIdentity($);
  const requestGeneration = identityGeneration;
  // Native Windows paths select PowerShell; WSL paths keep the Linux runtime.
  const windows = /^[a-z]:[\\/]|^\\\\/i.test(context.cwd);
  let argv;
  if (windows) {
    const override = await $.env.get('TEST_PROGRESS_POWERSHELL');
    const systemRoot = await $.env.get('SystemRoot');
    const shell = override || (systemRoot ? `${systemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe` : 'powershell.exe');
    argv = [shell, '-NoLogo', '-NoProfile', '-NonInteractive', '-File',
      `${$.plugin.root}/scripts/run-collector.ps1`, '-Action', action,
      '-Cwd', context.cwd, '-Owner', context.owner, '-Lane', lane];
  } else {
    argv = ['bash', `${$.plugin.root}/scripts/run-collector.sh`, action,
      '--cwd', context.cwd, '--owner', context.owner, '--lane', lane];
  }
  const response = await $.process.run(argv, { timeoutMs: windows ? 15000 : 5000 });
  await synchronizeIdentity($);
  if (requestGeneration !== identityGeneration) {
    throw new Error('A sessão mudou durante a consulta. Atualize para ver os jobs desta sessão.');
  }
  let data;
  try { data = JSON.parse(response.stdout.trim()); }
  catch {
    const detail = String(response.stderr ?? '').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
      .replace(/[\x00-\x1f\x7f-\x9f]/g, ' ').trim().slice(0, 1024);
    throw new Error(detail || `Coletor retornou resposta inválida (exit ${response.exitCode}); requer Node 14+ local e bootstrap permitido pelo sistema.`);
  }
  if (data.schema !== 1 || !data.lanes || typeof data.ok !== 'boolean') {
    throw new Error('Versão de resposta do coletor incompatível.');
  }
  lanes = { backend: data.lanes.backend ?? null, frontend: data.lanes.frontend ?? null };
  if (action === 'logs') {
    selectedLogs = lane === 'all' ? 'backend' : lane;
    logTail = lanes[selectedLogs]?.logTail ?? [];
  }
  if (!data.ok || response.exitCode !== 0) {
    throw new Error(data.error ?? `Coletor encerrou com código ${response.exitCode}.`);
  }
  lastError = '';
  return data;
}

async function perform($, action, lane = 'all') {
  if (busy) return false;
  busy = true;
  $.ui.invalidate('ui.render');
  try { await collect($, action, lane); }
  catch (error) { lastError = String(error?.message ?? error); }
  finally {
    busy = false;
    $.ui.invalidate('ui.render');
  }
  return true;
}

function parseCommand(raw) {
  const tokens = String(raw ?? '').trim().split(/\s+/).filter(Boolean);
  const text = tokens.includes('--text');
  const args = tokens.filter((token) => token !== '--text');
  const name = args[0] ?? 'status';
  if (LANES.includes(name) || name === 'all') {
    if (args.length !== 1) throw new Error('Use backend, frontend ou all sem argumentos adicionais.');
    return { action: 'start', lane: name, text };
  }
  if (!['status', 'demo', 'cancel', 'logs', 'help', 'paths'].includes(name) || args.length > 2 ||
      (name === 'paths' && args.length !== 1)) {
    throw new Error('Use /test-progress help para consultar os comandos.');
  }
  const lane = args[1] ?? 'all';
  if (!['all', ...LANES].includes(lane)) throw new Error('Lane: backend, frontend ou all.');
  return { action: name, lane, text };
}

const HELP = [
  '/test-progress — abre o painel e consulta o estado; não inicia testes.',
  '/test-progress demo [backend|frontend|all] — eventos sintéticos; não executa uma suíte.',
  '/test-progress backend | frontend | all — inicia os comandos configurados, explicitamente.',
  '/test-progress cancel [backend|frontend|all] — pede cancelamento apenas dos jobs desta sessão.',
  '/test-progress logs [backend|frontend|all] — últimos registros do comando.',
  '/test-progress status — atualiza o painel.',
  '/test-progress paths — mostra os caminhos instalados dos adaptadores e exemplos.',
  'Acrescente --text para obter a resposta textual, inclusive no modo headless.',
  'Configuração: <diretório da sessão>/.claude/test-progress.json.',
  'Node automático: PATH, depois nvm local; frontend respeita a .nvmrc mais próxima.',
  'Windows: PowerShell 5.1/7; cancelamento encerra a árvore por Job Object.',
  'Percentual = testes resolvidos / testes conhecidos. Total parcial pode crescer.',
  'Cobertura de código e estimativa de tempo não são calculadas.',
].join('\n');

export function register(on) {
  on('session.start', async ($, e, next) => {
    await perform($, 'status');
    $.clock.every(1000, async () => {
      if (busy) return;
      const before = JSON.stringify({ lanes, lastError, identity });
      busy = true;
      try {
        await collect($, selectedLogs ? 'logs' : 'status', selectedLogs || 'all');
      } catch (error) { lastError = String(error?.message ?? error); }
      finally { busy = false; }
      if (before !== JSON.stringify({ lanes, lastError, identity })) $.ui.invalidate('ui.render');
    });
    // Last: a registration collision must not prevent background polling initialization.
    try {
      await $.command.register({
        name: 'test-progress', description: 'Painel de execução de testes em segundo plano',
        argumentHint: '[demo|backend|frontend|all|cancel|logs|status|paths|help] [lane] [--text]',
        immediate: true,
      });
    } catch (error) { registrationError = String(error?.message ?? error); }
    return next(e);
  });

  on('session.end', async ($, e, next) => {
    // No implicit cancellation: workers can finish while the Mod is reloaded or Claude closes.
    identity = '';
    identityGeneration += 1;
    sessionOwner = '';
    lanes = EMPTY();
    selectedLogs = '';
    logTail = [];
    $.ui.invalidate('ui.render');
    return next(e);
  });

  on('command.run', { command: 'test-progress' }, async ($, e) => {
    let command;
    try { command = parseCommand(e.args); }
    catch (error) { return { text: String(error.message) }; }
    if (command.action === 'help') return { text: HELP };
    if (command.action === 'paths') return { text: [
      `Plugin: ${$.plugin.root}`,
      `Python: ${$.plugin.root}/adapters/python/run.py`,
      `Karma: ${$.plugin.root}/adapters/karma/reporter.cjs`,
      `JUnit: ${$.plugin.root}/adapters/junit/pom.xml`,
      `Exemplos: ${$.plugin.root}/config.example.json`,
      'Use caminhos absolutos nos comandos do seu projeto. Confira novamente após atualizar o plugin.',
    ].join('\n') };
    const accepted = await perform($, command.action, command.lane);
    if (!accepted) return { text: 'O coletor está ocupado. Aguarde um instante e tente novamente.' };
    if (command.text) return { text: textSummary() + (selectedLogs ? `\n${logTail.join('\n')}` : '') };
    try {
      const placement = await $.ui.open({ id: PANE, title: 'Test Progress', focus: true, closeOnEscape: true });
      if (!placement.isPlaced) return { text: `${textSummary()}\nPainel aguardando espaço: ${placement.reason}` };
    } catch (error) {
      return { text: `${textSummary()}\nPainel indisponível: ${String(error?.message ?? error)}` };
    }
    return {};
  });

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE) return next(e);
    const { Box, Text, Button } = $.ui.resolve(e);
    const button = (key, label, action, lane = 'all') => Button({
      key, label: busy ? `${label}…` : label, plain: true,
      dimColor: busy, onPress: async () => { await perform($, action, lane); },
    });
    const block = (lane) => {
      const job = lanes[lane];
      const title = lane === 'backend' ? 'BACKEND' : 'FRONTEND';
      if (!job) return Box({ key: lane, flexDirection: 'column', children: [
        Text({ bold: true, children: [title] }),
        Text({ dimColor: true, children: ['Ainda não iniciado. Use Demo ou configure seu runner.'] }),
      ] });
      const color = job.status === 'failed' || job.status === 'error' ? 'red' :
        job.status === 'completed' ? 'green' : 'yellow';
      const lines = [
        Text({ bold: true, children: [title] }),
        ...(job.source === 'demo' ? [Text({ color: 'yellow', bold: true, children: ['DEMONSTRAÇÃO · eventos sintéticos'] })] : []),
        Text({ color, bold: true, children: [`${percentage(job)} ${progressBar(job)}`] }),
        Text({ children: [countSummary(job)] }),
        Text({ children: [`${job.passed} passaram · ${job.failed} falharam · ${job.skipped} ignorados`] }),
        Text({ color, children: [`${labels[job.status] ?? job.status} · ${job.phase}`] }),
        Text({ dimColor: true, wrap: 'truncate', children: [`Diretório: ${job.cwd}`] }),
        Text({ dimColor: true, wrap: 'truncate', children: [`Comando: ${job.command.join(' ')}`] }),
        Text({ dimColor: true, children: [`Exit: ${job.exitCode ?? 'desconhecido'} · revisão: ${job.revision?.head?.slice(0, 8) ?? 'indisponível'}${job.revision?.dirty === true ? ' (com alterações)' : ''}`] }),
        ...(job.nodeRuntime ? [Text({ dimColor: true, children: [`Node no PATH frontend: ${job.nodeRuntime.version} · ${job.nodeRuntime.source}`] })] : []),
        ...(job.collectorRuntime ? [Text({ dimColor: true, children: [`Node coletor: ${job.collectorRuntime.version} · ${job.collectorRuntime.source}`] })] : []),
      ];
      if (job.error) lines.push(Text({ color: 'red', children: [job.error] }));
      lines.push(Box({ flexDirection: 'row', columnGap: 2, children: [
        button(`logs-${lane}`, 'Ver logs', 'logs', lane),
        ...(ACTIVE.has(job.status) || (job.recoveryRequired && job.cancellable) ?
          [button(`cancel-${lane}`, job.recoveryRequired ? 'Cancelar órfão' : 'Cancelar', 'cancel', lane)] : []),
      ] }));
      return Box({ key: lane, flexDirection: 'column', children: lines });
    };
    return Box({ flexDirection: 'column', children: [
      Text({ bold: true, children: ['EXECUÇÃO DE TESTES'] }),
      Text({ dimColor: true, children: ['Progresso observado · atualização a cada segundo'] }),
      Text({ dimColor: true, wrap: 'truncate', children: [`Sessão: ${sessionOwner || 'aguardando consulta'}`] }),
      Box({ flexDirection: 'row', columnGap: 2, children: [
        button('demo', 'Demo', 'demo'), button('refresh', 'Atualizar', 'status'),
      ] }),
      Text({ dimColor: true, children: ['Iniciar comandos configurados:'] }),
      Box({ flexDirection: 'row', columnGap: 2, children: [
        button('backend', 'Backend', 'start', 'backend'),
        button('frontend', 'Frontend', 'start', 'frontend'),
        button('all', 'Ambos', 'start'),
      ] }),
      Text({ children: [' '] }), block('backend'), Text({ children: [' '] }), block('frontend'),
      ...(lastError || registrationError ? [
        Text({ children: [' '] }), Text({ color: 'red', children: [lastError || registrationError] }),
        Text({ dimColor: true, children: ['Consulte README.md e a configuração .claude/test-progress.json.'] }),
      ] : []),
      ...(selectedLogs ? [
        Text({ children: [' '] }), Text({ bold: true, children: [`LOGS · ${selectedLogs} · últimas 12 linhas`] }),
        ...logTail.slice(-12).map((line) => Text({ wrap: 'truncate', children: [line] })),
        Button({ key: 'hide-logs', label: 'Ocultar logs', plain: true, onPress: () => {
          selectedLogs = ''; logTail = []; $.ui.invalidate('ui.render');
        } }),
      ] : []),
      Text({ children: [' '] }),
      Text({ dimColor: true, children: ['% = resolvidos / conhecidos; total parcial pode crescer.'] }),
      Text({ dimColor: true, children: ['100% não confirma encerramento. Confira status, falhas e exit.'] }),
    ] });
  });

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const existing = await next(e);
    if (e.props?.hasSurvey || !LANES.some((lane) => lanes[lane])) return existing;
    const { Box, Text } = $.ui.resolve(e);
    return Box({ flexDirection: 'column', children: [
      ...(existing ? [existing] : []),
      Text({ dimColor: true, children: [LANES.map((lane) => shortSummary(lane, lanes[lane])).join(' | ')] }),
    ] });
  });
}
