from pathlib import Path

from PySide6.QtCore import QSettings, Qt
from PySide6.QtGui import QAction, QActionGroup, QKeySequence
from PySide6.QtWidgets import QDockWidget, QFileDialog, QMainWindow, QMessageBox, QWidget

from app import shortcuts, theme
from app.core.document import Document
from app.dialogs.password_dialog import ask_password
from app.viewer_state import VIEW_MODES, ViewerState
from app.widgets.page_view import PageView
from app.widgets.sidebar import Sidebar
from app.widgets.toolbar import Toolbar

APP_NAME = "PDF Viewer"

MENUS = {  # None = separator
    "파일(&F)": ["open", None, "quit"],
    "편집(&E)": ["copy"],
    "보기(&V)": ["prev", "next", None, "zoom_in", "zoom_out", "fit_width", "fit_page", None,
               "single", "continuous", "spread", "cover_alone", None, "rotate_left", "rotate_right", None,
               "select_tool", "hand_tool", None, "toggle_sidebar", "toggle_fullscreen", "toggle_presentation"],
}


class MainWindow(QMainWindow):
    """Assembles the widgets, owns the shared actions and wires everything to one ViewerState."""

    def __init__(self):
        super().__init__()
        self.state = ViewerState()
        self.setWindowTitle(APP_NAME)
        self._was_maximized = False
        self._actions = self._make_actions()

        for title, names in MENUS.items():
            menu = self.menuBar().addMenu(title)
            for name in names:
                menu.addAction(self._actions[name]) if name else menu.addSeparator()
        help_menu = self.menuBar().addMenu("도움말(&H)")
        help_menu.addAction("정보", lambda: QMessageBox.about(self, APP_NAME, f"{APP_NAME}\nPySide6 + PyMuPDF"))

        self._toolbar = Toolbar(self.state, self._actions)
        self.addToolBar(self._toolbar)
        view = PageView(self.state)
        self.setCentralWidget(view)
        view.setFocus()  # otherwise the editable zoom box takes focus and eats the arrow keys
        self._sidebar = Sidebar(self.state)
        self._dock = QDockWidget(objectName="sidebar_dock", features=QDockWidget.DockWidgetFeature.NoDockWidgetFeatures)
        self._dock.setTitleBarWidget(QWidget())  # no title bar: the menu/F4 toggles it, the edge drag resizes it
        self._dock.setWidget(self._sidebar)
        self.addDockWidget(Qt.DockWidgetArea.LeftDockWidgetArea, self._dock)
        self._restore_settings()

        self.state.document_changed.connect(self._update_title)
        self.state.document_changed.connect(view.setFocus)
        self.state.fullscreen_changed.connect(self._apply_fullscreen)
        self.state.sidebar_changed.connect(self._apply_sidebar)
        self._apply_sidebar()
        for signal in (self.state.layout_changed, self.state.tool_changed, self.state.fullscreen_changed,
                       self.state.sidebar_changed):
            signal.connect(self._sync_checks)
        self._sync_checks()

    def _make_actions(self):
        st = self.state
        actions = {}

        def add(name, label, slot, short=None, checkable=False):
            action = QAction(label, self, checkable=checkable)
            if short:
                action.setIconText(short)  # toolbar text; the menu shows the full label
                action.setToolTip(label)
            action.triggered.connect(lambda checked=False: slot())
            action.triggered.connect(self._sync_checks)  # undo Qt's own check toggling if the state refused
            action.setShortcuts([QKeySequence(key) for key in shortcuts.KEYS.get(name, [])])
            self.addAction(action)  # keeps the shortcut alive while the menu bar is hidden (presentation)
            actions[name] = action

        add("open", "열기…", self.choose_file, "열기")
        add("quit", "종료", self.close)
        add("copy", "복사", st.copy)
        add("prev", "이전 페이지", st.prev, "◀")
        add("next", "다음 페이지", st.next, "▶")
        add("zoom_in", "확대", st.zoom_in, "＋")
        add("zoom_out", "축소", st.zoom_out, "－")
        add("fit_width", "폭 맞춤", st.fit_width)
        add("fit_page", "페이지 맞춤", st.fit_page)
        for mode, label, short in zip(VIEW_MODES, ("단일 페이지", "연속 스크롤", "두 페이지 펼침"), ("단일", "연속", "펼침")):
            add(mode, label, lambda mode=mode: st.set_view_mode(mode), short, checkable=True)
        add("cover_alone", "펼침: 표지 단독", lambda: st.set_cover_alone(not st.cover_alone), checkable=True)
        add("rotate_left", "왼쪽으로 회전", st.rotate_left, "↺")
        add("rotate_right", "오른쪽으로 회전", st.rotate_right, "↻")
        add("select_tool", "선택 도구", lambda: st.set_tool("select"), "선택", checkable=True)
        add("hand_tool", "손 도구", lambda: st.set_tool("hand"), "손", checkable=True)
        add("toggle_sidebar", "사이드바", st.toggle_sidebar, checkable=True)
        add("toggle_fullscreen", "전체 화면", st.toggle_fullscreen, checkable=True)
        add("toggle_presentation", "발표 모드", st.toggle_presentation, checkable=True)
        add("exit_fullscreen", "전체 화면 끝내기", st.exit_fullscreen)
        for group in (VIEW_MODES, ("select_tool", "hand_tool")):
            exclusive = QActionGroup(self)  # clicking the checked one keeps it checked
            for name in group:
                exclusive.addAction(actions[name])
        return actions

    def _sync_checks(self):
        st, a = self.state, self._actions
        for mode in VIEW_MODES:
            a[mode].setChecked(st.view_mode == mode)
        a["cover_alone"].setChecked(st.cover_alone)
        a["select_tool"].setChecked(st.tool == "select")
        a["hand_tool"].setChecked(st.tool == "hand")
        a["toggle_sidebar"].setChecked(st.sidebar)
        a["toggle_fullscreen"].setChecked(st.fullscreen)
        a["toggle_presentation"].setChecked(st.presentation)
        a["exit_fullscreen"].setEnabled(st.fullscreen)  # Esc stays free for other uses otherwise

    def _apply_fullscreen(self):
        if self.state.fullscreen and not self.isFullScreen():
            self._was_maximized = self.isMaximized()
            self.showFullScreen()
        elif not self.state.fullscreen and self.isFullScreen():
            self.showMaximized() if self._was_maximized else self.showNormal()
        self.menuBar().setVisible(not self.state.presentation)
        self._toolbar.setVisible(not self.state.presentation)
        self._apply_sidebar()

    def _apply_sidebar(self):
        self._dock.setVisible(self.state.sidebar and not self.state.presentation)

    def choose_file(self):
        path, _ = QFileDialog.getOpenFileName(self, "PDF 열기", "", "PDF (*.pdf);;모든 파일 (*)")
        if path:
            self.open_file(path)

    def open_file(self, path):
        try:
            doc = Document(path)
        except (OSError, RuntimeError) as error:  # missing file, or pymupdf.FileDataError for broken files
            QMessageBox.warning(self, "열기 실패", f"{path}\n\n{error}")
            return
        retry = False
        while doc.is_locked:
            password = ask_password(self, Path(path).name, retry)
            if password is None:
                doc.close()
                return
            retry = not doc.authenticate(password)
        self.state.open(doc)

    def _restore_settings(self):
        settings = QSettings()
        if not self.restoreState(settings.value("window/state", b"")):  # first run: default width
            self.resizeDocks([self._dock], [theme.token("size.sidebar_width")], Qt.Orientation.Horizontal)
        self.state.set_sidebar(settings.value("sidebar/visible", True, type=bool))
        self._sidebar.setCurrentIndex(settings.value("sidebar/tab", 0, type=int))

    def closeEvent(self, event):
        settings = QSettings()
        settings.setValue("window/state", self.saveState())  # dock width
        settings.setValue("sidebar/visible", self.state.sidebar)
        settings.setValue("sidebar/tab", self._sidebar.currentIndex())
        self.state.renderer.shutdown()
        super().closeEvent(event)

    def _update_title(self):
        doc = self.state.document
        self.setWindowTitle(f"{Path(doc.path).name} — {APP_NAME}" if doc else APP_NAME)
