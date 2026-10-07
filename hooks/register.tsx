// Claude Code Mods 2.1.289+. No host Node APIs run inside the Mod sandbox.
import { atom, read } from 'claude-code';
import type { EngineInterface, Register, Timer } from 'claude-code';
import type { TestProgressDiagnostic, TestProgressPanel } from '../types';
import { ACTIVE, labels, validateEnvelope, parseCommand, visibleModuleIds, moduleTitle, countSummary, diagnosticText,
  sanitizeText, sanitizeTail, statusGlyph, progressBar, outcomeText, summaryCounts, finishedWithFailure, compactPercent, compactCounts, clock,
  configStatus } from '../runner/module-presentation.mjs';

type $ = EngineInterface;
type Action = 'list' | 'start' | 'status' | 'logs' | 'cancel' | 'help' | 'paths';
const PANE = 'claude-test-progress';
const NARROW_COLUMNS = 60;
const IDLE_POLL_TICKS = 10;
const LOG_ROWS = 12;
const empty = (): TestProgressPanel => ({ identity: '', generation: 0, sessionOwner: '', modules: {}, jobs: {},
  stateDiagnostics: {}, workspace: null, busy: false, lastError: '', registrationError: '', selectedLogs: null,
  logTail: [], logTop: null, chooseLogs: false, showHelp: false, seenRuns: [], collector: null });
// The host holds what the pane draws, so a hot reload keeps the selection, the seen runs and the collector Node.
const panel = atom({ plugin: 'test-progress', key: 'panel' } as const, empty());
// Working copy: hooks change it, then publish it; drawings read the host's value and redraw when it changes.
let p = empty(), hydrated = false, published = '';
// Collector calls run one at a time; commands and buttons wait instead of being dropped.
let queue: Promise<unknown> = Promise.resolve(), queued = 0, idleTicks = 0, timer: Timer | null = null;
const errorText = (error: unknown) => String(error instanceof Error ? error.message : error);
async function hydrate($: $) {
  if (hydrated) return;
  const held = await read($, panel);
  if (!hydrated) { p = { ...empty(), ...held, busy: false }; hydrated = true; published = JSON.stringify(p); }
}
async function publish($: $) {
  hydrated = true;
  const next = JSON.stringify(p);
  if (next === published) return;
  published = next;
  await $.state.set({ plugin: 'test-progress', key: 'panel' }, JSON.parse(next) as TestProgressPanel);
}
const visible = () => visibleModuleIds(p.modules, p.jobs, p.stateDiagnostics);
const enabled = () => visible().filter(id => p.modules[id]?.enabled);
const catalogue = () => JSON.stringify({ modules: p.modules, moduleConfig: p.workspace?.moduleConfig,
  stateBlocked: p.workspace?.stateBlocked, stateDiagnostics: p.stateDiagnostics });
const actionProjection = () => JSON.stringify({ catalogue: catalogue(), jobs: Object.keys(p.jobs).sort().map(id => {
  const job = p.jobs[id]!;
  return [id, job.runId, job.status, !!job.recoveryRequired, !!job.cancellable];
}) });
// Labels alone read best; a label shared by two visible modules gets its ID.
function displayNames() {
  const ids = visible(), count: Record<string, number> = {};
  for (const id of ids) { const label = p.modules[id]?.label ?? id; count[label] = (count[label] ?? 0) + 1; }
  return Object.fromEntries(ids.map(id => {
    const label = p.modules[id]?.label ?? id;
    return [id, (count[label] ?? 0) > 1 && label !== id ? `${label} (${id})` : label];
  }));
}
// The log shows a window of LOG_ROWS lines; with no top of its own it follows the end.
function logWindow() {
  const max = Math.max(0, p.logTail.length - LOG_ROWS);
  return { top: p.logTop === null ? max : Math.min(Math.max(0, p.logTop), max), max };
}
const closeLogs = () => { p.selectedLogs = null; p.logTail = []; p.logTop = null; };
const diagnostics = (id: string): TestProgressDiagnostic[] => [...(p.modules[id]?.diagnostics ?? []), ...(p.stateDiagnostics[id] ?? [])];
function serialized<T>(task: () => Promise<T>): Promise<T> {
  queued += 1;
  const run = queue.then(task).finally(() => { queued -= 1; });
  queue = run.catch(() => {});
  return run;
}
// Poll every second only while something can change without us: an unseen identity or a live job.
function pollDue() {
  const live = !p.workspace || Object.values(p.jobs).some(job => ACTIVE.has(job.status) || job.recoveryRequired);
  if (live || ++idleTicks >= IDLE_POLL_TICKS) { idleTicks = 0; return true; }
  return false;
}
const validCollector = (value: { path?: unknown; source?: unknown } | undefined): value is { path: string; source: string } =>
  typeof value?.path === 'string' && !value.path.includes('\0') && (value.path.startsWith('/') || /^[a-z]:\\/i.test(value.path)) &&
  typeof value.source === 'string' && /^[\w-]{1,32}$/.test(value.source);
