#!/usr/bin/env bash
set -euo pipefail

prototype_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
claude_executable="${CLAUDE_BIN:-claude}"
if ! command -v "$claude_executable" >/dev/null 2>&1; then
  printf 'Claude não encontrado. Defina CLAUDE_BIN ou disponibilize claude no PATH.\n' >&2
  exit 1
fi
. "$prototype_root/runtime/node-discovery.sh"
tp_select_collector_node "$PWD"
# Check availability without pinning an automatic choice or changing PATH.
# Each Mod invocation resolves the runtime from its current session directory.
claude_version="$("$claude_executable" --version)"
if [[ ! "$claude_version" =~ ([0-9]+)\.([0-9]+)\.([0-9]+) ]]; then
  printf 'Não foi possível identificar a versão: %s\n' "$claude_version" >&2
  exit 1
fi
major="${BASH_REMATCH[1]}"
minor="${BASH_REMATCH[2]}"
patch="${BASH_REMATCH[3]}"
if (( major < 2 || (major == 2 && minor < 1) || (major == 2 && minor == 1 && patch < 295) )); then
  printf 'Mods requer Claude 2.1.295+. Encontrado: %s\n' "$claude_version" >&2
  printf 'Use CLAUDE_BIN=/caminho/do/claude-atualizado bash %s/launch.sh\n' "$prototype_root" >&2
  exit 1
fi
exec "$claude_executable" --plugin-dir "$prototype_root" "$@"
