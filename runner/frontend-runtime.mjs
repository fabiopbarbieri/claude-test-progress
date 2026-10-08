import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import { windowsNodeResolver } from './windows-process.mjs';
import { mergeEnvironment } from './runtime.mjs';
import { validModuleId } from './module-id.mjs';

const windows = process.platform === 'win32';
const driver = fileURLToPath(new URL('../runtime/resolve-node.sh', import.meta.url));
const sources = new Set(['path', 'nvm', 'nvmrc-path', 'nvmrc-nvm']);

function runtimeError(message, moduleId, code = 'NODE_RUNTIME_UNAVAILABLE') {
  const error = new Error(message);
  error.code = code;
  if (validModuleId(moduleId)) error.moduleId = moduleId;
  return error;
}

function resolverError(error, subject, moduleId) {
  if (error.code === 'ETIMEDOUT') {
    return runtimeError(`A descoberta de Node.js para ${subject} excedeu o limite de 3 segundos e foi interrompida.`, moduleId);
  }
  // Neither the native error message nor stderr is safe to project publicly.
  return runtimeError(`Não foi possível escolher Node.js para ${subject}; confira o runtime e a versão exigida pelo projeto.`, moduleId);
}

export function frontendRuntime(cwd, environment, command, { runtime = 'node-project', moduleId } = {}) {
  if (runtime === 'inherit') return { env: { ...environment } };
  if (runtime !== 'node-project') throw runtimeError('O runtime do módulo não é suportado.', moduleId, 'INVALID_RUNTIME');
  const subject = validModuleId(moduleId) ? `o módulo ${moduleId}` : 'frontend';
  const inherited = mergeEnvironment(process.env, environment);
  const resolve = (native) => {
    const { file, args } = windows ? windowsNodeResolver(cwd, inherited, native) :
      { file: 'bash', args: [driver, 'project', '--cwd', cwd] };
    return { native: windows && path.win32.basename(file).startsWith('helper-'),
      run: () => execFileSync(file, args, {
        cwd, env: inherited, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
        maxBuffer: 64 * 1024, timeout: 3000, killSignal: 'SIGKILL',
      }) };
  };
  let output;
  try {
    const resolver = resolve(true);
    try { output = resolver.run(); }
    catch (error) {
      // A native helper that could not start at all (blocked by policy) falls back to PowerShell.
      if (!resolver.native || error.code === 'ETIMEDOUT' || typeof error.status === 'number') throw error;
      output = resolve(false).run();
    }
  } catch (error) {
    throw resolverError(error, subject, moduleId);
  }
  let descriptor;
  try { descriptor = JSON.parse(output); }
  catch { throw runtimeError(`O resolvedor de Node.js para ${subject} retornou JSON inválido.`, moduleId); }
  if (!descriptor || typeof descriptor.path !== 'string' || !path.isAbsolute(descriptor.path) ||
      descriptor.path.includes('\0') || typeof descriptor.version !== 'string' ||
      !/^v\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(descriptor.version) ||
      !sources.has(descriptor.source) ||
      !(descriptor.nvmrc === null || (typeof descriptor.nvmrc === 'string' &&
        path.isAbsolute(descriptor.nvmrc) && !descriptor.nvmrc.includes('\0')))) {
    throw runtimeError(`O resolvedor de Node.js para ${subject} retornou um descriptor inválido.`, moduleId);
  }
  try {
    if (!fs.statSync(descriptor.path).isFile()) throw new Error('not a file');
    fs.accessSync(descriptor.path, fs.constants.X_OK);
  } catch { throw runtimeError(`O Node.js escolhido para ${subject} não é um arquivo executável disponível.`, moduleId); }
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
      throw runtimeError(`O caminho explícito de Node.js para ${subject} difere do Node descoberto ou está indisponível. Use command: ["node", ...] para seguir a descoberta.`, moduleId);
    }
  }
  const nodeRuntime = { path: descriptor.path, version: descriptor.version,
    source: descriptor.source, nvmrc: descriptor.nvmrc };
  const directory = path.dirname(nodeRuntime.path);
  const childPath = inherited.PATH ? `${directory}${path.delimiter}${inherited.PATH}` : directory;
  return { nodeRuntime, env: mergeEnvironment(environment, { PATH: childPath }) };
}
