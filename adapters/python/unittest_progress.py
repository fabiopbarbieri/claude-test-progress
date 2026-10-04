"""Opt-in unittest progress, with one resolved item per test method."""

import sys
import traceback
import unittest


class _Progress:
    def __init__(self, emitter):
        self.emitter = emitter
        self.total = None
        self.passed = 0
        self.failed = 0
        self.skipped = 0
        self.notes = []
        self.finished = False

    def uncertain(self, message):
        self.total = None
        if message not in self.notes:
            self.notes.append(message)

    def emit(self, final=False):
        resolved = self.passed + self.failed + self.skipped
        stable = (self.total is not None
                  and (not final or resolved == self.total))
        self.emitter.emit(self.total, self.passed, self.failed, self.skipped,
                          final=final, total_stable=stable,
                          phase="finished" if final else "executing")
        self.finished = final

    def finish(self):
        # Defer diagnostics until TextTestRunner restores -b captured streams.
        for message in self.notes:
            self.emitter.note(message)
        self.emit(final=True)


class _ProgressResult(unittest.TextTestResult):
    def __init__(self, *args, progress, **kwargs):
        super().__init__(*args, **kwargs)
        self.progress = progress
        self._active_test = None
        self._outcome = None
        self._synthetic = False

    def startTest(self, test):
        super().startTest(test)
        self._active_test = test
        self._outcome = None
        # The standard loader creates this placeholder for import/name errors.
        # It is not a user's method and must not inflate resolved counts.
        self._synthetic = (type(test).__module__ == "unittest.loader"
                           and type(test).__name__ == "_FailedTest")
        if self._synthetic:
            self.progress.uncertain(
                "Erro de descoberta/importação: o total de métodos é desconhecido.")

    def _record(self, test, outcome):
        # A skipped subtest is reported through addSkip rather than addSubTest.
        owner = getattr(test, "test_case", test)
        if self._active_test is None or owner is not self._active_test:
            self.progress.uncertain(
                "Resultado de fixture/contêiner sem método iniciado: "
                "a contagem permanece desconhecida; consulte o relatório unittest.")
            self.progress.emit()
            return
        if self._synthetic:
            return
        # Any failure/error wins, including failures in subtests or cleanups.
        if self._outcome != "failed":
            self._outcome = outcome

    def stopTest(self, test):
        super().stopTest(test)
        if not self._synthetic:
            if self._outcome is None:
                self.progress.uncertain(
                    "Método encerrado sem resultado confirmado; contagem parcial.")
            else:
                setattr(self.progress, self._outcome,
                        getattr(self.progress, self._outcome) + 1)
            resolved = (self.progress.passed + self.progress.failed
                        + self.progress.skipped)
            if self.progress.total is not None and resolved > self.progress.total:
                self.progress.uncertain(
                    "A suíte executou mais métodos que countTestCases; total desconhecido.")
        self._active_test = None
        self._outcome = None
        self._synthetic = False
        self.progress.emit()

    def addSuccess(self, test):
        super().addSuccess(test)
        self._record(test, "passed")

    def addFailure(self, test, err):
        super().addFailure(test, err)
        self._record(test, "failed")

    def addError(self, test, err):
        super().addError(test, err)
        self._record(test, "failed")

    def addSkip(self, test, reason):
        super().addSkip(test, reason)
        self._record(test, "skipped")

    def addExpectedFailure(self, test, err):
        super().addExpectedFailure(test, err)
        self._record(test, "skipped")

    def addUnexpectedSuccess(self, test):
        super().addUnexpectedSuccess(test)
        self._record(test, "failed")

    def addSubTest(self, test, subtest, err):
        super().addSubTest(test, subtest, err)
        if err is not None:
            self._record(test, "failed")


def run(args, emitter):
    """Execute the native unittest CLI and return its success/failure exit code."""
    progress = _Progress(emitter)
    loader = unittest.TestLoader()

    # Pass a class, so unittest.main supplies its parsed verbosity, buffering,
    # failfast and version-specific runner options unchanged.
    class ProgressRunner(unittest.TextTestRunner):
        def _makeResult(self):
            # Match TextTestRunner's result construction across Python 3.8+.
            kwargs = {}
            if hasattr(self, "durations"):
                kwargs["durations"] = self.durations
            return _ProgressResult(self.stream, self.descriptions, self.verbosity,
                                   progress=progress, **kwargs)

        def run(self, test):
            progress.total = test.countTestCases()
            if loader.errors:
                progress.uncertain(
                    "Erro de descoberta/importação: o total de métodos é desconhecido.")
            progress.emit()
            try:
                return super().run(test)
            except BaseException:
                progress.uncertain(
                    "Execução interrompida antes do relatório final; contagem parcial.")
                raise
            finally:
                progress.finish()

    try:
        program = unittest.main(module=None, argv=["unittest"] + list(args),
                                testRunner=ProgressRunner, testLoader=loader,
                                exit=False)
    except SystemExit as exc:
        # argparse/help still exit even when unittest's exit=False is supplied.
        code = exc.code if isinstance(exc.code, int) else 1
        if code and not progress.finished:
            progress.uncertain("unittest recusou os argumentos ou a descoberta.")
            progress.finish()
        return code
    except KeyboardInterrupt:
        if not progress.finished:
            progress.uncertain("Execução unittest interrompida; total desconhecido.")
            progress.finish()
        raise
    except Exception:
        if not progress.finished:
            progress.uncertain("unittest falhou antes de confirmar a execução dos métodos.")
            progress.finish()
        traceback.print_exc()
        return 1

    result = program.result
    if not result.wasSuccessful():
        return 1
    # Python 3.12 introduced the CLI exit code for no executed/skipped tests.
    if sys.version_info >= (3, 12) and result.testsRun == 0 and not result.skipped:
        return 5
    return 0
