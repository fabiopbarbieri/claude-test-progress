#!/usr/bin/env node
import { SCHEMA_VERSION } from './schema.mjs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { ACTIVE, namespace, files, readJson, readPrivate, atomicJson, acquireLock, releaseLock,
  inspectState, revision, timestamp, validRecord, ownedClaim, jobFile } from './state.mjs';
import { processIdentity, sameProcess, groupState, killOwnedOrphan } from './process-identity.mjs';
import { randomUUID, removePath } from './runtime.mjs';
import { validModuleId } from './module-id.mjs';
import { sanitizeText, readableTail } from './module-presentation.mjs';
import { PREFIX } from './progress.mjs';
import { discoverModules, prepareSelection, assertSourcesUnchanged } from './module-config.mjs';
import { batchFiles, readBatch, changeBatch, preparationMs, ABORT_MS, pause } from './module-batch.mjs';
import { windowsLaunchCoordinator } from './windows-process.mjs';

const runnerDirectory = path.dirname(fileURLToPath(import.meta.url));
const collectorRuntime = { path: process.execPath, version: process.version, source: process.env.TEST_PROGRESS_NODE_SOURCE || 'direct' };
let context;
let discovery;
let actionResults;
function argumentsOf(argv) {
  const action = argv[0];
  if (!['start', 'list', 'status', 'cancel', 'logs'].includes(action)) throw new Error('Ação esperada: start, list, status, cancel ou logs');
  const options = Object.create(null);
  for (let index = 1; index < argv.length; index += 2) {
    const option = argv[index];
    if (!['--cwd', '--owner', '--module', '--config'].includes(option) || options[option] !== undefined ||
        !argv[index + 1] || argv[index + 1].startsWith('--')) throw new Error(`Argumento inválido: ${option}`);
    options[option] = argv[index + 1];
  }
  if (!options['--cwd'] || !options['--owner']) throw new Error('Informe --cwd e --owner');
  const target = options['--module'] || 'all';
  if (target !== 'all' && !validModuleId(target)) throw new Error('--module precisa ser um ID seguro ou all');
  return { action, options, target };
}
function initialSnapshot(config, runId, batchId, codeRevision) {
  return { schemaVersion: SCHEMA_VERSION, runId, moduleId: config.moduleId, label: config.label, batchId, source: 'config',
    status: 'preparing', phase: 'preparing', unit: 'tests', total: null, resolved: 0, passed: 0, failed: 0, skipped: 0,
    totalStable: false, percent: null, progressObserved: false, startedAt: timestamp(), updatedAt: timestamp(),
    endedAt: null, exitCode: null, heartbeatAt: null, lastOutputAt: null, lastProgressAt: null, pid: null, workerPid: null,
    command: config.command, cwd: config.cwd, adapter: config.adapter, runtime: config.runtime,
    logPath: path.join(context.directory, `${config.moduleId}.${runId}.log`), revision: codeRevision, collectorRuntime,
    ...(config.language ? { language: config.language } : {}), ...(config.nodeRuntime ? { nodeRuntime: config.nodeRuntime } : {}) };
}
async function start(selection, preparationStartedAt) {
  if (!selection.ids.length) throw new Error('Nenhum módulo habilitado para iniciar.');
  const initialState = inspectState(context.directory);
  if (selection.ids.some(id => initialState.stateDiagnostics[id]?.some(item => item.blocking))) throw new Error('Módulo selecionado contém estado bloqueado; recuperação segura necessária.');
  if (initialState.blocked) throw new Error('Namespace contém estado incompatível ou inseguro; novos starts bloqueados.');
  const deadlineAt = new Date(preparationStartedAt + preparationMs(selection.ids.length)).toISOString();
  if (Date.now() >= Date.parse(deadlineAt)) throw new Error('Prazo de preflight e preparação expirado antes da reserva.');
  const batchId = randomUUID();
  const loc = batchFiles(context.directory, batchId);
  const entries = selection.ids.slice().sort().map((moduleId) => ({ moduleId, runId: randomUUID() }));
  const reserved = [];
  let coordinator;
  let manifestCreated = false;
  const acknowledgeRelease = () => {
    actionResults = Object.fromEntries(entries.map((entry) => [entry.moduleId, { ok: true, runId: entry.runId, batchId, action: 'start' }]));
  };
  try {
    assertSourcesUnchanged(selection.revision);
    for (const entry of entries) {
      acquireLock(context.directory, entry.moduleId, entry.runId, { batchId });
      reserved.push(entry);
    }
    // Namespace-wide incompatible-state checks happen again after reserving, before preparing workers.
    // Own newly reserved locks are expected to have no snapshots yet.
    for (const entry of entries) ownedClaim(context.directory, entry.moduleId, entry.runId);
    const revisions = new Map();
    let testHooks = Object.create(null);
    if (process.env.TEST_PROGRESS_INTERNAL_TEST_HOOKS) testHooks = JSON.parse(process.env.TEST_PROGRESS_INTERNAL_TEST_HOOKS);
    for (const entry of entries) {
      const config = selection.configurations[entry.moduleId];
      if (!revisions.has(config.cwd)) revisions.set(config.cwd, revision(config.cwd));
      atomicJson(files(context.directory, entry.moduleId).snapshot, initialSnapshot(config, entry.runId, batchId, revisions.get(config.cwd)));
      atomicJson(jobFile(context.directory, entry.moduleId, entry.runId), { ...config, schemaVersion: SCHEMA_VERSION, ...entry,
        directory: context.directory, batchId, collectorRuntime, ...(testHooks[entry.moduleId] ? { testHooks: testHooks[entry.moduleId] } : {}) });
    }
    atomicJson(loc.manifest, { schemaVersion: SCHEMA_VERSION, batchId, state: 'preparing', entries, launchIdentity: processIdentity(process.pid),
      coordinatorIdentity: null, createdAt: timestamp(), deadlineAt });
    manifestCreated = true;
    atomicJson(loc.request, { schemaVersion: SCHEMA_VERSION, batchId, directory: context.directory, revision: selection.revision });
    let identity;
    if (process.platform === 'win32') {
      // Whitelist only NUL handles. Native PowerShell must receive EOF even
      // while the detached coordinator and user command keep running.
      identity = windowsLaunchCoordinator(process.execPath, loc.request);
    } else {
      coordinator = spawn(process.execPath, [path.join(runnerDirectory, 'module-batch-worker.mjs'), loc.request],
        { detached: true, stdio: 'ignore', cwd: runnerDirectory, windowsHide: true });
      await new Promise((resolve, reject) => { coordinator.once('error', reject); if (coordinator.pid) resolve(); });
      identity = processIdentity(coordinator.pid);
      coordinator.unref();
    }
    if (!identity) throw new Error('Identidade do coordenador não confirmada');
    for (;;) {
      const manifest = readBatch(context.directory, batchId);
      if (manifest.state === 'released') {
        acknowledgeRelease();
        return;
      }
      if (manifest.state === 'aborted') throw new Error(manifest.error || 'Lote abortado antes da execução');
      const alive = sameProcess(identity);
      // A native identity query can outlive preparation. The durable barrier,
      // reread after that query, decides whether launch has already succeeded.
      const afterProbe = readBatch(context.directory, batchId);
      if (afterProbe.state === 'released') { acknowledgeRelease(); return; }
      if (afterProbe.state === 'aborted') throw new Error(afterProbe.error || 'Lote abortado antes da execução');
      if (!alive) throw new Error('Coordenador perdido antes da liberação do lote');
      if (Date.now() >= Date.parse(deadlineAt)) throw new Error('Prazo de preparação do lote expirado');
      await pause();
    }
  } catch (error) {
    if (manifestCreated) {
      try {
        const final = changeBatch(context.directory, batchId, (value) => value.state === 'preparing' ?
          { ...value, state: 'aborted', error: error.message, abortedAt: timestamp() } : value);
        if (final.state === 'released') { acknowledgeRelease(); return; }
      } catch { /* Retain unsafe gate. */ }
    }
    for (const entry of reserved) {
      try {
        const claim = ownedClaim(context.directory, entry.moduleId, entry.runId);
        if (sameProcess(claim.coordinatorIdentity) || sameProcess(claim.workerIdentity)) {
          atomicJson(files(context.directory, entry.moduleId).cancel, { schemaVersion: SCHEMA_VERSION, ...entry, requestedAt: timestamp() });
          continue;
        }
        if (claim.spawnAttemptAt) continue; // An unacknowledged spawn is an unknown tree.
        const snapshot = readJson(files(context.directory, entry.moduleId).snapshot);
        if (validRecord(snapshot, entry.moduleId, entry.runId)) atomicJson(files(context.directory, entry.moduleId).snapshot,
          { ...snapshot, status: 'error', phase: 'batch-aborted', infrastructureFailure: true, error: error.message, endedAt: timestamp(), updatedAt: timestamp() });
        releaseLock(context.directory, entry.moduleId, entry.runId);
        removePath(jobFile(context.directory, entry.moduleId, entry.runId), { force: true });
      } catch { /* Preserve uncertain ownership and continue processing other entries. */ }
    }
    // Observe an abort briefly; prepared commands still cannot pass the barrier.
    const observation = Date.now() + ABORT_MS;
    while (reserved.some((entry) => {
      try { return Boolean(readJson(files(context.directory, entry.moduleId).claim)); } catch { return false; }
    }) && Date.now() < observation) await pause(50);
    throw error;
  }
}
async function cancel(target, state) {
  actionResults = Object.create(null);
  for (const moduleId of target === 'all' ? [...new Set([...Object.keys(state.jobs), ...Object.keys(state.stateDiagnostics).filter(validModuleId)])].sort() : [target]) {
    try {
      const snapshot = state.jobs[moduleId];
      if ((state.stateDiagnostics[moduleId]?.length && !snapshot?.recoveryRequired) || !snapshot) throw new Error(`Estado de ${moduleId} indisponível ou incompatível`);
      if (snapshot.recoveryRequired) {
        const claim = ownedClaim(context.directory, moduleId, snapshot.runId);
        const identity = snapshot.childIdentity ?? claim.childIdentity;
        killOwnedOrphan(identity);
        const deadline = Date.now() + 1500;
        while (groupState(identity) !== 'empty' && Date.now() < deadline) await pause(50);
        if (groupState(identity) !== 'empty') throw new Error('Árvore não vazia confirmada; lock conservado');
        atomicJson(files(context.directory, moduleId).snapshot, { ...snapshot, status: 'cancelled', phase: 'cancelled', recoveryRequired: false,
          cancellable: false, endedAt: timestamp(), updatedAt: timestamp(), exitCode: null, totalStable: false });
        releaseLock(context.directory, moduleId, snapshot.runId);
        removePath(jobFile(context.directory, moduleId, snapshot.runId), { force: true });
        if (process.platform === 'win32') removePath(`${jobFile(context.directory, moduleId, snapshot.runId)}.windows.json`, { force: true });
      } else if (ACTIVE.has(snapshot.status)) {
        ownedClaim(context.directory, moduleId, snapshot.runId);
        atomicJson(files(context.directory, moduleId).cancel, { schemaVersion: SCHEMA_VERSION, moduleId, runId: snapshot.runId, requestedAt: timestamp() });
      }
      actionResults[moduleId] = { ok: true, action: 'cancel', runId: snapshot.runId };
    } catch (error) { actionResults[moduleId] = { ok: false, action: 'cancel', error: error.message }; }
  }
}
function logs(target, state) {
  for (const moduleId of target === 'all' ? Object.keys(state.jobs) : [target]) {
    const snapshot = state.jobs[moduleId];
    if (!snapshot) continue;
    try {
      const expected = path.join(context.directory, `${moduleId}.${snapshot.runId}.log`);
      if (snapshot.logPath !== expected) throw new Error('logPath não autenticado');
      // The tail keeps 40 readable lines of at most 4096 characters, protocol lines and blank runs left out.
      const contents = readPrivate(expected, 2 * 1024 * 1024, { tail: 256 * 1024 }) || '';
      const clean = sanitizeText(contents);
      state.jobs[moduleId] = { ...snapshot, logTail: clean ? readableTail(clean.split(/\r?\n/), PREFIX).slice(-40).map((line) => line.slice(-4096)) : [] };
    } catch (error) { (state.stateDiagnostics[moduleId] || (state.stateDiagnostics[moduleId] = [])).push({ code: 'unsafe-log', message: error.message, blocking: true }); }
  }
}
function envelope(state, ok, error) {
  const modules = discovery?.modules || Object.create(null);
  for (const [id, job] of Object.entries(state.jobs)) if (!modules[id]) modules[id] = { id, label: job.label || id, language: job.language || null,
    order: Object.keys(modules).length, enabled: false, directoryPresent: false, origin: 'state', diagnostics: [] };
  return { schemaVersion: SCHEMA_VERSION, ok, modules, jobs: state.jobs,
    workspace: { ...(discovery?.workspace || {}), moduleConfig: { ...(discovery?.workspace?.moduleConfig || { status: 'absent', schemaVersion: null, enabledIds: [] }), diagnostics: discovery?.diagnostics || [] }, stateBlocked: state.blocked },
    stateDiagnostics: state.stateDiagnostics, ...(actionResults ? { actionResults } : {}), ...(error ? { error } : {}),
    // The Mod reuses this Node for later queries instead of bootstrapping a shell each time.
    collector: { path: collectorRuntime.path, source: collectorRuntime.source } };
}
async function main() {
  try {
    if (Number(process.versions.node.split('.')[0]) < 14) throw new Error('Node.js 14.0.0 ou superior é necessário');
    const { action, options, target } = argumentsOf(process.argv.slice(2));
    const preparationStartedAt = Date.now();
    // Read-only actions may reuse a recent Windows DACL verification; start and cancel never do.
    context = namespace(options['--cwd'], options['--owner'], { reuseVerifiedAcl: !['start', 'cancel'].includes(action) });
    // Discovery enriches metadata only. State management remains available with removed/invalid configuration.
    try { discovery = discoverModules(context, { configPath: options['--config'] }); } catch (error) { if (action === 'start' || action === 'list') throw error; }
    let state = inspectState(context.directory);
    if (action === 'start') { await start(prepareSelection(discovery, target), preparationStartedAt); state = inspectState(context.directory); }
    else if (action === 'cancel') { await cancel(target, state); state = inspectState(context.directory); }
    else if (action === 'logs') logs(target, state);
    const ok = !actionResults || Object.values(actionResults).every((result) => result.ok);
    if (!ok) process.exitCode = 1;
    process.stdout.write(`${JSON.stringify(envelope(state, ok))}\n`);
  } catch (error) {
    let state = { jobs: Object.create(null), stateDiagnostics: Object.create(null), blocked: true };
    try { if (context) state = inspectState(context.directory); } catch (stateError) {
      state.stateDiagnostics['*'] = [{ code: 'unsafe-namespace', message: stateError.message, blocking: true }];
    }
    process.stderr.write(`test-progress: ${error.message}\n`);
    process.stdout.write(`${JSON.stringify(envelope(state, false, error.message))}\n`);
    process.exitCode = 1;
  }
}
main();
