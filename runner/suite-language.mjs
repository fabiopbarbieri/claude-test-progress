// Presentation hint only: never use a label to select runtimes or adapters.
export function suiteLanguage(job) {
  if (job.language) return job.language;
  if (job.adapter === 'maven') return 'JVM';
  if (job.adapter === 'karma') return 'JavaScript';
  const command = job.command ?? [];
  const executable = String(command[0] ?? '').split(/[\\/]/).pop().toLowerCase()
    .replace(/\.(exe|cmd|bat)$/, '');
  if (/^python(?:\d+(?:\.\d+)*)?$/.test(executable) || ['pytest', 'pytest-3'].includes(executable)) return 'Python';
  if (['ruby', 'jruby', 'bundle', 'bundler', 'rspec', 'rails', 'rake'].includes(executable)) return 'Ruby';
  if (['java', 'mvn', 'mvnw', 'gradle', 'gradlew'].includes(executable)) return 'JVM';
  if (['node', 'nodejs', 'bun', 'deno', 'tsx', 'ts-node'].includes(executable)) {
    if (['tsx', 'ts-node'].includes(executable) || command.some((arg) => /\.(?:ts|tsx|mts|cts)$/.test(arg))) return 'TypeScript';
    return 'JavaScript';
  }
  // Package managers and shell scripts can launch any language. Keep their
  // module label unless configuration names the suite's language explicitly.
  return null;
}
