#!/usr/bin/env python3
"""Exercise the Ruby adapter using isolated public fixtures and installed gems."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
import uuid

ROOT = Path(__file__).resolve().parent.parent
PREFIX = '@@TEST_PROGRESS@@'
RUBY = os.environ.get('RUBY', 'ruby')


def fixture_env(app):
    env = dict(os.environ)
    for key in list(env):
        if key == 'SPEC_OPTS' or key == 'RUBYOPT' or key.startswith('BUNDLE_'):
            env.pop(key)
    env['XDG_CONFIG_HOME'] = str(app / '.xdg')
    return env


def invoke(app, *args):
    result = subprocess.run([RUBY, str(ROOT / 'adapters/ruby/run.rb'), 'rspec', *args],
                            cwd=str(app), env=fixture_env(app), capture_output=True, text=True, timeout=30)
    events = [json.loads(line[len(PREFIX):]) for line in result.stdout.splitlines()
              if line.startswith(PREFIX)]
    assert events, (result.stdout, result.stderr)
    for event in events:
        assert event['resolved'] == event['passed'] + event['failed'] + event['skipped']
        assert event['total'] is None or event['resolved'] <= event['total']
    return result, events


def collector_check(app):
    config = app / 'collector.json'
    config.write_text(json.dumps({'schemaVersion': 2, 'modules': {'backend': {
        'command': [RUBY, str(ROOT / 'adapters/ruby/run.rb'), 'rspec', 'slow_spec.rb'],
        'cwd': '.', 'adapter': 'events', 'env': {}}}}))
    owner = 'ruby-check-' + uuid.uuid4().hex

    def collect(action):
        argv = ['node', str(ROOT / 'runner/cli.mjs'), action, '--cwd', str(app),
                '--owner', owner, '--module', 'backend']
        if action == 'start':
            argv += ['--config', str(config)]
        reply = subprocess.run(argv, env=fixture_env(app), capture_output=True, text=True, timeout=15)
        assert reply.returncode == 0, reply.stderr
        data = json.loads(reply.stdout)
        assert data['ok'], data
        return data['jobs']['backend']

    job = collect('start')
    try:
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            job = collect('status')
            if job['resolved'] == 1 and (app / 'child.pid').exists():
                break
            assert job['status'] in ('preparing', 'running'), job
            time.sleep(0.1)
        assert job['resolved'] == 1 and job['status'] == 'running', job
        job = collect('cancel')
        while job['status'] in ('preparing', 'running') and time.monotonic() < deadline:
            time.sleep(0.1)
            job = collect('status')
        assert job['status'] == 'cancelled' and job['resolved'] == 1, job
        assert job['totalStable'] is False, job
        if os.name == 'posix' and Path('/proc').is_dir():
            child = int((app / 'child.pid').read_text())
            child_stat = Path('/proc') / str(child) / 'stat'
            assert not child_stat.exists() or child_stat.read_text().split(') ')[1].startswith('Z'), child

        print('collector live progress, fd capture and cancellation: OK')
    finally:
        if job['status'] in ('preparing', 'running'):
            collect('cancel')


def main():
    with tempfile.TemporaryDirectory(prefix='test-progress-ruby-') as temporary:
        app = Path(temporary) / 'project with spaces'
        app.mkdir()
        (app / 'spec').mkdir()
        (app / '.xdg/rspec').mkdir(parents=True)
        (app / '.xdg/rspec/options').write_text('')
        (app / 'spec/cases_spec.rb').write_text('''RSpec.describe 'outcomes' do
  it('passes') { expect(2 + 2).to eq(4) }
  it('fails') { expect(false).to be true }
  it('skips') { skip 'intentional' }
  it('pending') { pending 'intentional'; expect(false).to be true }
end
''')
        result, events = invoke(app)
        assert result.returncode == 1, (result.stdout, result.stderr)
        last = events[-1]
        assert [last[k] for k in ('total', 'passed', 'failed', 'skipped', 'final')] == [4, 1, 1, 2, True], last
        assert '4 examples, 1 failure, 2 pending' in result.stdout
        assert events[0]['total'] is None
        print('RSpec default selection and outcomes: OK')

        def check(name, source, args, code, counts, stable=True):
            (app / 'case_spec.rb').write_text(source)
            result, events = invoke(app, 'case_spec.rb', *args)
            last = events[-1]
            assert result.returncode == code, (name, result.stdout, result.stderr)
            assert [last[k] for k in ('total', 'passed', 'failed', 'skipped')] == counts, (name, last)
            assert last['final'] and last['totalStable'] == stable, (name, last)
            native = subprocess.run([RUBY, '-rrspec/core', '-e',
                                     '$0 = "rspec"; RSpec::Core::Runner.invoke', '--',
                                     'case_spec.rb', *args], cwd=str(app), env=fixture_env(app),
                                    capture_output=True, text=True, timeout=30)
            assert native.returncode == result.returncode, (name, native.stderr, result.stderr)
            print(name + ': OK')
            return result, events

        check('filtered', "RSpec.describe('x') { it('a') {}; it('b') {} }", ['-e', 'a'], 0, [1, 1, 0, 0])
        check('zero selected', "RSpec.describe('x') { it('a') {} }", ['-e', 'missing'], 0, [0, 0, 0, 0])
        check('zero required', 'RSpec.configure { |c| c.fail_if_no_examples = true }', [], 1, [0, 0, 0, 0])
        check('discovery error', "raise 'discovery failed'", [], 1, [None, 0, 0, 0], False)
        check('invalid option', '', ['--not-an-rspec-option'], 1, [None, 0, 0, 0], False)
        check('syntax error', 'RSpec.describe(', [], 1, [None, 0, 0, 0], False)
        check('before suite error', "RSpec.configure { |c| c.before(:suite) { raise 'setup' } }; RSpec.describe('x') { it('a') {} }", [], 1, [1, 0, 0, 0], False)
        check('after suite error', "RSpec.configure { |c| c.after(:suite) { raise 'teardown' } }; RSpec.describe('x') { it('a') {} }", [], 1, [1, 1, 0, 0], False)
        check('example teardown', "RSpec.describe('x') { after { raise 'teardown' }; it('a') {} }", [], 1, [1, 0, 1, 0])
        check('context setup', "RSpec.describe('x') { before(:context) { raise 'setup' }; it('a') {}; it('b') {} }", [], 1, [2, 0, 2, 0])
        check('fail fast custom exit', "RSpec.describe('x') { it('a') { raise 'fail' }; it('b') {} }", ['--fail-fast', '--failure-exit-code', '7'], 7, [2, 0, 1, 0], False)
        check('pending unexpectedly passes', "RSpec.describe('x') { it('a') { pending 'fix'; expect(true).to be true } }", [], 1, [1, 0, 1, 0])
        result, events = check('dry run', "RSpec.describe('x') { it('a') { raise 'never run' } }", ['--dry-run'], 0, [1, 0, 0, 0])
        assert events[-1]['phase'] == 'collected'
        check('retry', "require 'rspec/retry'; RSpec.describe('x') { it('a', retry: 2) { @tries = (@tries || 0) + 1; raise 'retry' if @tries == 1 } }", [], 0, [1, 1, 0, 0])
        (app / '.rspec').write_text('--format documentation --out native.txt --deprecation-out deprecations.txt')
        result, _ = check('native output configuration', "RSpec.describe('configured') { it('works') {} }", [], 0, [1, 1, 0, 0])
        assert 'configured' in (app / 'native.txt').read_text()
        assert 'already been initialized' not in result.stderr
        (app / '.rspec').unlink()
        (app / 'Gemfile').write_text("source 'https://rubygems.org'\ngem 'rspec', '~> 3.13.0'\n")
        bundled = subprocess.run([RUBY, '-rbundler/setup', str(ROOT / 'adapters/ruby/run.rb'),
                                  'rspec', 'case_spec.rb'], cwd=str(app), env=fixture_env(app),
                                 capture_output=True, text=True, timeout=30)
        assert bundled.returncode == 0 and PREFIX in bundled.stdout, (bundled.stdout, bundled.stderr)
        (app / 'Gemfile').unlink()
        print('application bundle: OK')
        # Reopening fd 1 is stronger than replacing $stdout: events still reach
        # the original collector pipe and are flushed before the slow test ends.
        source = """RSpec.describe 'live' do
  it('first') do
    STDOUT.reopen('captured.txt', 'w')
    $stdout = StringIO.new
    puts 'captured'
  end
  it('second') do
    child = Process.spawn(RbConfig.ruby, '-e', 'sleep 60')
    File.write('child.pid', child)
    sleep 60
  end
end
"""
        (app / 'slow_spec.rb').write_text("require 'stringio'\n" + source)
        collector_check(app)



if __name__ == '__main__':
    main()
