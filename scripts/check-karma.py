#!/usr/bin/env python3
"""Run Angular CLI fixtures in real headless Chrome, then through the collector."""
import argparse
import json
import os
from pathlib import Path
import shutil
import socket
import tempfile

from adapter_checks import ROOT, PREFIX, run, snapshots, final_counts, collector


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--angular', required=True, choices=['9', '18'])
    parser.add_argument('--frontend-node', required=True)
    parser.add_argument('--node', default=shutil.which('node'))
    parser.add_argument('--chrome', default=os.environ.get('CHROME_BIN') or shutil.which('google-chrome'))
    args = parser.parse_args()
    if not args.node or not args.chrome:
        parser.error('Collector Node and Chrome are required for this selected suite')
    frontend = Path(args.frontend_node).resolve()
    npm = (frontend.parent / 'npm').resolve()
    with tempfile.TemporaryDirectory(prefix='progress-angular-') as temporary:
        app = Path(temporary) / 'application with spaces'
        shutil.copytree(ROOT / ('tests/dependencies/angular' + args.angular), app)
        shutil.copy(ROOT / 'adapters/karma/reporter.cjs', app / 'reporter.cjs')
        code, version = run([frontend, '--version'], app)
        assert code == 0, version
        (app / '.nvmrc').write_text(version.strip() + '\n', encoding='utf-8')
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            port = str(sock.getsockname()[1])
        overrides = {'PATH': str(frontend.parent) + os.pathsep + os.environ['PATH'],
                     'CHROME_BIN': str(Path(args.chrome).resolve()), 'FIXTURE_PORT': port,
                     'NG_CLI_ANALYTICS': 'false', 'NG_BUILD_MAX_WORKERS': '2', 'NGCC_MAX_WORKERS': '2',
                     'npm_config_cache': str(Path(temporary) / 'npm-cache')}
        env = dict(os.environ, **overrides)
        code, output = run([frontend, npm, 'ci', '--ignore-scripts', '--no-audit', '--no-fund'],
                           app, env=env, timeout=600)
        assert code == 0, output
        installed = json.loads((app / 'node_modules/@angular/core/package.json').read_text())['version']
        assert installed.split('.')[0] == args.angular, ('Angular fixture major changed', installed)
        print('Angular ' + args.angular + ' locked fixture install: OK', flush=True)
        command = [frontend, app / 'node_modules/@angular/cli/bin/ng',
                   'test', 'fixture', '--watch=false', '--progress=false']
        native_code, output = run(command, app, dict(env, FIXTURE_REPORTER='off'), timeout=300)
        assert native_code == 1 and PREFIX not in output, output
        # A compiler/bootstrap failure must not count as a successful negative control.
        assert 'TOTAL: 1 FAILED, 2 SUCCESS' in output, output
        try:
            snapshots(output)
        except AssertionError:
            pass
        else:
            raise AssertionError('Event gate accepted a runner without the reporter')
        print('Native browser outcomes and missing-reporter negative control: OK', flush=True)

        code, output = run(command, app, env, timeout=300)
        assert code == native_code, output
        final_counts(snapshots(output), [4, 2, 1, 1])
        print('TestBed rendering, click, fail and skip; native exit parity: OK', flush=True)

        code, output = run(command, app, dict(env, FIXTURE_MODE='pass'), timeout=300)
        assert code == 0, output
        final_counts(snapshots(output), [1, 1, 0, 0])
        print('Successful Angular browser suite: OK', flush=True)

        # Bare node deliberately follows the app runtime selected from PATH/.nvmrc.
        job = collector(args.node, app, ['node'] + command[1:],
                        {'status': 'failed', 'total': 4, 'resolved': 4, 'passed': 2,
                         'failed': 1, 'skipped': 1, 'exitCode': 1},
                        lane='frontend', env=overrides, timeout=300)
        assert Path(job['nodeRuntime']['path']).resolve() == frontend, job
        assert job['nodeRuntime']['source'] == 'nvmrc-path', job
        print('Collector aggregates browser results using the app .nvmrc: OK', flush=True)

        # The fixture flushes Karma's 50-result polling buffer, then leaves one
        # real Jasmine spec pending. Never accept cancellation after all tests.
        collector(args.node, app, ['node'] + command[1:],
                  {'status': 'cancelled', 'total': 51, 'resolved': 50, 'passed': 50,
                   'failed': 0, 'skipped': 0, 'totalStable': False}, lane='frontend',
                  env=dict(overrides, FIXTURE_MODE='slow'), cancel=True, timeout=300)
        print('Browser cancellation preserves partial results: OK', flush=True)


if __name__ == '__main__':
    main()
