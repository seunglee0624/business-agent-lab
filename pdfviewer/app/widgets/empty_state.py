from pathlib import Path

from PySide6.QtCore import QRect, QSize, Qt, Signal
from PySide6.QtGui import QFont, QFontMetrics, QStandardItem, QStandardItemModel
from PySide6.QtWidgets import (QLabel, QListView, QPushButton, QSizePolicy, QStyle, QStyledItemDelegate, QToolTip,
                               QVBoxLayout, QWidget)

from app import theme
from app.core import settings
from app.icons import icon

PATH_ROLE = Qt.ItemDataRole.UserRole
FOLDER_ROLE = Qt.ItemDataRole.UserRole + 1
REMOVE_TIP = "목록에서 제거 (Delete)"


def close_area(row):
    """The x's click target at the right end of a row; the text stays out of it."""
    width = theme.token("size.control_sm")
    return QRect(row.right() - width + 1, row.top(), width, row.height())


class RecentDelegate(QStyledItemDelegate):
    """Two lines per row: the file name, and its folder below in small muted text.
    Plus an x on the row under the mouse or with the keyboard focus."""

    def __init__(self, parent):
        super().__init__(parent)
        self._close = icon("close")

    @staticmethod
    def _folder_font(option):
        font = QFont(option.font)
        font.setPixelSize(theme.token("font.caption_size"))
        font.setWeight(QFont.Weight(theme.token("font.caption_weight")))
        return font

    def sizeHint(self, option, index):
        pad = theme.token("spacing.md")
        height = option.fontMetrics.height() + QFontMetrics(self._folder_font(option)).height() + 2 * pad
        return QSize(1, height)  # width 1: rows take the view's width, so long names elide and the x stays in view

    def paint(self, painter, option, index):
        self.initStyleOption(option, index)
        option.text = ""  # the style draws the hover/selection background; the two lines are drawn here
        option.widget.style().drawControl(QStyle.ControlElement.CE_ItemViewItem, option, painter, option.widget)
        pad = theme.token("spacing.md")
        text = option.rect.adjusted(pad, pad, -theme.token("size.control_sm"), -pad)
        folder_font = self._folder_font(option)
        name_height = option.fontMetrics.height()
        painter.save()
        painter.setPen(theme.color("color.text"))
        painter.drawText(QRect(text.left(), text.top(), text.width(), name_height), Qt.AlignmentFlag.AlignLeft,
                         option.fontMetrics.elidedText(index.data(), Qt.TextElideMode.ElideMiddle, text.width()))
        painter.setFont(folder_font)
        painter.setPen(theme.color("color.text_muted"))
        painter.drawText(QRect(text.left(), text.top() + name_height, text.width(), text.height() - name_height),
                         Qt.AlignmentFlag.AlignLeft, QFontMetrics(folder_font).elidedText(
                             index.data(FOLDER_ROLE), Qt.TextElideMode.ElideMiddle, text.width()))
        painter.restore()
        if option.state & (QStyle.StateFlag.State_MouseOver | QStyle.StateFlag.State_HasFocus):
            size = theme.token("size.control_sm") // 2  # the icon is a button-sized square: half of it = a 10px glyph
            area = close_area(option.rect)
            self._close.paint(painter, QRect(area.center().x() - size // 2, area.center().y() - size // 2, size, size))

    def helpEvent(self, event, view, option, index):
        if close_area(option.rect).contains(event.pos()):
            QToolTip.showText(event.globalPos(), REMOVE_TIP, view)
            return True
        return super().helpEvent(event, view, option, index)  # elsewhere: the full path


class RecentList(QListView):
    """A click on a row's x (or Delete) asks to drop it; a click anywhere else on the row picks it."""

    remove_requested = Signal(str)

    def __init__(self):
        super().__init__()
        self._pressed_x = None
        self.setMouseTracking(True)
        self.setFocusPolicy(Qt.FocusPolicy.TabFocus)  # a click (x or row) shows no focus frame; Tab still reaches it for Delete
        self.viewport().setAttribute(Qt.WidgetAttribute.WA_Hover)  # the x shows on the row under the mouse
        self.setItemDelegate(RecentDelegate(self))

    def _x_under(self, event):
        index = self.indexAt(event.position().toPoint())
        if index.isValid() and close_area(self.visualRect(index)).contains(event.position().toPoint()):
            return index.data(PATH_ROLE)
        return None

    def mousePressEvent(self, event):
        self._pressed_x = self._x_under(event)
        if self._pressed_x is None:
            super().mousePressEvent(event)

    def mouseDoubleClickEvent(self, event):
        # a quick second click on an x lands on the row that moved up: it must not open that file
        self._pressed_x = self._x_under(event)
        if self._pressed_x is None:
            super().mouseDoubleClickEvent(event)

    def mouseReleaseEvent(self, event):
        pressed, self._pressed_x = self._pressed_x, None
        if pressed is None:
            super().mouseReleaseEvent(event)
        elif self._x_under(event) == pressed:  # released off the x: nothing, like a button
            self.remove_requested.emit(pressed)

    def keyPressEvent(self, event):
        if event.key() == Qt.Key.Key_Delete and self.currentIndex().isValid():
            self.remove_requested.emit(self.currentIndex().data(PATH_ROLE))
        else:
            super().keyPressEvent(event)


class EmptyState(QWidget):
    """Shown while no document is open: how to open one, and the recent files."""

    file_chosen = Signal(str)  # a recent file was picked

    def __init__(self, open_action):
        super().__init__()
        self.setObjectName("emptyState")
        self.setAttribute(Qt.WidgetAttribute.WA_StyledBackground)  # a plain QWidget ignores a QSS background otherwise
        title = QLabel("PDF를 열어보세요", objectName="emptyTitle")
        self._open_button = button = QPushButton("파일 열기", objectName="primary")
        button.clicked.connect(open_action.trigger)
        self.setFocusProxy(button)  # the screen's one action gets the first key press
        self._model = QStandardItemModel(self)
        self._list = RecentList()
        self._list.setModel(self._model)
        self._list.setEditTriggers(QListView.EditTrigger.NoEditTriggers)
        self._list.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        # as tall as its rows: the frame hugs the files (QSS max-height caps it, then it scrolls)
        self._list.setSizeAdjustPolicy(QListView.SizeAdjustPolicy.AdjustToContents)
        self._list.setSizePolicy(QSizePolicy.Policy.Preferred, QSizePolicy.Policy.Fixed)
        self._list.activated.connect(lambda index: self.file_chosen.emit(index.data(PATH_ROLE)))
        self._list.clicked.connect(lambda index: self.file_chosen.emit(index.data(PATH_ROLE)))
        self._list.remove_requested.connect(self._remove)

        self._recent = QWidget()  # heading + list: the heading lines up with the file names, not the screen centre
        heading = QLabel("최근 문서", objectName="heading")
        heading.setContentsMargins(self._list.frameWidth() + theme.token("spacing.md"), 0, 0, 0)
        column = QVBoxLayout(self._recent)
        column.setContentsMargins(0, 0, 0, 0)
        column.addWidget(heading)
        column.addWidget(self._list)

        layout = QVBoxLayout(self)
        layout.addStretch()
        for widget in (title, button, self._recent):
            layout.addWidget(widget, 0, Qt.AlignmentFlag.AlignHCenter)
        layout.addStretch()
        self.reload()

    def reload(self):
        self._model.clear()
        for path in settings.recent_files():
            item = QStandardItem(Path(path).name)
            item.setData(path, PATH_ROLE)
            item.setData(str(Path(path).parent), FOLDER_ROLE)
            item.setData(f"{Path(path).name}, {Path(path).parent}", Qt.ItemDataRole.AccessibleTextRole)
            item.setToolTip(path)
            self._model.appendRow(item)
        self._recent.setVisible(self._model.rowCount() > 0)

    def _remove(self, path):
        row = self._list.currentIndex().row()
        settings.remove_recent(path)
        self.reload()
        if self._model.rowCount():  # Delete again removes the next one
            self._list.setCurrentIndex(self._model.index(min(max(row, 0), self._model.rowCount() - 1), 0))
        else:
            self._open_button.setFocus()  # the list is gone: don't leave the focus nowhere

    def showEvent(self, event):
        super().showEvent(event)
        self.reload()  # a file opened since last time is now at the top
