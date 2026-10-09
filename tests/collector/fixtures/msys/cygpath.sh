#!/bin/bash
# Fake cygpath for msys-bootstrap.mjs: drive W: is the POSIX root.
mode=$1
shift
for p in "$@"; do
  case $mode in
    -u) p=${p#[Ww]:}; printf '%s\n' "${p//\\//}" ;;
    -w) printf 'W:%s\n' "${p//\//\\}" ;;
    *) exit 1 ;;
  esac
done
