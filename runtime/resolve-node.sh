#!/usr/bin/env bash
set -euo pipefail

tp_runtime_dir=${BASH_SOURCE[0]}
if [[ $tp_runtime_dir == */* ]]; then
  tp_runtime_dir=${tp_runtime_dir%/*}
else
  tp_runtime_dir=.
fi
tp_runtime_dir=$(cd -- "$tp_runtime_dir" && pwd -P)
. "$tp_runtime_dir/node-discovery.sh"

if [[ $# != 3 || ${2-} != --cwd ]]; then
  _tp_node_error 'Uso: bash resolve-node.sh collector|project --cwd /diretório/absoluto'
  exit 2
fi
case $1 in
  collector) tp_select_collector_node "$3" ;;
  project) tp_select_project_node "$3" ;;
  *) _tp_node_error 'Modo deve ser collector ou project.'; exit 2 ;;
esac

# The selected Node serializes only descriptor fields, never the environment.
"$TP_NODE_PATH" -e '
var args = process.argv.slice(1);
process.stdout.write(JSON.stringify({
  path: args[0], version: args[1], source: args[2], nvmrc: args[3] || null
}) + "\n");
' "$TP_NODE_PATH" "$TP_NODE_VERSION" "$TP_NODE_SOURCE" "$TP_NODE_NVMRC"
