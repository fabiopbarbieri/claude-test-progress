#!/bin/bash
# Fake powershell.exe for msys-bootstrap.mjs: prints the arguments it was started with.
printf '%s\n' "$@"
