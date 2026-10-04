import fs from 'fs';
import { windowsIdentity, windowsGroupState, windowsSameProcess, windowsKillOwnedBroker } from './windows-process.mjs';

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
export function processIdentity(pid) {
  if (process.platform === 'win32') return windowsIdentity(pid);
  if (process.platform !== 'linux' || !Number.isInteger(pid) || pid <= 0) return null;
  try {
    const identity = proc(pid);
    return { ...identity, bootId: bootId() };
  } catch { return null; }
}
export function sameProcess(identity) {
  if (!identity) return false;
  if (process.platform === 'win32') return windowsSameProcess(identity);
  const current = processIdentity(identity.pid);
  return Boolean(current && current.state !== 'Z' && current.startTime === identity.startTime &&
    current.uid === identity.uid && current.group === identity.group && current.bootId === identity.bootId);
}
export function groupState(identity) {
  if (process.platform === 'win32') return windowsGroupState(identity);
  if (!identity || process.platform !== 'linux') return 'unknown';
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
  return Boolean(identity && identity.pid === identity.group && identity.uid === process.getuid?.() &&
    sameProcess(identity));
}
export function killOwnedOrphan(identity) {
  if (process.platform === 'win32') return windowsKillOwnedBroker(identity);
  // No PID-only recovery: require the original, same-user group leader to remain identifiable.
  if (!canKillOwnedOrphan(identity)) {
    throw new Error('Identidade do líder órfão não confirmada; nenhum processo foi sinalizado. A lane continua bloqueada e exige recuperação manual.');
  }
  try { process.kill(-identity.group, 'SIGKILL'); }
  catch (error) { if (error.code !== 'ESRCH') throw error; }
}
