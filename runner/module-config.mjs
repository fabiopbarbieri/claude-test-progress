import fs from 'fs';
import os from 'os';
import path from 'path';
import { createHash } from 'crypto';
import { validModuleId, requireModuleId } from './module-id.mjs';
import { frontendRuntime } from './frontend-runtime.mjs';
import { windowsCommand } from './windows-shell.mjs';
import { mergeEnvironment } from './runtime.mjs';

const sourceLimit = 1024 * 1024;
const fields = new Set(['enabled', 'label', 'language', 'cwd', 'order', 'adapter', 'runtime', 'env', 'command', 'extends']);
const templateFields = new Set(['label', 'language', 'cwd', 'adapter', 'runtime', 'env', 'command']);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const map = () => Object.create(null);
const diagnostic = (code, message, moduleId) => ({ code, message, ...(moduleId ? { moduleId } : {}) });
const ordered = modules => Object.keys(modules).sort((a, b) =>
  modules[a].order - modules[b].order || (a < b ? -1 : a > b ? 1 : 0));

function sourceRevision(file, source) {
  // This descriptor crosses the detached coordinator boundary as JSON.
  // Status must be durable: absent and unreadable/oversized all have null digest.
  return { path: file, digest: source.digest, status: source.status };
}

// Bound the read itself, including a file that grows between stat and read.
function readSource(file) {
  let descriptor;
  try {
    descriptor = fs.openSync(file, 'r');
    if (!fs.fstatSync(descriptor).isFile()) throw new Error('not a file');
    const buffer = Buffer.alloc(sourceLimit + 1);
    let length = 0;
    while (length < buffer.length) {
      const count = fs.readSync(descriptor, buffer, length, buffer.length - length, null);
      if (!count) break;
      length += count;
    }
    if (length > sourceLimit) return { status: 'invalid', digest: null,
      diagnostic: diagnostic('SOURCE_TOO_LARGE', 'A fonte de configuração excede 1 MiB.') };
    const bytes = buffer.subarray(0, length);
    const digest = createHash('sha256').update(bytes).digest('hex');
    try { return { status: 'valid', digest, value: JSON.parse(bytes.toString('utf8')) }; }
    catch { return { status: 'invalid', digest,
      diagnostic: diagnostic('INVALID_JSON', 'A fonte de configuração contém JSON inválido.') }; }
  } catch (error) {
    if (error.code === 'ENOENT') return { status: 'absent', digest: null };
    return { status: 'invalid', digest: null,
      diagnostic: diagnostic('SOURCE_UNREADABLE', 'Não foi possível ler a fonte de configuração.') };
  } finally { if (descriptor !== undefined) fs.closeSync(descriptor); }
}

function rootDiagnostic(source, collection) {
  if (source.status !== 'valid') return source.diagnostic;
  const value = source.value;
  if (!object(value) || value.schemaVersion !== 2 || !object(value[collection]) ||
      Object.keys(value).some(key => key !== 'schemaVersion' && key !== collection)) {
    return diagnostic('INVALID_SCHEMA', 'A fonte deve usar somente schemaVersion: 2 e seu catálogo declarado.');
  }
  if (Object.keys(value[collection]).some(id => !validModuleId(id))) {
    return diagnostic('INVALID_MODULE_ID', 'O catálogo contém um ID inválido ou reservado.');
  }
  return null;
}

function textValue(value, limit) {
  return typeof value === 'string' && !/[\x00-\x1f\x7f-\x9f]/.test(value) &&
    [...value.trim()].length >= 1 && [...value.trim()].length <= limit;
}

