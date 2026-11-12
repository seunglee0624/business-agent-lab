from functools import lru_cache

from PySide6.QtCore import QAbstractListModel, QModelIndex, Qt
from PySide6.QtGui import QTextDocument

from app.core import settings

FILTERS = {"highlights": "하이라이트", "notes": "메모", "bookmarks": "북마크"}
KIND_ROLE = Qt.ItemDataRole.UserRole + 1  # "highlights" | "notes" | "bookmarks"
ITEM_ROLE = Qt.ItemDataRole.UserRole + 2  # the stored dict


def label(kind, item):
    """What a row is called: a saved AI answer is a note too, marked as the AI's."""
    return "AI 메모" if kind == "notes" and item.get("source") == "ai" else FILTERS[kind]


def text(kind, item):
    """A row's words: a saved AI answer without its markdown marks ("**", "```", "|")."""
    if kind == "bookmarks":
        return item.get("label", "")
    return _plain(item["text"]) if item.get("source") == "ai" else item.get("text", "")


@lru_cache(maxsize=512)  # the list repaints often; an answer's text never changes
def _plain(markdown):
    document = QTextDocument()
    document.setMarkdown(markdown)
    return document.toPlainText()


class NotesModel(QAbstractListModel):
    """The current document's highlights, page notes or bookmarks (one kind at a time) in page order.
    Reloaded from AnnotationState on every change (a few hundred rows at most)."""

    def __init__(self, notes, parent=None):
        super().__init__(parent)
        self._notes = notes
        self.filter = settings.notes_filter() if settings.notes_filter() in FILTERS else "highlights"
        self._rows = []
        notes.changed.connect(self._reload)
        self._reload()

    def set_filter(self, kind):
        self.filter = kind
        settings.save_notes_filter(kind)
        self._reload()

    def _reload(self):
        store = self._notes.store
        rows = [(self.filter, item) for item in (store.items(self.filter) if store else [])]
        self.beginResetModel()
        self._rows = sorted(rows, key=lambda row: row[1]["page"])  # stable: the order made on one page stays
        self.endResetModel()

    def rowCount(self, parent=QModelIndex()):
        return 0 if parent.isValid() else len(self._rows)

    def data(self, index, role=Qt.ItemDataRole.DisplayRole):
        if not index.isValid():
            return None
        kind, item = self._rows[index.row()]
        if role == KIND_ROLE:
            return kind
        if role == ITEM_ROLE:
            return item
        if role == Qt.ItemDataRole.DisplayRole:  # also what a screen reader says
            return f"{item['page'] + 1}쪽 {label(kind, item)}: {text(kind, item)}"
        return None
