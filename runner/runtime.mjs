import fs from 'fs';
import path from 'path';
import { randomBytes } from 'crypto';

export function mergeEnvironment(...environments) {
  const result = {};
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