export function discoverModules(context, { configPath } = {}) {
  const modules = map();
  const catalog = map();
  const diagnostics = [];
  const workspace = { moduleConfig: { status: 'absent', schemaVersion: null, enabledIds: [] } };
  const workspacePath = path.resolve(context.cwd, configPath === undefined ? '.claude/test-progress.json' : configPath);
  const source = readSource(workspacePath);
  const revision = [sourceRevision(workspacePath, source)];
  const configuredDirectory = process.env.CLAUDE_CONFIG_DIR;
  const registryDirectory = configuredDirectory === undefined ? path.join(os.homedir(), '.claude') : configuredDirectory;
  let registry;
  let registryError;
  if (!path.isAbsolute(registryDirectory) || registryDirectory.includes('\0')) {
    registryError = diagnostic('INVALID_REGISTRY_DIRECTORY', 'O diretório do registry precisa ser absoluto.');
  } else {
    const registryPath = path.join(registryDirectory, 'test-progress.registry.json');
    registry = readSource(registryPath);
    revision.push(sourceRevision(registryPath, registry));
    registryError = rootDiagnostic(registry, 'templates');
  }
  if (registryError) diagnostics.push(registryError);
  const sourceError = rootDiagnostic(source, 'modules');
  if (source.status === 'absent') return { modules, workspace, diagnostics, catalog, revision };
  workspace.moduleConfig.schemaVersion = source.value?.schemaVersion === 2 ? 2 : null;
  if (sourceError) {
    workspace.moduleConfig.status = 'invalid';
    diagnostics.push(sourceError);
    return { modules, workspace, diagnostics, catalog, revision };
  }
  workspace.moduleConfig.status = 'valid';
  for (const [id, declaration] of Object.entries(source.value.modules)) {
    const errors = [];
    let origin = 'workspace';
    let effective = { enabled: true, label: id, cwd: '.', order: 0, adapter: 'auto', runtime: 'inherit', env: {} };
    if (!object(declaration)) {
      errors.push(diagnostic('INVALID_MODULE', 'A declaração do módulo precisa ser um objeto.', id));
    } else {
      if (Object.keys(declaration).some(key => !fields.has(key))) {
        errors.push(diagnostic('UNKNOWN_MODULE_FIELD', 'A declaração do módulo contém um campo desconhecido.', id));
      }
      if (own(declaration, 'extends')) {
        origin = 'template';
        const templateId = declaration.extends;
        const templates = registry?.value?.templates;
        if (!validModuleId(templateId) || registryError || !object(templates) || !own(templates, templateId)) {
          errors.push(diagnostic('TEMPLATE_UNAVAILABLE', 'O template declarado está inválido ou indisponível.', id));
        } else {
          const template = templates[templateId];
          if (!object(template) || Object.keys(template).some(key => !templateFields.has(key))) {
            errors.push(diagnostic('INVALID_TEMPLATE', 'O template declarado contém uma estrutura inválida.', id));
          } else effective = { ...effective, ...template };
        }
      }
      effective = { ...effective, ...declaration };
    }
    if (typeof effective.enabled !== 'boolean') errors.push(diagnostic('INVALID_ENABLED', 'enabled precisa ser booleano.', id));
    if (!textValue(effective.label, 64)) errors.push(diagnostic('INVALID_LABEL', 'label precisa conter de 1 a 64 caracteres sem controles.', id));
    if (own(effective, 'language') && !textValue(effective.language, 40)) errors.push(diagnostic('INVALID_LANGUAGE', 'language precisa conter de 1 a 40 caracteres sem controles.', id));
    if (!Number.isInteger(effective.order)) errors.push(diagnostic('INVALID_ORDER', 'order precisa ser um inteiro.', id));
    let directoryPresent = false;
    if (typeof effective.cwd === 'string' && !effective.cwd.includes('\0')) {
      try { directoryPresent = fs.statSync(path.resolve(context.cwd, effective.cwd)).isDirectory(); } catch { /* Discovery reports presence only. */ }
    }
    modules[id] = { id, label: textValue(effective.label, 64) ? effective.label.trim() : id,
      language: textValue(effective.language, 40) ? effective.language.trim() : null,
      order: Number.isInteger(effective.order) ? effective.order : 0, enabled: effective.enabled !== false,
      directoryPresent, origin, diagnostics: errors };
    catalog[id] = { configuration: effective, workspaceCwd: context.cwd };
  }
  workspace.moduleConfig.enabledIds = ordered(modules).filter(id => modules[id].enabled);
  return { modules, workspace, diagnostics, catalog, revision };
}

function fail(code, message, moduleId) {
  const error = new Error(message);
  Object.assign(error, diagnostic(code, message, moduleId));
  throw error;
}

function executableOnPath(executable, cwd, environment, id) {
  const explicit = path.isAbsolute(executable) || executable.includes('/');
  const candidates = explicit ? [path.resolve(cwd, executable)] :
    (environment.PATH || '').split(path.delimiter).map(directory => path.resolve(cwd, directory, executable));
  for (const candidate of candidates) {
    try {
      if (!fs.statSync(candidate).isFile()) continue;
      fs.accessSync(candidate, fs.constants.X_OK);
      // Preserve argv[0]: Python venvs and multicall executables use the alias
      // path/name to choose their environment. The captured path is absolute.
      return candidate;
    } catch { /* Search only the effective child's PATH, without invoking a shell. */ }
  }
  fail('EXECUTABLE_UNAVAILABLE', 'O primeiro executável do módulo está indisponível.', id);
}

