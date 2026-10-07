#!/usr/bin/env python3
"""Run Playwright Test fixtures in real headless Chromium, then through the collector."""
import argparse
import json
import os
from pathlib import Path
import shutil
import tempfile

from adapter_checks import ROOT, PREFIX, run, snapshots, final_counts, collector


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--playwright', required=True, choices=['minimum', 'latest'])
    parser.add_argument('--frontend-node', required=True)
    parser.add_argument('--node', default=shutil.which('node'))
    parser.add_argument('--install-browser', action='store_true',
                        help='Download the fixture Chromium into the temporary directory')
    args = parser.parse_args()
    if not args.node:
        parser.error('Collector Node is required for this selected suite')
    frontend = Path(args.frontend_node).resolve()
    # Version managers may ship npm as a shell wrapper; run npm's own entry point.
    npm_cli = frontend.parent.parent / 'lib/node_modules/npm/bin/npm-cli.js'
    npm = npm_cli if npm_cli.is_file() else (frontend.parent / 'npm').resolve()
    fixture = ROOT / 'tests/dependencies/playwright'
    with tempfile.TemporaryDirectory(prefix='progress-playwright-') as temporary:
        app = Path(temporary) / 'application with spaces'
        shutil.copytree(fixture, app, ignore=shutil.ignore_patterns('versions'))
        for name in ('package.json', 'package-lock.json'):
            shutil.copy(fixture / 'versions' / args.playwright / name, app / name)
        shutil.copy(ROOT / 'adapters/playwright/reporter.cjs', app / 'reporter.cjs')
        code, version = run([frontend, '--version'], app)
        assert code == 0, version
        (app / '.nvmrc').write_text(version.strip() + '\n', encoding='utf-8')
        overrides = {'PATH': str(frontend.parent) + os.pathsep + os.environ['PATH'],
                     'npm_config_cache': str(Path(temporary) / 'npm-cache'), 'CI': '1'}
        if args.install_browser:
            overrides['PLAYWRIGHT_BROWSERS_PATH'] = str(Path(temporary) / 'browsers')
        env = dict(os.environ, **overrides)
        code, output = run([frontend, npm, 'ci', '--ignore-scripts', '--no-audit', '--no-fund'],
                           app, env=env, timeout=600)
        assert code == 0, output
        cli = app / 'node_modules/@playwright/test/cli.js'
        pinned = json.loads((app / 'package.json').read_text())['devDependencies']['@playwright/test']
        code, output = run([frontend, cli, '--version'], app, env=env)
        assert code == 0 and output.strip().endswith(pinned), ('Playwright fixture version changed', pinned, output)
        if args.install_browser:
            code, output = run([frontend, cli, 'install', 'chromium'], app, env=env, timeout=600)
            assert code == 0, output
        print('Playwright ' + pinned + ' locked fixture install: OK', flush=True)

        command = [frontend, cli, 'test']
        native_code, output = run(command, app, dict(env, FIXTURE_REPORTER='off'), timeout=300)
        assert native_code == 1 and PREFIX not in output, output
        # A config or browser launch failure must not count as a successful negative control.
        assert '1 failed' in output and '1 skipped' in output and '1 flaky' in output, output
        try:
            snapshots(output)
        except AssertionError:
            pass
        else:
            raise AssertionError('Event gate accepted a runner without the reporter')
        print('Native browser outcomes and missing-reporter negative control: OK', flush=True)

        code, output = run(command, app, env, timeout=300)
        assert code == native_code, output
        # Retries resolve each test once: flaky and test.fail() pass, the hard failure fails once.
        final_counts(snapshots(output), [5, 3, 1, 1])
        print('Rendering, click, fail, skip, retry and expected failure; native exit parity: OK', flush=True)

        code, output = run(command, app, dict(env, FIXTURE_MODE='pass'), timeout=300)
        assert code == 0, output
        final_counts(snapshots(output), [1, 1, 0, 0])
        print('Successful Playwright browser suite: OK', flush=True)

        # The documented opt-in: an absolute reporter path on the command line, no config change.
        flag = '--reporter=list,' + str(ROOT / 'adapters/playwright/reporter.cjs')
        code, output = run(command + [flag], app, dict(env, FIXTURE_REPORTER='off', FIXTURE_MODE='pass'), timeout=300)
        assert code == 0, output
        final_counts(snapshots(output), [1, 1, 0, 0])
        print('Command-line reporter path without config change: OK', flush=True)

        # Bare node deliberately follows the app runtime selected from PATH/.nvmrc.
        job = collector(args.node, app, ['node'] + command[1:],
                        {'status': 'failed', 'total': 5, 'resolved': 5, 'passed': 3,
                         'failed': 1, 'skipped': 1, 'exitCode': 1},
                        module_id='e2e', runtime='node-project', env=overrides, timeout=300)
        assert Path(job['nodeRuntime']['path']).resolve() == frontend, job
        assert job['nodeRuntime']['source'] == 'nvmrc-path', job
        print('Collector aggregates browser results using the app .nvmrc: OK', flush=True)

        # One real test resolves, the next keeps the browser busy. Never accept
        # cancellation after all tests.
        collector(args.node, app, ['node'] + command[1:],
                  {'status': 'cancelled', 'total': 2, 'resolved': 1, 'passed': 1,
                   'failed': 0, 'skipped': 0}, module_id='e2e', runtime='node-project',
                  env=dict(overrides, FIXTURE_MODE='slow'), cancel=True, timeout=300)
        print('Browser cancellation preserves partial results: OK', flush=True)


if __name__ == '__main__':
    main()
