import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { validModuleId, requireModuleId } from '../../runner/module-id.mjs';
import { discoverModules, prepareSelection, assertSourcesUnchanged } from '../../runner/module-config.mjs';
import { removePath } from '../../runner/runtime.mjs';

for (const id of ['a', 'api-2', 'backend', 'frontend', 'a'.repeat(48)]) {
  assert.strictEqual(validModuleId(id), true);
  assert.strictEqual(requireModuleId(id), id);
}
for (const id of [null, '', 'A', '../secret', 'all', 'constructor', 'prototype',
  'con', 'prn', 'aux', 'nul', 'com1', 'com9', 'lpt1', 'lpt9', 'a'.repeat(49)]) {
  assert.strictEqual(validModuleId(id), false);
  assert.throws(() => requireModuleId(id), error => error.code === 'INVALID_MODULE_ID' &&
    !error.message.includes('secret'));
}
console.log('Safe module IDs: OK');

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'test-progress-modules-'));
const originalRegistry = process.env.CLAUDE_CONFIG_DIR;
const cwd = fs.realpathSync(temporary);
const registryDirectory = path.join(cwd, 'registry');
const configPath = path.join(cwd, '.claude', 'test-progress.json');
const registryPath = path.join(registryDirectory, 'test-progress.registry.json');
fs.mkdirSync(path.dirname(configPath));
fs.mkdirSync(registryDirectory);
process.env.CLAUDE_CONFIG_DIR = registryDirectory;
const writeWorkspace = modules => fs.writeFileSync(configPath, JSON.stringify({ schemaVersion: 1, modules }));
try {
  let found = discoverModules({ cwd });
  assert.strictEqual(found.workspace.moduleConfig.status, 'absent');
  assert.deepStrictEqual(Object.keys(found.modules), []);
  fs.writeFileSync(registryPath, JSON.stringify({ schemaVersion: 1, templates: {
    shared: { command: ['missing-command'], env: { TOKEN: 'synthetic-private-token' } },
  } }));
  found = discoverModules({ cwd });
  assert.deepStrictEqual(Object.keys(found.modules), []);
  writeWorkspace({ api: { label: ' API ', language: ' JVM ', extends: 'shared' },
    web: { command: ['unavailable'], runtime: 'node-project' }, off: { enabled: false } });
  found = discoverModules({ cwd });
  assert.deepStrictEqual(found.workspace.moduleConfig, { status: 'valid', schemaVersion: 1,
    enabledIds: ['api', 'web'] });
  assert.strictEqual(found.modules.api.label, 'API');
  assert.strictEqual(found.modules.api.language, 'JVM');
  assert.strictEqual(found.modules.api.origin, 'template');
  assert.strictEqual(found.modules.web.language, null);
  assert.strictEqual(found.modules.off.enabled, false);
  assert.strictEqual(found.modules.web.directoryPresent, true);
  assert.deepStrictEqual(found.modules.web.diagnostics, []);
  assert(!JSON.stringify({ modules: found.modules, workspace: found.workspace,
    diagnostics: found.diagnostics }).includes('synthetic-private-token'));
  console.log('Read-only discovery and registry activation: OK');
  fs.writeFileSync(path.join(cwd, '.nvmrc'), 'unavailable-synthetic-node');
  fs.writeFileSync(registryPath, JSON.stringify({ schemaVersion: 1, templates: {
    shared: { command: ['missing-command'], env: { TOKEN: 'synthetic-private-token', EXTRA: 'remove' },
      adapter: 'events', runtime: 'inherit' },
  } }));
  writeWorkspace({ api: { extends: 'shared', command: [process.execPath, '-e', 'throw Error("must not execute")'],
    env: { REPLACED: 'yes' }, order: 5 },
  broken: { command: ['missing-command'], env: { SECRET: null }, runtime: 'unknown' },
  zed: { command: [process.execPath], order: -2 }, off: { enabled: false } });
  found = discoverModules({ cwd });
  let prepared = prepareSelection(found, 'api');
  assert.deepStrictEqual(prepared.ids, ['api']);
  assert.deepStrictEqual(prepared.configurations.api.command,
    [fs.realpathSync(process.execPath), '-e', 'throw Error("must not execute")']);
  assert.deepStrictEqual(prepared.configurations.api.env, { REPLACED: 'yes' });
  assert.strictEqual(prepared.configurations.api.runtime, 'inherit');
  assert.strictEqual(prepared.configurations.api.adapter, 'events');
  assert.strictEqual(prepared.configurations.api.cwd, cwd);
  assert.strictEqual(prepared.configurations.api.nodeRuntime, undefined);
  if (process.platform !== 'win32') {
    const executableAlias = path.join(cwd, 'project-node-alias');
    fs.symlinkSync(process.execPath, executableAlias);
    writeWorkspace({ alias: { command: [executableAlias, '-e', ''], runtime: 'inherit' } });
    assert.strictEqual(prepareSelection(discoverModules({ cwd }), 'alias').configurations.alias.command[0], executableAlias,
      'Captured argv[0] must preserve a symlink alias, as required by Python venvs and multicall executables');
    fs.unlinkSync(executableAlias);
    writeWorkspace({ api: { command: [process.execPath] },
      broken: { command: ['missing-command'], env: { SECRET: null }, runtime: 'unknown' }, off: { enabled: false } });
    found = discoverModules({ cwd });
  }
  assert.throws(() => prepareSelection(found, 'all'), error => error.moduleId === 'broken');
  assert.throws(() => prepareSelection(found, 'off'), error => error.code === 'MODULE_DISABLED');
  assert.throws(() => prepareSelection(found, 'missing'), error => error.code === 'MODULE_NOT_FOUND');
  writeWorkspace({ api: { command: [process.execPath], order: 5 },
    zed: { command: [process.execPath], order: -2 }, aaa: { command: [process.execPath], order: 5 } });
  prepared = prepareSelection(discoverModules({ cwd }), 'all');
  assert.deepStrictEqual(prepared.ids, ['zed', 'aaa', 'api']);
  console.log('Selected-only preflight, whole-field inheritance and ordering: OK');
  found = discoverModules({ cwd });
  assertSourcesUnchanged(found.revision);
  writeWorkspace({ api: { command: [process.execPath], env: { PRIVATE: 'synthetic-private-token' } } });
  assert.throws(() => assertSourcesUnchanged(found.revision), error =>
    error.code === 'CONFIG_SOURCES_CHANGED' && !error.message.includes(cwd));
  found = discoverModules({ cwd });
  fs.unlinkSync(registryPath);
  assert.throws(() => assertSourcesUnchanged(found.revision), error => error.code === 'CONFIG_SOURCES_CHANGED');
  found = discoverModules({ cwd });
  assertSourcesUnchanged(found.revision);
  fs.writeFileSync(registryPath, JSON.stringify({ schemaVersion: 1, templates: {} }));
  assert.throws(() => assertSourcesUnchanged(found.revision), error => error.code === 'CONFIG_SOURCES_CHANGED');
  fs.unlinkSync(registryPath);
  const serializedRevision = JSON.parse(JSON.stringify(discoverModules({ cwd }).revision));
  fs.writeFileSync(registryPath, ' '.repeat(1024 * 1024 + 1));
  assert.throws(() => assertSourcesUnchanged(serializedRevision), error => error.code === 'CONFIG_SOURCES_CHANGED');
  console.log('Serialized supervisor revision detects an oversized source appearing: OK');
  console.log('Private source revision detects change, removal and appearance: OK');
  fs.writeFileSync(path.join(cwd, '.nvmrc'), 'synthetic-private-token');
  writeWorkspace({ web: { command: ['node', '-e', ''], runtime: 'node-project' } });
  assert.throws(() => prepareSelection(discoverModules({ cwd }), 'web'), error =>
    error.moduleId === 'web' && error.code === 'NODE_RUNTIME_UNAVAILABLE' &&
    !error.message.includes('synthetic-private-token') && !error.message.includes(cwd) &&
    error.message.includes('web'));
  console.log('Runtime resolver errors never expose stderr or private paths: OK');
  fs.writeFileSync(registryPath, ' '.repeat(1024 * 1024 + 1));
  writeWorkspace({ api: { command: [process.execPath] },
    dependent: { extends: 'shared', command: [process.execPath] } });
  found = discoverModules({ cwd });
  assert.strictEqual(found.diagnostics[0].code, 'SOURCE_TOO_LARGE');
  assert.deepStrictEqual(prepareSelection(found, 'api').ids, ['api']);
  assertSourcesUnchanged(found.revision);
  assert.throws(() => prepareSelection(found, 'dependent'), error => error.code === 'TEMPLATE_UNAVAILABLE');
  console.log('Unavailable registry affects only referenced modules: OK');
  fs.writeFileSync(registryPath, JSON.stringify({ schemaVersion: 1, templates: {} }));
  for (const invalid of [null, [], { schemaVersion: 1, backend: {} }, { schemaVersion: 2, modules: {} },
    { schemaVersion: 1, modules: {}, frontend: {} },
    { schemaVersion: 1, modules: { con: {} } }]) {
    fs.writeFileSync(configPath, JSON.stringify(invalid));
    found = discoverModules({ cwd });
    assert.strictEqual(found.workspace.moduleConfig.status, 'invalid');
    assert.throws(() => prepareSelection(found, 'all'), error => error.code === 'WORKSPACE_CONFIG_UNAVAILABLE');
  }
  fs.writeFileSync(configPath, '{"synthetic-private-token": invalid');
  found = discoverModules({ cwd });
  assert.strictEqual(found.diagnostics[0].code, 'INVALID_JSON');
  assert(!JSON.stringify(found.diagnostics).includes('synthetic-private-token'));
  fs.writeFileSync(configPath, ' '.repeat(1024 * 1024 + 1));
  found = discoverModules({ cwd });
  assert.strictEqual(found.diagnostics[0].code, 'SOURCE_TOO_LARGE');
  assert.throws(() => prepareSelection(found, 'all'));
  console.log('Other versions, mixed schema, unsafe IDs, JSON and source size block starts: OK');
  for (const [declaration, code] of [[false, 'INVALID_MODULE'], [null, 'INVALID_MODULE'],
    [{ enabled: null }, 'INVALID_ENABLED'], [{ label: '\u001bprivate' }, 'INVALID_LABEL'],
    [{ language: null }, 'INVALID_LANGUAGE'], [{ order: 1.5 }, 'INVALID_ORDER'],
    [{ typo: true }, 'UNKNOWN_MODULE_FIELD'], [{ command: null }, 'INVALID_COMMAND'],
    [{ command: [process.execPath], env: null }, 'INVALID_ENV'],
    [{ command: [process.execPath], env: { 'bad=name': 'private' } }, 'INVALID_ENV'],
    [{ command: [process.execPath], adapter: null }, 'INVALID_ADAPTER'],
    [{ command: [process.execPath], runtime: null }, 'INVALID_RUNTIME'],
    [{ command: [process.execPath], cwd: null }, 'INVALID_CWD'],
    [{ command: [process.execPath], cwd: 'missing-private-directory' }, 'DIRECTORY_UNAVAILABLE'],
    [{ command: ['unavailable-synthetic-command'] }, 'EXECUTABLE_UNAVAILABLE']]) {
    writeWorkspace({ api: { command: [process.execPath] }, broken: declaration });
    found = discoverModules({ cwd });
    assert.deepStrictEqual(prepareSelection(found, 'api').ids, ['api']);
    assert(found.workspace.moduleConfig.enabledIds.includes('broken'));
    assert.throws(() => prepareSelection(found, 'all'), error => error.code === code &&
      error.moduleId === 'broken' && !error.message.includes('private'));
  }
  writeWorkspace({ api: { command: [process.execPath], extends: 'shared' } });
  fs.writeFileSync(registryPath, JSON.stringify({ schemaVersion: 1, templates: {
    shared: { extends: 'other', command: [process.execPath] },
  } }));
  assert.throws(() => prepareSelection(discoverModules({ cwd }), 'api'), error => error.code === 'INVALID_TEMPLATE');
  console.log('Malformed modules remain selected by all; standalone modules stay usable: OK');
  fs.unlinkSync(configPath);
  found = discoverModules({ cwd });
  assert.strictEqual(found.workspace.moduleConfig.status, 'absent');
  assert.throws(() => prepareSelection(found, 'all'), error => error.code === 'WORKSPACE_CONFIG_UNAVAILABLE');
  const alternate = path.join(cwd, 'alternate.json');
  fs.writeFileSync(alternate, JSON.stringify({ schemaVersion: 1, modules: { api: { command: [process.execPath] } } }));
  assert.deepStrictEqual(prepareSelection(discoverModules({ cwd }, { configPath: 'alternate.json' }), 'all').ids, ['api']);
  process.env.CLAUDE_CONFIG_DIR = 'relative-private-registry';
  found = discoverModules({ cwd }, { configPath: 'alternate.json' });
  assert.strictEqual(found.diagnostics[0].code, 'INVALID_REGISTRY_DIRECTORY');
  assert.deepStrictEqual(prepareSelection(found, 'api').ids, ['api']);
  process.env.CLAUDE_CONFIG_DIR = registryDirectory;
  console.log('ENOENT, config override and absolute registry directory contract: OK');
  if (process.platform !== 'win32') {
    const bin = path.join(cwd, 'bin with spaces');
    fs.mkdirSync(bin);
    fs.symlinkSync(process.execPath, path.join(bin, 'chosen-command'));
    writeWorkspace({ api: { command: ['chosen-command', '--literal'], env: { PATH: bin } } });
    prepared = prepareSelection(discoverModules({ cwd }), 'api');
    assert.deepStrictEqual(prepared.configurations.api.command, [path.join(bin, 'chosen-command'), '--literal']);
    writeWorkspace({ api: { command: ['node'], env: { PATH: bin } } });
    assert.throws(() => prepareSelection(discoverModules({ cwd }), 'api'), error => error.code === 'EXECUTABLE_UNAVAILABLE');
    fs.writeFileSync(path.join(bin, 'bash'), '#!/bin/sh\nprintf "synthetic-private-token synthetic-registry-path" >&2\nexit 1\n', { mode: 0o700 });
    writeWorkspace({ web: { command: ['node'], env: { PATH: bin }, runtime: 'node-project' } });
    assert.throws(() => prepareSelection(discoverModules({ cwd }), 'web'), error =>
      error.code === 'NODE_RUNTIME_UNAVAILABLE' && !error.message.includes('synthetic-private-token') &&
      !error.message.includes('synthetic-registry-path'));
    fs.unlinkSync(path.join(cwd, '.nvmrc'));
    writeWorkspace({ web: { command: ['node', '-e', 'throw Error("must not execute")'],
      runtime: 'node-project', env: { PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH || ''}` } } });
    prepared = prepareSelection(discoverModules({ cwd }), 'web');
    assert.strictEqual(prepared.configurations.web.nodeRuntime.source, 'path');
    assert.strictEqual(prepared.configurations.web.nodeRuntime.nvmrc, null);
    assert.strictEqual(prepared.configurations.web.command[0], fs.realpathSync(prepared.configurations.web.nodeRuntime.path));
    console.log('Effective PATH, captured executable and explicit node-project runtime: OK');
  }
} finally {
  if (originalRegistry === undefined) delete process.env.CLAUDE_CONFIG_DIR;
  else process.env.CLAUDE_CONFIG_DIR = originalRegistry;
  removePath(temporary, { recursive: true, force: true });
}
