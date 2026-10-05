import assert from 'assert';
import fs from 'fs';
import childProcess from 'child_process';
import { syncBuiltinESMExports } from 'module';

async function main() {
  const originalExec = childProcess.execFileSync;
  const originalExists = fs.existsSync;
  const originalSystemRoot = process.env.SystemRoot;
  const originalOverride = process.env.TEST_PROGRESS_POWERSHELL;
  const self = { platform: 'win32', pid: process.pid, startTime: '134356740192899202', owner: 'S-1-5-21-1-2-3-1001', sessionId: 2 };
  const external = { ...self, pid: process.pid + 100 };
  const calls = [];
  let fail = false;
  try {
    process.env.SystemRoot = 'C:\\Windows';
    delete process.env.TEST_PROGRESS_POWERSHELL;
    fs.existsSync = file => String(file).endsWith('WindowsPowerShell\\v1.0\\powershell.exe') || originalExists(file);
    childProcess.execFileSync = (file, args, options) => {
      calls.push({ args, options });
      assert.strictEqual(options.timeout, 7500);
      assert.strictEqual(options.windowsHide, true);
      if (fail) throw new Error('Transport unavailable');
      const action = args[args.indexOf('-Action') + 1];
      if (action === 'Identity') return JSON.stringify(self);
      if (action === 'State') return JSON.stringify({ state: 'unknown' });
      const queries = JSON.parse(args[args.indexOf('-Queries') + 1]);
      if (action === 'IdentityMany') return JSON.stringify({ identities: queries.map(pid => pid === self.pid ? self : ({ ...external, pid })) });
      if (action === 'StateMany') return JSON.stringify({ matches: queries.map(identity => identity.pid === external.pid),
        selfIdentity: args.includes('-SelfProcessId') ? self : null });
      throw new Error('Unexpected control action');
    };
    syncBuiltinESMExports();
    const api = await import('../../runner/windows-process.mjs');
    assert.strictEqual(typeof api.windowsIdentities, 'function', 'Batch identity API exists');
    assert.strictEqual(typeof api.windowsSameProcesses, 'function', 'Batch state API exists');
    const first = api.windowsIdentity(process.pid);
    assert.deepStrictEqual(first, self);
    first.startTime = '1';
    assert.deepStrictEqual(api.windowsIdentity(process.pid), self, 'Caller cannot mutate cached birth identity');
    assert.strictEqual(calls.length, 1, 'Only the initial self query invokes PowerShell');
    assert.strictEqual(api.windowsSameProcess(self), true);
    for (const changed of [{ ...self, startTime: '1' }, { ...self, owner: 'S-1-5-18' }, { ...self, sessionId: 3 }]) {
      assert.strictEqual(api.windowsSameProcess(changed), false, 'Changed self identity never becomes alive');
    }
    assert.strictEqual(calls.length, 1);
    assert.deepStrictEqual(api.windowsIdentities([external.pid, external.pid + 1]), [external, { ...external, pid: external.pid + 1 }]);
    assert.strictEqual(calls.length, 2, 'A batch of external identities uses one invocation');
    assert.deepStrictEqual(api.windowsSameProcesses([self, external, { ...external, pid: external.pid + 1 }, null]), [true, true, false, false]);
    assert.strictEqual(calls.length, 3, 'A mixed state batch uses one invocation');
    assert.deepStrictEqual(api.windowsSameProcesses(Array(64).fill(external)), Array(64).fill(true));
    assert.strictEqual(calls.length, 4, 'The maximum valid batch still uses one invocation');
    assert.strictEqual(api.windowsSameProcess(external), false, 'Unknown external state is not alive');
    fail = true;
    assert.strictEqual(api.windowsSameProcess(self), true, 'Established self identity survives unavailable transport');
    assert.deepStrictEqual(api.windowsIdentities([external.pid]), [null]);
    assert.deepStrictEqual(api.windowsSameProcesses([external]), [false]);
    const beforeInvalid = calls.length;
    assert.deepStrictEqual(api.windowsIdentities([0, -1, 1.5, 2147483648]), [null, null, null, null]);
    assert.deepStrictEqual(api.windowsSameProcesses([null, { ...external, startTime: 'bad' }, { ...external, owner: 'bad' }]), [false, false, false]);
    assert.deepStrictEqual(api.windowsIdentities([]), []);
    assert.deepStrictEqual(api.windowsSameProcesses([]), []);
    assert.throws(() => api.windowsIdentities(Array(65).fill(external.pid)));
    assert.throws(() => api.windowsSameProcesses(Array(65).fill(external)));
    assert.throws(() => api.windowsIdentities(null));
    assert.throws(() => api.windowsSameProcesses(null));
    assert.strictEqual(calls.length, beforeInvalid, 'Invalid and empty lists never invoke PowerShell');
    fail = false;
    const freshBatch = await import('../../runner/windows-process.mjs?first-batch-self');
    const beforeFirstBatch = calls.length;
    assert.deepStrictEqual(freshBatch.windowsSameProcesses([self, external]), [true, true]);
    assert.strictEqual(calls.length, beforeFirstBatch + 1, 'First self + external batch captures genuine self in one invocation');
    assert.deepStrictEqual(freshBatch.windowsIdentities([self.pid, self.pid]), [self, self]);
    assert.strictEqual(calls.length, beforeFirstBatch + 1, 'Repeated own identities use the established cache');
    const firstIdentities = await import('../../runner/windows-process.mjs?first-batch-identities');
    assert.deepStrictEqual(firstIdentities.windowsIdentities([self.pid, external.pid]), [self, external]);
    assert.strictEqual(calls.length, beforeFirstBatch + 2, 'Identity batch also establishes genuine self in one invocation');
    const forgedFirst = await import('../../runner/windows-process.mjs?forged-first-self');
    assert.deepStrictEqual(forgedFirst.windowsSameProcesses([{ ...self, startTime: '1' }, external]), [false, true]);
    assert.strictEqual(calls.length, beforeFirstBatch + 3, 'An untrusted first self tuple cannot seed the cache');
    fail = true;
    const uncached = await import('../../runner/windows-process.mjs?uncached-self');
    assert.strictEqual(uncached.windowsSameProcess(self), false, 'Failed first self query cannot establish liveness');
    assert.deepStrictEqual(uncached.windowsSameProcesses([self, external]), [false, false]);
    console.log('Windows batched queries, immutable self identity and unknown/invalid fail-closed control: OK');
  } finally {
    childProcess.execFileSync = originalExec;
    fs.existsSync = originalExists;
    if (originalSystemRoot === undefined) delete process.env.SystemRoot; else process.env.SystemRoot = originalSystemRoot;
    if (originalOverride === undefined) delete process.env.TEST_PROGRESS_POWERSHELL; else process.env.TEST_PROGRESS_POWERSHELL = originalOverride;
    syncBuiltinESMExports();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
