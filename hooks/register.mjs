// Claude Code Mods 2.1.289+. No host Node APIs run inside the Mod sandbox.
import { ACTIVE, labels, validateEnvelope, parseCommand, visibleModuleIds, moduleTitle,
  percentage, progressText, countSummary, diagnosticText, sanitizeText, sanitizeTail } from '../runner/module-presentation.mjs';
const PANE = 'claude-test-progress';
let modules = {}, jobs = {}, stateDiagnostics = {}, workspace = null;
let identity = '', generation = 0, sessionOwner = '', sessionWorkspace = '';
let busy = false, lastError = '', registrationError = '', timer = null;
// Collector calls run one at a time; commands and buttons wait instead of being dropped.
let queue = Promise.resolve(), queued = 0, idleTicks = 0, collectorNode = null;
const IDLE_POLL_TICKS = 10;
let selectedLogs = null, logTail = [], chooseLogs = false, showHelp = false;
const visible = () => visibleModuleIds(modules, jobs, stateDiagnostics);
const enabled = () => visible().filter(id => modules[id]?.enabled);
const catalogue = () => JSON.stringify({ modules, moduleConfig: workspace?.moduleConfig, stateBlocked: workspace?.stateBlocked, stateDiagnostics });
const actionProjection = () => JSON.stringify({ catalogue: catalogue(), jobs: Object.keys(jobs).sort().map(id =>
  [id, jobs[id].runId, jobs[id].status, !!jobs[id].recoveryRequired, !!jobs[id].cancellable]) });
const projection = () => JSON.stringify({ modules, jobs, stateDiagnostics, workspace, identity, generation,
  busy, lastError, registrationError, selectedLogs, logTail, chooseLogs, showHelp });
const diagnostics = id => [...(modules[id]?.diagnostics ?? []), ...(stateDiagnostics[id] ?? [])];
function serialized(task) {
  queued += 1;
  const run = queue.then(task).finally(() => { queued -= 1; });
  queue = run.catch(() => {});
  return run;
}
// Poll every second only while something can change without us: an unseen identity or a live job.
function pollDue() {
  const live = !workspace || Object.values(jobs).some(job => ACTIVE.has(job.status) || job.recoveryRequired);
  if (live || ++idleTicks >= IDLE_POLL_TICKS) { idleTicks = 0; return true; }
  return false;
}
const validCollector = value => typeof value?.path === 'string' && !value.path.includes('\0') &&
  (value.path.startsWith('/') || /^[a-z]:\\/i.test(value.path)) && /^[\w-]{1,32}$/.test(value?.source ?? '');
