from PySide6.QtCore import QAbstractListModel, QModelIndex, Qt

from app import theme


class ThumbnailModel(QAbstractListModel):
    """One row per page (row = page index). Images come from the shared Renderer cache; the list view
    asks for the renders of the rows it shows."""

    def __init__(self, state, parent=None):
        super().__init__(parent)
        self._state = state
        state.document_changed.connect(self._reset)
        state.layout_changed.connect(self._reset)  # rotation changes every thumbnail
        state.renderer.page_ready.connect(self._on_ready)

    def rowCount(self, parent=QModelIndex()):
        return 0 if parent.isValid() else self._state.page_count

    def data(self, index, role=Qt.ItemDataRole.DisplayRole):
        if role == Qt.ItemDataRole.DisplayRole and index.isValid():
            return str(index.row() + 1)
        return None

    def zoom(self, row):
        """Logical zoom that fits the page in the square thumbnail box."""
        return theme.token("size.thumbnail") / max(self._state.page_size(row))

    def size(self, row):
        w, h = self._state.page_size(row)
        return w * self.zoom(row), h * self.zoom(row)

    def render_key(self, row, dpr):
        return row, self.zoom(row) * dpr, self._state.rotation

    def image(self, row, dpr):
        return self._state.renderer.get(*self.render_key(row, dpr))

    def _reset(self):
        self.beginResetModel()
        self.endResetModel()

    def _on_ready(self, index, zoom, rotation):
        if index < self.rowCount():
            self.dataChanged.emit(self.index(index), self.index(index))
