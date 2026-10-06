import assert from 'assert';
import { createLineDecoder } from '../../runner/output-decoder.mjs';

const cp1252 = text => Buffer.from(text, 'latin1');
const utf8 = text => Buffer.from(text, 'utf8');

// Valid UTF-8 passes through, including a character split between chunks.
let decoder = createLineDecoder('windows-1252');
const word = utf8('módulo não existe\n');
assert.strictEqual(decoder.push(word.subarray(0, 2)), '', 'An unfinished line waits');
assert.strictEqual(decoder.push(word.subarray(2)), 'módulo não existe\n');

// A line in the ANSI code page falls back without affecting UTF-8 neighbours.
assert.strictEqual(decoder.push(Buffer.concat([utf8('ação ok\r\n'), cp1252('módulo ainda não existe\n'), utf8('fim ✓\n')])),
  'ação ok\r\nmódulo ainda não existe\nfim ✓\n');
assert.strictEqual(decoder.push(cp1252('progresso 50%\r')), 'progresso 50%\r', 'CR ends a record');

// Output left without a newline comes out on flush.
assert.strictEqual(decoder.push(cp1252('saída final')), '');
assert.strictEqual(decoder.flush(), 'saída final');
assert.strictEqual(decoder.flush(), '');

// The fallback is resolved only when a line needs it.
let asked = 0;
decoder = createLineDecoder(() => { asked++; return 'windows-1252'; });
decoder.push(utf8('só UTF-8\n'));
assert.strictEqual(asked, 0, 'Valid UTF-8 never queries the code page');
decoder.push(cp1252('é\n'));
decoder.push(cp1252('é\n'));
assert.strictEqual(asked, 1, 'The code page is queried once');

// Without a fallback, invalid bytes keep the previous replacement behaviour.
decoder = createLineDecoder(null);
assert.strictEqual(decoder.push(cp1252('não\n')), 'n�o\n');

// A huge line without a newline is released instead of growing without bound.
decoder = createLineDecoder(null);
assert.strictEqual(decoder.push(Buffer.alloc(140000, 0x61)).length, 140000);
console.log('Output decoding: UTF-8, ANSI fallback per line, split characters, CR records, flush and line limit: OK');
