import logging
import threading

from PySide6.QtCore import QObject, Signal

from app.core.llm.base import LLMError

log = logging.getLogger(__name__)


class LLMWorker(QObject):
    """Runs one answer on a daemon thread and reports it with signals (queued to the UI thread).
    A thread is enough: the wait is network I/O, which releases the GIL (unlike PyMuPDF rendering).
    Daemon: a request still waiting for the network never holds up quitting the app."""

    chunk = Signal(str)
    done = Signal(str)  # the whole answer, or what arrived before cancel()
    failed = Signal(str, str)  # LLMError kind, message

    def __init__(self, backend, system, messages):
        super().__init__()
        self._backend, self._system, self._messages = backend, system, messages
        self._cancelled = False

    def start(self):
        threading.Thread(target=self._run, daemon=True).start()

    def cancel(self):
        """Stops at the next piece of text; the stream is closed then."""
        self._cancelled = True

    def _run(self):
        parts = []
        stream = self._backend.stream(self._system, self._messages)
        try:
            for piece in stream:
                if self._cancelled:
                    break
                parts.append(piece)
                self.chunk.emit(piece)
        except LLMError as error:
            self.failed.emit(error.kind, str(error))
            return
        except Exception as error:  # a bug or an unexpected library error: report it instead of dying silently
            log.exception("AI answer failed")
            self.failed.emit("other", f"알 수 없는 오류: {error}")
            return
        finally:
            stream.close()
        self.done.emit("".join(parts))
