import { expect, test } from 'claude-code/testing';
import { suiteLanguage } from '../runner/suite-language.mjs';

test('suite labels use explicit language, then adapter, then known commands; never collector Node', () => {
  for (const [job, language] of [
    [{ language: 'Kotlin', adapter: 'maven', command: ['./mvnw'] }, 'Kotlin'],
    [{ adapter: 'maven', command: ['./wrapper'] }, 'JVM'],
    [{ adapter: 'karma', command: ['npm', 'test'] }, 'JavaScript'],
    [{ command: ['/usr/bin/python3.14', 'run.py'] }, 'Python'],
    [{ command: ['C:\\Ruby\\bin\\ruby.exe', 'run.rb'] }, 'Ruby'],
    [{ command: ['bundle', 'exec', 'rspec'] }, 'Ruby'],
    [{ command: ['node', 'suite.mjs'] }, 'JavaScript'],
    [{ command: ['node', 'suite.ts'] }, 'TypeScript'],
    [{ command: ['npm', 'test'], collectorRuntime: { version: 'v26.7.0' } }, null],
    [{ command: ['./custom-wrapper'], nodeRuntime: { version: 'v26.7.0' } }, null],
  ] as const) expect(suiteLanguage(job)).toBe(language);
});
