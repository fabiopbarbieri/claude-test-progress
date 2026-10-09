#!/usr/bin/env bash
# Runs bench-heavy.ps1 from Git Bash on Windows. Path arguments may use MSYS spelling
# (/c/Tools/tp-bench); they are converted for PowerShell. TP_BENCH_POWERSHELL=pwsh picks
# PowerShell 7 instead of Windows PowerShell 5.1.
#
#   bash scripts/bench/bench-heavy.sh -Workspace /c/Tools/tp-bench -Scenario S1,S2 -Repeat 3
set -euo pipefail

case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*) ;;
  *) echo 'bench-heavy.sh runs in Git Bash on Windows.' >&2; exit 2 ;;
esac
here=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
engine=${TP_BENCH_POWERSHELL:-powershell}
args=()
convert=0
for value in "$@"; do
  if (( convert )); then value=$(cygpath -w -- "$value"); convert=0; fi
  case "$value" in
    -Workspace|-Checkout|-Output|-NodePath) convert=1 ;;
  esac
  args+=("$value")
done
exec "$engine" -NoProfile -ExecutionPolicy Bypass -File "$(cygpath -w -- "$here/bench-heavy.ps1")" "${args[@]}"
