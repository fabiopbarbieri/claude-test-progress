#!/usr/bin/env bash
set -euo pipefail

tp_bootstrap_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
. "$tp_bootstrap_root/runtime/node-discovery.sh"

# Bootstrap before any JavaScript runs: the project's active Node can be <14.
tp_bootstrap_cwd=$PWD
tp_bootstrap_args=("$@")
for ((tp_bootstrap_index = 0; tp_bootstrap_index < $#; tp_bootstrap_index++)); do
  if [[ ${tp_bootstrap_args[tp_bootstrap_index]} == --cwd ]]; then
    tp_bootstrap_cwd=${tp_bootstrap_args[tp_bootstrap_index + 1]-}
    break
  fi
done
tp_select_collector_node "$tp_bootstrap_cwd"
export TEST_PROGRESS_NODE_SOURCE=$TP_NODE_SOURCE
# Preserve PATH. Only the frontend worker later chooses its project runtime.
exec "$TP_NODE_PATH" "$tp_bootstrap_root/runner/cli.mjs" "$@"
