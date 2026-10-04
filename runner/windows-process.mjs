import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const script = fileURLToPath(new URL('../runtime/windows-process.ps1', import.meta.url));
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
function argumentsFor(action, parameters) {
  return ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', script, '-Action', action, ...parameters];
}
function control(action, parameters) {
  const output = execFileSync(windowsPowerShell(), argumentsFor(action, parameters), {
    encoding: 'utf8', timeout: 2000, maxBuffer: 64 * 1024, windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return JSON.parse(output.replace(/^\uFEFF/, '').trim());
}
function valid(identity) {
  return Boolean(identity && identity.platform === 'win32' && Number.isInteger(identity.pid) &&
    identity.pid > 0 && typeof identity.startTime === 'string' && /^\d+$/.test(identity.startTime) &&
    typeof identity.owner === 'string' && /^S-\d+(?:-\d+)+$/.test(identity.owner));
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
  if (!Number.isInteger(pid) || pid <= 0) return null;
  try {
    const value = control('Identity', ['-ProcessId', String(pid)]);
    return valid(value) ? value : null;
  } catch { return null; }
}
export function windowsSameProcess(identity) {
  if (!valid(identity)) return false;
  try { return control('State', identityArguments(identity)).state === 'present'; }
  catch { return false; }
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
  const value = control('SecureDirectory', ['-Directory', directory]);
  if (value.secured !== true) throw new Error('DACL do diretório Windows não confirmada');
}
export function windowsSpawnSpec(jobPath, environment = process.env) {
  if (!path.win32.isAbsolute(jobPath)) throw new Error('Arquivo de execução Windows precisa ser absoluto');
  return { file: windowsPowerShell(environment), args: argumentsFor('Run', ['-JobFile', jobPath]),
    options: { env: environment, windowsHide: true, shell: false } };
}
