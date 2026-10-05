"""Shared public-CLI assertions for disposable adapter integration fixtures."""
import json
from contextlib import suppress
import os
from pathlib import Path
import signal
import subprocess
import time
import uuid

ROOT = Path(__file__).resolve().parent.parent
PREFIX = "@@TEST_PROGRESS@@"


def run(argv, cwd, env=None, timeout=180):
    process = subprocess.Popen([str(arg) for arg in argv], cwd=str(cwd), env=env,
                               stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                               text=True, start_new_session=True)
    try:
        output, unused = process.communicate(timeout=timeout)
    except BaseException:
        with suppress(ProcessLookupError):
            os.killpg(process.pid, signal.SIGKILL)
        process.wait()
        raise
    return process.returncode, output


def snapshots(output):
    events = [json.loads(line.split(PREFIX, 1)[1])
              for line in output.splitlines() if PREFIX in line]
    assert events, "No adapter events in runner output:\n" + output[-8000:]
    previous = {}
    for event in events:
        assert event['resolved'] == sum(event[k] for k in ('passed', 'failed', 'skipped')), event
        assert event['total'] is None or event['resolved'] <= event['total'], event
        assert event['resolved'] >= previous.get(event['scope'], 0), event
        previous[event['scope']] = event['resolved']
    return events


def final_counts(events, expected, scopes=1):
    finals = [event for event in events if event['final']]
    assert len(finals) == scopes, finals
    assert len({event['scope'] for event in finals}) == scopes, finals
    assert all(event['totalStable'] for event in finals), finals
    actual = [sum(event[key] for event in finals)
              for key in ('total', 'passed', 'failed', 'skipped')]
    assert actual == expected, (actual, expected, finals)


def collector(node, app, argv, expected, lane='backend', env=None, cancel=False, timeout=180):
    owner = 'adapter-check-' + uuid.uuid4().hex
    config = app / 'collector.json'
    config.write_text(json.dumps({'schemaVersion': 1, lane: {
        'command': [str(arg) for arg in argv], 'cwd': '.', 'adapter': 'events',
        'env': env or {}}}), encoding='utf-8')

    def action(name):
        command = [node, ROOT / 'runner/cli.mjs', name, '--cwd', app,
                   '--owner', owner, '--lane', lane]
        if name == 'start':
            command += ['--config', config]
        code, output = run(command, app, timeout=20)
        assert code == 0, output
        result = json.loads(output)
        assert result['ok'], result
        return result['lanes'][lane]

    job = action('start')
    requested = False
    try:
        deadline = time.monotonic() + timeout
        while job['status'] in ('preparing', 'running') and time.monotonic() < deadline:
            time.sleep(0.2)
            job = action('status')
            if cancel and job['resolved'] >= 1 and not requested:
                action('cancel')
                requested = True
        for key, value in expected.items():
            assert job[key] == value, (key, value, job)
        if cancel:
            assert requested, job
        return job
    finally:
        if job['status'] in ('preparing', 'running'):
            action('cancel')
