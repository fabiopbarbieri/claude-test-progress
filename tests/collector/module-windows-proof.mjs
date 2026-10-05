import assert from 'assert';
import { windowsCompletion } from '../../runner/windows-proof.mjs';
assert.strictEqual(windowsCompletion({ resumed: true, treeEmpty: false, exitCode: null }, false).infrastructureFailure, true,
  'broker death after resume without final proof is infrastructure failure');
assert.strictEqual(windowsCompletion({ resumed: true, treeEmpty: true, exitCode: 1 }, false).infrastructureFailure, false,
  'observed suite exit 1 is a normal result');
assert.strictEqual(windowsCompletion({ resumed: true, treeEmpty: true, exitCode: 0 }, false).exitCode, 0);
assert.strictEqual(windowsCompletion(null, false).infrastructureFailure, true);
assert.strictEqual(windowsCompletion({ resumed: true, treeEmpty: false, exitCode: null }, true).infrastructureFailure, false,
  'individual cancellation with an independently empty Job must not compensate siblings');
assert.strictEqual(windowsCompletion({ treeEmpty: true, exitCode: 125, error: 'broker failure' }, true).infrastructureFailure, true);
console.log('Windows final proof: lost broker infrastructure, normal suite exit and individual cancellation: OK');
