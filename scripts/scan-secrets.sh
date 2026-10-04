#!/usr/bin/env bash
set -euo pipefail
project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
scanner="${GITLEAKS_BIN:-gitleaks}"
if ! command -v "$scanner" >/dev/null 2>&1; then
  printf 'Instale Gitleaks ou defina GITLEAKS_BIN para o executável local.\n' >&2
  exit 1
fi
# Redact every match. Reports/logs from a finding must not become public artifacts.
"$scanner" dir "$project_root" --redact --no-banner
if git -C "$project_root" rev-parse --verify HEAD >/dev/null 2>&1; then
  "$scanner" git "$project_root" --log-opts='--all' --redact --no-banner
fi
