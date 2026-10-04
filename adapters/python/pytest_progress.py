"""Serial pytest progress through public hooks; pytest is imported on demand."""


class _ProgressPlugin:
    def __init__(self, emitter):
        self.emitter = emitter
        self.total = None
        self.results = {}
        self.counts = {"passed": 0, "failed": 0, "skipped": 0}
        self.attempts = {}
        self.collection_failed = False
        self.collection_finished = False
        self.finished = False
        self.last_snapshot = None

    def snapshot(self, final=False, total_stable=False, phase="executing"):
        counts = [self.counts[outcome] for outcome in ("passed", "failed", "skipped")]
        snapshot = (self.total, *counts, final, total_stable, phase)
        if snapshot != self.last_snapshot:
            self.emitter.emit(self.total, *counts, final=final,
                              total_stable=total_stable, phase=phase)
            self.last_snapshot = snapshot

    def pytest_collection_finish(self, session):
        self.collection_finished = True
        self.total = None if self.collection_failed else len(session.items)
        self.snapshot(total_stable=self.total is not None)

    def pytest_collectreport(self, report):
        if report.failed:
            self.collection_failed = True
            self.total = None

    def pytest_runtest_logreport(self, report):
        # Setup starts a fresh attempt. A rerun must not inherit an earlier fail.
        if report.when == "setup":
            self.attempts[report.nodeid] = {"outcome": None, "rerun": False}
        attempt = self.attempts.setdefault(report.nodeid,
                                           {"outcome": None, "rerun": False})
        if report.outcome == "rerun":
            attempt["rerun"] = True
        elif report.failed:
            attempt["outcome"] = "failed"
        elif report.skipped and attempt["outcome"] != "failed":
            attempt["outcome"] = "skipped"
        elif report.when == "call" and report.passed and attempt["outcome"] is None:
            # Non-strict XPASS is passed; xfail reports are skipped by pytest.
            attempt["outcome"] = "passed"
        if report.when == "teardown":
            if attempt["outcome"] is not None and not attempt["rerun"]:
                previous = self.results.get(report.nodeid)
                if previous is not None:
                    self.counts[previous] -= 1
                self.results[report.nodeid] = attempt["outcome"]
                self.counts[attempt["outcome"]] += 1
                self.snapshot(total_stable=self.total is not None)

    def pytest_sessionfinish(self, session, exitstatus):
        collect_only = session.config.getoption("collectonly", default=False)
        complete = (self.collection_finished and not self.collection_failed
                    and not session.shouldfail and not session.shouldstop
                    and int(exitstatus) in (0, 1, 5)
                    and (collect_only or len(self.results) == self.total))
        self.snapshot(final=True, total_stable=complete,
                      phase="collected" if collect_only else "finished")
        self.finished = True


def run(args, emitter):
    """Return pytest's exit code without changing its capture configuration."""
    plugin = _ProgressPlugin(emitter)
    plugin.snapshot(phase="collecting")
    try:
        import pytest
    except ImportError:
        emitter.note("pytest indisponível neste Python; use o ambiente do projeto com pytest 7+.")
        plugin.snapshot(final=True, phase="finished")
        return 2
    if getattr(pytest, "version_tuple", (0,))[0] < 7:
        emitter.note("pytest 7+ é necessário neste Python.")
        plugin.snapshot(final=True, phase="finished")
        return 2

    class SerialProgressPlugin(_ProgressPlugin):
        @pytest.hookimpl(trylast=True)
        def pytest_collection_finish(self, session):
            nodeids = [item.nodeid for item in session.items]
            if len(nodeids) != len(set(nodeids)):
                raise pytest.UsageError(
                    "test-progress: coleta com nodeids duplicados não é suportada; "
                    "remova caminhos repetidos ou --keep-duplicates.")
            super().pytest_collection_finish(session)

        @pytest.hookimpl(tryfirst=True)
        def pytest_configure(self, config):
            processes = config.getoption("numprocesses", default=None)
            distribution = config.getoption("dist", default="no")
            transports = config.getoption("tx", default=[])
            if (processes not in (None, 0, "0")
                    or distribution not in (None, "no") or transports):
                raise pytest.UsageError(
                    "test-progress: esta versão aceita somente pytest serial; "
                    "remova opções paralelas do pytest-xdist (-n/--dist/--tx).")

    plugin = SerialProgressPlugin(emitter)
    try:
        return int(pytest.main(list(args), plugins=[plugin]))
    finally:
        # Argument errors/help can return before pytest_sessionfinish is called.
        if not plugin.finished:
            plugin.snapshot(final=True, phase="finished")
