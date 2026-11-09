from PySide6.QtCore import QEvent, QSignalBlocker, Qt
from PySide6.QtWidgets import QComboBox, QLabel, QSpinBox, QToolBar, QWidget

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
        self._page.setToolTip("페이지 번호 (입력 후 Enter)")
        self._page.setKeyboardTracking(False)  # go only on Enter / focus out, not per digit
        self._page.valueChanged.connect(lambda value: state.go_to(value - 1))
        self.addWidget(self._page)
        self._total = QLabel(objectName="pageTotal", toolTip="전체 페이지 수")
        self.addWidget(self._total)
        self.addAction(actions["next"])
        self.addSeparator()
        self._lead = QWidget()  # widens so the zoom group starts over the document (align_zoom)
        self._lead_action = self.addWidget(self._lead)
        self._lead_action.setVisible(False)
        self._zoom_out = actions["zoom_out"]
        self.addAction(self._zoom_out)
        self._zoom = QComboBox()
        # editable only so it can show any zoom (e.g. 137%); the text is read-only and a click opens the list
        self._zoom.setEditable(True)
        self._zoom.lineEdit().setReadOnly(True)
        self._zoom.lineEdit().installEventFilter(self)
        self._zoom.lineEdit().setCursor(Qt.CursorShape.ArrowCursor)  # no text cursor: nothing to type
        self._zoom.setAccessibleName("확대 비율")
        self._zoom.setToolTip("확대 비율 (목록에서 고르기)")
        self._zoom.addItems([*PRESETS, *FITS])
        self._zoom.textActivated.connect(self._on_zoom_text)  # picked from the list
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

    def align_zoom(self, x):
        """Start the zoom group at x (toolbar coordinates); never closer than its usual place after the page group."""
        button, gap = self.widgetForAction(self._zoom_out), self.layout().spacing()
        # the lead's left is where the button goes without it; read it, not button minus lead, because two calls
        # in a row (before the toolbar re-lays out) would otherwise count the lead twice
        natural = self._lead.x() if self._lead_action.isVisible() else button.x()
        width = x - natural - gap  # the lead brings its own gap before the button
        self._lead.setFixedWidth(max(width, 0))
        self._lead_action.setVisible(width > 0)

    def eventFilter(self, watched, event):
        if watched is self._zoom.lineEdit() and event.type() == QEvent.Type.MouseButtonPress:
            self._zoom.showPopup()
            return True
        return super().eventFilter(watched, event)

    def _on_zoom_text(self, text):
        if text in FITS:
            getattr(self._state, FITS[text])()
            self._show_zoom()
            return
        self._state.set_zoom(PRESETS[text])
        self._show_zoom()

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
