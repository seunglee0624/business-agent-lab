from PySide6.QtCore import Qt
from PySide6.QtGui import QStandardItem, QStandardItemModel

PAGE_ROLE = Qt.ItemDataRole.UserRole  # 1-based target page, -1 when the entry has none


class OutlineModel(QStandardItemModel):
    """Tree of the document's table of contents, rebuilt when the Renderer has loaded it."""

    def __init__(self, state, parent=None):
        super().__init__(parent)
        self._state = state
        state.document_changed.connect(self._load)
        state.renderer.outline_ready.connect(self._load)

    def _load(self):
        self.clear()
        parents = [self.invisibleRootItem()]  # parents[n] holds the entries of level n + 1
        for level, title, page in self._state.renderer.outline or []:
            item = QStandardItem(title)
            item.setEditable(False)
            item.setData(page, PAGE_ROLE)
            del parents[level:]
            parents[-1].appendRow(item)
            parents.append(item)
