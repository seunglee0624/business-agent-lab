from PySide6.QtCore import QObject, Signal

from app.core import settings
from app.core.llm import make_backend, prompts
from app.core.llm.worker import LLMWorker

SCOPES = {"page": "현재 페이지", "selection": "선택한 부분"}
MAX_TURNS = 10  # question+answer pairs sent back as history; older ones are dropped


class ChatState(QObject):
    """Sole owner of the AI chat: one conversation per open file, the context scope, and the answer in progress.
    Messages: {"role": "user" | "assistant" | "error", "text", ...}. A user message keeps "sent", the exact
    content sent; turns already sent never change (append-only), so each request reuses the previous one's cache."""

    changed = Signal()  # messages added or an answer grew; also when another file's conversation is shown
    busy_changed = Signal()
    scope_changed = Signal()
    panel_changed = Signal()

    def __init__(self, viewer, backend=None):
        super().__init__()
        self._viewer = viewer
        self.backend = backend or make_backend(settings.llm_config())
        self.scope = "page"
        self.panel = settings.chat_panel()
        self._chats = {}  # file path -> messages
        self._turn = None  # (messages, user message, answer message) of the question in progress
        self._worker = None  # streams the answer; None while the page's text is still being extracted
        self._waiting_page = None
        viewer.renderer.text_ready.connect(self._on_text)
        viewer.document_changed.connect(self._on_document)

    @property
    def messages(self):
        doc = self._viewer.document
        return self._chats.setdefault(doc.path, []) if doc else []

    @property
    def busy(self):
        return self._turn is not None

    def set_scope(self, scope):
        if scope in SCOPES and scope != self.scope:
            self.scope = scope
            self.scope_changed.emit()

    def set_panel(self, shown):
        if shown != self.panel:
            self.panel = shown
            settings.save_chat_panel(shown)
            self.panel_changed.emit()

    def toggle_panel(self):
        self.set_panel(not self.panel)

    def send(self, question):
        question = question.strip()
        if not question or self.busy or self._viewer.document is None:
            return
        chat, viewer = self.messages, self._viewer
        if self.scope == "selection":
            text = viewer.selected_text()
            if not text:
                chat.append({"role": "error", "kind": "no_selection",
                             "text": "선택한 부분이 없습니다. 페이지에서 글자를 드래그해 선택한 뒤 다시 물어보세요."})
                self.changed.emit()
                return
            page = viewer.selection[0]
        else:
            page, text = viewer.current_page, viewer.renderer.text(viewer.current_page)
        user = {"role": "user", "text": question, "where": f"p.{page + 1}"}
        answer = {"role": "assistant", "text": "", "streaming": True}
        chat += [user, answer]
        self._turn = chat, user, answer
        if text is None:
            self._waiting_page = page
            viewer.renderer.request_text(page)
        else:
            self._ask(text)
        self.busy_changed.emit()
        self.changed.emit()

    def cancel(self):
        """Stop the answer: what arrived so far stays."""
        if self._worker:
            self._worker.cancel()
            self._finish(self._worker, None)
        elif self._turn:
            self._fail("cancelled", "보내기 전에 중지했습니다.")

    def clear(self):
        """Forget this file's conversation."""
        self.cancel()
        self.messages.clear()
        self.changed.emit()

    def _ask(self, excerpt):
        chat, user, answer = self._turn
        user["sent"] = prompts.user_turn(user["where"], excerpt, user["text"])
        worker = self._worker = LLMWorker(self.backend, prompts.SYSTEM, self._history(chat))
        worker.setParent(self)  # Qt owns it, so it is deleted on this thread (deleteLater) and not by Python's GC
        worker.chunk.connect(lambda piece: self._on_chunk(worker, piece))
        worker.done.connect(lambda text: self._finish(worker, text))
        worker.failed.connect(lambda kind, message: self._on_failed(worker, kind, message))
        worker.start()

    @staticmethod
    def _history(chat):
        """The conversation as the API takes it: failed turns and error notes left out, the last MAX_TURNS kept."""
        turns = []
        for message in chat:
            if message.get("failed") or message.get("streaming"):
                continue
            if message["role"] == "user" and "sent" in message:
                turns.append({"role": "user", "content": message["sent"]})
            elif message["role"] == "assistant":
                turns.append({"role": "assistant", "content": message["text"] or "(중단됨)"})
        turns = turns[-(2 * MAX_TURNS - 1):]  # the new question plus MAX_TURNS - 1 earlier pairs
        while turns and turns[0]["role"] != "user":
            turns.pop(0)
        return turns

    def _on_chunk(self, worker, piece):
        if worker is self._worker:
            self._turn[2]["text"] += piece
            self.changed.emit()

    def _finish(self, worker, text):
        """done, or cancel() (text None): keep what arrived. A cancelled worker's own late done is ignored."""
        if text is not None:  # the worker's last signal: nothing more will use it
            worker.deleteLater()
        if worker is not self._worker:
            return
        self._turn[2].pop("streaming")
        self._turn = self._worker = None
        self.busy_changed.emit()
        self.changed.emit()

    def _on_failed(self, worker, kind, message):
        worker.deleteLater()
        if worker is self._worker:
            self._fail(kind, message)

    def _fail(self, kind, message):
        chat, user, answer = self._turn
        self._turn = self._worker = self._waiting_page = None
        user["failed"] = answer["failed"] = True  # neither half of a failed turn is sent again
        answer.pop("streaming")
        if not answer["text"]:
            chat.remove(answer)
        chat.append({"role": "error", "kind": kind, "text": message})
        self.busy_changed.emit()
        self.changed.emit()

    def _on_text(self, page):
        if self._turn and self._worker is None and page == self._waiting_page:
            self._waiting_page = None
            self._ask(self._viewer.renderer.text(page))

    def _on_document(self):
        if self._turn and self._worker is None:  # set_document dropped the other file's text job
            self._fail("cancelled", "다른 문서로 바뀌어 질문을 보내지 않았습니다.")
        else:
            self.changed.emit()
