from pathlib import Path

from PySide6.QtCore import Qt, Signal
from PySide6.QtGui import QStandardItem, QStandardItemModel
from PySide6.QtWidgets import QLabel, QListView, QPushButton, QVBoxLayout, QWidget

from app.core import settings

PATH_ROLE = Qt.ItemDataRole.UserRole


class EmptyState(QWidget):
    """Shown while no document is open: how to open one, and the recent files."""

    file_chosen = Signal(str)  # a recent file was picked

    def __init__(self, open_action):
        super().__init__()
        self.setObjectName("emptyState")
        self.setAttribute(Qt.WidgetAttribute.WA_StyledBackground)  # a plain QWidget ignores a QSS background otherwise
        title = QLabel("PDF를 열어보세요", objectName="emptyTitle")
        button = QPushButton("파일 열기", objectName="primary")
        button.clicked.connect(open_action.trigger)
        self.setFocusProxy(button)  # the screen's one action gets the first key press
        self._recent_title = QLabel("최근 문서", objectName="heading")
        self._model = QStandardItemModel(self)
        self._list = QListView()
        self._list.setModel(self._model)
        self._list.setEditTriggers(QListView.EditTrigger.NoEditTriggers)
        self._list.setTextElideMode(Qt.TextElideMode.ElideMiddle)  # long folders: the full path is the tooltip
        self._list.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        self._list.activated.connect(lambda index: self.file_chosen.emit(index.data(PATH_ROLE)))
        self._list.clicked.connect(lambda index: self.file_chosen.emit(index.data(PATH_ROLE)))

        layout = QVBoxLayout(self)
        layout.addStretch()
        for widget in (title, button, self._recent_title, self._list):
            layout.addWidget(widget, 0, Qt.AlignmentFlag.AlignHCenter)
        layout.addStretch()
        self.reload()

    def reload(self):
        self._model.clear()
        for path in settings.recent_files():
            item = QStandardItem(f"{Path(path).name}    {Path(path).parent}")
            item.setData(path, PATH_ROLE)
            item.setToolTip(path)
            self._model.appendRow(item)
        shown = self._model.rowCount() > 0
        self._recent_title.setVisible(shown)
        self._list.setVisible(shown)

    def showEvent(self, event):
        super().showEvent(event)
        self.reload()  # a file opened since last time is now at the top
