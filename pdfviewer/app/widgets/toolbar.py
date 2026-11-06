from PySide6.QtCore import QSignalBlocker
from PySide6.QtWidgets import QComboBox, QLabel, QSpinBox, QToolBar

from app.viewer_state import VIEW_MODES

PRESETS = {"50%": 0.5, "75%": 0.75, "100%": 1.0, "125%": 1.25, "150%": 1.5, "200%": 2.0}
FITS = {"폭 맞춤": "fit_width", "페이지 맞춤": "fit_page"}


class Toolbar(QToolBar):
    """Top toolbar. Buttons are the window's shared actions; the page box and zoom box
    call ViewerState and show values from its signals."""

    def __init__(self, state, actions):
        super().__init__("도구 모음")
        self.setObjectName("toolbar")
        self.setMovable(False)
        self._state = state

        self.addAction(actions["open"])
        self.addSeparator()
        self.addAction(actions["prev"])
        self._page = QSpinBox()
        self._page.setAccessibleName("페이지 번호")
        self._page.setKeyboardTracking(False)  # go only on Enter / focus out, not per digit
        self._page.valueChanged.connect(lambda value: state.go_to(value - 1))
        self.addWidget(self._page)
        self._total = QLabel(objectName="pageTotal")
        self.addWidget(self._total)
        self.addAction(actions["next"])
        self.addSeparator()
        self.addAction(actions["zoom_out"])
        self._zoom = QComboBox()
        self._zoom.setEditable(True)
        self._zoom.setInsertPolicy(QComboBox.InsertPolicy.NoInsert)
        self._zoom.addItems([*PRESETS, *FITS])
        self._zoom.textActivated.connect(self._on_zoom_text)  # picked from the list
        # typed + Enter: with NoInsert, textActivated only fires for text matching a list item
        self._zoom.lineEdit().returnPressed.connect(lambda: self._on_zoom_text(self._zoom.currentText()))
        self.addWidget(self._zoom)
        self.addAction(actions["zoom_in"])
        for group in (VIEW_MODES, ("rotate_left", "rotate_right"), ("select_tool", "hand_tool")):
            self.addSeparator()
            for name in group:
                self.addAction(actions[name])

        state.document_changed.connect(self._refresh)
        state.page_changed.connect(self._refresh)
        state.zoom_changed.connect(self._show_zoom)
        self._refresh()

    def _on_zoom_text(self, text):
        if text in FITS:
            getattr(self._state, FITS[text])()
            self._show_zoom()
            return
        try:
            self._state.set_zoom(float(text.strip().rstrip("%")) / 100)
        except ValueError:
            pass
        self._show_zoom()  # also restores the box after invalid input

    def _refresh(self):
        count = self._state.page_count
        with QSignalBlocker(self._page):
            self._page.setRange(min(1, count), count)
            self._page.setValue(self._state.current_page + 1 if count else 0)
        self._page.setEnabled(count > 0)
        self._zoom.setEnabled(count > 0)
        self._total.setText(f"/ {count}")
        self._show_zoom()

    def _show_zoom(self):
        fit = next((label for label, mode in FITS.items() if mode == self._state.zoom_mode), None)
        self._zoom.setEditText(fit or f"{round(self._state.zoom * 100)}%")
