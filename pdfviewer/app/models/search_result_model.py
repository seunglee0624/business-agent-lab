from PySide6.QtCore import QAbstractListModel, QModelIndex, Qt


class SearchResultModel(QAbstractListModel):
    """One row per search result: page number and the text around the match. Rows are appended as
    the search goes on, so the list keeps its scroll position."""

    def __init__(self, state, parent=None):
        super().__init__(parent)
        self._state = state
        self._rows = 0  # rows announced to the view so far
        state.search_changed.connect(self._update)

    def rowCount(self, parent=QModelIndex()):
        return 0 if parent.isValid() else self._rows

    def data(self, index, role=Qt.ItemDataRole.DisplayRole):
        if role == Qt.ItemDataRole.DisplayRole and index.isValid():
            page, _, context = self._state.search_results[index.row()]
            return f"{page + 1}쪽   {context}"
        return None

    def _update(self):
        count = len(self._state.search_results)
        if count < self._rows or not count:  # a new search
            self.beginResetModel()
            self._rows = count
            self.endResetModel()
        elif count > self._rows:
            self.beginInsertRows(QModelIndex(), self._rows, count - 1)
            self._rows = count
            self.endInsertRows()
