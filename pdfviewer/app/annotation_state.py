import logging
import os
import threading
from pathlib import Path

from PySide6.QtCore import QObject, QStandardPaths, QTimer, Signal
from PySide6.QtGui import QUndoCommand, QUndoGroup, QUndoStack

from app.core import settings
from app.core.annotations.export import to_markdown
from app.core.annotations.store import AnnotationStore, doc_id, new_id, now

COLORS = {"yellow": "노랑", "green": "초록", "blue": "파랑", "pink": "분홍"}
SAVE_MS = 500  # changes are written this long after the last one
log = logging.getLogger(__name__)


class _Hasher(QObject):
    """Content id of a file on a daemon thread: hashing a large PDF must not freeze the window."""

    done = Signal(str, str)  # path, id ("" when the file could not be read)

    def start(self, path):
        threading.Thread(target=self._run, args=(path,), daemon=True).start()

    def _run(self, path):
        try:
            self.done.emit(path, doc_id(path))
        except OSError:
            log.warning("cannot hash %s", path, exc_info=True)
            self.done.emit(path, "")


class _Command(QUndoCommand):
    def __init__(self, text, do, undo):
        super().__init__(text)
        self._do, self._undo = do, undo

    def redo(self):
        self._do()

    def undo(self):
        self._undo()


LABEL_CHARS = 60  # a bookmark name: the start of its page's first line
SAVE_STATES = {"": "", "pending": "저장 중…", "saved": "저장됨", "failed": "저장 실패"}


