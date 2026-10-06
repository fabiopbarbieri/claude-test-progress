#!/usr/bin/env bash
set -euo pipefail

adapter_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
build_dir="$adapter_dir/build"
platform_version=1.11.3
mkdir -p "$build_dir/deps" "$build_dir/classes"

fetch_jar() {
  local artifact_path="$1" artifact_file="${1##*/}"
  if [[ ! -s "$build_dir/deps/$artifact_file" ]]; then
    curl --fail --silent --show-error --retry 2 --proto '=https' \
      "https://repo.maven.apache.org/maven2/$artifact_path" \
      --output "$build_dir/deps/$artifact_file.part"
    mv -- "$build_dir/deps/$artifact_file.part" "$build_dir/deps/$artifact_file"
  fi
}

for artifact in junit-platform-launcher junit-platform-engine junit-platform-commons; do
  fetch_jar "org/junit/platform/$artifact/$platform_version/$artifact-$platform_version.jar"
done
fetch_jar "org/opentest4j/opentest4j/1.3.0/opentest4j-1.3.0.jar"
fetch_jar "org/apiguardian/apiguardian-api/1.1.2/apiguardian-api-1.1.2.jar"

javac --release 17 -encoding UTF-8 -cp "$build_dir/deps/*" \
  -d "$build_dir/classes" \
  "$adapter_dir/src/main/java/local/claude/progress/TestProgressListener.java"
cp -R "$adapter_dir/src/main/resources/." "$build_dir/classes/"
jar --create --file "$build_dir/test-progress-listener-0.1.0.jar" -C "$build_dir/classes" .
printf 'JAR compilado: %s\n' "$build_dir/test-progress-listener-0.1.0.jar"
