// Claude Code Mods 2.1.289+. No host Node APIs run inside the Mod sandbox.
import { ACTIVE, labels, validateEnvelope, parseCommand, visibleModuleIds, moduleTitle, countSummary, diagnosticText,
  sanitizeText, sanitizeTail, statusGlyph, progressBar, outcomeText, summaryLine, compactPercent, compactCounts, clock, configStatus } from '../runner/module-presentation.mjs';
const PANE = 'claude-test-progress';
let modules = {}, jobs = {}, stateDiagnostics = {}, workspace = null;
let identity = '', generation = 0, sessionOwner = '';
let busy = false, lastError = '', registrationError = '', timer = null;
// Collector calls run one at a time; commands and buttons wait instead of being dropped.
let queue = Promise.resolve(), queued = 0, idleTicks = 0, collectorNode = null;
const IDLE_POLL_TICKS = 10;
let selectedLogs = null, logTail = [], chooseLogs = false, showHelp = false;
// Runs the person has seen in the pane; the band only keeps unseen failures.
let seenRuns = new Set();
const NARROW_COLUMNS = 60;
const visible = () => visibleModuleIds(modules, jobs, stateDiagnostics);
const enabled = () => visible().filter(id => modules[id]?.enabled);
const catalogue = () => JSON.stringify({ modules, moduleConfig: workspace?.moduleConfig, stateBlocked: workspace?.stateBlocked, stateDiagnostics });
const actionProjection = () => JSON.stringify({ catalogue: catalogue(), jobs: Object.keys(jobs).sort().map(id =>
  [id, jobs[id].runId, jobs[id].status, !!jobs[id].recoveryRequired, !!jobs[id].cancellable]) });
const projection = () => JSON.stringify({ modules, jobs, stateDiagnostics, workspace, identity, generation,
  busy, lastError, registrationError, selectedLogs, logTail, chooseLogs, showHelp });
