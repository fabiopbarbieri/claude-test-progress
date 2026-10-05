import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const script = fileURLToPath(new URL('../runtime/windows-process.ps1', import.meta.url));
let selfIdentity = null;
function variable(environment, name) {
  const key = Object.keys(environment).find((entry) => entry.toUpperCase() === name);
  return key === undefined ? undefined : environment[key];
}
export function windowsPowerShell(environment = process.env) {
  const override = variable(environment, 'TEST_PROGRESS_POWERSHELL');
  if (override) {
    if (!path.win32.isAbsolute(override) || !fs.statSync(override).isFile()) {
      throw new Error('TEST_PROGRESS_POWERSHELL deve apontar para um executável absoluto');
    }
    return override;
  }
  const systemRoot = variable(environment, 'SYSTEMROOT') || variable(environment, 'WINDIR');
  if (!systemRoot) throw new Error('SystemRoot ausente: PowerShell não localizado');
  const legacy = path.win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  if (fs.existsSync(legacy)) return legacy;
  throw new Error('Windows PowerShell 5.1 ausente; configure TEST_PROGRESS_POWERSHELL com o caminho absoluto de pwsh.exe');
}
// Per-call limit for PowerShell control processes. PowerShell 7 starts slower than
// 5.1 (each call compiles WindowsProcessHost.cs), so its default is higher. The
// variable overrides either engine; the ceiling is the batch preparation deadline
// and an invalid value is an error, never a silent fallback.
export const CONTROL_TIMEOUT_MS = Object.freeze({ default: 7500, pwsh: 15000, min: 1000, max: 30000 });
export function windowsControlTimeout(environment = process.env, engine = null) {
  const value = variable(environment, 'TEST_PROGRESS_POWERSHELL_TIMEOUT_MS');
  if (value === undefined || value === '') {
    return engine && path.win32.basename(engine).toLowerCase() === 'pwsh.exe' ? CONTROL_TIMEOUT_MS.pwsh : CONTROL_TIMEOUT_MS.default;
  }
  const timeout = /^[0-9]{1,6}$/.test(value) ? Number(value) : NaN;
  if (!(timeout >= CONTROL_TIMEOUT_MS.min && timeout <= CONTROL_TIMEOUT_MS.max)) {
    throw new Error(`TEST_PROGRESS_POWERSHELL_TIMEOUT_MS deve ser um inteiro entre ${CONTROL_TIMEOUT_MS.min} e ${CONTROL_TIMEOUT_MS.max} (ms)`);
  }
  return timeout;
}
function argumentsFor(action, parameters) {
  return ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', script, '-Action', action, ...parameters];
}
function control(action, parameters, attempts = 1) {
  const engine = windowsPowerShell();
  const timeout = windowsControlTimeout(process.env, engine);
  for (let attempt = 1; ; attempt++) {
    try {
      const output = execFileSync(engine, argumentsFor(action, parameters), {
        encoding: 'utf8', timeout, maxBuffer: 64 * 1024, windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return JSON.parse(output.replace(/^\uFEFF/, '').trim());
    } catch (error) {
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
function managed(identity) {
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
export function windowsSecureDirectory(directory) {
  if (!path.win32.isAbsolute(directory)) throw new Error('Diretório Windows precisa ser absoluto');
  // The first control process of a CLI call compiles WindowsProcessHost.cs; a cold
  // PowerShell 7 start can exceed the timeout. Retrying is safe: creation is atomic
  // with a protected DACL and an existing directory is only verified, never repaired.
  // Deadline-bound queries are not retried; they already fail closed as unknown.
  const value = control('SecureDirectory', ['-Directory', directory], 2);
  if (value.secured !== true) throw new Error('DACL do diretório Windows não confirmada');
}
export function windowsLaunchCoordinator(collector, request) {
  if (!path.win32.isAbsolute(collector) || !path.win32.isAbsolute(request)) throw new Error('Coordenador Windows precisa de caminhos absolutos');
  const identity = control('LaunchCoordinator', ['-Collector', collector, '-JobFile', request]);
  if (!valid(identity)) throw new Error('Identidade do coordenador Windows não confirmada');
  return identity;
}
export function windowsSpawnSpec(jobPath, environment = process.env) {
  if (!path.win32.isAbsolute(jobPath)) throw new Error('Arquivo de execução Windows precisa ser absoluto');
  return { file: windowsPowerShell(environment), args: argumentsFor('Run', ['-JobFile', jobPath]),
    options: { env: environment, windowsHide: true, shell: false } };
}