const duration = (ms: number | undefined) => typeof ms === 'number' ? `${Math.floor(ms / 1000)}s` : 'desconhecida';
function startAllowed(id: string) {
  const job = p.jobs[id];
  return !p.busy && p.workspace?.moduleConfig?.status === 'valid' && !p.workspace?.stateBlocked &&
    !p.stateDiagnostics['*']?.length && p.modules[id]?.enabled === true && p.modules[id]?.directoryPresent === true &&
    !diagnostics(id).length && !(job && ACTIVE.has(job.status)) && !job?.recoveryRequired;
}
const allAllowed = () => enabled().length > 0 && enabled().every(startAllowed);
const failedIds = () => enabled().filter(id => finishedWithFailure(p.jobs[id]));
const failedAllowed = () => failedIds().length > 0 && failedIds().every(startAllowed);
// Opening or using the pane acknowledges the runs it shows, so the band can step aside.
function acknowledge() {
  const seen = new Set(p.seenRuns);
  for (const job of Object.values(p.jobs)) seen.add(job.runId);
  if (seen.size !== p.seenRuns.length) p.seenRuns = [...seen].slice(-200);
}
function shortSummary(id: string) {
  const job = p.jobs[id];
  if (!job) return `${moduleTitle(id, p.modules[id])}: sem execução`;
  const counts = compactCounts(job).map(count => count.text).join(' ');
  return `${moduleTitle(id, p.modules[id])}: ${statusGlyph(job).glyph} ${compactPercent(job)} · ${labels[job.status] ?? job.status}${counts ? ` · ${counts}` : ''}`;
}
function textSummary() {
  const rows = ['Test Progress', ...(p.sessionOwner ? [`owner=${p.sessionOwner}`] : [])];
  for (const id of visible()) {
    const job = p.jobs[id];
    rows.push(shortSummary(id), `  linguagem=${p.modules[id]?.language ?? 'não informada'}`);
    if (!p.modules[id]?.enabled) rows.push('  Módulo removido/desativado.');
    for (const item of diagnostics(id)) rows.push(`  Diagnóstico: ${diagnosticText(item)}`);
    if (!job) continue;
    rows.push(`  ${countSummary(job)}; passed=${job.passed ?? 0}, failed=${job.failed ?? 0}, skipped=${job.skipped ?? 0}`,
      `  origem=${job.source}; fase=${job.phase}; exitCode=${job.exitCode ?? 'ainda desconhecido'}`,
      `  duração=${duration(job.elapsedMs)}; último sinal do executor=${job.heartbeatAt ?? 'ainda não observado'}`,
      `  última saída=${job.lastOutputAt ?? 'não observada'}; último progresso reconhecido=${job.lastProgressAt ?? 'não observado'}`,
      `  runId=${job.runId}; log=${job.logPath ?? 'não disponível'}`);
    if (job.collectorRuntime) rows.push(`  Node coletor=${job.collectorRuntime.version} (${job.collectorRuntime.source})`);
    if (job.nodeRuntime) rows.push(`  Node da suíte=${job.nodeRuntime.version} (${job.nodeRuntime.source}); .nvmrc=${job.nodeRuntime.nvmrc ?? 'ausente'}`);
    if (job.error) rows.push(`  ${job.error}`);
  }
  if (!visible().length) rows.push('Nenhum módulo ativado neste workspace.', 'Configure .claude/test-progress.json; consulte /test-progress help.');
  rows.push(`Cadastro: ${configStatus[p.workspace?.moduleConfig?.status ?? ''] ?? 'não consultado'} · .claude/test-progress.json`);
  if (p.workspace?.error) rows.push(`Configuração: ${p.workspace.error}`);
  for (const item of p.workspace?.moduleConfig?.diagnostics ?? []) rows.push(`Configuração: ${diagnosticText(item)}`);
  for (const item of p.stateDiagnostics['*'] ?? []) rows.push(`Estado: ${diagnosticText(item)}`);
  if (p.lastError) rows.push(`Erro: ${p.lastError}`);
  if (p.registrationError) rows.push(`Registro: ${p.registrationError}`);
  return rows.join('\n');
}
async function synchronizeIdentity($: $) {
  await hydrate($);
  const cwd = await $.session.cwd(), owner = await $.session.id();
  const key = `${cwd}\n${owner}`;
  if (p.identity !== key) {
    // A new identity starts clean, but the collector Node it bootstrapped and the registration outcome stay.
    p = { ...empty(), identity: key, generation: p.generation + 1, sessionOwner: owner,
      registrationError: p.registrationError, collector: p.collector, busy: p.busy };
  }
  return { cwd, owner, generation: p.generation };
}
async function collect($: $, action: Action = 'status', moduleId = 'all'): Promise<unknown> {
  const context = await synchronizeIdentity($);
  const windows = /^[a-z]:[\\/]|^\\\\/i.test(context.cwd);
  // After one bootstrap, call the Node it selected directly: no shell, no PATH/nvm probing.
  const direct = p.collector?.identity === p.identity ? p.collector : null;
  let argv: string[];
  if (direct) argv = [direct.path, `${$.plugin.root}/runner/cli.mjs`, action,
    '--cwd', context.cwd, '--owner', context.owner, '--module', moduleId];
  else if (windows) {
    const override = await $.env.get('TEST_PROGRESS_POWERSHELL'), systemRoot = await $.env.get('SystemRoot');
    argv = [override || (systemRoot ? `${systemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe` : 'powershell.exe'),
      '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', `${$.plugin.root}/scripts/run-collector.ps1`,
      '-Action', action, '-Cwd', context.cwd, '-Owner', context.owner, '-Module', moduleId];
  } else argv = ['bash', `${$.plugin.root}/scripts/run-collector.sh`, action,
    '--cwd', context.cwd, '--owner', context.owner, '--module', moduleId];
  const init = { timeoutMs: action === 'start' ? 60000 : windows ? 15000 : 5000,
    ...(direct ? { env: { TEST_PROGRESS_NODE_SOURCE: direct.source } } : {}) };
  // A stale cached Node falls back to the bootstrap once; a start is never repeated.
  const fallback = () => { p.collector = null; return !!direct && action !== 'start'; };
  const changed = () => new Error('A sessão mudou durante a consulta. Atualize para ver os jobs desta sessão.');
  let response;
  try { response = await $.process.run(argv, init); }
  catch (error) {
    await synchronizeIdentity($);
    if (context.generation !== p.generation) throw changed();
    if (direct && fallback()) return collect($, action, moduleId);
    throw error;
  }
  await synchronizeIdentity($);
  if (context.generation !== p.generation) throw changed();
  let raw: unknown;
  try { raw = JSON.parse(response.stdout.trim()); }
  catch {
    if (direct && fallback()) return collect($, action, moduleId);
    throw new Error(sanitizeText(response.stderr).trim().slice(0, 1024) || `Coletor retornou resposta inválida (exit ${response.exitCode}); requer Node 14+ local.`);
  }
  const data = validateEnvelope(raw);
  if (!direct && validCollector(data.collector)) p.collector = { identity: p.identity, path: data.collector.path, source: data.collector.source };
  // Error envelopes still carry the valid catalogue and persistent jobs.
  p.modules = data.modules; p.jobs = data.jobs; p.workspace = data.workspace; p.stateDiagnostics = data.stateDiagnostics;
  const selected = p.selectedLogs && p.jobs[p.selectedLogs.id];
  if (p.selectedLogs && selected?.runId === p.selectedLogs.runId && Array.isArray(selected.logTail)) p.logTail = sanitizeTail(selected.logTail);
  if (!data.ok || response.exitCode !== 0) {
    const actionErrors = Object.entries(data.actionResults ?? {}).filter(([, result]) => !result.ok)
      .map(([id, result]) => `${id}: ${result.error ?? 'ação recusada'}`).join('\n');
    throw new Error(data.error ?? (actionErrors || `Coletor encerrou com código ${response.exitCode}.`));
  }
  p.lastError = '';
  return data;
}
type Expected = { generation: number; projection: string };
function perform($: $, action: Action, moduleId = 'all', expected: Expected | null = null) {
  return serialized(() => performNow($, action, moduleId, expected));
}
// The collector starts one ID or all; a rerun of the failed modules starts each in turn after one check.
function startFailed($: $, expected: Expected) {
  return serialized(async () => {
    await hydrate($);
    p.busy = true; await publish($);
    try {
      await synchronizeIdentity($);
      await collect($, 'status');
      if (p.generation !== expected.generation || actionProjection() !== expected.projection) throw new Error('O cadastro ou a execução mudou. Revise os módulos antes de agir.');
      p.busy = false;
      const ids = failedIds(), allowed = failedAllowed();
      p.busy = true;
      if (!allowed) throw new Error('Início indisponível. Confira os diagnósticos e jobs ativos.');
      for (const id of ids) await collect($, 'start', id);
    } catch (error) { p.lastError = errorText(error); }
    finally { p.busy = false; await publish($); }
  });
}
async function performNow($: $, action: Action, moduleId: string, expected: Expected | null) {
  await hydrate($);
  p.busy = true; await publish($);
  try {
    await synchronizeIdentity($);
    if (expected && (p.generation !== expected.generation || actionProjection() !== expected.projection)) throw new Error('A seleção mudou. Atualize o painel antes de agir.');
    if (expected && ['start', 'cancel', 'logs'].includes(action)) {
      // Refresh before rendered actions; never act on a renamed module or a replaced run silently.
      await collect($, 'status');
      if (p.generation !== expected.generation || actionProjection() !== expected.projection) throw new Error('O cadastro ou a execução mudou. Revise o módulo antes de agir.');
      if (action === 'start') {
        p.busy = false;
        const allowed = moduleId === 'all' ? allAllowed() : startAllowed(moduleId);
        p.busy = true;
        if (!allowed) throw new Error('Início indisponível. Confira os diagnósticos e jobs ativos.');
      }
    }
    await collect($, action, moduleId);
    if (action === 'logs') {
      const job = p.jobs[moduleId];
      if (moduleId === 'all') { closeLogs(); p.chooseLogs = true; }
      else if (job) { p.selectedLogs = { id: moduleId, runId: job.runId }; p.logTail = sanitizeTail(job.logTail); p.logTop = null; p.chooseLogs = false; }
    }
  } catch (error) { p.lastError = errorText(error); }
  finally { p.busy = false; await publish($); }
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
  '▶ iniciar  ↻ reinicia os com erro  ■ cancelar  nome abre o log  × fecha o log  ~ total parcial',
  'A roda do mouse rola o log aberto; ↓ volta ao fim.',
  'S/E/T: módulos com sucesso / com erro / total',
  '✓ passaram  ✗ falharam  ⊘ ignorados',
  '/test-progress help lista os comandos.'];
