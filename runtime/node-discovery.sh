#!/usr/bin/env bash
# Source this Bash library; selectors write only TP_NODE_* and no stdout.
# nvm is loaded in a subshell, without changing the caller's PATH or aliases.

_tp_node_error() {
  printf 'test-progress: %s\n' "$*" >&2
}

# Git Bash (MSYS2) and Cygwin run Windows' node.exe, which reports and accepts Windows
# paths; cygpath converts them to and from this shell's paths.
_tp_node_msys() {
  [[ ${OSTYPE-} == msys* || ${OSTYPE-} == cygwin* ]]
}

_tp_node_posix_path() {
  if _tp_node_msys && [[ $1 =~ ^([A-Za-z]):[\\/](.*)$ ]]; then
    # /proc/cygdrive leads to the drives in MSYS2 and Cygwin alike, and costs no process;
    # each process start in Git Bash costs ~40 ms.
    if [[ -d /proc/cygdrive/${BASH_REMATCH[1],,} ]]; then
      printf '/proc/cygdrive/%s/%s\n' "${BASH_REMATCH[1],,}" "${BASH_REMATCH[2]//\\//}"
    else
      cygpath -u "$1" 2>/dev/null
    fi
  else
    printf '%s\n' "$1"
  fi
}

_tp_node_initialize() {
  TP_NODE_PATH=''
  TP_NODE_VERSION=''
  TP_NODE_SOURCE=''
  TP_NODE_NVMRC=''
  TP_TASK_NODE_CWD=''
  local tp_cwd
  tp_cwd=$(_tp_node_posix_path "${1-}") || tp_cwd=''
  set -- "$tp_cwd"
  if [[ ${1-} != /* || ! -d ${1-} ]]; then
    _tp_node_error '--cwd deve indicar um diretório absoluto existente.'
    return 1
  fi
  if ! TP_TASK_NODE_CWD=$(cd -- "$1" && pwd -P); then
    _tp_node_error 'Não foi possível acessar --cwd.'
    return 1
  fi
}

_tp_node_probe() {
  local tp_candidate=$1 tp_output tp_version tp_path
  TP_TASK_PROBE_PATH=''
  TP_TASK_PROBE_VERSION=''
  # ES5 syntax keeps probing usable with old project runtimes (Node 10+).
  if ! tp_output=$(
    cd -- "$TP_TASK_NODE_CWD" &&
      "$tp_candidate" -e 'process.stdout.write(process.execPath + "\n" + process.version)' 2>/dev/null
  ); then
    return 1
  fi
  [[ $tp_output == *$'\n'* ]] || return 1
  tp_version=${tp_output##*$'\n'}
  tp_path=$(_tp_node_posix_path "${tp_output%$'\n'*}") || return 1
  [[ $tp_path == /* && -x $tp_path ]] || return 1
  [[ $tp_version =~ ^v[0-9]+\.[0-9]+\.[0-9]+([-+][0-9A-Za-z.-]+)?$ ]] || return 1
  TP_TASK_PROBE_PATH=$tp_path
  TP_TASK_PROBE_VERSION=$tp_version
}

_tp_node_matches() {
  local tp_minimum=$1 tp_selector=${2-} tp_version tp_major
  tp_version=${TP_TASK_PROBE_VERSION#v}
  tp_major=${tp_version%%.*}
  (( 10#$tp_major >= tp_minimum )) || return 1
  if [[ -n $tp_selector ]]; then
    tp_selector=${tp_selector#v}
    [[ $tp_version == "$tp_selector" || $tp_version == "$tp_selector".* ]] || return 1
  fi
}

_tp_node_accept() {
  TP_NODE_PATH=$TP_TASK_PROBE_PATH
  TP_NODE_VERSION=$TP_TASK_PROBE_VERSION
  TP_NODE_SOURCE=$1
}

_tp_node_from_path() {
  local tp_minimum=$1 tp_source=$2 tp_selector=${3-} tp_candidate
  while IFS= read -r tp_candidate; do
    if _tp_node_probe "$tp_candidate" && _tp_node_matches "$tp_minimum" "$tp_selector"; then
      _tp_node_accept "$tp_source"
      return 0
    fi
  done < <(cd -- "$TP_TASK_NODE_CWD" && type -ap node 2>/dev/null)
  return 1
}

_tp_node_nvm_paths() (
  # nvm does not support nounset. Its functions and environment stay here.
  set +u
  set +e
  local tp_policy=$1 tp_script='' tp_dir tp_selector tp_result
  shift
  local -a tp_dirs=() tp_selectors=("$@")
  [[ -z ${NVM_DIR-} ]] || tp_dirs+=("$NVM_DIR")
  [[ -z ${HOME-} ]] || tp_dirs+=("$HOME/.nvm")
  [[ -z ${XDG_CONFIG_HOME-} ]] || tp_dirs+=("$XDG_CONFIG_HOME/nvm")
  for tp_dir in "${tp_dirs[@]}"; do
    if [[ -r $tp_dir/nvm.sh && -f $tp_dir/nvm.sh ]]; then
      tp_dir=$(cd -- "$tp_dir" && pwd -P) || continue
      tp_script=$tp_dir/nvm.sh
      break
    fi
  done
  [[ -n $tp_script ]] || return 1
  cd -- "$TP_TASK_NODE_CWD" || return 1
  export NVM_DIR=${tp_script%/nvm.sh}
  export NVM_SYMLINK_CURRENT=false
  export NVM_NO_COLORS=1
  export NVM_SILENT=1
  # Only the trusted nvm installation is sourced, never the project's .nvmrc.
  . "$tp_script" --no-use >/dev/null 2>&1 || return 1
  declare -F nvm >/dev/null || return 1
  if [[ $tp_policy == fallback ]]; then
    # After current/default/node, try every other locally installed release.
    # GNU version sort is descending; no nvm private API or remote inventory.
    while IFS= read -r tp_selector; do
      tp_selectors+=("$tp_selector")
    done < <(
      for tp_dir in "$NVM_DIR"/versions/node/v*; do
        [[ -d $tp_dir ]] || continue
        tp_selector=${tp_dir##*/}
        [[ $tp_selector =~ ^v[0-9]+\.[0-9]+\.[0-9]+([-+][0-9A-Za-z.-]+)?$ ]] || continue
        printf '%s\n' "$tp_selector"
      done | command sort -Vr
    )
  fi
  for tp_selector in "${tp_selectors[@]}"; do
    # Explicit selectors avoid nvm's private, version-dependent .nvmrc parser.
    # `which` resolves installed runtimes only; no install/use/alias commands.
    if tp_result=$(nvm which --silent "$tp_selector" 2>/dev/null); then
      [[ $tp_result == /* && -x $tp_result ]] || continue
      printf '%s\n' "$tp_result"
    fi
  done
)

_tp_node_from_nvm() {
  local tp_minimum=$1 tp_source=$2 tp_match=$3 tp_candidate
  shift 3
  while IFS= read -r tp_candidate; do
    if _tp_node_probe "$tp_candidate" && _tp_node_matches "$tp_minimum" "$tp_match"; then
      _tp_node_accept "$tp_source"
      return 0
    fi
  done < <(_tp_node_nvm_paths "$@")
  return 1
}

# nvm-windows from Git Bash: its current version (NVM_SYMLINK), then every local install
# under NVM_HOME, newest first. Network locations are skipped, as in node-discovery.ps1.
_tp_node_nvm_windows_paths() {
  local tp_root tp_dir
  _tp_node_msys || return 0
  if [[ -n ${NVM_SYMLINK-} && ${NVM_SYMLINK} != [\\/][\\/]* ]]; then
    tp_root=$(_tp_node_posix_path "$NVM_SYMLINK") && printf '%s\n' "$tp_root/node.exe"
  fi
  if [[ -n ${NVM_HOME-} && ${NVM_HOME} != [\\/][\\/]* ]]; then
    tp_root=$(_tp_node_posix_path "$NVM_HOME") || return 0
    for tp_dir in "$tp_root"/v*; do
      if [[ ${tp_dir##*/} =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ && -d $tp_dir ]]; then printf '%s\n' "${tp_dir##*/}"; fi
    done | command sort -Vr | while IFS= read -r tp_dir; do printf '%s\n' "$tp_root/$tp_dir/node.exe"; done
  fi
}

