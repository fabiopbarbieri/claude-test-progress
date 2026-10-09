#!/usr/bin/env bash
set -euo pipefail

tp_bootstrap_script=${BASH_SOURCE[0]}
# Git Bash may get this script as a Windows path, and dirname splits only on '/'.
if [[ ${OSTYPE-} == msys* || ${OSTYPE-} == cygwin* ]]; then tp_bootstrap_script=${tp_bootstrap_script//\\//}; fi
tp_bootstrap_root=$(cd -- "$(dirname -- "$tp_bootstrap_script")/.." && pwd -P)
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
if ! tp_select_collector_node "$tp_bootstrap_cwd"; then
  _tp_node_msys || exit 1
  # Git Bash: nvm 2.x shims and the other installs only node-discovery.ps1 knows.
  tp_bootstrap_ps=(-NoProfile -ExecutionPolicy Bypass -File "$(cygpath -w "$tp_bootstrap_root/scripts/run-collector.ps1")")
  for ((tp_bootstrap_index = 0; tp_bootstrap_index < $#; tp_bootstrap_index++)); do
    case ${tp_bootstrap_args[tp_bootstrap_index]} in
      --cwd|--owner|--module|--config)
        tp_bootstrap_name=${tp_bootstrap_args[tp_bootstrap_index]#--}
        tp_bootstrap_value=${tp_bootstrap_args[tp_bootstrap_index + 1]-}
        [[ $tp_bootstrap_name == owner || $tp_bootstrap_name == module || $tp_bootstrap_value != /* ]] ||
          tp_bootstrap_value=$(cygpath -w "$tp_bootstrap_value")
        tp_bootstrap_ps+=("-${tp_bootstrap_name^}" "$tp_bootstrap_value")
        tp_bootstrap_index=$((tp_bootstrap_index + 1)) ;;
      *) tp_bootstrap_ps+=(-Action "${tp_bootstrap_args[tp_bootstrap_index]}") ;;
    esac
  done
  printf 'test-progress: usando o bootstrap PowerShell.\n' >&2
  exec powershell.exe "${tp_bootstrap_ps[@]}"
fi
export TEST_PROGRESS_NODE_SOURCE=$TP_NODE_SOURCE
tp_bootstrap_cli=$tp_bootstrap_root/runner/cli.mjs
if _tp_node_msys; then
  # Windows' node.exe takes Windows paths. MSYS converts arguments only by guessing,
  # and not at all under MSYS_NO_PATHCONV, so the paths it needs are converted here.
  # One cygpath converts them all.
  tp_bootstrap_paths=("$tp_bootstrap_cli")
  tp_bootstrap_slots=()
  for ((tp_bootstrap_index = 0; tp_bootstrap_index < $# - 1; tp_bootstrap_index++)); do
    if [[ ${tp_bootstrap_args[tp_bootstrap_index]} == --cwd || ${tp_bootstrap_args[tp_bootstrap_index]} == --config ]] &&
       [[ ${tp_bootstrap_args[tp_bootstrap_index + 1]} == /* ]]; then
      tp_bootstrap_slots+=($((tp_bootstrap_index + 1)))
      tp_bootstrap_paths+=("${tp_bootstrap_args[tp_bootstrap_index + 1]}")
    fi
  done
  mapfile -t tp_bootstrap_paths < <(cygpath -w "${tp_bootstrap_paths[@]}")
  tp_bootstrap_cli=${tp_bootstrap_paths[0]}
  for ((tp_bootstrap_index = 0; tp_bootstrap_index < ${#tp_bootstrap_slots[@]}; tp_bootstrap_index++)); do
    tp_bootstrap_args[tp_bootstrap_slots[tp_bootstrap_index]]=${tp_bootstrap_paths[tp_bootstrap_index + 1]}
  done
fi
# Preserve PATH. Only the frontend worker later chooses its project runtime.
# An empty array is unbound under `set -u` in Bash 3.2 (macOS).
exec "$TP_NODE_PATH" "$tp_bootstrap_cli" ${tp_bootstrap_args[@]+"${tp_bootstrap_args[@]}"}