function textLogs(moduleId: string) {
  const ids = moduleId === 'all' ? Object.keys(p.jobs).sort() : [moduleId];
  return ids.flatMap(id => { const job = p.jobs[id]; return job ? [`LOGS · ${id} · ${job.runId}\n${sanitizeTail(job.logTail).join('\n')}`] : []; }).join('\n\n');
}
async function paneShown($: $) {
  try { return (await $.ui.panes()).some(pane => pane.id === PANE && pane.isShown); } catch { return false; }
}
export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await hydrate($);
    timer?.cancel();
    timer = $.clock.every(1000, () => {
      // A waiting command already refreshes state; never stack ticks behind it.
      if (queued) return;
      void serialized(async () => {
        try {
          await synchronizeIdentity($);
          if (pollDue()) {
            // Every query returns the whole catalogue and all jobs; only a live selected run re-reads its log.
            const selected = p.selectedLogs, job = selected && p.jobs[selected.id];
            const live = !!selected && !!job && ACTIVE.has(job.status);
            await collect($, live ? 'logs' : 'status', live ? selected.id : 'all');
          }
        } catch (error) { p.lastError = errorText(error); }
        if (await paneShown($)) acknowledge();
        await publish($);
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
      p.registrationError = '';
    } catch (error) { p.registrationError = errorText(error); }
    await publish($);
    return next(e);
  });
  on('session.end', async ($, e, next) => {
    // Poll survives clear/resume/branch; workers and timer aren't cancelled here.
    await hydrate($);
    p = { ...empty(), generation: p.generation + 1, registrationError: p.registrationError, collector: p.collector };
    await publish($);
    return next(e);
  });
  on('command.run', { command: 'test-progress' }, async ($, e, next) => {
    await hydrate($);
    // A name match alone isn't ownership: register() can have failed, or another
    // command can have replaced our name since startup. Preserve its full result.
    if (p.registrationError) return next(e);
    try {
      const current = (await $.command.list()).find(command => command.name === 'test-progress');
      if (!current || current.source !== 'plugin' || current.plugin !== 'test-progress') {
        p.registrationError = 'O comando test-progress está indisponível ou pertence a outra origem.';
        await publish($);
        return next(e);
      }
    } catch (error) {
      p.registrationError = `Não foi possível confirmar a origem do comando: ${errorText(error)}`;
      await publish($);
      return next(e);
    }
    let command;
    try { command = parseCommand(e.args); } catch (error) { return { text: errorText(error) }; }
    if (command.action === 'help') return { text: HELP };
    if (command.action === 'paths') return { text: [`Plugin: ${$.plugin.root}`,
      `Rails: ${$.plugin.root}/adapters/rails/run.rb`, `Python: ${$.plugin.root}/adapters/python/run.py`,
      `Karma: ${$.plugin.root}/adapters/karma/reporter.cjs`, `JUnit: ${$.plugin.root}/adapters/junit/pom.xml`,
      `Ruby / RSpec: ${$.plugin.root}/adapters/ruby/run.rb`, `Exemplos: ${$.plugin.root}/config.example.json`].join('\n') };
    // A bare /test-progress toggles: an open pane closes, a closed one refreshes and opens.
    if (!String(e.args ?? '').trim()) {
      try {
        if ((await $.ui.panes()).some(pane => pane.id === PANE)) { await $.ui.close({ id: PANE }); return {}; }
      } catch { /* No pane record: open as usual. */ }
    }
    await perform($, command.action, command.moduleId);
    if (command.text || command.action === 'list') return { text: textSummary() + (command.action === 'logs' ? `\n${textLogs(command.moduleId)}` : '') };
    try {
      const placement = await $.ui.open({ id: PANE, title: 'Test Progress', focus: true, closeOnEscape: true });
      if (!placement.isPlaced) return { text: `${textSummary()}\nPainel aguardando espaço: ${placement.reason}` };
      acknowledge(); await publish($);
    } catch (error) { return { text: `${textSummary()}\nPainel indisponível: ${errorText(error)}` }; }
    return {};
  });
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    // Reading the host's value subscribes this drawing; each publish redraws it.
    await read($, panel);
    await hydrate($);
    const { Box, Text, Button } = $.ui.resolve(e);
    const expected = { generation: p.generation, projection: actionProjection() };
    const guarded = (fn: () => Promise<void> | void) => async () => {
      await synchronizeIdentity($);
      if (p.generation !== expected.generation || actionProjection() !== expected.projection) {
        p.lastError = 'A seleção mudou. Tente de novo.'; await publish($); return;
      }
      acknowledge();
      await fn();
      await publish($);
    };
    const bodyColumns = typeof e.props?.bodyColumns === 'number' ? e.props.bodyColumns : 80;
    const narrow = bodyColumns < NARROW_COLUMNS;
    // Button has no disabled prop in the native API. Dim and guard instead of inventing HTML attributes.
    const button = (key: string, label: string, action: Action, id = 'all', allowed = true) =>
      <Button key={key} label={label} plain dimColor={p.busy || !allowed}
        onPress={guarded(async () => { if (allowed) await perform($, action, id, expected); })} />;
    const local = (key: string, label: string, fn: () => void) => <Button key={key} label={label} plain onPress={guarded(fn)} />;
    const names = displayNames();
    const toggleLogs = (id: string) => guarded(async () => {
      if (p.selectedLogs?.id === id && !p.chooseLogs) { closeLogs(); return; }
      await perform($, 'logs', id, expected);
    });
    // ▶/■ leads the row, in a fixed cell so names stay aligned when a module has neither.
    const runControl = (id: string) => {
      const module = p.modules[id], job = p.jobs[id];
      return <Box key="run" width={1}>{job && (ACTIVE.has(job.status) || job.recoveryRequired && job.cancellable) ? button(`cancel-${id}`, '■', 'cancel', id) :
        module?.enabled ? button(`start-${id}`, '▶', 'start', id, startAllowed(id)) : null}</Box>;
    };
    const progress = (id: string, cells: number) => {
      const job = p.jobs[id];
      if (!job) return [<Text key="none" color="inactive">—</Text>];
      if (job.recoveryRequired) return [<Text key="orphan" color="error">órfão: processo ainda vivo</Text>];
      const counts = compactCounts(job).map(count => <Text key={count.text} color={count.color}>{`${count.text} `}</Text>);
      if (!ACTIVE.has(job.status)) {
        const outcome = outcomeText(job);
        return [...counts, <Text key="outcome" color={outcome.color}>{outcome.text}</Text>];
      }
      const stopping = job.phase === 'cancellation-requested';
      const bar = progressBar(job, cells);
      return [
        <Box key="bar" flexDirection="row" width={cells + 1}>
          {bar.done ? <Text key="done" color={stopping ? 'inactive' : 'suggestion'}>{bar.done}</Text> : null}
          <Text key="rest" color="subtle">{bar.rest}</Text>
        </Box>,
        <Box key="pct" width={7}><Text dimColor={stopping}>{compactPercent(job)}</Text></Box>,
        ...(stopping ? [<Text key="stopping" color="inactive">parando…</Text>] : counts),
      ];
    };
    const logBlock = (id: string) => {
      const selected = p.selectedLogs;
      if (selected?.id !== id) return [];
      const job = p.jobs[id];
      const changed = job?.runId !== selected.runId;
      const { top, max } = logWindow(), total = p.logTail.length;
      const lines = p.logTail.slice(top, top + LOG_ROWS);
      const range = total <= LOG_ROWS ? `${total} ${total === 1 ? 'linha' : 'linhas'}` :
        top === max ? `últimas ${lines.length} de ${total} linhas` : `linhas ${top + 1}–${top + lines.length} de ${total}`;
      const header = `log · run ${selected.runId.slice(0, 8)} · ${range}`;
      return [
        <Box key={`log-${id}`} flexDirection="column" paddingLeft={4}>
          <Box key="log-header" flexDirection="row" justifyContent="space-between">
            <Text key="log-title" color="inactive" wrap="truncate-end">{`│ ${header}`}</Text>
            <Box key="log-actions" flexDirection="row" flexShrink={0} gap={1}>
              {top < max ? local(`end-logs-${id}`, '↓', () => { p.logTop = null; }) : null}
              {local(`close-logs-${id}`, '×', closeLogs)}
            </Box>
          </Box>
          {changed && job ? <Box key="changed" flexDirection="row" gap={1}>
            <Text color="inactive">│ nova execução</Text>
            {button('select-current-logs', '↻', 'logs', id)}
          </Box> : null}
          {lines.length ? lines.map((line, i) => /\b(ERROR|FAIL(ED|URE)?)\b/.test(line) ?
            <Text key={`log-${selected.runId}-${top + i}`} wrap="truncate-end" color="error">{`│ ${line}`}</Text> :
            <Text key={`log-${selected.runId}-${top + i}`} wrap="truncate-end" dimColor>{`│ ${line}`}</Text>) :
            <Text key="empty" color="inactive">│ sem saída ainda</Text>}
        </Box>,
      ];
    };
    // Errors are the line the person most needs whole: they wrap, then point at the next step.
    const problemBlock = (id: string) => {
      const job = p.jobs[id];
      const problems = [...diagnostics(id).map(diagnosticText), ...(job?.error ? [job.error] : [])];
      if (!problems.length) return [];
      const hint = job && p.selectedLogs?.id !== id ? '→ clique no nome para abrir o log' + (job.phase === 'no-progress-observed' || /eventos de progresso/.test(job.error ?? '') ?
        ' · confira o "adapter" do módulo' : '') : '';
      return [
        <Box key="problems" flexDirection="column" paddingLeft={4}>
          {problems.slice(0, 2).map((item, i) => <Text key={`problem-${i}`} color="error" wrap="wrap">{item}</Text>)}
          {hint ? <Text key="hint" dimColor wrap="wrap">{hint}</Text> : null}
        </Box>,
      ];
    };
    const row = (id: string) => {
      const job = p.jobs[id], module = p.modules[id];
      const { glyph, color } = statusGlyph(job);
      const time = job ? clock(job.elapsedMs) : '';
      const live = !!job && ACTIVE.has(job.status);
      const head = [
        <Box key="glyph" width={1}><Text color={color} bold>{glyph}</Text></Box>,
        runControl(id),
        // With a run, the name opens and closes its log.
        <Box key="name" flexGrow={1} flexShrink={1} overflow="hidden">{job ?
          <Button key={`logs-${id}`} label={names[id] ?? id} plain dimColor={!module?.enabled || p.busy && p.selectedLogs?.id !== id} onPress={toggleLogs(id)} /> :
          <Text wrap="truncate" bold={!!module?.enabled} dimColor={!module?.enabled}>{names[id] ?? id}</Text>}</Box>,
      ];
      const tail = <Box key="tail" flexDirection="row" flexShrink={0} gap={1}>
        {time ? <Text key="time" dimColor>{time}</Text> : null}
      </Box>;
      // The name takes the free space, so results and actions stay right-aligned at any width.
      // Narrow: a finished result fits the name line; only a live bar takes a second one.
      const middle = <Box key="middle" flexDirection="row" flexShrink={0}>{progress(id, narrow ? 10 : 12)}</Box>;
      return <Box key={`module-${id}`} flexDirection="column">
        <Box key="line" flexDirection="row" gap={1}>{head}{narrow && live ? null : middle}{tail}</Box>
        {narrow && live ? <Box key="progress" flexDirection="row" paddingLeft={4}>{progress(id, 10)}</Box> : null}
        {problemBlock(id)}
        {logBlock(id)}
      </Box>;
    };
    const ids = visible();
    const configured = ['absent', 'valid'].includes(p.workspace?.moduleConfig?.status ?? 'absent');
    const counts = summaryCounts(ids, p.jobs);
    return <Box key="module-list" flexDirection="column">
      <Box key="toolbar" flexDirection="row" justifyContent="space-between">
        <Box key="summary" flexDirection="row" gap={2}>
          <Box key="counts" flexDirection="row">
            <Text key="passed" color="success">{`${counts.passed}`}</Text>
            <Text key="sep-1" dimColor>/</Text>
            <Text key="failed" color="error">{`${counts.failed}`}</Text>
            <Text key="sep-2" dimColor>/</Text>
            <Text key="total" dimColor>{`${counts.total}`}</Text>
          </Box>
          {enabled().length >= 2 ? button('start-all', '▶ Todos', 'start', 'all', allAllowed()) : null}
          {/* Button takes no color at rest; the whole label is the target and turns red under the pointer. Hidden while nothing failed. */}
          {failedIds().length ? <Box key="failed-action"><Button key="start-failed" label="↻ Apenas com erro" plain hover={{ color: 'error' }}
            dimColor={p.busy || !failedAllowed()} onPress={guarded(async () => { if (failedAllowed()) await startFailed($, expected); })} /></Box> : null}
          {p.busy ? <Text key="busy" dimColor>…</Text> : null}
        </Box>
        <Box key="toolbar-actions" flexDirection="row" gap={1}>
          {local('help', '?', () => { p.showHelp = !p.showHelp; })}
        </Box>
      </Box>
      {ids.map(row)}
      {!ids.length && configured && !p.workspace?.error ? <Text key="empty" dimColor>Nenhum módulo em .claude/test-progress.json</Text> : null}
      {p.chooseLogs ? <Text key="choose-logs" dimColor>Clique no nome de um módulo para ver o log.</Text> : null}
      {p.selectedLogs && !ids.includes(p.selectedLogs.id) ? logBlock(p.selectedLogs.id) : null}
      {p.workspace?.error ? <Text key="config-error" color="error" wrap="wrap">{`Configuração: ${p.workspace.error}`}</Text> : null}
      {(p.workspace?.moduleConfig?.diagnostics ?? []).map((item, i) => <Text key={`config-${i}`} color="error" wrap="wrap">{`Configuração: ${diagnosticText(item)}`}</Text>)}
      {(p.stateDiagnostics['*'] ?? []).map((item, i) => <Text key={`state-${i}`} color="error" wrap="wrap">{`Estado: ${diagnosticText(item)}`}</Text>)}
      {p.lastError ? <Text key="last-error" color="error" wrap="wrap">{p.lastError}</Text> : null}
      {p.registrationError ? <Text key="registration" color="error" wrap="wrap">{`Registro: ${p.registrationError}`}</Text> : null}
      {p.showHelp ? LEGEND.map((line, i) => <Text key={`legend-${i}`} dimColor wrap="wrap">{line}</Text>) : null}
    </Box>;
  });
  // With a log open, the wheel moves the log's own window; at its edges, and for the keys, the pane scrolls.
  on('ui.scroll', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    await hydrate($);
    if (!p.selectedLogs || e.origin.kind !== 'person' || !e.pointer) return next(e);
    const { top, max } = logWindow(), to = Math.min(max, Math.max(0, top + e.by));
    if (to === top) return next(e);
    p.logTop = to === max ? null : to;
    await publish($);
    return {};
  });
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const existing = await next(e);
    if (e.props?.hasSurvey) return existing;
    await read($, panel);
    await hydrate($);
    const seen = new Set(p.seenRuns);
    const live = (id: string) => { const job = p.jobs[id]!; return ACTIVE.has(job.status) || !!job.recoveryRequired; };
    const failed = (id: string) => { const job = p.jobs[id]!; return ['failed', 'error'].includes(job.status) || (job.failed ?? 0) > 0; };
    const ids = visible().filter(id => p.jobs[id]);
    const active = ids.filter(live), unseenFailures = ids.filter(id => !live(id) && failed(id) && !seen.has(p.jobs[id]!.runId));
    // Nothing running and nothing new to report: the band steps aside.
    if (!active.length && !unseenFailures.length) return existing;
    const passed = ids.filter(id => !live(id) && !failed(id) && p.jobs[id]!.status === 'completed');
    const shown = [...active, ...unseenFailures, ...passed];
    const { Box, Text } = $.ui.resolve(e);
    const names = displayNames();
    const item = (id: string) => {
      const job = p.jobs[id]!, { glyph, color } = statusGlyph(job);
      const pct = compactPercent(job);
      return <Box key={`summary-${id}`} flexDirection="row">
        <Text key="glyph" color={color}>{`${glyph} `}</Text>
        <Text key="name">{names[id] ?? id}</Text>
        {job.recoveryRequired ? <Text key="state" color="error">{' órfão'}</Text> :
          live(id) ? (pct === '—' ? <Text key="resolved" dimColor>{` ${job.resolved ?? 0} resolvidos`}</Text> : <Text key="pct">{` ${pct}`}</Text>) : null}
        {!job.recoveryRequired && (job.failed ?? 0) > 0 ? <Text key="failed" color="error">{` ✗${job.failed}`}</Text> : null}
      </Box>;
    };
    const children = shown.slice(0, 3).flatMap((id, i) => [...(i ? [<Text key={`sep-${i}`} dimColor>{'  ·  '}</Text>] : []), item(id)]);
    return <Box flexDirection="column">
      {existing ?? null}
      <Box key="band" flexDirection="row" overflow="hidden">
        {children}
        {shown.length > 3 ? <Text key="more" dimColor>{`  ·  +${shown.length - 3}`}</Text> : null}
      </Box>
    </Box>;
  });
};
