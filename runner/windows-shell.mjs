import fs from 'fs';
import path from 'path';

function variable(environment, name) {
  const key = Object.keys(environment).find((entry) => entry.toUpperCase() === name);
  return key === undefined ? undefined : environment[key];
}
function isFile(file) {
  try { return fs.statSync(file).isFile(); } catch { return false; }
}
function resolveExecutable(name, cwd, environment) {
  const extensions = (variable(environment, 'PATHEXT') || '.COM;.EXE;.BAT;.CMD')
    .split(';').filter((entry) => /^\.[a-z0-9]+$/i.test(entry));
  const hasExtension = Boolean(path.win32.extname(name));
  const names = hasExtension ? [name] : [name, ...extensions.map((extension) => name + extension)];
  const explicit = /[\\/]/.test(name) || path.win32.isAbsolute(name);
  const directories = explicit ? [cwd] : [cwd, ...(variable(environment, 'PATH') || '')
    .split(';').map((entry) => entry.replace(/^"(.*)"$/, '$1')).filter(Boolean)];
  for (const directory of directories) {
    for (const candidate of names) {
      const file = path.win32.resolve(cwd, directory, candidate);
      if (isFile(file)) return file;
    }
  }
  throw new Error(`Executável Windows não encontrado: ${name}`);
}

// cmd.exe reparses its command line. Reject expansion/control characters rather
// than promising argv fidelity for syntax that has a second interpretation.
export function windowsCommand(command, cwd, environment = process.env) {
  if (!Array.isArray(command) || command.length === 0 || command.some((value) =>
    typeof value !== 'string' || /[\0\r\n]/.test(value)) || !command[0]) {
    throw new Error('Comando Windows inválido');
  }
  const file = resolveExecutable(command[0], cwd, environment);
  const extension = path.win32.extname(file).toLowerCase();
  if (extension === '.cmd' || extension === '.bat') {
    const values = [file, ...command.slice(1)];
    if (values.some((value) => /[&|<>^()%!"\r\n]/.test(value))) {
      throw new Error('Argumento de .cmd/.bat contém expansão ou controle não suportado; use um executável .exe');
    }
    const systemRoot = variable(environment, 'SYSTEMROOT') || variable(environment, 'WINDIR');
    if (!systemRoot) throw new Error('SystemRoot ausente: cmd.exe não pode ser localizado com segurança');
    const shell = path.win32.join(systemRoot, 'System32', 'cmd.exe');
    if (!isFile(shell)) throw new Error('cmd.exe do Windows não encontrado');
    return { file: shell, args: ['/d', '/s', '/v:off', '/c', `"${values.map((value) => `"${value}"`).join(' ')}"`] };
  }
  if (path.win32.basename(file).toLowerCase() === 'cmd.exe') {
    const args = command.slice(1);
    const simple = args.length === 2 && args[0].toLowerCase() === '/c';
    const full = args.length === 5 && args.slice(0, 4).map((value) => value.toLowerCase()).join(' ') === '/d /s /v:off /c';
    const payload = args[args.length - 1];
    if ((!simple && !full) || !payload || /[&|<>^()%!\r\n]/.test(payload)) {
      throw new Error('cmd.exe requer /c com comando literal; expansão e controle de shell não são suportados');
    }
    return { file, args: ['/d', '/s', '/v:off', '/c', payload] };
  }
  if (extension !== '.exe' && extension !== '.com') {
    throw new Error(`Formato executável Windows não suportado: ${extension || 'sem extensão'}`);
  }
  return { file, args: command.slice(1) };
}
