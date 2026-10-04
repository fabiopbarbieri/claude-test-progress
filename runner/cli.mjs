#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { LANES, ACTIVE, namespace, files, readJson, atomicJson, acquireLock,
  releaseLock, snapshots, revision, timestamp } from './state.mjs';
import { groupState, killOwnedOrphan } from './process-identity.mjs';
import { randomUUID, removePath, mergeEnvironment } from './runtime.mjs';
import { frontendRuntime } from './frontend-runtime.mjs';
import { windowsCommand } from './windows-shell.mjs';

const runnerDirectory = path.dirname(fileURLToPath(import.meta.url));
const collectorRuntime = { path: process.execPath, version: process.version,
  source: process.env.TEST_PROGRESS_NODE_SOURCE || 'direct' };
let context;
function argumentsOf(argv) {
  const action = argv[0];
  if (!['start', 'status', 'cancel', 'logs', 'demo'].includes(action)) {
    throw new Error('Ação esperada: start, status, cancel, logs ou demo');
  }
  const options = {};
  for (let index = 1; index < argv.length; index += 2) {
    const option = argv[index];
    if (!['--cwd', '--owner', '--lane', '--config'].includes(option) ||
        options[option] !== undefined || !argv[index + 1] || argv[index + 1].startsWith('--')) {
      throw new Error(`Argumento inválido: ${option}`);
    }
    options[option] = argv[index + 1];
  }
  if (!options['--cwd'] || !options['--owner']) throw new Error('Informe --cwd e --owner');
  const lane = options['--lane'] ?? 'all';
  if (!['all', ...LANES].includes(lane)) throw new Error('--lane precisa ser backend, frontend ou all');
  return { action, options, lanes: lane === 'all' ? LANES : [lane] };
}
function configuration(cwd, requestedPath, lanes) {
  const configPath = path.resolve(cwd, requestedPath ?? '.claude/test-progress.json');
  const config = readJson(configPath);
  if (!config) throw new Error(`Configuração ausente: ${configPath}`);
  if ((config.schemaVersion ?? config.schema) !== 1) throw new Error('A configuração precisa declarar schemaVersion: 1');
  return Object.fromEntries(lanes.map((lane) => {
    const item = config[lane];
    if (!item || !Array.isArray(item.command) || !item.command.length ||
        item.command.some((arg) => typeof arg !== 'string' || arg.includes('\0')) || !item.command[0]) {
      throw new Error(`command precisa ser uma lista de argumentos em ${lane}`);
    }
    const adapter = item.adapter ?? 'auto';
    if (!['auto', 'events', lane === 'backend' ? 'maven' : 'karma'].includes(adapter)) {
      throw new Error(`Adapter inválido em ${lane}`);
    }
    if (item.cwd !== undefined && typeof item.cwd !== 'string') throw new Error(`cwd inválido em ${lane}`);
    const workingDirectory = fs.realpathSync(path.resolve(cwd, item.cwd ?? '.'));
    if (!fs.statSync(workingDirectory).isDirectory()) throw new Error(`cwd não é diretório em ${lane}`);
    const environment = item.env ?? {};
    if (!environment || Array.isArray(environment) || typeof environment !== 'object' ||
        Object.entries(environment).some(([key, value]) => !key || key.includes('=') || key.includes('\0') ||
          typeof value !== 'string' || value.includes('\0'))) throw new Error(`env inválido em ${lane}`);
    const runtime = lane === 'frontend' ? frontendRuntime(workingDirectory, environment, item.command) : { env: environment };
    return [lane, { command: item.command, cwd: workingDirectory, adapter, ...runtime }];
  }));
}
async function start(context, lane, config, source, codeRevision, runId) {
  const locations = files(context.directory, lane);
  const jobPath = path.join(context.directory, `${lane}.${runId}.job.json`);
  try {
    const snapshot = {
      schema: 1, runId, lane, source, status: 'preparing', phase: 'preparing', unit: 'tests',
      total: null, resolved: 0, passed: 0, failed: 0, skipped: 0,
      totalStable: false, percent: null, progressObserved: false,
      startedAt: timestamp(), updatedAt: timestamp(), endedAt: null, exitCode: null,
      pid: null, workerPid: null, command: config.command, cwd: config.cwd,
      logPath: path.join(context.directory, `${lane}.${runId}.log`), revision: codeRevision,
      collectorRuntime,
      ...(config.nodeRuntime ? { nodeRuntime: config.nodeRuntime } : {}),
    };
    atomicJson(locations.snapshot, snapshot);
    atomicJson(jobPath, { ...config, collectorRuntime, runId, lane, directory: context.directory });
    const worker = spawn(process.execPath, [path.join(runnerDirectory, 'worker.mjs'), jobPath], {
      detached: true, stdio: 'ignore', cwd: runnerDirectory,
    });
    await new Promise((resolve, reject) => {
      worker.once('error', reject);
      // The spawn event only exists since Node 14.17; a successful spawn already has its PID.
      if (worker.pid) resolve();
    });
    // Only the worker updates its claim and snapshot; avoid races with an instant child exit.
    worker.unref();
  } catch (error) {
    const snapshot = readJson(locations.snapshot);
    if (snapshot?.runId === runId) atomicJson(locations.snapshot, {
      ...snapshot, status: 'error', phase: 'worker-start-error', error: error.message,
      endedAt: timestamp(), updatedAt: timestamp(),
    });
    removePath(jobPath, { force: true });
    releaseLock(context.directory, lane, runId);
    throw error;
  }
}

