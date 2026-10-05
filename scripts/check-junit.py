#!/usr/bin/env python3
"""Compile the real listener, then verify a disposable JUnit/Surefire application."""
import argparse
from pathlib import Path
import shutil
import tempfile
import xml.etree.ElementTree as ET

from adapter_checks import ROOT, PREFIX, run, snapshots, final_counts, collector


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--maven', default=shutil.which('mvn'))
    parser.add_argument('--node', default=shutil.which('node'))
    args = parser.parse_args()
    if not args.maven or not args.node:
        parser.error('Maven, a JDK and collector Node are required for this selected suite')
    with tempfile.TemporaryDirectory(prefix='progress-junit-') as temporary:
        directory = Path(temporary)
        adapter = directory / 'listener'
        shutil.copytree(ROOT / 'adapters/junit', adapter,
                        ignore=shutil.ignore_patterns('build', 'target'))
        app = directory / 'application with spaces'
        app.mkdir()
        shutil.copy(ROOT / 'tests/dependencies/junit/pom.xml', app / 'pom.xml')
        shutil.copytree(ROOT / 'tests/fixtures/junit', app / 'src/test/java/fixture')
        version = ET.parse(adapter / 'pom.xml').getroot().find(
            '{http://maven.apache.org/POM/4.0.0}version').text
        mvn = [args.maven, '-B', '-ntp', '-Dstyle.color=never',
               '-Dmaven.repo.local=' + str(directory / 'repository'),
               '-Dlistener.version=' + version]
        code, output = run(mvn + ['install', '-DskipTests'], adapter, timeout=300)
        assert code == 0, output
        print('Listener build and service registration artifact: OK', flush=True)

        # Negative control: the same real suite without the listener cannot prove progress.
        native_code, native_output = run(mvn + ['-P!progress-listener',
                                               '-Dtest=OutcomesTest', 'test'], app)
        assert native_code == 1 and PREFIX not in native_output, native_output
        report = ET.parse(app / 'target/surefire-reports/TEST-fixture.OutcomesTest.xml').getroot()
        assert [int(report.attrib[key]) for key in ('tests', 'failures', 'errors', 'skipped')] == [6, 1, 0, 2]
        try:
            snapshots(native_output)
        except AssertionError:
            pass
        else:
            raise AssertionError('Event gate accepted a runner without the listener')
        print('Negative control (listener absent rejected): OK', flush=True)

        code, output = run(mvn + ['-Dtest=OutcomesTest', 'test'], app)
        assert code == native_code, output
        events = snapshots(output)
        final_counts(events, [6, 3, 1, 2])
        assert any(not event['totalStable'] for event in events), events
        assert events[0]['total'] < events[-1]['total'], events
        print('Pass/fail/disabled/aborted/dynamic, native exit parity: OK', flush=True)

        code, output = run(mvn + ['-Dtest=OutcomesTest#pass', 'test'], app)
        assert code == 0, output
        final_counts(snapshots(output), [1, 1, 0, 0])
        print('JUnit method selection: OK', flush=True)

        parallel = mvn + ['-Dtest=OutcomesTest,SecondTest', '-Dfork.count=2',
                          '-Djunit.jupiter.execution.parallel.enabled=true',
                          '-Djunit.jupiter.execution.parallel.mode.default=concurrent', 'test']
        code, output = run(parallel, app)
        assert code == 1, output
        final_counts(snapshots(output), [7, 4, 1, 2], scopes=2)
        collector(args.node, app, parallel, {'status': 'failed', 'total': 7,
                  'resolved': 7, 'passed': 4, 'failed': 1, 'skipped': 2, 'exitCode': 1})
        print('Two Surefire forks, parallel tests and collector aggregation: OK', flush=True)

        collector(args.node, app, mvn + ['-Dtest=SlowTest', 'test'],
                  {'status': 'cancelled', 'resolved': 1, 'passed': 1,
                   'failed': 0, 'totalStable': False}, cancel=True)
        print('Collector cancellation preserves partial JUnit results: OK', flush=True)


if __name__ == '__main__':
    main()