const duration = job => typeof job.elapsedMs === 'number' ? `${Math.floor(job.elapsedMs / 1000)}s` : 'desconhecida';
function startAllowed(id) {
  return !busy && workspace?.moduleConfig?.status === 'valid' && !workspace?.stateBlocked &&
    !stateDiagnostics['*']?.length && modules[id]?.enabled === true && modules[id].directoryPresent === true &&
    !diagnostics(id).length && !ACTIVE.has(jobs[id]?.status) && !jobs[id]?.recoveryRequired;
}
const allAllowed = () => enabled().length > 0 && enabled().every(startAllowed);
function withinWorkspace(directory) {
  if (!directory || !sessionWorkspace) return false;
  const windows = /^[a-z]:[\\/]|^\\\\/i.test(sessionWorkspace);
  const normalize = value => (windows ? value.replace(/\\/g, '/').toLowerCase() : value).replace(/\/+$/, '');
  const root = normalize(sessionWorkspace), candidate = normalize(directory);
  return candidate === root || candidate.startsWith(`${root}/`);
}
function shortSummary(id) {
  const job = jobs[id];
  return `${moduleTitle(id, modules[id])}: ${job ? `${percentage(job)}${job.total != null && !job.totalStable ? ' parcial' : ''} · ${labels[job.status] ?? job.status} · ${job.failed ?? 0} falha(s)` : 'sem execução'}`;
}
function textSummary() {
  const rows = ['Test Progress', ...(sessionOwner ? [`owner=${sessionOwner}`] : [])];
  for (const id of visible()) {
    const job = jobs[id];
    rows.push(shortSummary(id), `  linguagem=${modules[id]?.language ?? 'não informada'}`);
    if (!modules[id]?.enabled) rows.push('  Módulo removido/desativado.');
    for (const item of diagnostics(id)) rows.push(`  Diagnóstico: ${diagnosticText(item)}`);
    if (!job) continue;
    rows.push(`  ${countSummary(job)}; passed=${job.passed ?? 0}, failed=${job.failed ?? 0}, skipped=${job.skipped ?? 0}`,
      `  origem=${job.source}; fase=${job.phase}; exitCode=${job.exitCode ?? 'ainda desconhecido'}`,
      `  duração=${duration(job)}; último sinal do executor=${job.heartbeatAt ?? 'ainda não observado'}`,
      `  última saída=${job.lastOutputAt ?? 'não observada'}; último progresso reconhecido=${job.lastProgressAt ?? 'não observado'}`,
      `  runId=${job.runId}; log=${job.logPath ?? 'não disponível'}`);
    if (job.collectorRuntime) rows.push(`  Node coletor=${job.collectorRuntime.version} (${job.collectorRuntime.source})`);
    if (job.nodeRuntime) rows.push(`  Node da suíte=${job.nodeRuntime.version} (${job.nodeRuntime.source}); .nvmrc=${job.nodeRuntime.nvmrc ?? 'ausente'}`);
    if (job.error) rows.push(`  ${job.error}`);
  }
  if (!visible().length) rows.push('Nenhum módulo ativado neste workspace.', 'Configure .claude/test-progress.json; consulte /test-progress help.');
  rows.push(`Cadastro: ${workspace?.moduleConfig?.status ?? 'não consultado'} · .claude/test-progress.json`);
  if (workspace?.error) rows.push(`Configuração: ${workspace.error}`);
  for (const item of workspace?.moduleConfig?.diagnostics ?? []) rows.push(`Configuração: ${diagnosticText(item)}`);
  for (const item of stateDiagnostics['*'] ?? []) rows.push(`Estado: ${diagnosticText(item)}`);
  if (lastError) rows.push(`Erro: ${lastError}`);
  if (registrationError) rows.push(`Registro: ${registrationError}`);
  return rows.join('\n');
}
async function synchronizeIdentity($) {
  const cwd = await $.session.cwd(), owner = await $.session.id();
  const key = `${cwd}\n${owner}`;
  if (identity !== key) {
    generation += 1; identity = key; sessionOwner = owner; sessionWorkspace = cwd;
    modules = {}; jobs = {}; stateDiagnostics = {}; workspace = null;
    selectedLogs = null; logTail = []; chooseLogs = false; showHelp = false; lastError = '';
  }
  return { cwd, owner, generation };
}
async function collect($, action = 'status', moduleId = 'all') {
  const context = await synchronizeIdentity($);
  const windows = /^[a-z]:[\\/]|^\\\\/i.test(context.cwd);
  // After one bootstrap, call the Node it selected directly: no shell, no PATH/nvm probing.
  const direct = collectorNode?.identity === identity ? collectorNode : null;
  let argv;
  if (direct) argv = [direct.path, `${$.plugin.root}/runner/cli.mjs`, action,
    '--cwd', context.cwd, '--owner', context.owner, '--module', moduleId];
  else if (windows) {
    const override = await $.env.get('TEST_PROGRESS_POWERSHELL'), systemRoot = await $.env.get('SystemRoot');
    argv = [override || (systemRoot ? `${systemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe` : 'powershell.exe'),
      '-NoLogo', '-NoProfile', '-NonInteractive', '-File', `${$.plugin.root}/scripts/run-collector.ps1`,
      '-Action', action, '-Cwd', context.cwd, '-Owner', context.owner, '-Module', moduleId];
  } else argv = ['bash', `${$.plugin.root}/scripts/run-collector.sh`, action,
    '--cwd', context.cwd, '--owner', context.owner, '--module', moduleId];
  const init = { timeoutMs: action === 'start' ? 60000 : windows ? 15000 : 5000,
    ...(direct ? { env: { TEST_PROGRESS_NODE_SOURCE: direct.source } } : {}) };
  // A stale cached Node falls back to the bootstrap once; a start is never repeated.
  const fallback = () => { collectorNode = null; return direct && action !== 'start'; };
  let response;
  try { response = await $.process.run(argv, init); }
  catch (error) {
    await synchronizeIdentity($);
    if (context.generation !== generation) throw new Error('A sessão mudou durante a consulta. Atualize para ver os jobs desta sessão.');
    if (direct && fallback()) return collect($, action, moduleId);
    throw error;
  }
  await synchronizeIdentity($);
  if (context.generation !== generation) throw new Error('A sessão mudou durante a consulta. Atualize para ver os jobs desta sessão.');
  let data;
  try { data = JSON.parse(response.stdout.trim()); }
  catch {
    if (direct && fallback()) return collect($, action, moduleId);
    throw new Error(sanitizeText(response.stderr).trim().slice(0, 1024) || `Coletor retornou resposta inválida (exit ${response.exitCode}); requer Node 14+ local.`);
  }
  validateEnvelope(data);
  if (!direct && validCollector(data.collector)) collectorNode = { identity, path: data.collector.path, source: data.collector.source };
  // Error envelopes still carry the valid catalogue and persistent jobs.
  modules = data.modules; jobs = data.jobs; workspace = data.workspace; stateDiagnostics = data.stateDiagnostics;
  if (selectedLogs && jobs[selectedLogs.id]?.runId === selectedLogs.runId && Array.isArray(jobs[selectedLogs.id].logTail)) logTail = sanitizeTail(jobs[selectedLogs.id].logTail);
  if (!data.ok || response.exitCode !== 0) {
    const actionErrors = Object.entries(data.actionResults ?? {}).filter(([, result]) => !result.ok)
      .map(([id, result]) => `${id}: ${result.error ?? 'ação recusada'}`).join('\n');
    throw new Error(data.error ?? (actionErrors || `Coletor encerrou com código ${response.exitCode}.`));
  }
  lastError = '';
  return data;
}
function perform($, action, moduleId = 'all', expected = null) {
  return serialized(() => performNow($, action, moduleId, expected));
}
async function performNow($, action, moduleId, expected) {
  busy = true; $.ui.invalidate('ui.render');
  try {
    await synchronizeIdentity($);
    if (expected && (generation !== expected.generation || actionProjection() !== expected.projection)) throw new Error('A seleção mudou. Atualize o painel antes de agir.');
    if (expected && ['start', 'cancel', 'logs'].includes(action)) {
      // Refresh before rendered actions; never act on a renamed module or a replaced run silently.
      await collect($, 'status');
      if (generation !== expected.generation || actionProjection() !== expected.projection) throw new Error('O cadastro ou a execução mudou. Revise o módulo antes de agir.');
      if (action === 'start') {
        busy = false;
        const allowed = moduleId === 'all' ? allAllowed() : startAllowed(moduleId);
        busy = true;
        if (!allowed) throw new Error('Início indisponível. Confira os diagnósticos e jobs ativos.');
      }
    }
    await collect($, action, moduleId);
    if (action === 'logs') {
      if (moduleId === 'all') { chooseLogs = true; selectedLogs = null; logTail = []; }
      else if (jobs[moduleId]) {
        selectedLogs = { id: moduleId, runId: jobs[moduleId].runId };
        logTail = sanitizeTail(jobs[moduleId].logTail); chooseLogs = false;
      }
    }
  } catch (error) { lastError = String(error?.message ?? error); }
  finally { busy = false; $.ui.invalidate('ui.render'); }
}
const HELP = [
  '/test-progress — consulta e abre o painel; não inicia testes.',
  '/test-progress list — lista módulos ativados, IDs, linguagens e diagnósticos.',
  '/test-progress start <id|all> — inicia explicitamente os módulos ativados.',
  '/test-progress status [id|all] — consulta o estado.',
  '/test-progress logs [id|all] — consulta os logs; escolha um ID no painel.',
  '/test-progress cancel [id|all] — cancela jobs ativos/recuperáveis desta sessão.',
  '/test-progress help | paths — ajuda e caminhos instalados.',
  'Acrescente --text para resposta textual, inclusive no modo headless.',
  'Cadastro: <diretório da sessão>/.claude/test-progress.json (schemaVersion 2).',
  'Windows: PowerShell 5.1/7; cancelamento da árvore por Job Object.',
  'Percentual = testes resolvidos / testes conhecidos. Total parcial pode crescer.',
  'Cobertura de código e estimativa de tempo não são calculadas.',
].join('\n');
function textLogs(moduleId) {
  const ids = moduleId === 'all' ? Object.keys(jobs).sort() : [moduleId];
  return ids.filter(id => jobs[id]).map(id => `LOGS · ${id} · ${jobs[id].runId}\n${sanitizeTail(jobs[id].logTail).join('\n')}`).join('\n\n');
}
export function register(on) {
  on('session.start', async ($, e, next) => {
    timer?.cancel();
    timer = $.clock.every(1000, () => {
      // A waiting command already refreshes state; never stack ticks behind it.
      if (queued) return;
      return serialized(async () => {
        const before = projection();
        try {
          await synchronizeIdentity($);
          if (pollDue()) {
            // Every query returns the whole catalogue and all jobs; only a live selected run re-reads its log.
            const live = selectedLogs && ACTIVE.has(jobs[selectedLogs.id]?.status);
            await collect($, live ? 'logs' : 'status', live ? selectedLogs.id : 'all');
          }
        } catch (error) { lastError = String(error?.message ?? error); }
        if (before !== projection()) $.ui.invalidate('ui.render');
      });
    });
    await perform($, 'status');
    try {
      // Keep one generic hint; no catalogue updates overwrite another command's registration.
      const existing = (await $.command.list()).find(command => command.name === 'test-progress');
      if (existing && (existing.source !== 'plugin' || existing.plugin !== 'test-progress')) {
        throw new Error('O comando test-progress já existe; origem não pertence a este plugin.');
      }
      await $.command.register({ name: 'test-progress', description: 'Painel de execução de testes em segundo plano',
        argumentHint: '[list|start|status|logs|cancel|help|paths] [id|all] [--text]', immediate: true });
      registrationError = '';
    } catch (error) { registrationError = String(error?.message ?? error); }
    $.ui.invalidate('ui.render');
    return next(e);
  });
  on('session.end', async ($, e, next) => {
    // Poll survives clear/resume/branch; workers and timer aren't cancelled here.
    identity = ''; generation += 1; sessionOwner = ''; sessionWorkspace = '';
    modules = {}; jobs = {}; stateDiagnostics = {}; workspace = null; lastError = '';
    selectedLogs = null; logTail = []; chooseLogs = false; showHelp = false;
    $.ui.invalidate('ui.render'); return next(e);
  });
  on('command.run', { command: 'test-progress' }, async ($, e, next) => {
    // A name match alone isn't ownership: register() can have failed, or another
    // command can have replaced our name since startup. Preserve its full result.
    if (registrationError) return next(e);
    try {
      const current = (await $.command.list()).find(command => command.name === 'test-progress');
      if (!current || current.source !== 'plugin' || current.plugin !== 'test-progress') {
        registrationError = 'O comando test-progress está indisponível ou pertence a outra origem.';
        $.ui.invalidate('ui.render');
        return next(e);
      }
    } catch (error) {
      registrationError = `Não foi possível confirmar a origem do comando: ${String(error?.message ?? error)}`;
      $.ui.invalidate('ui.render');
      return next(e);
    }
    let command;
    try { command = parseCommand(e.args); } catch (error) { return { text: String(error.message) }; }
    if (command.action === 'help') return { text: HELP };
    if (command.action === 'paths') return { text: [`Plugin: ${$.plugin.root}`,
      `Rails: ${$.plugin.root}/adapters/rails/run.rb`, `Python: ${$.plugin.root}/adapters/python/run.py`,
      `Karma: ${$.plugin.root}/adapters/karma/reporter.cjs`, `JUnit: ${$.plugin.root}/adapters/junit/pom.xml`,
      `Ruby / RSpec: ${$.plugin.root}/adapters/ruby/run.rb`, `Exemplos: ${$.plugin.root}/config.example.json`].join('\n') };
    await perform($, command.action, command.moduleId);
    if (command.text || command.action === 'list') return { text: textSummary() + (command.action === 'logs' ? `\n${textLogs(command.moduleId)}` : '') };
    try {
      const placement = await $.ui.open({ id: PANE, title: 'Test Progress', focus: true, closeOnEscape: true });
      if (!placement.isPlaced) return { text: `${textSummary()}\nPainel aguardando espaço: ${placement.reason}` };
    } catch (error) { return { text: `${textSummary()}\nPainel indisponível: ${String(error?.message ?? error)}` }; }
    return {};
  });
  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE) return next(e);
    const { Box, Text, Button } = $.ui.resolve(e);
    const expected = { generation, projection: actionProjection() };
    const guarded = fn => async () => {
      await synchronizeIdentity($);
      if (generation !== expected.generation || actionProjection() !== expected.projection) {
        lastError = 'A seleção mudou. Atualize o painel antes de agir.'; $.ui.invalidate('ui.render'); return;
      }
      await fn();
    };
    // Button has no disabled prop in the native API. Dim and guard instead of inventing HTML attributes.
    const button = (key, label, action, id = 'all', allowed = true) => Button({ key,
      label: busy ? `${label}…` : label, plain: true, dimColor: busy || !allowed,
      onPress: guarded(async () => { if (allowed) await perform($, action, id, expected); }) });
    const text = (value, props = {}) => Text({ ...props, children: [value] });
    const block = id => {
      const module = modules[id], job = jobs[id];
      const color = job?.status === 'failed' || job?.status === 'error' ? 'red' : job?.status === 'completed' ? 'green' : 'yellow';
      const lines = [text(moduleTitle(id, module), { bold: true }), text(`Linguagem: ${module?.language ?? 'não informada'}`, { dimColor: true })];
      if (!module?.enabled) lines.push(text('Módulo removido/desativado.', { dimColor: true }));
      for (const item of diagnostics(id)) lines.push(text(diagnosticText(item), { color: 'red' }));
      if (!job) lines.push(text(stateDiagnostics[id]?.length ? 'Snapshot indisponível; confira o estado antes de iniciar.' : 'Ainda não iniciado.', { dimColor: true }));
      else {
        lines.push(text(progressText(job), { color, bold: true }), text(countSummary(job)),
          text(`${job.passed ?? 0} ✅ · ${job.failed ?? 0} ❌ · ${job.skipped ?? 0} ⏩`),
          text(`${labels[job.status] ?? job.status} · ${job.phase}`, { color }),
          text(`Duração: ${duration(job)}`, { dimColor: true }));
        if (job.recoveryRequired) lines.push(text('Recuperação pendente.', { color: 'yellow' }));
        if (!withinWorkspace(job.cwd) && job.cwd) lines.push(text(`Diretório: ${job.cwd}`, { dimColor: true, wrap: 'truncate' }));
        if (job.command) lines.push(text(`Comando: ${job.command.join(' ')}`, { dimColor: true, wrap: 'truncate' }));
        if (job.exitCode != null) lines.push(text(`Exit: ${job.exitCode}`, { dimColor: true }));
        if (job.revision?.head) lines.push(text(`revisão: ${job.revision.head.slice(0, 8)}${job.revision.dirty ? ' (com alterações)' : ''}`, { dimColor: true }));
        if (job.nodeRuntime) lines.push(text(`Node ${job.nodeRuntime.version}`, { dimColor: true }));
        if (job.error) lines.push(text(job.error, { color: 'red' }));
      }
      // A vertical action group remains usable on narrow terminal and desktop panes.
      lines.push(Box({ key: `actions-${id}`, flexDirection: 'column', children: [
        ...(module?.enabled ? [button(`start-${id}`, `Iniciar ${id}`, 'start', id, startAllowed(id))] : []),
        ...(job ? [button(`logs-${id}`, `Ver logs ${id}`, 'logs', id)] : []),
        ...(job && (ACTIVE.has(job.status) || job.recoveryRequired && job.cancellable) ?
          [button(`cancel-${id}`, `${job.recoveryRequired ? 'Cancelar órfão' : 'Cancelar'} ${id}`, 'cancel', id)] : []),
      ] }));
      return Box({ key: `module-${id}`, flexDirection: 'column', children: lines });
    };
    const logChanged = selectedLogs && jobs[selectedLogs.id]?.runId !== selectedLogs.runId;
    // Pane bodies are scrolled by the host, with keyboard focus anchored to keyed native Buttons.
    return Box({ key: 'module-list', flexDirection: 'column', children: [
      Box({ key: 'toolbar', flexDirection: 'column', children: [button('refresh', 'Atualizar', 'status'),
        Button({ key: 'help', label: showHelp ? 'Ocultar ajuda' : 'Ajuda', plain: true, onPress: guarded(() => {
          showHelp = !showHelp; $.ui.invalidate('ui.render');
        }) }),
        Button({ key: 'close', label: 'Fechar', plain: true, onPress: () => $.ui.close({ id: PANE }) })] }),
      ...(enabled().length >= 2 ? [button('start-all', 'Iniciar Todos', 'start', 'all', allAllowed())] : []),
      ...visible().flatMap(id => [text(' ', { key: `gap-${id}` }), block(id)]),
      ...(!visible().length ? [text('Nenhum módulo ativado neste workspace.', { dimColor: true }),
        text('Configure .claude/test-progress.json; consulte /test-progress help.', { dimColor: true })] : []),
      text(`Cadastro: ${workspace?.moduleConfig?.status ?? 'não consultado'} · .claude/test-progress.json`, { dimColor: true }),
      ...(workspace?.error ? [text(`Configuração: ${workspace.error}`, { color: 'red' })] : []),
      ...(workspace?.moduleConfig?.diagnostics ?? []).map(item => text(`Configuração: ${diagnosticText(item)}`, { color: 'red' })),
      ...(stateDiagnostics['*'] ?? []).map(item => text(`Estado: ${diagnosticText(item)}`, { color: 'red' })),
      ...(lastError ? [text(lastError, { color: 'red' })] : []),
      ...(registrationError ? [text(`Registro: ${registrationError}`, { color: 'red' })] : []),
      ...(showHelp ? HELP.split('\n').map(line => text(line, { dimColor: true })) : []),
      ...(chooseLogs ? [text('Escolha um módulo para ver os logs.', { dimColor: true })] : []),
      ...(selectedLogs ? [text(`LOGS · ${selectedLogs.id} · ${selectedLogs.runId} · últimas 12 linhas`, { bold: true }),
        ...(logChanged ? [text('A execução mudou. Os logs selecionados foram preservados.', { color: 'yellow' }),
          ...(jobs[selectedLogs.id] ? [button('select-current-logs', 'Ver logs da execução atual', 'logs', selectedLogs.id)] : [])] : []),
        ...logTail.slice(-12).map((line, i) => text(line, { key: `log-${selectedLogs.runId}-${i}`, wrap: 'truncate' })),
        Button({ key: 'hide-logs', label: 'Ocultar logs', plain: true, onPress: guarded(() => {
          selectedLogs = null; logTail = []; chooseLogs = false; $.ui.invalidate('ui.render');
        }) })] : []),
    ] });
  });
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const existing = await next(e);
    const ids = visible().filter(id => jobs[id]);
    if (e.props?.hasSurvey || !ids.length) return existing;
    ids.sort((a, b) => Number(!!(ACTIVE.has(jobs[b].status) || jobs[b].recoveryRequired)) - Number(!!(ACTIVE.has(jobs[a].status) || jobs[a].recoveryRequired)));
    const { Box, Text } = $.ui.resolve(e);
    return Box({ flexDirection: 'column', children: [...(existing ? [existing] : []),
      ...ids.slice(0, 3).map(id => Text({ key: `summary-${id}`, dimColor: true, wrap: 'truncate', children: [shortSummary(id)] })),
      ...(ids.length > 3 ? [Text({ dimColor: true, children: [`+${ids.length - 3} restante(s) · /test-progress`] })] : [])] });
  });
}
