from pathlib import Path

from PySide6.QtCore import QSignalBlocker, QSize, Qt
from PySide6.QtGui import QKeySequence
from PySide6.QtWidgets import QTabBar, QToolButton

from app import shortcuts, theme
from app.icons import icon


class TabBar(QTabBar):
    """One tab per open file. Clicks, closes and drags call ViewerState; the tabs come from its signals."""

    def __init__(self, state):
        super().__init__()
        self.setObjectName("tabBar")
        self._state = state
        self.setTabsClosable(True)
        self.setMovable(True)
        self.setExpanding(False)
        self.setDocumentMode(True)
        self.setElideMode(Qt.TextElideMode.ElideMiddle)
        self.currentChanged.connect(lambda index: index >= 0 and state.switch_tab(index))
        self.tabCloseRequested.connect(state.close_tab)
        self.tabMoved.connect(state.move_tab)
        state.tabs_changed.connect(self._sync)
        self._sync()

    def _sync(self):
        paths = [tab.document.path for tab in self._state.tabs]
        with QSignalBlocker(self):
            # a drag already moved the tabs here: rebuilding mid-drag would drop the tab being dragged
            if [self.tabData(i) for i in range(self.count())] != paths:
                while self.count():
                    self.removeTab(0)
                for path in paths:
                    i = self.addTab(Path(path).name)
                    self.setTabData(i, path)
                    self.setTabToolTip(i, path)
                    self.setTabButton(i, QTabBar.ButtonPosition.RightSide, self._close_button(Path(path).name))
            if self._state.tab_index is not None:
                self.setCurrentIndex(self._state.tab_index)
        self.setVisible(bool(paths))

    def _close_button(self, name):
        """A themed x in place of the style's own close button; it still goes through tabCloseRequested."""
        button = QToolButton(objectName="tabClose", toolTip=self._close_tip(), autoRaise=True)
        button.setAccessibleName(f"탭 닫기: {name}")
        button.setFocusPolicy(Qt.FocusPolicy.NoFocus)  # Ctrl+W closes from the keyboard; an extra Tab stop per tab is noise
        button.setIcon(icon("close"))
        size = theme.token("size.control_sm") // 2
        button.setIconSize(QSize(size, size))  # the icon is a button-sized square: half of it = a 10px glyph
        button.clicked.connect(lambda: self.tabCloseRequested.emit(next(
            i for i in range(self.count()) if self.tabButton(i, QTabBar.ButtonPosition.RightSide) is button)))
        return button

    @staticmethod
    def _close_tip():
        keys = shortcuts.keys("close_tab")
        return f"탭 닫기 ({QKeySequence(keys[0]).toString(QKeySequence.SequenceFormat.NativeText)})" if keys else "탭 닫기"

    def update_key_tips(self):
        """The close key changed in the shortcut list."""
        for i in range(self.count()):
            self.tabButton(i, QTabBar.ButtonPosition.RightSide).setToolTip(self._close_tip())

    def mouseReleaseEvent(self, event):
        index = self.tabAt(event.position().toPoint())
        if event.button() == Qt.MouseButton.MiddleButton and index >= 0:
            self._state.close_tab(index)
            return
        super().mouseReleaseEvent(event)