// Labels alone read best; a label shared by two visible modules gets its ID.
function displayNames() {
  const ids = visible(), count = {};
  for (const id of ids) { const label = modules[id]?.label ?? id; count[label] = (count[label] ?? 0) + 1; }
  return Object.fromEntries(ids.map(id => { const label = modules[id]?.label ?? id; return [id, count[label] > 1 && label !== id ? `${label} (${id})` : label]; }));
}
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
function shortSummary(id) {
  const job = jobs[id];
  if (!job) return `${moduleTitle(id, modules[id])}: sem execução`;
  const counts = compactCounts(job).map(count => count.text).join(' ');
  return `${moduleTitle(id, modules[id])}: ${statusGlyph(job).glyph} ${compactPercent(job)} · ${labels[job.status] ?? job.status}${counts ? ` · ${counts}` : ''}`;
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
  rows.push(`Cadastro: ${configStatus[workspace?.moduleConfig?.status] ?? 'não consultado'} · .claude/test-progress.json`);
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
    generation += 1; identity = key; sessionOwner = owner;
    modules = {}; jobs = {}; stateDiagnostics = {}; workspace = null;
    selectedLogs = null; logTail = []; chooseLogs = false; showHelp = false; lastError = ''; seenRuns = new Set();
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
  '/test-progress — abre ou fecha o painel; não inicia testes.',
  '/test-progress list — lista módulos ativados, IDs, linguagens e diagnósticos.',
  '/test-progress start <id|all> — inicia explicitamente os módulos ativados.',
  '/test-progress status [id|all] — consulta o estado.',
  '/test-progress logs [id|all] — consulta os logs; escolha um ID no painel.',
  '/test-progress cancel [id|all] — cancela jobs ativos/recuperáveis desta sessão.',
  '/test-progress help | paths — ajuda e caminhos instalados.',
  'Acrescente --text para resposta textual, inclusive no modo headless.',
  'Cadastro: <diretório da sessão>/.claude/test-progress.json.',
  'Windows: PowerShell 5.1/7; cancelamento da árvore por Job Object.',
  'Percentual = testes resolvidos / testes conhecidos. Total parcial pode crescer.',
  'Cobertura de código e estimativa de tempo não são calculadas.',
].join('\n');
const LEGEND = ['● rodando  ✓ ok  ✗ falhou  ■ cancelado  ! erro ou órfão  ○ sem execução',
  '▶ iniciar  ■ cancelar  ≡ logs  × fechar  ~ total parcial',
  '✓ passaram  ✗ falharam  ↷ ignorados',
  '/test-progress help lista os comandos.'];
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
    identity = ''; generation += 1; sessionOwner = '';
    modules = {}; jobs = {}; stateDiagnostics = {}; workspace = null; lastError = '';
    selectedLogs = null; logTail = []; chooseLogs = false; showHelp = false; seenRuns = new Set();
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
    // A bare /test-progress toggles: an open pane closes, a closed one refreshes and opens.
    const bare = !String(e.args ?? '').trim();
    if (bare) {
      try {
        if ((await $.ui.panes()).some(pane => pane.id === PANE)) { await $.ui.close({ id: PANE }); return {}; }
      } catch { /* No pane record: open as usual. */ }
    }
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
        lastError = 'A seleção mudou. Tente de novo.'; $.ui.invalidate('ui.render'); return;
      }
      await fn();
    };
    // Opening the pane acknowledges finished runs, so the band can step aside.
    const unseen = Object.values(jobs).filter(job => !seenRuns.has(job.runId));
    if (unseen.length) { for (const job of unseen) seenRuns.add(job.runId); Promise.resolve().then(() => $.ui.invalidate('ui.render')); }
    const narrow = (e.props?.bodyColumns ?? 80) < NARROW_COLUMNS;
    const text = (value, props = {}) => Text({ ...props, children: [value] });
    // Button has no disabled prop in the native API. Dim and guard instead of inventing HTML attributes.
    const button = (key, label, action, id = 'all', allowed = true) => Button({ key, label, plain: true,
      dimColor: busy || !allowed, onPress: guarded(async () => { if (allowed) await perform($, action, id, expected); }) });
    const local = (key, label, fn) => Button({ key, label, plain: true, onPress: guarded(async () => { fn(); $.ui.invalidate('ui.render'); }) });
    const names = displayNames();
    const nameWidth = Math.min(18, Math.max(6, ...visible().map(id => names[id].length))) + 1;
    const actions = id => {
      const module = modules[id], job = jobs[id];
      const open = selectedLogs?.id === id;
      return [
        ...(job ? [Button({ key: `logs-${id}`, label: '≡', plain: true, dimColor: busy && !open, onPress: guarded(async () => {
          if (open && !chooseLogs) { selectedLogs = null; logTail = []; $.ui.invalidate('ui.render'); return; }
          await perform($, 'logs', id, expected);
        }) })] : []),
        ...(job && (ACTIVE.has(job.status) || job.recoveryRequired && job.cancellable) ? [button(`cancel-${id}`, '■', 'cancel', id)] :
          module?.enabled ? [button(`start-${id}`, '▶', 'start', id, startAllowed(id))] : []),
      ];
    };
    const progress = (id, cells) => {
      const job = jobs[id];
      if (!job) return [text('—', { key: 'none', color: 'inactive' })];
      if (job.recoveryRequired) return [text('órfão: processo ainda vivo', { key: 'orphan', color: 'error' })];
      const counts = compactCounts(job).map(count => text(`${count.text} `, { key: count.text, color: count.color }));
      if (!ACTIVE.has(job.status)) {
        const outcome = outcomeText(job);
        return [...counts, text(outcome.text, { key: 'outcome', color: outcome.color })];
      }
      const stopping = job.phase === 'cancellation-requested';
      const bar = progressBar(job, cells);
      return [
        Box({ key: 'bar', flexDirection: 'row', width: cells + 1, children: [
          ...(bar.done ? [text(bar.done, { key: 'done', color: stopping ? 'inactive' : 'suggestion' })] : []),
          text(bar.rest, { key: 'rest', color: 'subtle' })] }),
        Box({ key: 'pct', width: 7, children: [text(compactPercent(job), { dimColor: stopping })] }),
        ...(stopping ? [text('parando…', { key: 'stopping', color: 'inactive' })] : counts),
      ];
    };
    const logBlock = id => {
      if (selectedLogs?.id !== id) return [];
      const changed = jobs[id]?.runId !== selectedLogs.runId;
      const lines = logTail.slice(-12);
      const header = `log · run ${selectedLogs.runId.slice(0, 8)} · ${lines.length < logTail.length ? `últimas ${lines.length} de ${logTail.length}` : `${lines.length}`} ${lines.length === 1 ? 'linha' : 'linhas'}`;
      return [Box({ key: `log-${id}`, flexDirection: 'column', paddingLeft: 2, children: [
        Box({ key: 'log-header', flexDirection: 'row', justifyContent: 'space-between', children: [
          text(`│ ${header}`, { key: 'log-title', color: 'inactive', wrap: 'truncate-end' }),
          local(`close-logs-${id}`, '×', () => { selectedLogs = null; logTail = []; })] }),
        ...(changed && jobs[id] ? [Box({ key: 'changed', flexDirection: 'row', gap: 1, children: [
          text('│ nova execução', { color: 'inactive' }), button('select-current-logs', '↻', 'logs', id)] })] : []),
        ...(lines.length ? lines.map((line, i) => text(`│ ${line}`, { key: `log-${selectedLogs.runId}-${i}`, wrap: 'truncate-end',
          ...(/\b(ERROR|FAIL(ED|URE)?)\b/.test(line) ? { color: 'error' } : { dimColor: true }) })) :
          [text('│ sem saída ainda', { key: 'empty', color: 'inactive' })]),
      ] })];
    };
    // Errors are the line the person most needs whole: they wrap, then point at the next step.
    const problemBlock = id => {
      const job = jobs[id];
      const problems = [...diagnostics(id).map(diagnosticText), ...(job?.error ? [job.error] : [])];
      if (!problems.length) return [];
      const hint = job && selectedLogs?.id !== id ? '→ ≡ abre o log' + (job.phase === 'no-progress-observed' || /eventos de progresso/.test(job.error ?? '') ?
        ' · confira o "adapter" do módulo' : '') : '';
      return [Box({ key: 'problems', flexDirection: 'column', paddingLeft: 2, children: [
        ...problems.slice(0, 2).map((item, i) => text(item, { key: `problem-${i}`, color: 'error', wrap: 'wrap' })),
        ...(hint ? [text(hint, { key: 'hint', dimColor: true, wrap: 'wrap' })] : []),
      ] })];
    };
    const row = id => {
      const job = jobs[id], module = modules[id];
      const { glyph, color } = statusGlyph(job);
      const time = job ? clock(job.elapsedMs) : '';
      const live = job && ACTIVE.has(job.status);
      const head = [Box({ key: 'glyph', width: 2, children: [text(glyph, { color, bold: true })] }),
        Box({ key: 'name', ...(narrow ? { flexGrow: 1, flexShrink: 1 } : { width: nameWidth }),
          children: [text(names[id], { wrap: 'truncate', bold: !!module?.enabled, ...(module?.enabled ? {} : { dimColor: true }) })] })];
      const tail = Box({ key: 'tail', flexDirection: 'row', flexGrow: narrow ? 0 : 1, justifyContent: 'flex-end', gap: 1, children: [
        ...(time ? [text(time, { key: 'time', dimColor: true })] : []), ...actions(id)] });
      // Narrow: a finished result fits the name line; only a live bar takes a second one.
      const middle = Box({ key: 'middle', flexDirection: 'row', children: progress(id, narrow ? 10 : 12) });
      return Box({ key: `module-${id}`, flexDirection: 'column', children: [
        ...(narrow ? [Box({ key: 'line', flexDirection: 'row', gap: 1, children: [...head, ...(live ? [] : [middle]), tail] }),
          ...(live ? [Box({ key: 'progress', flexDirection: 'row', paddingLeft: 2, children: progress(id, 10) })] : [])] :
          [Box({ key: 'line', flexDirection: 'row', children: [...head, middle, tail] })]),
        ...problemBlock(id),
        ...logBlock(id),
      ] });
    };
    const ids = visible();
    const configured = ['absent', 'valid'].includes(workspace?.moduleConfig?.status ?? 'absent');
    const summary = summaryLine(ids, jobs);
    return Box({ key: 'module-list', flexDirection: 'column', children: [
      Box({ key: 'toolbar', flexDirection: 'row', justifyContent: 'space-between', children: [
        Box({ key: 'summary', flexDirection: 'row', children: [
          ...summary.flatMap((part, i) => [...(i ? [text(' · ', { key: `summary-sep-${i}`, dimColor: true })] : []),
            text(part.text, { key: `summary-${i}`, ...(part.color ? { color: part.color } : { dimColor: true }) })]),
          ...(busy ? [text(' …', { key: 'busy', dimColor: true })] : [])] }),
        Box({ key: 'toolbar-actions', flexDirection: 'row', gap: 1, children: [
          ...(enabled().length >= 2 ? [button('start-all', '▶ todos', 'start', 'all', allAllowed())] : []),
          local('help', '?', () => { showHelp = !showHelp; }),
          Button({ key: 'close', label: '×', plain: true, role: 'dismiss', onPress: () => $.ui.close({ id: PANE }) })] })] }),
      ...ids.map(row),
      ...(!ids.length && configured && !workspace?.error ? [text('Nenhum módulo em .claude/test-progress.json', { key: 'empty', dimColor: true })] : []),
      ...(chooseLogs ? [text('Escolha ≡ em um módulo.', { key: 'choose-logs', dimColor: true })] : []),
      ...(selectedLogs && !ids.includes(selectedLogs.id) ? logBlock(selectedLogs.id) : []),
      ...(workspace?.error ? [text(`Configuração: ${workspace.error}`, { key: 'config-error', color: 'error', wrap: 'wrap' })] : []),
      ...(workspace?.moduleConfig?.diagnostics ?? []).map((item, i) => text(`Configuração: ${diagnosticText(item)}`, { key: `config-${i}`, color: 'error', wrap: 'wrap' })),
      ...(stateDiagnostics['*'] ?? []).map((item, i) => text(`Estado: ${diagnosticText(item)}`, { key: `state-${i}`, color: 'error', wrap: 'wrap' })),
      ...(lastError ? [text(lastError, { key: 'last-error', color: 'error', wrap: 'wrap' })] : []),
      ...(registrationError ? [text(`Registro: ${registrationError}`, { key: 'registration', color: 'error', wrap: 'wrap' })] : []),
      ...(showHelp ? LEGEND.map((line, i) => text(line, { key: `legend-${i}`, dimColor: true, wrap: 'wrap' })) : []),
    ] });
  });
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const existing = await next(e);
    if (e.props?.hasSurvey) return existing;
    const live = id => ACTIVE.has(jobs[id].status) || jobs[id].recoveryRequired;
    const failed = id => ['failed', 'error'].includes(jobs[id].status) || (jobs[id].failed ?? 0) > 0;
    const ids = visible().filter(id => jobs[id]);
    const active = ids.filter(live), unseenFailures = ids.filter(id => !live(id) && failed(id) && !seenRuns.has(jobs[id].runId));
    // Nothing running and nothing new to report: the band steps aside.
    if (!active.length && !unseenFailures.length) return existing;
    const passed = ids.filter(id => !live(id) && !failed(id) && jobs[id].status === 'completed');
    const shown = [...active, ...unseenFailures, ...passed];
    const { Box, Text } = $.ui.resolve(e);
    const names = displayNames();
    const span = (key, value, props = {}) => Text({ key, ...props, children: [value] });
    const item = id => {
      const job = jobs[id], { glyph, color } = statusGlyph(job);
      const parts = [span('glyph', `${glyph} `, { color }), span('name', names[id])];
      if (job.recoveryRequired) parts.push(span('state', ' órfão', { color: 'error' }));
      else if (live(id)) {
        const pct = compactPercent(job);
        parts.push(pct === '—' ? span('resolved', ` ${job.resolved ?? 0} resolvidos`, { dimColor: true }) : span('pct', ` ${pct}`));
      }
      if (!job.recoveryRequired && (job.failed ?? 0) > 0) parts.push(span('failed', ` ✗${job.failed}`, { color: 'error' }));
      return Box({ key: `summary-${id}`, flexDirection: 'row', children: parts });
    };
    const children = [];
    shown.slice(0, 3).forEach((id, i) => { if (i) children.push(span(`sep-${i}`, '  ·  ', { dimColor: true })); children.push(item(id)); });
    if (shown.length > 3) children.push(span('more', `  ·  +${shown.length - 3}`, { dimColor: true }));
    return Box({ flexDirection: 'column', children: [...(existing ? [existing] : []),
      Box({ key: 'band', flexDirection: 'row', overflow: 'hidden', children })] });
  });
}
