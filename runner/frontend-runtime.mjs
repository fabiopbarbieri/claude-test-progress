import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import { windowsPowerShell } from './windows-process.mjs';
import { mergeEnvironment } from './runtime.mjs';

const windows = process.platform === 'win32';
const driver = fileURLToPath(new URL(windows ? '../runtime/resolve-node.ps1' : '../runtime/resolve-node.sh', import.meta.url));
const sources = new Set(['path', 'nvm', 'nvmrc-path', 'nvmrc-nvm']);

function resolverError(error) {
  if (error.code === 'ETIMEDOUT') {
    return new Error('A descoberta de Node.js para frontend excedeu o limite de 3 segundos e foi interrompida');
  }
  // Do not include execFileSync's message: it can echo the command and captured output.
  const detail = String(error.stderr || '').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/[\x00-\x1f\x7f-\x9f]/g, ' ').trim().slice(0, 1024);
  const reason = detail || (error.code === 'ENOENT' ? 'bash ou driver indisponível' : 'o resolvedor falhou');
  return new Error(`Não foi possível escolher Node.js para frontend: ${reason}`);
}

export function frontendRuntime(cwd, environment, command) {
  const inherited = mergeEnvironment(process.env, environment);
  let output;
  try {
    const executable = windows ? windowsPowerShell(inherited) : 'bash';
    const args = windows ? ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', driver, '-Mode', 'project', '-Cwd', cwd] :
      [driver, 'project', '--cwd', cwd];
    output = execFileSync(executable, args, {
      cwd, env: inherited, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024, timeout: 3000, killSignal: 'SIGKILL',
    });
  } catch (error) {
    throw resolverError(error);
  }
  let descriptor;
  try { descriptor = JSON.parse(output); }
  catch { throw new Error('O resolvedor de Node.js do frontend retornou JSON inválido'); }
  if (!descriptor || typeof descriptor.path !== 'string' || !path.isAbsolute(descriptor.path) ||
      descriptor.path.includes('\0') || typeof descriptor.version !== 'string' ||
      !/^v\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(descriptor.version) ||
      !sources.has(descriptor.source) ||
      !(descriptor.nvmrc === null || (typeof descriptor.nvmrc === 'string' &&
        path.isAbsolute(descriptor.nvmrc) && !descriptor.nvmrc.includes('\0')))) {
    throw new Error('O resolvedor de Node.js do frontend retornou um descriptor inválido');
  }
  try {
    if (!fs.statSync(descriptor.path).isFile()) throw new Error('not a file');
    fs.accessSync(descriptor.path, fs.constants.X_OK);
  } catch { throw new Error('O Node.js escolhido para frontend não é um arquivo executável disponível'); }
  const executable = command[0];
  if ((path.isAbsolute(executable) || /[\\/]/.test(executable)) && /^node(?:\.exe)?$/i.test(path.basename(executable))) {
    let sameExecutable = false;
    try {
      const explicitPath = path.isAbsolute(executable) ? executable : path.resolve(cwd, executable);
      const explicitReal = fs.realpathSync(explicitPath);
      const selectedReal = fs.realpathSync(descriptor.path);
      sameExecutable = windows ? explicitReal.toLowerCase() === selectedReal.toLowerCase() : explicitReal === selectedReal;
    } catch { /* An unavailable explicit Node cannot match the selected runtime. */ }
    if (!sameExecutable) {
      throw new Error('O caminho explícito de Node.js no comando frontend difere do Node descoberto ou não está disponível. Use command: ["node", ...] para seguir a descoberta');
    }
  }
  const nodeRuntime = { path: descriptor.path, version: descriptor.version,
    source: descriptor.source, nvmrc: descriptor.nvmrc };
  const directory = path.dirname(nodeRuntime.path);
  const childPath = inherited.PATH ? `${directory}${path.delimiter}${inherited.PATH}` : directory;
  return { nodeRuntime, env: mergeEnvironment(environment, { PATH: childPath }) };
}
