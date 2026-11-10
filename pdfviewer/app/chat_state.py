from PySide6.QtCore import QObject, Signal

from app.core import settings
from app.core.llm import make_backend, prompts
from app.core.llm.worker import LLMWorker

SCOPES = {"selection": "선택한 부분", "page": "현재 페이지", "document": "문서 전체"}
SAVED_KEYS = ("role", "text", "where", "sent", "page", "usage", "note_id")  # what a saved conversation keeps
MAX_TURNS = 10  # question+answer pairs sent back as history; older ones are dropped


class ChatState(QObject):
    """Sole owner of the AI chat: one conversation per open file, the context scope, and the answer in progress.
    Messages: {"role": "user" | "assistant" | "error" | "note", "text", ...}. A user message keeps "sent", the exact
    content sent; turns already sent never change (append-only), so each request reuses the previous one's cache.
    The first whole-document question puts the document in the system prompt, where it stays for that conversation.
    With notes (AnnotationState), each finished turn is saved in the file's notes and comes back when it is reopened,
    and an answer can be kept as a note of the page it was asked on."""

    changed = Signal()  # messages added or an answer grew; also when another file's conversation is shown
    busy_changed = Signal()
    scope_changed = Signal()
    panel_changed = Signal()
    context_changed = Signal()  # what the next question would carry may differ: call context_info()
    quick_changed = Signal()
    backend_changed = Signal()  # the AI settings were saved
    input_requested = Signal()  # "AI에게 질문": the question box should take the keys

    def __init__(self, viewer, backend=None, notes=None):
        super().__init__()
        self._viewer, self._notes = viewer, notes
        config = settings.llm_config()
        self.backend = backend or make_backend(config)
        self.document_limit = config["document_limit"]
        self.scope = settings.chat_scope() if settings.chat_scope() in SCOPES else "page"
        self.panel = settings.chat_panel()
        self.quick_questions = settings.quick_questions()
        self._chats = {}  # file path -> messages
        self._documents = {}  # file path -> whole-document block, once that conversation asked about it
        self._turn = None  # (messages, user message, answer message) of the question in progress
        self._worker = None  # streams the answer; None while the text to send is still being extracted
        self._needs = None  # what that text is: a page index or "document"
        renderer = viewer.renderer
        renderer.text_ready.connect(self._on_text)
        renderer.document_text_ready.connect(self._on_text)
        viewer.document_changed.connect(self._on_document)
        if notes:
            notes.changed.connect(self._restore)  # also when a document's notes finish loading
        for signal in (renderer.text_ready, renderer.document_text_ready, viewer.page_changed, viewer.selection_changed,
                       viewer.document_changed, self.scope_changed, self.panel_changed):
            signal.connect(self.context_changed)

    @property
    def messages(self):
        doc = self._viewer.document
        return self._chats.setdefault(doc.path, []) if doc else []

    @property
    def busy(self):
        return self._turn is not None

    # ---- panel, scope, quick questions

    def set_scope(self, scope):
        if scope in SCOPES and scope != self.scope:
            self.scope = scope
            settings.save_chat_scope(scope)
            self.scope_changed.emit()

    def set_panel(self, shown):
        if shown != self.panel:
            self.panel = shown
            settings.save_chat_panel(shown)
            self.panel_changed.emit()

    def toggle_panel(self):
        self.set_panel(not self.panel)

    def ask_about_selection(self):
        """Right-click "AI에게 질문": the selection becomes the scope and the question box opens; the user types."""
        self.set_scope("selection")
        self.set_panel(True)
        self.input_requested.emit()

    def set_quick_questions(self, questions):
        self.quick_questions = questions
        settings.save_quick_questions(questions)
        self.quick_changed.emit()

    @property
    def config(self):
        return settings.llm_config()

    def apply_config(self, config):
        """New AI settings from the settings dialog: saved, and used from the next question on."""
        settings.save_llm_config(config)
        self.backend = make_backend(config)
        self.document_limit = config["document_limit"]
        self.backend_changed.emit()
        self.context_changed.emit()

    def ask_quick(self, question):
        """A quick-question button: its own scope if it has one, else the current one."""
        if question.get("scope"):
            self.set_scope(question["scope"])
        self.send(question["text"])

    def open_page(self, number):
        """A p.N link in an answer (1-based, as written)."""
        if 1 <= number <= self._viewer.page_count:
            self._viewer.go_to(number - 1)

    def context_info(self):
        """What the next question would carry, e.g. "p.12 · 1,240자". Starts extracting text the panel will need."""
        viewer = self._viewer
        if viewer.document is None:
            return ""
        if self.scope == "selection":
            text = viewer.selected_text()
            return f"선택 p.{viewer.selection[0] + 1} · {len(text):,}자" if text else "선택한 부분 없음"
        if self.scope == "document":
            result = self._document_text(request=self.panel)
            if result is None:
                return f"문서 전체 · {viewer.page_count}쪽"
            texts, count = result
            cut = " · 앞부분만" if self._truncated(texts) else ""
            return f"문서 전체 · {count}쪽 · {sum(map(len, texts)):,}자{cut}"
        page = viewer.current_page
        text = self._page_text(page, request=self.panel)
        return f"p.{page + 1}" + (f" · {len(text):,}자" if text is not None else "")

    # ---- asking

    def send(self, question):
        question = question.strip()
        viewer = self._viewer
        if not question or self.busy or viewer.document is None:
            return
        chat, excerpt = self.messages, None
        if self.scope == "selection":
            excerpt = viewer.selected_text()
            if not excerpt:
                chat.append({"role": "error", "kind": "no_selection", "text": "선택한 부분이 없습니다."})
                self.changed.emit()
                return
            where, self._needs, page = f"p.{viewer.selection[0] + 1}", None, viewer.selection[0]
        elif self.scope == "document":
            where, self._needs, page = "문서 전체", "document", viewer.current_page
        else:
            self._needs = page = viewer.current_page
            where = f"p.{self._needs + 1}"
        user = {"role": "user", "text": question, "where": where, "page": page}  # page: where "메모로 저장" puts it
        answer = {"role": "assistant", "text": "", "streaming": True}
        chat += [user, answer]
        self._turn = chat, user, answer
        if self._needs is None:
            self._ask(excerpt)
        else:
            self._try_ask()
        self.busy_changed.emit()
        self.changed.emit()

    def cancel(self):
        """Stop the answer: what arrived so far stays."""
        if self._worker:
            self._worker.cancel()
            self._finish(self._worker, None, None)
        elif self._turn:
            self._fail("cancelled", "보내기 전에 중지했습니다.")

    def clear(self):
        """Forget this file's conversation (and the document it carried), the saved copy too."""
        self.cancel()
        self.messages.clear()
        if self._viewer.document:
            self._documents.pop(self._viewer.document.path, None)
            if self._notes:  # even with saving off: a cleared conversation must not come back
                self._notes.save_chat(self._viewer.document.path, [])
        self.changed.emit()

    # ---- saving: the conversation and answers kept as notes

    def save_answer(self, index):
        """Keep the answer at messages[index] as a note of the page its question was asked on."""
        messages = self.messages
        answer = messages[index] if 0 <= index < len(messages) else None
        if not (self.can_save_answers and answer and answer["role"] == "assistant" and answer["text"]
                and not answer.get("streaming") and not self.answer_saved(answer)):
            return
        question = next((m for m in reversed(messages[:index]) if m["role"] == "user"), {})
        page = question.get("page", self._viewer.current_page)  # conversations saved before 11c have none
        answer["note_id"] = self._notes.add_ai_note(page, answer["text"], question.get("text", ""))
        self._save(messages)
        self.changed.emit()

    @property
    def can_save_answers(self):
        """Answers can be kept once this file's notes have loaded."""
        return self._notes is not None and self._notes.store is not None

    def answer_saved(self, message):
        """Whether an answer is kept as a note (not if that note was deleted or undone since)."""
        return bool(self._notes and message.get("note_id") and self._notes.has_note(message["note_id"]))

    def _save(self, chat):
        """Save a conversation into its file's notes: finished turns only, no errors or notes."""
        path = next((path for path, messages in self._chats.items() if messages is chat), None)
        if not (self._notes and path and self.config["save_chat"]):
            return
        kept = [{key: m[key] for key in SAVED_KEYS if key in m} for m in chat
                if m["role"] in ("user", "assistant") and not m.get("failed") and not m.get("streaming")]
        self._notes.save_chat(path, kept)

    def _restore(self):
        """A file whose notes just loaded gets its saved conversation back, unless one was started already."""
        doc = self._viewer.document
        if not (self._notes and doc and not self._chats.get(doc.path) and self.config["save_chat"]):
            return
        saved = self._notes.saved_chat()
        if saved:
            self._chats[doc.path] = saved
            self.changed.emit()

    def _page_text(self, page, request):
        """The page's text, or None while it is still being extracted (asked for if request)."""
        text = self._viewer.renderer.text(page)
        if text is None and request:
            self._viewer.renderer.request_text(page)
        return text

    def _document_text(self, request):
        renderer = self._viewer.renderer
        result = renderer.document_text(self.document_limit)
        if result is None and request:
            renderer.request_document_text(self.document_limit)
        return result

    def _truncated(self, texts):
        return sum(map(len, texts)) >= self.document_limit

    def _try_ask(self):
        """Send the waiting question once its text is extracted."""
        if self._needs == "document":
            path = self._viewer.document.path
            if path not in self._documents:
                result = self._document_text(request=True)
                if result is None:
                    return
                texts, count = result
                truncated = self._truncated(texts)
                self._documents[path] = prompts.document_block(texts, count, truncated)
                if truncated:  # said before the answer: the question was sent with only the start of the file
                    chat = self._turn[0]
                    chat.insert(len(chat) - 1, {"role": "note", "text": f"문서가 {self.document_limit:,}자를 넘어 "
                                                f"앞부분(p.1–p.{len(texts)})만 보냈습니다."})
            excerpt = None
        else:
            excerpt = self._page_text(self._needs, request=True)
            if excerpt is None:
                return
        self._needs = None
        self._ask(excerpt)

    def _ask(self, excerpt):
        chat, user, answer = self._turn
        user["sent"] = prompts.user_turn(user["where"], excerpt, user["text"])
        system = prompts.SYSTEM
        document = self._documents.get(self._viewer.document.path)
        if document:
            system += "\n\n" + document
        worker = self._worker = LLMWorker(self.backend, system, self._history(chat))
        worker.setParent(self)  # Qt owns it, so it is deleted on this thread (deleteLater) and not by Python's GC
        worker.chunk.connect(lambda piece: self._on_chunk(worker, piece))
        worker.done.connect(lambda text, usage: self._finish(worker, text, usage))
        worker.failed.connect(lambda kind, message: self._on_failed(worker, kind, message))
        worker.start()

    @staticmethod
    def _history(chat):
        """The conversation as the API takes it: failed turns and notes left out, the last MAX_TURNS kept."""
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

    def _finish(self, worker, text, usage):
        """done, or cancel() (text None): keep what arrived. A cancelled worker's own late done is ignored."""
        if text is not None:  # the worker's last signal: nothing more will use it
            worker.deleteLater()
        if worker is not self._worker:
            return
        chat, _, answer = self._turn
        answer.pop("streaming")
        if usage:
            answer["usage"] = usage
        self._turn = self._worker = None
        self._save(chat)
        self.busy_changed.emit()
        self.changed.emit()

    def _on_failed(self, worker, kind, message):
        worker.deleteLater()
        if worker is self._worker:
            self._fail(kind, message)

    def _fail(self, kind, message):
        chat, user, answer = self._turn
        self._turn = self._worker = self._needs = None
        user["failed"] = answer["failed"] = True  # neither half of a failed turn is sent again
        answer.pop("streaming")
        if not answer["text"]:
            chat.remove(answer)
        chat.append({"role": "error", "kind": kind, "text": message})
        self.busy_changed.emit()
        self.changed.emit()

    def _on_text(self, *_):
        if self._turn and self._worker is None:
            self._try_ask()

    def _on_document(self):
        if self._turn and self._worker is None:  # set_document dropped the other file's text job
            self._fail("cancelled", "다른 문서로 바뀌어 질문을 보내지 않았습니다.")
        else:
            self.changed.emit()