export function prepareSelection(discovery, target) {
  if (discovery.workspace.moduleConfig.status !== 'valid') {
    fail('WORKSPACE_CONFIG_UNAVAILABLE', 'O workspace precisa de uma configuração válida no schema 2.');
  }
  let ids;
  if (target === 'all') ids = ordered(discovery.modules).filter(id => discovery.modules[id].enabled);
  else {
    requireModuleId(target);
    if (!own(discovery.modules, target)) fail('MODULE_NOT_FOUND', 'O módulo não está declarado neste workspace.', target);
    if (!discovery.modules[target].enabled) fail('MODULE_DISABLED', 'O módulo está desativado neste workspace.', target);
    ids = [target];
  }
  const configurations = map();
  for (const id of ids) {
    const metadata = discovery.modules[id];
    if (metadata.diagnostics.length) {
      const error = metadata.diagnostics[0];
      fail(error.code, error.message, id);
    }
    const { configuration: item, workspaceCwd } = discovery.catalog[id];
    if (!Array.isArray(item.command) || item.command.length === 0 ||
        item.command.some(value => typeof value !== 'string' || value.includes('\0')) || !item.command[0]) {
      fail('INVALID_COMMAND', 'command precisa ser um array não vazio de argumentos válidos.', id);
    }
    if (!object(item.env) || Object.entries(item.env).some(([key, value]) =>
      !key || /[=\0]/.test(key) || typeof value !== 'string' || value.includes('\0'))) {
      fail('INVALID_ENV', 'env precisa conter nomes e valores de ambiente válidos.', id);
    }
    if (process.platform === 'win32') {
      const names = Object.keys(item.env).map(key => key.toUpperCase());
      if (new Set(names).size !== names.length) fail('INVALID_ENV', 'env contém nomes duplicados por caixa.', id);
    }
    if (!['auto', 'events', 'maven', 'karma'].includes(item.adapter)) fail('INVALID_ADAPTER', 'O adapter do módulo não é suportado.', id);
    if (!['inherit', 'node-project'].includes(item.runtime)) fail('INVALID_RUNTIME', 'O runtime do módulo não é suportado.', id);
    if (typeof item.cwd !== 'string' || item.cwd.includes('\0')) fail('INVALID_CWD', 'cwd precisa ser um caminho válido.', id);
    let cwd;
    try {
      cwd = fs.realpathSync(path.resolve(workspaceCwd, item.cwd));
      if (!fs.statSync(cwd).isDirectory()) throw new Error('not a directory');
    } catch { fail('DIRECTORY_UNAVAILABLE', 'O diretório de execução do módulo está indisponível.', id); }
    let env = { ...item.env };
    let nodeRuntime;
    if (item.runtime === 'node-project') {
      try {
        ({ env, nodeRuntime } = frontendRuntime(cwd, env, item.command, { runtime: item.runtime, moduleId: id }));
      } catch (error) {
        fail(error.code || 'NODE_RUNTIME_UNAVAILABLE', error.message, id);
      }
    }
    let command = [...item.command];
    if (nodeRuntime && /^node(?:\.exe)?$/i.test(command[0])) command[0] = nodeRuntime.path;
    const configuration = { moduleId: id, label: metadata.label,
      ...(metadata.language !== null ? { language: metadata.language } : {}),
      runtime: item.runtime, command, cwd, adapter: item.adapter, env,
      ...(nodeRuntime ? { nodeRuntime } : {}) };
    if (process.platform === 'win32') {
      try { configuration.windowsCommand = windowsCommand(command, cwd, mergeEnvironment(process.env, env)); }
      catch { fail('EXECUTABLE_UNAVAILABLE', 'O comando Windows do módulo está inválido ou indisponível.', id); }
    } else command[0] = executableOnPath(command[0], cwd, mergeEnvironment(process.env, env), id);
    configurations[id] = configuration;
  }
  return { ids, configurations, revision: discovery.revision };
}

export function assertSourcesUnchanged(revision) {
  for (const source of revision) {
    const current = readSource(source.path);
    if (current.digest !== source.digest || current.status !== source.status) {
      fail('CONFIG_SOURCES_CHANGED', 'As fontes de configuração mudaram; refaça a descoberta antes de iniciar.');
    }
  }
}
