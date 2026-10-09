import assert from 'assert';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import childProcess from 'child_process';
import { fileURLToPath } from 'url';
import { syncBuiltinESMExports } from 'module';
import { stateRoot } from '../../runner/runtime.mjs';

// Each scenario imports a fresh copy, so the per-process helper decision starts over.
let generation = 0;
const load = () => import(`../../runner/windows-process.mjs?scenario=${++generation}`);

async function main() {
  const originalExec = childProcess.execFileSync;
  const originalExists = fs.existsSync;
  const originalSystemRoot = process.env.SystemRoot;
  const originalHelper = process.env.TEST_PROGRESS_WINDOWS_HELPER;
  const root = stateRoot();
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const hash = crypto.createHash('sha256');
  for (const name of ['WindowsProcessHost.cs', 'WindowsHelper.cs']) {
    hash.update(fs.readFileSync(fileURLToPath(new URL(`../../runtime/${name}`, import.meta.url)))).update('\0');
  }
  const helper = path.join(root, `helper-${hash.digest('hex').slice(0, 16)}.exe`);
  const hostDigest = crypto.createHash('sha256').update(fs.readFileSync(fileURLToPath(new URL('../../runtime/WindowsProcessHost.cs', import.meta.url)))).digest('hex').slice(0, 16);
  const stale = ['helper-0000000000000000.exe', 'helper-0000000000000000.exe.failed', 'host-4.0.30319.42000-5-0000000000000000.dll'].map(name => path.join(root, name));
  const kept = [`host-4.0.30319.42000-5-${hostDigest}.dll`, `host-9.0.10-7-${hostDigest}.dll`, 'acl-fixture.json'].map(name => path.join(root, name));
  const self = { platform: 'win32', pid: process.pid + 1, startTime: '134356740192899202', owner: 'S-1-5-21-1-2-3-1001', sessionId: 2 };
  const calls = [];
  const last = () => calls[calls.length - 1];
  let helperFails = false, buildFails = false;
  try {
    process.env.SystemRoot = 'C:\\Windows';
    delete process.env.TEST_PROGRESS_WINDOWS_HELPER;
    fs.existsSync = file => String(file).endsWith('WindowsPowerShell\\v1.0\\powershell.exe') || originalExists(file);
    childProcess.execFileSync = (file, args) => {
      const action = args[args.indexOf('-Action') + 1];
      calls.push({ file, args, action });
      if (file === helper && helperFails) throw Object.assign(new Error('spawnSync EACCES'), { code: 'EACCES' });
      if (action === 'BuildHelper') {
        if (buildFails) throw Object.assign(new Error('build failed'), { status: 1 });
        fs.writeFileSync(args[args.indexOf('-Output') + 1], 'helper');
        return JSON.stringify({ built: true });
      }
      if (action === 'SecureDirectory') return JSON.stringify({ secured: true });
      if (action === 'Identity' || action === 'LaunchCoordinator') return JSON.stringify(self);
      throw new Error('Unexpected control action');
    };
    syncBuiltinESMExports();

    // A present helper answers control calls with its own argument shape.
    fs.writeFileSync(helper, 'helper');
    let api = await load();
    assert.deepStrictEqual(api.windowsIdentity(self.pid), self);
    assert.strictEqual(last().file, helper, 'A present helper replaces PowerShell');
    assert.deepStrictEqual(last().args, ['-Action', 'Identity', '-ProcessId', String(self.pid)], 'The helper gets no PowerShell flags');
    api.windowsLaunchCoordinator('C:\\node\\node.exe', 'C:\\state\\batch.request.json');
    const runner = last().args;
    assert.strictEqual(runner[runner.indexOf('-Runner') + 1], path.dirname(fileURLToPath(new URL('../../runner/cli.mjs', import.meta.url))));
    const spec = api.windowsSpawnSpec('C:\\state\\api.job.json');
    assert.strictEqual(spec.file, helper, 'The broker runs as the helper');
    assert.deepStrictEqual(spec.args, ['-Action', 'Run', '-JobFile', 'C:\\state\\api.job.json']);

    // A helper that cannot start falls back to PowerShell for the rest of the process.
    api = await load();
    helperFails = true;
    calls.length = 0;
    assert.deepStrictEqual(api.windowsIdentity(self.pid), self);
    assert.deepStrictEqual(calls.map(call => call.file === helper), [true, false], 'The same call retries through PowerShell');
    assert(calls[1].args.includes('-ExecutionPolicy') && calls[1].args.includes('-CacheDirectory'));
    helperFails = false;
    api.windowsIdentity(self.pid);
    assert.notStrictEqual(last().file, helper, 'A failed helper is not tried again in this process');
    assert.notStrictEqual(api.windowsSpawnSpec('C:\\state\\api.job.json').file, helper);

    // The variable forces PowerShell even with a helper present.
    process.env.TEST_PROGRESS_WINDOWS_HELPER = '0';
    api = await load();
    api.windowsIdentity(self.pid);
    assert.notStrictEqual(last().file, helper, 'TEST_PROGRESS_WINDOWS_HELPER=0 disables the helper');
    delete process.env.TEST_PROGRESS_WINDOWS_HELPER;

    // Securing the state root builds a missing helper once; a failed build waits an hour.
    fs.unlinkSync(helper);
    buildFails = true;
    api = await load();
    calls.length = 0;
    api.windowsSecureDirectory(root);
    assert.deepStrictEqual(calls.map(call => call.action), ['SecureDirectory', 'BuildHelper']);
    assert(calls[1].file.endsWith('WindowsPowerShell\\v1.0\\powershell.exe'), 'Windows PowerShell 5.1 builds the helper');
    assert(fs.existsSync(`${helper}.failed`), 'A failed build leaves a retry marker');
    api.windowsSecureDirectory(root);
    assert.deepStrictEqual(calls.map(call => call.action), ['SecureDirectory', 'BuildHelper', 'SecureDirectory'], 'No rebuild within the hour');
    fs.unlinkSync(`${helper}.failed`);
    buildFails = false;
    api = await load();
    calls.length = 0;
    api.windowsSecureDirectory(path.join(root, 'workspace'));
    assert.deepStrictEqual(calls.map(call => call.action), ['SecureDirectory'], 'Only the state root triggers a build');
    for (const file of [...stale, ...kept]) fs.writeFileSync(file, 'old');
    api.windowsSecureDirectory(root);
    assert(fs.existsSync(helper), 'A successful build publishes the helper');
    assert.deepStrictEqual(stale.filter(file => fs.existsSync(file)), [], 'Builds of other sources are removed');
    assert.deepStrictEqual(kept.filter(file => !fs.existsSync(file)), [], 'Current host DLLs and other state stay');
    api.windowsIdentity(self.pid);
    assert.strictEqual(last().file, helper, 'The built helper is used right away');
    console.log('Windows native helper: selection, argument shape, broker, fallback, opt-out and one-time build and pruning: OK');
  } finally {
    childProcess.execFileSync = originalExec;
    fs.existsSync = originalExists;
    for (const file of [helper, `${helper}.failed`, ...stale, ...kept]) { try { fs.unlinkSync(file); } catch { /* Already absent. */ } }
    if (originalSystemRoot === undefined) delete process.env.SystemRoot; else process.env.SystemRoot = originalSystemRoot;
    if (originalHelper === undefined) delete process.env.TEST_PROGRESS_WINDOWS_HELPER; else process.env.TEST_PROGRESS_WINDOWS_HELPER = originalHelper;
    syncBuiltinESMExports();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
