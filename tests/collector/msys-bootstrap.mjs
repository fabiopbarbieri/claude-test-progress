// Git Bash runs Windows' node.exe, which reports and takes Windows paths. This simulates it
// on POSIX: OSTYPE=msys, a cygpath that maps drive W: to the POSIX root, and a node that
// answers the probe with a Windows path and otherwise prints the source and arguments.
import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { removePath } from '../../runner/runtime.mjs';

if (process.platform === 'win32') {
  console.log('MSYS bootstrap: skipped on native Windows');
  process.exit(0);
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const fixtures = path.join(root, 'tests/collector/fixtures/msys');
const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tp-msys-')));
const windows = (posix) => 'W:' + posix.replace(/\//g, '\\');
const install = (fixture, file) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.copyFileSync(path.join(fixtures, fixture), file);
  fs.chmodSync(file, 0o755);
};
try {
  const bin = path.join(temporary, 'bin');
  const cwd = path.join(temporary, 'project');
  fs.mkdirSync(cwd);
  install('cygpath.sh', path.join(bin, 'cygpath'));
  const environment = (extra) => ({ PATH: `${bin}:/usr/bin:/bin`, HOME: temporary, OSTYPE: 'msys', ...extra });
  const run = (args, extra) => execFileSync('bash', [path.join(root, 'scripts/run-collector.sh'), ...args],
    { encoding: 'utf8', env: environment(extra), stdio: ['ignore', 'pipe', 'pipe'] }).trim().split('\n');
  const cli = windows(path.join(root, 'runner', 'cli.mjs'));

  install('node.sh', path.join(temporary, 'path-bin', 'node'));
  const onPath = { PATH: `${bin}:${path.join(temporary, 'path-bin')}:/usr/bin:/bin` };
  assert.deepStrictEqual(run(['status', '--cwd', windows(cwd), '--owner', 'o', '--module', 'all'], onPath),
    ['source=path v20.11.1', cli, 'status', '--cwd', windows(cwd), '--owner', 'o', '--module', 'all'],
    'A Windows --cwd is probed in POSIX form and passed on unchanged; node.exe reporting a Windows path is accepted');
  assert.deepStrictEqual(run(['list', '--cwd', cwd, '--config', path.join(cwd, 'tp.json'), '--owner', 'o'], onPath),
    ['source=path v20.11.1', cli, 'list', '--cwd', windows(cwd), '--config', windows(path.join(cwd, 'tp.json')), '--owner', 'o'],
    'POSIX --cwd and --config reach node.exe as Windows paths, even without MSYS argument conversion');

  const home = path.join(temporary, 'nvm');
  for (const version of ['v12.22.12', 'v20.11.1', 'v9.0.0']) install('node.sh', path.join(home, version, 'node.exe'));
  fs.mkdirSync(path.join(home, 'v99-not-a-version'));
  assert.deepStrictEqual(run(['status', '--cwd', windows(cwd)], { NVM_HOME: windows(home) }).slice(0, 2), ['source=nvm v20.11.1', cli],
    'Without node on PATH, the newest nvm-windows install >=14 is chosen');
  install('node.sh', path.join(temporary, 'installs', 'v18.20.0', 'node.exe'));
  fs.symlinkSync(path.join(temporary, 'installs', 'v18.20.0'), path.join(temporary, 'current'));
  assert.deepStrictEqual(run(['status', '--cwd', windows(cwd)], { NVM_HOME: windows(home), NVM_SYMLINK: windows(path.join(temporary, 'current')) }).slice(0, 1),
    ['source=nvm v18.20.0'], "nvm-windows' current version (NVM_SYMLINK) comes before the other installs");
  install('powershell.sh', path.join(bin, 'powershell.exe'));
  assert.deepStrictEqual(run(['status', '--cwd', cwd, '--owner', 'o', '--module', 'web'], { NVM_HOME: '\\\\server\\nvm' }),
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', windows(path.join(root, 'scripts', 'run-collector.ps1')),
      '-Action', 'status', '-Cwd', windows(cwd), '-Owner', 'o', '-Module', 'web'],
    'A network NVM_HOME is never probed; without a Node, Git Bash hands the call to the PowerShell bootstrap');
  console.log('MSYS bootstrap: Windows paths from node.exe, --cwd/--config conversion, nvm-windows and PowerShell fallbacks: OK');
} finally {
  removePath(temporary, { recursive: true, force: true });
}