class AnnotationState(QObject):
    """Sole owner of the notes of every open document: highlights, page notes (the user's, one per page, and saved
    AI answers), bookmarks, the document note and the saved AI conversation. Each document's notes live in core/annotations/store.py, found by content id.
    Every change but the document note (typed in its own box, with that box's undo) can be undone."""

    changed = Signal()  # any highlight, page note, bookmark or the document note; also a document switch
    active_changed = Signal()  # the highlight clicked on the page
    editing_changed = Signal()  # a comment or page note box opened or closed
    save_state_changed = Signal()
    problem = Signal(str)  # a notes file that could not be read or saved: for the status bar

    def __init__(self, viewer, folder=None):
        super().__init__()
        self._viewer = viewer
        location = QStandardPaths.writableLocation(QStandardPaths.StandardLocation.AppDataLocation)
        self._folder = Path(folder or location) / "notes"
        self._ids = {}  # file path -> content id
        self._stores = {}  # content id -> AnnotationStore (two copies of one PDF share theirs)
        self._stacks = {}  # content id -> QUndoStack
        self.undo_group = QUndoGroup(self)  # the current document's stack: for the undo/redo actions
        self.active = None  # id of the clicked highlight
        self.editing = None  # id of the highlight whose comment is being written (always the active one)
        self.editing_note = None  # page whose note is being written
        self.draft = ""  # the comment or note being written
        self._editing_doc = None  # content id of its document: a tab switch saves the draft there
        self.save_state = ""  # a key of SAVE_STATES
        self.color = settings.highlight_color() if settings.highlight_color() in COLORS else "yellow"
        self._hasher = _Hasher()
        self._hasher.done.connect(self._on_hashed)
        self._save_timer = QTimer(self, singleShot=True, interval=SAVE_MS, timeout=self.flush)
        viewer.document_changed.connect(self._on_document)
        viewer.tabs_changed.connect(self._release)
        self._on_document()

    def _current_id(self):
        doc = self._viewer.document
        return self._ids.get(doc.path) if doc else None

    @property
    def store(self):
        """The current document's notes; None while its id is still being computed."""
        return self._stores.get(self._current_id())

    def highlights(self):
        return self.store.items("highlights") if self.store else []

    def highlight(self, highlight_id):
        return self.store.find("highlights", highlight_id) if self.store and highlight_id else None

    def page_note(self, page):
        """The page's own note (one per page; AI answers saved as notes come later as separate items)."""
        return next((n for n in self.store.items("notes") if n["page"] == page and n["source"] == "user"), None) \
            if self.store else None

    def is_bookmarked(self, page):
        return self.store is not None and any(b["page"] == page for b in self.store.items("bookmarks"))

    def marked_pages(self):
        """(pages with a bookmark, pages with the user's note): what the page view draws ribbons for."""
        if self.store is None:
            return set(), set()
        return ({b["page"] for b in self.store.items("bookmarks")},
                {n["page"] for n in self.store.items("notes") if n["source"] == "user"})

    def go_to_bookmark(self, step):
        """The next (1) or previous (-1) bookmarked page after the current one, wrapping around."""
        pages = sorted(self.marked_pages()[0])
        if not pages:
            return
        here = self._viewer.current_page
        after = [p for p in pages if p > here] if step > 0 else [p for p in reversed(pages) if p < here]
        self._viewer.go_to(after[0] if after else pages[0 if step > 0 else -1])

    def doc_note(self):
        return self.store.data["doc_note"] if self.store else ""

    def has_note(self, note_id):
        return self.store is not None and self.store.find("notes", note_id) is not None

    def saved_chat(self):
        """The current document's saved AI conversation (copies: the chat owns its live messages)."""
        return [dict(message) for message in self.store.data["chat"]] if self.store else []

    def export_markdown(self):
        """The current document's notes as Markdown ("" while they are still loading)."""
        return to_markdown(self.store.data) if self.store else ""

    @property
    def is_editing(self):
        return self.editing is not None or self.editing_note is not None

    def highlight_at(self, page, x, y):
        """The highlight under a point in page.rect coordinates; the newest when they overlap."""
        for item in reversed(self.highlights()):
            if item["page"] == page and any(x0 <= x <= x1 and y0 <= y <= y1 for x0, y0, x1, y1 in item["quads"]):
                return item["id"]
        return None

    # ---- changes (each one undoable)

    def highlight_selection(self, color=None):
        """Highlight the selected words; returns the new highlight's id (None without a selection)."""
        viewer, store = self._viewer, self.store
        info = viewer.renderer.info(viewer.selection[0]) if viewer.selection else None
        if store is None or not info:
            return None
        if color and color != self.color:
            self.color = color
            settings.save_highlight_color(color)
        page, first, last = viewer.selection
        item = {"id": new_id(), "page": page, "words": [first, last], "quads": _line_boxes(info[0][first:last + 1]),
                "text": viewer.selected_text(), "color": self.color, "comment": "", "created": now(), "updated": now()}
        self._add("highlights", item, "하이라이트")
        viewer.clear_selection()
        return item["id"]

    def set_highlight_color(self, highlight_id, color):
        self._update("highlights", highlight_id, {"color": color}, "하이라이트 색 바꾸기")
        self.color = color
        settings.save_highlight_color(color)

    def set_highlight_comment(self, highlight_id, comment):
        self._update("highlights", highlight_id, {"comment": comment.strip()}, "코멘트 바꾸기")

    def remove_highlight(self, highlight_id):
        self._remove("highlights", highlight_id, "하이라이트 지우기")

    def set_page_note(self, page, text, content_id=None):
        """Empty text deletes the note. content_id: another document than the current one (see _update)."""
        content_id = content_id or self._current_id()
        store, text = self._stores.get(content_id), text.strip()
        if store is None:
            return
        note = next((n for n in store.items("notes") if n["page"] == page and n["source"] == "user"), None)
        if note and text:
            self._update("notes", note["id"], {"text": text}, "메모 바꾸기", content_id)
        elif note:
            self._remove("notes", note["id"], "메모 지우기", content_id)
        elif text:
            self._add("notes", {"id": new_id(), "page": page, "text": text, "source": "user",
                                "created": now(), "updated": now()}, "메모", content_id)

    def toggle_bookmark(self, page=None):
        """The current page by default."""
        if self.store is None or self._viewer.document is None:
            return
        page = self._viewer.current_page if page is None else page
        mark = next((b for b in self.store.items("bookmarks") if b["page"] == page), None)
        if mark:
            self._remove("bookmarks", mark["id"], "북마크 지우기")
        else:
            self._add("bookmarks", {"id": new_id(), "page": page, "label": self._first_line(page), "created": now()},
                      "북마크")

    def _first_line(self, page):
        """The page's first text line, as the bookmark's name in the notes list ("" if not read yet)."""
        info = self._viewer.renderer.info(page)
        words = info[0] if info else []
        line = [w[4] for w in words if words and w[5:7] == words[0][5:7]]  # same (block, line) as the first word
        return " ".join(line)[:LABEL_CHARS]

    def add_ai_note(self, page, text, question):
        """An AI answer kept as a note of the page it was asked on; returns its id."""
        item = {"id": new_id(), "page": page, "text": text.strip(), "source": "ai", "question": question,
                "created": now(), "updated": now()}
        self._add("notes", item, "AI 답변 메모")
        return item["id"]

    def remove_note(self, note_id):
        self._remove("notes", note_id, "메모 지우기")

    def save_chat(self, path, messages):
        """Keep a file's AI conversation in its notes (no undo step: the chat has its own clear)."""
        store = self._stores.get(self._ids.get(path))
        if store is not None and messages != store.data["chat"]:
            store.set("chat", messages)
            self._changed(emit=False)

    def set_doc_note(self, text):
        """Kept as typed (no undo step per key: its box has its own undo)."""
        if self.store is not None and text != self.store.data["doc_note"]:
            self.store.set("doc_note", text)
            self._changed(emit=False)  # only its own box shows it: no list reload per key

    def _add(self, kind, item, text, content_id=None):
        content_id = content_id or self._current_id()
        store = self._stores.get(content_id)
        if store is not None:
            self._push(text, lambda: store.add(kind, item), lambda: store.remove(kind, item["id"]),
                       self._stacks[content_id])

    def _remove(self, kind, item_id, text, content_id=None):
        content_id = content_id or self._current_id()
        store = self._stores.get(content_id)
        item = store.find(kind, item_id) if store else None
        if item is None:
            return
        index = store.items(kind).index(item)  # undo puts it back in place, so overlaps stack as before
        self._push(text, lambda: store.remove(kind, item_id), lambda: store.add(kind, item, index),
                   self._stacks[content_id])

    def _update(self, kind, item_id, fields, text, content_id=None):
        """content_id: another document than the current one (a draft saved on a tab switch)."""
        content_id = content_id or self._current_id()
        store = self._stores.get(content_id)
        item = store.find(kind, item_id) if store else None
        if item is None or all(item[key] == value for key, value in fields.items()):
            return
        old = {key: item[key] for key in [*fields, "updated"]}  # undo brings back the old time too
        self._push(text, lambda: store.update(kind, item_id, fields),
                   lambda: store.update(kind, item_id, old), self._stacks[content_id])

    def _push(self, text, do, undo, stack):
        """Run a change through a document's undo stack; the screen and the save follow after each step."""
        def step(action):
            action()
            if self.editing and self.highlight(self.editing) is None:  # e.g. undoing its creation from the menu
                self.stop_editing()
            if self.active and self.highlight(self.active) is None:
                self.set_active(None)
            self._changed()
        stack.push(_Command(text, lambda: step(do), lambda: step(undo)))

    def _changed(self, emit=True):
        self._save_timer.start()
        self._set_save_state("pending")
        if emit:
            self.changed.emit()

    def _set_save_state(self, state):
        if state != self.save_state:
            self.save_state = state
            self.save_state_changed.emit()

    # ---- selection on the page, the comment or note being written, saving

    def set_active(self, highlight_id):
        """Ignored while a box is open: clicks elsewhere must not move it to another highlight."""
        if highlight_id != self.active and not self.is_editing:
            self.active = highlight_id
            self.active_changed.emit()

    def start_editing(self, highlight_id):
        """The comment box of a highlight."""
        item = self.highlight(highlight_id)
        if item is None:
            return
        self.stop_editing(save=True)
        self.set_active(highlight_id)
        self.editing, self.draft, self._editing_doc = highlight_id, item["comment"], self._current_id()
        self.editing_changed.emit()

    def start_note(self, page=None):
        """The note box of a page (the current one by default); saving it empty deletes the note."""
        if self.store is None or self._viewer.document is None:
            return
        page = self._viewer.current_page if page is None else page
        self.stop_editing(save=True)
        self.set_active(None)
        note = self.page_note(page)
        self.editing_note, self.draft, self._editing_doc = page, note["text"] if note else "", self._current_id()
        self.editing_changed.emit()

    def set_draft(self, text):
        self.draft = text

    def stop_editing(self, save=False):
        """Close the comment or note box; save=True keeps what was written."""
        if not self.is_editing:
            return
        highlight_id, page, content_id = self.editing, self.editing_note, self._editing_doc
        self.editing = self.editing_note = self._editing_doc = None
        if save and highlight_id:
            self._update("highlights", highlight_id, {"comment": self.draft.strip()}, "코멘트 바꾸기", content_id)
        elif save:
            self.set_page_note(page, self.draft, content_id)
        self.editing_changed.emit()

    def select_highlight(self, highlight_id):
        """Its words become the text selection, e.g. to ask the AI about them."""
        item = self.highlight(highlight_id)
        if item:
            self._viewer.select(item["page"], *item["words"])

    def flush(self):
        """Write every changed document now (also on quit). A failure keeps the changes for the next try."""
        self._save_timer.stop()
        failed = False
        for store in self._stores.values():
            try:
                store.save()
            except OSError as error:
                failed = True
                log.warning("cannot save %s", store.path, exc_info=True)
                self.problem.emit(f"메모를 저장하지 못했습니다 ({error}). 다음 변경 때 다시 시도합니다.")
        if self.save_state:  # nothing changed yet this session: nothing to report
            self._set_save_state("failed" if failed else "saved")

    # ---- documents

    def _on_document(self):
        self.stop_editing(save=True)  # into the document it was written for
        self.set_active(None)
        self._release()
        doc = self._viewer.document
        self.undo_group.setActiveStack(None)
        if doc:
            # the cache is keyed by size and modified time: a file changed on disk is hashed again
            self._ids.pop(doc.path, None)
            try:
                stat = os.stat(doc.path)
                cached = settings.cached_doc_id(doc.path, stat.st_size, stat.st_mtime_ns)
            except OSError:
                cached = None
            if cached:
                self._on_hashed(doc.path, cached)
                return
            self._hasher.start(doc.path)
        self.changed.emit()

    def _release(self):
        """Save and drop the notes of closed tabs (kept when the save fails, for flush to retry)."""
        open_paths = {tab.document.path for tab in self._viewer.tabs}
        for path in [path for path in self._ids if path not in open_paths]:
            del self._ids[path]
        for content_id in [c for c in self._stores if c not in self._ids.values() and c != self._editing_doc]:
            try:
                self._stores[content_id].save()
            except OSError as error:
                log.warning("cannot save %s", self._stores[content_id].path, exc_info=True)
                self.problem.emit(f"메모를 저장하지 못했습니다 ({error}). 다음 변경 때 다시 시도합니다.")
                continue
            del self._stores[content_id]
            stack = self._stacks.pop(content_id)
            self.undo_group.removeStack(stack)
            stack.setParent(None)  # freed now, with its commands: deleteLater crashed the test run

    def _on_hashed(self, path, content_id):
        if not content_id:
            self.problem.emit("PDF 파일을 읽지 못해 이 문서의 하이라이트를 쓸 수 없습니다. 다시 열면 다시 시도합니다.")
            return
        if path not in {tab.document.path for tab in self._viewer.tabs}:
            return  # closed while it was hashed
        if content_id not in self._stores:
            store = AnnotationStore(self._folder, content_id, path, Path(path).stem)
            self._stores[content_id], self._stacks[content_id] = store, QUndoStack(self.undo_group)
            if store.problem:
                self.problem.emit(store.problem)
        self._ids[path] = content_id  # only once its store exists
        try:
            stat = os.stat(path)
            settings.save_doc_id(path, stat.st_size, stat.st_mtime_ns, content_id)
        except OSError:
            pass
        doc = self._viewer.document
        if doc and doc.path == path:
            self.undo_group.setActiveStack(self._stacks[content_id])
            self.changed.emit()


def _line_boxes(words):
    """One box per text line of the selected words, in page.rect coordinates."""
    boxes = {}
    for x0, y0, x1, y1, _, block, line in words:
        box = boxes.setdefault((block, line), [x0, y0, x1, y1])
        box[:] = min(box[0], x0), min(box[1], y0), max(box[2], x1), max(box[3], y1)
    return [[round(v, 2) for v in box] for box in boxes.values()]