_tp_node_from_nvm_windows() {
  local tp_minimum=$1 tp_source=$2 tp_candidate
  while IFS= read -r tp_candidate; do
    [[ -f $tp_candidate ]] || continue
    if _tp_node_probe "$tp_candidate" && _tp_node_matches "$tp_minimum"; then
      _tp_node_accept "$tp_source"
      return 0
    fi
  done < <(_tp_node_nvm_windows_paths)
  return 1
}

_tp_node_find_nvmrc() {
  local tp_dir=$TP_TASK_NODE_CWD tp_file
  while :; do
    tp_file=${tp_dir%/}/.nvmrc
    if [[ -e $tp_file || -L $tp_file ]]; then
      TP_NODE_NVMRC=$tp_file
      return 0
    fi
    [[ $tp_dir != / ]] || return 0
    tp_dir=${tp_dir%/*}
    [[ -n $tp_dir ]] || tp_dir=/
  done
}

_tp_node_parse_nvmrc() {
  local tp_line tp_selector=''
  TP_TASK_NODE_SELECTOR=''
  if [[ ! -f $TP_NODE_NVMRC || ! -r $TP_NODE_NVMRC ]]; then
    _tp_node_error '.nvmrc deve ser um arquivo legível.'
    return 1
  fi
  while IFS= read -r tp_line || [[ -n $tp_line ]]; do
    tp_line=${tp_line%%#*}
    tp_line=${tp_line#"${tp_line%%[![:space:]]*}"}
    tp_line=${tp_line%"${tp_line##*[![:space:]]}"}
    [[ -n $tp_line ]] || continue
    # nvm 0.40.8 reserves key=value metadata and ignores it.
    [[ $tp_line != *=* ]] || continue
    if [[ -n $tp_selector || $tp_line == *[[:space:]]* || $tp_line == -* ]]; then
      _tp_node_error '.nvmrc deve conter exatamente um seletor de versão, sem opções.'
      return 1
    fi
    tp_selector=$tp_line
  done < "$TP_NODE_NVMRC"
  if [[ -z $tp_selector ]]; then
    _tp_node_error '.nvmrc não contém um seletor de versão.'
    return 1
  fi
  TP_TASK_NODE_SELECTOR=$tp_selector
}

tp_select_collector_node() {
  _tp_node_initialize "${1-}" || return 1
  if [[ ${TEST_PROGRESS_NODE+x} ]]; then
    if [[ -n $TEST_PROGRESS_NODE ]] && _tp_node_probe "$TEST_PROGRESS_NODE" && _tp_node_matches 14; then
      _tp_node_accept override
      return 0
    fi
    _tp_node_error 'TEST_PROGRESS_NODE deve executar um Node >=14; override inválido não permite fallback.'
    return 1
  fi
  _tp_node_from_path 14 path && return 0
  # nvm.sh does not run on Windows; Git Bash uses nvm-windows' installs instead.
  if ! _tp_node_msys; then _tp_node_from_nvm 14 nvm '' fallback current default node && return 0; fi
  _tp_node_from_nvm_windows 14 nvm && return 0
  _tp_node_error 'Node >=14 não encontrado no PATH ou no nvm local para o coletor.'
  return 1
}

tp_select_project_node() {
  local tp_numeric=''
  _tp_node_initialize "${1-}" || return 1
  _tp_node_find_nvmrc
  if [[ -n $TP_NODE_NVMRC ]]; then
    _tp_node_parse_nvmrc || return 1
    if [[ $TP_TASK_NODE_SELECTOR =~ ^v?[0-9]+(\.[0-9]+){0,2}$ ]]; then
      tp_numeric=$TP_TASK_NODE_SELECTOR
      _tp_node_from_path 0 nvmrc-path "$tp_numeric" && return 0
    fi
    _tp_node_from_nvm 0 nvmrc-nvm "$tp_numeric" exact "$TP_TASK_NODE_SELECTOR" && return 0
    _tp_node_error 'A versão exigida pela .nvmrc não está disponível localmente; nenhum fallback foi aplicado.'
    return 1
  fi
  _tp_node_from_path 0 path && return 0
  _tp_node_from_nvm 0 nvm '' fallback current default node && return 0
  _tp_node_error 'Node do projeto não encontrado no PATH ou no nvm local.'
  return 1
}
