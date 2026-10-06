import path from 'path';
import { execFileSync } from 'child_process';

// Runners on Windows often write piped output in the ANSI code page (Python, Java, older
// tools) instead of UTF-8. Each line is decoded as UTF-8 when valid; otherwise as the
// fallback encoding. CR and LF are single bytes in every supported code page, so line
// boundaries are found on the raw bytes before decoding.
const LINE_LIMIT = 131072;
const CODE_PAGES = { 874: 'windows-874', 932: 'shift_jis', 936: 'gbk', 949: 'euc-kr', 950: 'big5' };

function decoder(label, fatal) {
  try { return new TextDecoder(label, { fatal, ignoreBOM: true }); }
  catch { return null; }
}

// Reads the system ANSI code page once. Unknown or UTF-8 pages return null (no fallback).
let ansiEncoding;
export function windowsAnsiEncoding() {
  if (ansiEncoding !== undefined) return ansiEncoding;
  ansiEncoding = null;
  try {
    const reg = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'reg.exe');
    const output = execFileSync(reg, ['query', 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Nls\\CodePage', '/v', 'ACP'],
      { encoding: 'latin1', timeout: 2000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    const page = Number((/\bACP\s+REG_SZ\s+(\d+)/.exec(output) || [])[1]);
    const label = page >= 1250 && page <= 1258 ? `windows-${page}` : CODE_PAGES[page];
    if (label && decoder(label, false)) ansiEncoding = label;
  } catch { /* Keep UTF-8 with replacement characters. */ }
  return ansiEncoding;
}

// `fallback` is an encoding label or a function returning one, resolved on first need.
export function createLineDecoder(fallback = null) {
  const utf8 = decoder('utf-8', true);
  const lenient = new TextDecoder('utf-8', { ignoreBOM: true });
  let pending = Buffer.alloc(0);
  let legacy;
  const legacyDecoder = () => {
    if (legacy === undefined) {
      const label = typeof fallback === 'function' ? fallback() : fallback;
      legacy = label ? decoder(label, false) : null;
    }
    return legacy;
  };
  const line = bytes => {
    if (utf8) {
      try { return utf8.decode(bytes); }
      catch { /* Not UTF-8. */ }
    }
    const other = legacyDecoder();
    return (other || lenient).decode(bytes);
  };
  const decode = bytes => {
    if (!bytes.length) return '';
    if (utf8) {
      try { return utf8.decode(bytes); }
      catch { /* Decode line by line below. */ }
    }
    let text = '', start = 0;
    for (let i = 0; i < bytes.length; i++) {
      if (bytes[i] === 10 || bytes[i] === 13) {
        text += line(bytes.subarray(start, i)) + String.fromCharCode(bytes[i]);
        start = i + 1;
      }
    }
    return text + line(bytes.subarray(start));
  };
  return {
    // Returns the text of every complete line in the chunk; an unfinished line waits.
    push(chunk) {
      const bytes = pending.length ? Buffer.concat([pending, chunk]) : chunk;
      let end = bytes.length;
      while (end > 0 && bytes[end - 1] !== 10 && bytes[end - 1] !== 13) end--;
      if (!end && bytes.length <= LINE_LIMIT) { pending = bytes; return ''; }
      if (!end) end = bytes.length;
      pending = Buffer.from(bytes.subarray(end));
      return decode(bytes.subarray(0, end));
    },
    flush() {
      const bytes = pending;
      pending = Buffer.alloc(0);
      return decode(bytes);
    },
  };
}
