import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import { environmentValue, stateRoot } from './runtime.mjs';

const script = fileURLToPath(new URL('../runtime/windows-process.ps1', import.meta.url));
const runnerDirectory = path.dirname(fileURLToPath(import.meta.url));
const helperSources = ['WindowsProcessHost.cs', 'WindowsHelper.cs'].map(name => fileURLToPath(new URL(`../runtime/${name}`, import.meta.url)));
let selfIdentity = null;
export function windowsPowerShell(environment = process.env) {
  const override = environmentValue(environment, 'TEST_PROGRESS_POWERSHELL');
  if (override) {
    if (!path.win32.isAbsolute(override) || !fs.statSync(override).isFile()) {
      throw new Error('TEST_PROGRESS_POWERSHELL deve apontar para um executável absoluto');
    }
    return override;
  }
  const systemRoot = environmentValue(environment, 'SYSTEMROOT') || environmentValue(environment, 'WINDIR');
  if (!systemRoot) throw new Error('SystemRoot ausente: PowerShell não localizado');
  const builtIn = path.win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  if (fs.existsSync(builtIn)) return builtIn;
  throw new Error('Windows PowerShell 5.1 ausente; configure TEST_PROGRESS_POWERSHELL com o caminho absoluto de pwsh.exe');
}
// Per-call limit for PowerShell control processes. A cold PowerShell 7 call is slower
// than 5.1 (it compiles WindowsProcessHost.cs until the cached DLL exists), so its default is higher. The
// variable overrides either engine; the ceiling is the batch preparation deadline
// and an invalid value is an error, never a silent fallback.
export const CONTROL_TIMEOUT_MS = Object.freeze({ default: 7500, pwsh: 15000, min: 1000, max: 30000 });
export function windowsControlTimeout(environment = process.env, engine = null) {
  const value = environmentValue(environment, 'TEST_PROGRESS_POWERSHELL_TIMEOUT_MS');
  if (value === undefined || value === '') {
    return engine && path.win32.basename(engine).toLowerCase() === 'pwsh.exe' ? CONTROL_TIMEOUT_MS.pwsh : CONTROL_TIMEOUT_MS.default;
  }
  const timeout = /^[0-9]{1,6}$/.test(value) ? Number(value) : NaN;
  if (!(timeout >= CONTROL_TIMEOUT_MS.min && timeout <= CONTROL_TIMEOUT_MS.max)) {
    throw new Error(`TEST_PROGRESS_POWERSHELL_TIMEOUT_MS deve ser um inteiro entre ${CONTROL_TIMEOUT_MS.min} e ${CONTROL_TIMEOUT_MS.max} (ms)`);
  }
  return timeout;
}
// Process-scoped Bypass lets the helpers run under the client default (Restricted)
// without changing any persistent policy; Group Policy still takes precedence.
export const POWERSHELL_FLAGS = Object.freeze(['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass']);
function argumentsFor(action, parameters) {
  return [...POWERSHELL_FLAGS, '-File', script, '-Action', action, '-CacheDirectory', stateRoot(), ...parameters];
}
// Native helper: WindowsHelper.cs compiled once by Windows PowerShell 5.1 into the private
// state root, named by the hash of its sources. It runs the same actions as
// windows-process.ps1 in tens of milliseconds and a few MB. It is used only as a plain,
// unlinked file inside that verified root, the same trust given to the job files that
// define the commands; if it cannot start, this process falls back to PowerShell.
let helperFile; // undefined: not found yet; null: disabled for this process
function helperPath() {
  const hash = crypto.createHash('sha256');
  for (const file of helperSources) hash.update(fs.readFileSync(file)).update('\0');
  return path.join(stateRoot(), `helper-${hash.digest('hex').slice(0, 16)}.exe`);
}
function plainFile(file) {
  try {
    const info = fs.lstatSync(file);
    return info.isFile() && fs.realpathSync(file) === path.resolve(file) ? file : null;
  } catch { return null; }
}
function helper() {
  if (helperFile !== undefined) return helperFile;
  if (environmentValue(process.env, 'TEST_PROGRESS_WINDOWS_HELPER') === '0') return (helperFile = null);
  const file = plainFile(helperPath());
  if (file) helperFile = file;
  return file;
}
// Builds the helper once per source hash; a failed build is not retried for an hour.
function ensureHelper() {
  if (helper() || helperFile === null) return;
  const file = helperPath(), failed = `${file}.failed`;
  try { if (Date.now() - fs.statSync(failed).mtimeMs < 3600000) return; } catch { /* No recent failure. */ }
  const systemRoot = environmentValue(process.env, 'SYSTEMROOT') || environmentValue(process.env, 'WINDIR');
  const builder = systemRoot && path.win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  if (!builder || !fs.existsSync(builder)) return;
  try {
    execFileSync(builder, [...POWERSHELL_FLAGS, '-File', script, '-Action', 'BuildHelper', '-Output', file],
      { encoding: 'utf8', timeout: 30000, maxBuffer: 64 * 1024, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    helperFile = plainFile(file) ?? undefined;
  } catch {
    try { fs.writeFileSync(failed, '', { mode: 0o600 }); } catch { /* The next call may try again. */ }
  }
}
function control(action, parameters, attempts = 1) {
  for (let attempt = 1; ; attempt++) {
    const exe = helper();
    const engine = exe || windowsPowerShell();
    const timeout = windowsControlTimeout(process.env, exe ? null : engine);
    const args = exe ? ['-Action', action, ...parameters, ...(action === 'LaunchCoordinator' ? ['-Runner', runnerDirectory] : [])] :
      argumentsFor(action, parameters);
    try {
      const output = execFileSync(engine, args, {
        encoding: 'utf8', timeout, maxBuffer: 64 * 1024, windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return JSON.parse(output.replace(/^\uFEFF/, '').trim());
    } catch (error) {
      // A helper that could not start at all (blocked by policy, removed) is dropped for this process.
      if (exe && error.code !== 'ETIMEDOUT' && typeof error.status !== 'number') { helperFile = null; attempt--; continue; }
      if (error.code !== 'ETIMEDOUT' || attempt >= attempts) throw error;
    }
  }
}
function valid(identity) {
  return Boolean(identity && identity.platform === 'win32' && Number.isInteger(identity.pid) &&
    identity.pid > 0 && typeof identity.startTime === 'string' && /^\d+$/.test(identity.startTime) &&
    typeof identity.owner === 'string' && /^S-\d+(?:-\d+)+$/.test(identity.owner));
}
function validPid(pid) { return Number.isInteger(pid) && pid > 0 && pid <= 2147483647; }
function queryIdentity(identity) {
  return valid(identity) && validPid(identity.pid) && identity.startTime.length <= 20 && identity.owner.length <= 184;
}
function checkedList(values) {
  if (!Array.isArray(values) || values.length > 64) throw new Error('Consulta Windows precisa de uma lista de até 64 itens');
}
function rememberSelf(value) {
  if (!selfIdentity && queryIdentity(value) && value.pid === process.pid && Number.isInteger(value.sessionId) && value.sessionId >= 0) {
    selfIdentity = Object.freeze({ platform: value.platform, pid: value.pid, startTime: value.startTime,
      owner: value.owner, sessionId: value.sessionId });
  }
}
function matchesSelf(identity) {
  return Boolean(selfIdentity && queryIdentity(identity) && identity.pid === selfIdentity.pid &&
    identity.startTime === selfIdentity.startTime && identity.owner === selfIdentity.owner && identity.sessionId === selfIdentity.sessionId);
}
function identityArguments(identity) {
  return ['-ProcessId', String(identity.pid), '-StartTime', identity.startTime, '-Owner', identity.owner];
}
export function managed(identity) {
  return valid(identity) && identity.managedBroker === true && identity.contained === true &&
    typeof identity.jobName === 'string' && /^Local\\claude-test-progress-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(identity.jobName) &&
    Number.isInteger(identity.sessionId) && identity.sessionId >= 0;
}
export function windowsIdentity(pid) {
  if (!validPid(pid)) return null;
  if (pid === process.pid && selfIdentity) return { ...selfIdentity };
  try {
    const value = control('Identity', ['-ProcessId', String(pid)]);
    if (!queryIdentity(value) || value.pid !== pid) return null;
    if (pid === process.pid) {
      rememberSelf(value);
      return selfIdentity ? { ...selfIdentity } : null;
    }
    return { ...value };
  } catch { return null; }
}
export function windowsIdentities(pids) {
  checkedList(pids);
  const result = pids.map(() => null);
  const pending = [];
  pids.forEach((pid, index) => {
    if (!validPid(pid)) return;
    if (pid === process.pid && selfIdentity) result[index] = { ...selfIdentity };
    else pending.push({ pid, index });
  });
  if (!pending.length) return result;
  try {
    const reply = control('IdentityMany', ['-Queries', JSON.stringify(pending.map(item => item.pid))]);
    if (!Array.isArray(reply.identities) || reply.identities.length !== pending.length) return result;
    pending.forEach((item, index) => {
      const identity = reply.identities[index];
      if (!queryIdentity(identity) || identity.pid !== item.pid) return;
      if (item.pid === process.pid) {
        rememberSelf(identity);
        if (selfIdentity) result[item.index] = { ...selfIdentity };
      } else result[item.index] = { ...identity };
    });
  } catch { /* Unknown identities stay null; no external identity is cached. */ }
  return result;
}
export function windowsSameProcess(identity) {
  if (!queryIdentity(identity)) return false;
  if (identity.pid === process.pid) {
    if (!selfIdentity) windowsIdentity(process.pid);
    return matchesSelf(identity);
  }
  try { return control('State', identityArguments(identity)).state === 'present'; }
  catch { return false; }
}
export function windowsSameProcesses(identities) {
  checkedList(identities);
  const result = identities.map(() => false);
  const pending = [];
  identities.forEach((identity, index) => {
    if (!queryIdentity(identity)) return;
    if (identity.pid === process.pid && selfIdentity) result[index] = matchesSelf(identity);
    else pending.push({ identity, index });
  });
  if (!pending.length) return result;
  const captureSelf = !selfIdentity && pending.some(item => item.identity.pid === process.pid);
  try {
    const parameters = ['-Queries', JSON.stringify(pending.map(item => ({ pid: item.identity.pid,
      startTime: item.identity.startTime, owner: item.identity.owner })))];
    if (captureSelf) parameters.push('-SelfProcessId', String(process.pid));
    const reply = control('StateMany', parameters);
    if (!Array.isArray(reply.matches) || reply.matches.length !== pending.length) return result;
    if (captureSelf) rememberSelf(reply.selfIdentity);
    pending.forEach((item, index) => {
      result[item.index] = item.identity.pid === process.pid ? matchesSelf(item.identity) : reply.matches[index] === true;
    });
  } catch { /* Unknown states stay false; external liveness is always queried. */ }
  return result;
}
export function windowsGroupState(identity) {
  if (!managed(identity)) return 'unknown';
  try {
    const value = control('Group', ['-JobName', identity.jobName, '-SessionId', String(identity.sessionId)]);
    return ['empty', 'present'].includes(value.state) ? value.state : 'unknown';
  } catch { return 'unknown'; }
}
export function windowsKillOwnedBroker(identity) {
  if (!managed(identity)) {
    throw new Error('Identidade do broker Windows não confirmada; nenhum PID foi encerrado');
  }
  const value = control('Kill', identityArguments(identity));
  if (value.killed !== true) throw new Error('O broker Windows não confirmou encerramento');
}
export function windowsSecureDirectory(directory, child = null) {
  if (!path.win32.isAbsolute(directory)) throw new Error('Diretório Windows precisa ser absoluto');
  if (child !== null && path.win32.dirname(child) !== directory) throw new Error('Subdiretório Windows precisa estar direto na raiz');
  // The first control process of a CLI call compiles WindowsProcessHost.cs; a cold
  // PowerShell 7 start can exceed the timeout. Retrying is safe: creation is atomic
  // with a protected DACL and an existing directory is only verified, never repaired.
  // Deadline-bound queries are not retried; they already fail closed as unknown.
  const value = control('SecureDirectory', ['-Directory', directory, ...(child === null ? [] : ['-Child', child])], 2);
  if (value.secured !== true) throw new Error('DACL do diretório Windows não confirmada');
  if (directory === stateRoot()) ensureHelper();
}
export function windowsLaunchCoordinator(collector, request) {
  if (!path.win32.isAbsolute(collector) || !path.win32.isAbsolute(request)) throw new Error('Coordenador Windows precisa de caminhos absolutos');
  const identity = control('LaunchCoordinator', ['-Collector', collector, '-JobFile', request]);
  if (!valid(identity)) throw new Error('Identidade do coordenador Windows não confirmada');
  return identity;
}
// The project's Node is chosen by the native helper when it runs, else by resolve-node.ps1.
export function windowsNodeResolver(cwd, environment = process.env, native = true) {
  const exe = native ? helper() : null;
  return exe ? { file: exe, args: ['-Action', 'ResolveNode', '-Mode', 'project', '-Cwd', cwd] } :
    { file: windowsPowerShell(environment), args: [...POWERSHELL_FLAGS, '-File', fileURLToPath(new URL('../runtime/resolve-node.ps1', import.meta.url)), '-Mode', 'project', '-Cwd', cwd] };
}
export function windowsSpawnSpec(jobPath, environment = process.env) {
  if (!path.win32.isAbsolute(jobPath)) throw new Error('Arquivo de execução Windows precisa ser absoluto');
  const exe = helper();
  return { file: exe || windowsPowerShell(environment), args: exe ? ['-Action', 'Run', '-JobFile', jobPath] : argumentsFor('Run', ['-JobFile', jobPath]),
    options: { env: environment, windowsHide: true, shell: false } };
}
