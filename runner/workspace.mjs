import path from 'path';
import { LANES, readJson } from './state.mjs';

// Discovery is deliberately cheap: no commands, runtime lookup or environment
// values in the public metadata. Bad config must not block logs/cancellation.
export function inspectWorkspace(cwd, requestedPath) {
  let config;
  try { config = readJson(path.resolve(cwd, requestedPath ?? '.claude/test-progress.json')); }
  catch {
    return { config: null, metadata: { configStatus: 'invalid', configuredLanes: [],
      error: 'Não foi possível ler a configuração de testes. Confira o arquivo JSON.' } };
  }
  if (config === null) return { config: null, metadata: { configStatus: 'missing', configuredLanes: [] } };
  if (!config || Array.isArray(config) || typeof config !== 'object' || (config.schemaVersion ?? config.schema) !== 1) {
    return { config: null, metadata: { configStatus: 'invalid', configuredLanes: [],
      error: 'A configuração de testes precisa declarar schemaVersion: 1.' } };
  }
  const configuredLanes = LANES.filter(lane => config[lane] != null && config[lane] !== false && config[lane].enabled !== false);
  return { config, metadata: { configStatus: 'ready', configuredLanes } };
}
