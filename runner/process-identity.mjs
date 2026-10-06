import fs from 'fs';
import { windowsIdentity, windowsIdentities, windowsGroupState, windowsSameProcess, windowsSameProcesses, windowsKillOwnedBroker } from './windows-process.mjs';

function proc(pid) {
  const directory = `/proc/${pid}`;
  const text = fs.readFileSync(`${directory}/stat`, 'utf8');
  // comm is parenthesized and may itself contain spaces or parentheses.
  const fields = text.slice(text.lastIndexOf(')') + 2).trim().split(/\s+/);
  return { pid: Number(pid), state: fields[0], group: Number(fields[2]),
    startTime: fields[19], uid: fs.statSync(directory).uid };
}
function bootId() {
  return fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
}
// On Windows every liveness query starts a PowerShell process, so supervision loops
// trust a positive answer this long before asking again. A process found absent
// never comes back, and a negative or failed answer is always queried again.
export const WINDOWS_LIVENESS_MS = 2000;

export function processIdentity(pid) {
  if (process.platform === 'win32') return windowsIdentity(pid);
  if (process.platform !== 'linux' || !Number.isInteger(pid) || pid <= 0) return null;
  try {
    const identity = proc(pid);
    return { ...identity, bootId: bootId() };
  } catch { return null; }
}
export function validProcessIdentity(identity) {
  if (!identity || !Number.isInteger(identity.pid) || identity.pid <= 0) return false;
  if (process.platform === 'win32') return identity.platform === 'win32' && typeof identity.startTime === 'string' &&
    /^\d+$/.test(identity.startTime) && typeof identity.owner === 'string' && /^S-\d+(?:-\d+)+$/.test(identity.owner);
  return process.platform === 'linux' && Number.isInteger(identity.group) && identity.group > 0 &&
    Number.isInteger(identity.uid) && identity.uid >= 0 && typeof identity.startTime === 'string' && /^\d+$/.test(identity.startTime) &&
    typeof identity.bootId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(identity.bootId);
}
export function sameProcess(identity) {
  if (!validProcessIdentity(identity)) return false;
  if (process.platform === 'win32') return windowsSameProcess(identity);
  const current = processIdentity(identity.pid);
  return Boolean(current && current.state !== 'Z' && current.startTime === identity.startTime &&
    current.uid === identity.uid && current.group === identity.group && current.bootId === identity.bootId);
}
export function processIdentities(pids) {
  if (process.platform !== 'win32') return pids.map(processIdentity);
  const results = [];
  for (let index = 0; index < pids.length; index += 64) results.push(...windowsIdentities(pids.slice(index, index + 64)));
  return results;
}
export function sameProcesses(identities) {
  if (process.platform !== 'win32') return identities.map(sameProcess);
  const results = [];
  for (let index = 0; index < identities.length; index += 64) results.push(...windowsSameProcesses(identities.slice(index, index + 64)));
  return results;
}
export function groupState(identity) {
  if (process.platform === 'win32') return windowsGroupState(identity);
  if (!validProcessIdentity(identity) || process.platform !== 'linux') return 'unknown';
  try {
    if (bootId() !== identity.bootId) return 'empty';
    for (const entry of fs.readdirSync('/proc')) {
      if (!/^\d+$/.test(entry)) continue;
      try {
        const member = proc(Number(entry));
        if (member.group === identity.group && member.state !== 'Z') return 'present';
      } catch (error) {
        if (error.code !== 'ENOENT' && error.code !== 'ESRCH') return 'unknown';
      }
    }
    return 'empty';
  } catch { return 'unknown'; }
}
export function canKillOwnedOrphan(identity) {
  if (process.platform === 'win32') return Boolean(identity?.managedBroker && identity?.contained && windowsSameProcess(identity));
  return Boolean(validProcessIdentity(identity) && identity.pid === identity.group && identity.uid === process.getuid?.() &&
    sameProcess(identity));
}
export function killOwnedOrphan(identity) {
  if (process.platform === 'win32') return windowsKillOwnedBroker(identity);
  // No PID-only recovery: require the original, same-user group leader to remain identifiable.
  if (!canKillOwnedOrphan(identity)) {
    throw new Error('Identidade do líder órfão não confirmada; nenhum processo foi sinalizado. O módulo continua bloqueado e exige recuperação manual.');
  }
  try { process.kill(-identity.group, 'SIGKILL'); }
  catch (error) { if (error.code !== 'ESRCH') throw error; }
}