async function cancel(context, lanes) {
  const state = snapshots(context.directory);
  for (const lane of lanes) {
    const snapshot = state[lane];
    if (!snapshot) continue;
    if (snapshot.recoveryRequired) {
      const locations = files(context.directory, lane);
      const claim = readJson(locations.claim);
      if (claim?.runId !== snapshot.runId) throw new Error(`Bloqueio de ${lane} não corresponde à execução órfã; recuperação manual necessária.`);
      const identity = snapshot.childIdentity ?? claim.childIdentity;
      killOwnedOrphan(identity);
      const deadline = Date.now() + 1500;
      while (groupState(identity) !== 'empty' && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      if (groupState(identity) !== 'empty') throw new Error(`O encerramento do grupo de ${lane} não foi confirmado; a lane continua bloqueada.`);
      state[lane] = { ...snapshot, status: 'cancelled', phase: 'cancelled', recoveryRequired: false,
        cancellable: false,
        endedAt: timestamp(), updatedAt: timestamp(), cancellationRequestedAt: timestamp(),
        totalStable: false, exitCode: null, error: 'Grupo órfão encerrado por recuperação segura; o código de saída do comando não foi observado.' };
      atomicJson(locations.snapshot, state[lane]);
      releaseLock(context.directory, lane, snapshot.runId);
      removePath(path.join(context.directory, `${lane}.${snapshot.runId}.job.json`), { force: true });
      removePath(path.join(context.directory, `${lane}.${snapshot.runId}.job.json.windows.json`), { force: true });
      continue;
    }
    if (!ACTIVE.has(snapshot.status)) continue;
    // A request is bound to a run ID inside this owner's namespace, never an arbitrary PID.
    atomicJson(files(context.directory, lane).cancel, { runId: snapshot.runId, requestedAt: timestamp() });
    // Return the request immediately; the worker publishes the acknowledgement on close.
    state[lane] = { ...snapshot, phase: 'cancellation-requested', cancellationRequestedAt: timestamp() };
  }
  return state;
}
function logs(context, lanes) {
  const state = snapshots(context.directory);
  for (const lane of lanes) {
    if (!state[lane]) continue;
    let logTail = [];
    try {
      const log = fs.readFileSync(state[lane].logPath, 'utf8');
      logTail = log.replace(/\n$/, '').split(/\r?\n/).slice(-40).map((line) => line.slice(-4096));
      if (log === '') logTail = [];
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    state[lane] = { ...state[lane], logTail };
  }
  return state;
}

async function main() {
  try {
    if (Number(process.versions.node.split('.')[0]) < 14) throw new Error('Node.js 14.0.0 ou superior é necessário');
    const { action, options, lanes } = argumentsOf(process.argv.slice(2));
    context = namespace(options['--cwd'], options['--owner']);
    let state;
    if (action === 'start' || action === 'demo') {
      const config = action === 'demo' ? Object.fromEntries(lanes.map((lane) => [lane, {
        command: [process.execPath, path.join(runnerDirectory, 'demo.mjs'), lane],
        cwd: context.cwd, adapter: 'events', env: {},
      }])) : configuration(context.cwd, options['--config'], lanes);
      const revisionByCwd = new Map();
      for (const lane of lanes) {
        if (process.platform === 'win32') {
          // Windows searches cwd before PATH. Bind plain Node to the selected binary.
          const command = config[lane].nodeRuntime && /^node(?:\.exe)?$/i.test(config[lane].command[0]) ?
            [config[lane].nodeRuntime.path, ...config[lane].command.slice(1)] : config[lane].command;
          config[lane].windowsCommand = windowsCommand(command, config[lane].cwd,
            mergeEnvironment(process.env, config[lane].env));
        }
        if (!revisionByCwd.has(config[lane].cwd)) revisionByCwd.set(config[lane].cwd, revision(config[lane].cwd));
      }
      // Reserve every selected lane before launching. mkdir is the inter-process gate.
      const reserved = new Map();
      const launched = new Set();
      try {
        snapshots(context.directory);
        for (const lane of lanes) {
          const runId = randomUUID();
          acquireLock(context.directory, lane, runId);
          reserved.set(lane, runId);
        }
        for (const lane of lanes) {
          await start(context, lane, config[lane], action === 'demo' ? 'demo' : 'config', revisionByCwd.get(config[lane].cwd), reserved.get(lane));
          launched.add(lane);
        }
      } catch (error) {
        for (const [lane, runId] of reserved) {
          if (launched.has(lane)) atomicJson(files(context.directory, lane).cancel, { runId, requestedAt: timestamp() });
          else releaseLock(context.directory, lane, runId);
        }
        throw error;
      }
      state = snapshots(context.directory);
    } else if (action === 'cancel') state = await cancel(context, lanes);
    else if (action === 'logs') state = logs(context, lanes);
    else state = snapshots(context.directory);
    process.stdout.write(`${JSON.stringify({ schema: 1, ok: true, lanes: state })}\n`);
  } catch (error) {
    let lanes = { backend: null, frontend: null };
    try { if (context) lanes = snapshots(context.directory); } catch { /* Keep the original error. */ }
    process.stderr.write(`test-progress: ${error.message}\n`);
    process.stdout.write(`${JSON.stringify({ schema: 1, ok: false, lanes, error: error.message })}\n`);
    process.exitCode = 1;
  }
}

main();
