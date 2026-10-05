const reserved = new Set(['all', 'constructor', 'prototype', 'con', 'prn', 'aux', 'nul']);

export function validModuleId(id) {
  return typeof id === 'string' && /^[a-z][a-z0-9-]{0,47}$/.test(id) &&
    !reserved.has(id) && !/^(?:com|lpt)[1-9]$/.test(id);
}

export function requireModuleId(id) {
  if (validModuleId(id)) return id;
  const error = new Error('ID de módulo inválido ou reservado.');
  error.code = 'INVALID_MODULE_ID';
  throw error;
}
