import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomBytes } from 'crypto';

// Windows environment names are case-insensitive; find one regardless of its spelling.
export function environmentValue(environment, name) {
  const key = Object.keys(environment).find((entry) => entry.toUpperCase() === name);
  return key === undefined ? undefined : environment[key];
}

// Flags for every long-lived collector Node (coordinator, workers, watcher). Rereading
// state and logs each pass makes short-lived garbage; a 1 MB young generation keeps a
// watcher near 40 MB private instead of ~120 MB, at the same CPU. windows-process.ps1
// and WindowsHelper.cs launch the Windows coordinator with the same flag.
export const LONG_LIVED_NODE_FLAGS = Object.freeze(['--max-semi-space-size=1']);

// Per-user root of the private collector state; the Windows host assembly cache lives here too.
export function stateRoot() {
  return path.join(fs.realpathSync(os.tmpdir()), `claude-test-progress-${process.getuid?.() ?? 'user'}`);
}

// Reads from `position` until EOF or `bound` bytes. The buffer starts at the size the
// caller saw at open: state records are a few KB, and zero-filling the whole bound on
// every read was the collector's largest allocation. A file that grew since then keeps
// reading into a larger buffer, up to the same bound, so a caller's limit check holds.
export function readUpTo(fd, size, bound, position = 0) {
  let buffer = Buffer.alloc(Math.max(1, Math.min(bound, size + 1)));
  let length = 0;
  for (;;) {
    while (length < buffer.length) {
      const count = fs.readSync(fd, buffer, length, buffer.length - length, position + length);
      if (!count) return buffer.subarray(0, length);
      length += count;
    }
    if (buffer.length >= bound) return buffer;
    const grown = Buffer.alloc(bound);
    buffer.copy(grown, 0, 0, length);
    buffer = grown;
  }
}

export function mergeEnvironment(...environments) {
  const result = Object.create(null);
  for (const environment of environments) for (const [key, value] of Object.entries(environment)) {
    result[process.platform === 'win32' ? key.toUpperCase() : key] = value;
  }
  return result;
}

export function randomUUID() {
  const bytes = randomBytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// Node 14.0 has no rmSync. Inspect links themselves and unlink them, never their targets.
export function removePath(target, { recursive = false, force = false } = {}) {
  if (typeof fs.rmSync === 'function') return fs.rmSync(target, { recursive, force });
  try {
    const info = fs.lstatSync(target);
    if (info.isDirectory()) {
      if (!recursive) {
        const error = new Error(`Cannot remove directory without recursive: ${target}`);
        error.code = 'EISDIR';
        throw error;
      }
      for (const entry of fs.readdirSync(target)) {
        removePath(path.join(target, entry), { recursive: true, force });
      }
      fs.rmdirSync(target);
    } else {
      fs.unlinkSync(target);
    }
  } catch (error) {
    if (!force || error.code !== 'ENOENT') throw error;
  }
}
