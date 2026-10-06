#!/usr/bin/env bash
# Orca worktree setup hook: copy the local Test Progress preset from the main checkout.
set -euo pipefail

worktree_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
main_root="$(cd -- "$(git -C "$worktree_root" rev-parse --path-format=absolute --git-common-dir)/.." && pwd)"
preset=".claude/test-progress.json"

if [[ "$main_root" == "$worktree_root" ]]; then
  printf 'Checkout principal; nada a copiar.\n'
  exit 0
fi
if [[ ! -f "$main_root/$preset" ]]; then
  printf 'Preset ausente em %s; nada a copiar.\n' "$main_root/$preset" >&2
  exit 0
fi
if [[ -f "$worktree_root/$preset" ]]; then
  printf '%s já existe na worktree; mantido.\n' "$preset"
  exit 0
fi

mkdir -p "$worktree_root/.claude"
cp "$main_root/$preset" "$worktree_root/$preset"
printf 'Preset do Test Progress copiado de %s.\n' "$main_root"
