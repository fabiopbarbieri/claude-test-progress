#!/bin/bash
# Fake Windows node.exe for msys-bootstrap.mjs. It answers the bootstrap probe with a
# Windows path and the version named by its install directory (nvm-windows layout), and
# otherwise prints the source and arguments it was started with.
self=$(cd "$(dirname "$0")" && pwd -P)/$(basename "$0")
version=$(basename "$(dirname "$self")")
[[ $version =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || version=v20.11.1
if [[ $1 == -e ]]; then printf 'W:%s\n%s' "${self//\//\\}" "$version"; exit 0; fi
printf 'source=%s %s\n' "$TEST_PROGRESS_NODE_SOURCE" "$version"
printf '%s\n' "$@"
