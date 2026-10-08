import path from 'path';

// Runners write to a pipe, so most of them drop color. The panel draws SGR
// colors, so each module is asked for color the way its runner understands it.
// NO_COLOR or an explicit FORCE_COLOR (module env or inherited) is the person's
// choice and turns the whole policy off.
const executable = value => path.win32.basename(path.posix.basename(value)).toLowerCase().replace(/\.(cmd|bat|exe)$/, '');
const append = (current, option) => (current ? `${current} ${option}` : option);

export function colorEnvironment(environment, command, adapter) {
  const key = name => Object.keys(environment).find(item => item.toUpperCase() === name) || name;
  const value = name => environment[key(name)];
  if (value('NO_COLOR') || value('FORCE_COLOR') !== undefined) return environment;
  const result = { ...environment, [key('FORCE_COLOR')]: '1' };
  const names = Array.isArray(command) ? command.map(executable) : [];
  // Maven 3.9+ reads MAVEN_ARGS; older versions keep their plain output.
  if (adapter === 'maven' || names[0] === 'mvn' || names[0] === 'mvnw') {
    const current = value('MAVEN_ARGS') || '';
    if (!/style\.color/.test(current)) result[key('MAVEN_ARGS')] = append(current, '-Dstyle.color=always');
  }
  if (names.includes('rspec')) {
    const current = value('SPEC_OPTS') || '';
    if (!/(^|\s)--(no-|force-)?colou?r\b/.test(current)) result[key('SPEC_OPTS')] = append(current, '--force-color');
  }
  return result;
}
