#!/usr/bin/env python3
"""Run a project's Python tests with the opt-in Test Progress reporter."""

import json
import os
import sys
import threading
import uuid


class ProgressEmitter:
    """Keep reporter events outside pytest fd capture and unittest buffering."""

    def __init__(self, runner):
        self.scope = "{}:{}".format(runner, uuid.uuid4())
        # A duplicate keeps the original pipe when pytest redirects fd 1.
        # os.dup descriptors are non-inheritable on the supported Python versions.
        self.stream = os.fdopen(os.dup(sys.stdout.fileno()), "w",
                                encoding="utf-8", buffering=1, newline="\n")
        self.lock = threading.Lock()

    def emit(self, total, passed, failed, skipped, final=False,
             total_stable=False, phase="executing"):
        event = {
            "scope": self.scope, "total": total,
            "resolved": passed + failed + skipped,
            "passed": passed, "failed": failed, "skipped": skipped,
            "final": final, "totalStable": total_stable, "phase": phase,
        }
        with self.lock:
            # A leading newline separates an event from runners' progress dots.
            self.stream.write("\n@@TEST_PROGRESS@@" + json.dumps(event) + "\n")
            self.stream.flush()

    def note(self, message):
        print("test-progress: " + message, file=sys.stderr, flush=True)

    def close(self):
        self.stream.close()


def main(argv=None):
    args = list(sys.argv[1:] if argv is None else argv)
    if not args or args[0] in ("-h", "--help"):
        print("Uso: python /caminho/adapters/python/run.py {pytest|unittest} [argumentos]\n"
              "Use o Python/venv do projeto. pytest precisa estar instalado nesse ambiente.\n"
              "Exemplos: pytest -q tests/ | unittest discover -s tests -v")
        return 0 if args else 2
    runner = args.pop(0)
    if runner not in ("pytest", "unittest"):
        print("test-progress: runner esperado: pytest ou unittest", file=sys.stderr)
        return 2
    if sys.version_info < (3, 8):
        print("test-progress: Python 3.8+ é necessário", file=sys.stderr)
        return 2

    # Resolve our adapter before adding the project's directory to import lookup.
    if runner == "pytest":
        from pytest_progress import run
    else:
        from unittest_progress import run
    # Match `python -m pytest/unittest` for imports from the configured cwd.
    sys.path.insert(0, os.getcwd())
    emitter = ProgressEmitter(runner)
    try:
        return run(args, emitter)
    except KeyboardInterrupt:
        return 130
    finally:
        emitter.close()


if __name__ == "__main__":
    sys.exit(main())
