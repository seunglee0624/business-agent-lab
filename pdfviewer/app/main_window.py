import logging
import os
from pathlib import Path

from PySide6.QtCore import QEvent, QPoint, Qt, QTimer
from PySide6.QtGui import QAction, QActionGroup, QKeySequence, QShortcut
from PySide6.QtWidgets import (QDockWidget, QFileDialog, QMainWindow, QMenu, QMessageBox, QStackedWidget, QVBoxLayout,
                               QWidget)

from app import shortcuts, theme
from app.core import settings
from app.core.document import Document
from app.dialogs.password_dialog import ask_password
from app.dialogs.properties_dialog import show_properties
from app.dialogs.shortcuts_dialog import show_shortcuts
from app.icons import icon
from app.viewer_state import VIEW_MODES, ViewerState
from app.widgets.empty_state import EmptyState
from app.widgets.page_view import PageView
from app.widgets.search_bar import SearchBar
from app.widgets.sidebar import Sidebar
from app.widgets.status_bar import StatusBar
from app.widgets.tab_bar import TabBar
from app.widgets.toolbar import Toolbar

APP_NAME = "PDF Viewer"
log = logging.getLogger(__name__)

# need an open document: disabled on the empty screen so no button silently does nothing
DOCUMENT_ACTIONS = ("close_tab", "properties", "copy", "open_search", "prev", "next", "first_page", "last_page",
                    "page_up", "page_down", "zoom_in", "zoom_out", "actual_size", "fit_width", "fit_page", *VIEW_MODES, "cover_alone", "rotate_left", "rotate_right", "select_tool", "hand_tool",
                    "toggle_presentation")

MENUS = {  # None = separator, "recent" = the recent files submenu
    "파일": ["open", "recent", "close_tab", None, "properties", None, "quit"],
    "편집": ["copy", None, "open_search"],
    "보기": ["prev", "next", "first_page", "last_page", None, "zoom_in", "zoom_out", "actual_size", "fit_width",
               "fit_page", None,
               "single", "continuous", "spread", "cover_alone", None, "rotate_left", "rotate_right", None,
               "select_tool", "hand_tool", None, "toggle_sidebar", "toggle_fullscreen", "toggle_presentation", None,
               "next_tab", "prev_tab"],
    "도움말": ["shortcut_help"],
}


def unopenable_reason(path):
    """Why a file failed to open: (message, drop it from recent files)."""
    if not os.path.exists(path):
        return "파일을 찾을 수 없어요. 옮겨졌거나 삭제됐을 수 있어요.", True
    try:
        open(path, "rb").close()
    except OSError:  # no read permission, or locked by another program: it may open later, so keep it listed
        return "파일을 읽을 권한이 없어요. 접근이 막혀 있거나 다른 프로그램이 쓰고 있을 수 있어요.", False
    return "PDF를 열 수 없어요. 파일이 손상됐거나 PDF가 아닐 수 있어요.", True


class MainWindow(QMainWindow):
    """Assembles the widgets, owns the shared actions and wires everything to one ViewerState."""

    def __init__(self):
        super().__init__()
        self.state = ViewerState()
        self.setWindowTitle(APP_NAME)
        self._was_maximized = False
        self._actions = self._make_actions()
        self._recent_menu = QMenu("최근 파일", self, toolTipsVisible=True)
        self._recent_menu.aboutToShow.connect(self._fill_recent_menu)

        for title, names in MENUS.items():
            menu = self.menuBar().addMenu(title)
            QShortcut(shortcuts.MENU_KEYS[title], self, lambda menu=menu: self._open_menu(menu))
            for name in names:
                if name == "recent":
                    menu.addMenu(self._recent_menu)
                elif name:
                    menu.addAction(self._actions[name])
                else:
                    menu.addSeparator()
        help_menu = menu  # the last of MENUS
        help_menu.addAction("정보", lambda: QMessageBox.about(self, APP_NAME, f"{APP_NAME}\nPySide6 + PyMuPDF"))

        self._toolbar = Toolbar(self.state, self._actions)
        self.addToolBar(self._toolbar)
        self.addToolBarBreak()
        self._search_bar = SearchBar(self.state)
        self.addToolBar(self._search_bar)
        view = self._view = PageView(self.state)
        view.setAcceptDrops(False)  # dropped files go to the window
        view.viewport().setAcceptDrops(False)
        self._empty = EmptyState(self._actions["open"])
        self._empty.file_chosen.connect(self.open_file)
        self._stack = QStackedWidget()
        self._stack.addWidget(self._empty)
        self._stack.addWidget(view)
        central = QWidget()
        column = QVBoxLayout(central)
        column.setContentsMargins(0, 0, 0, 0)
        column.setSpacing(0)
        self._tab_bar = TabBar(self.state)
        column.addWidget(self._tab_bar)
        column.addWidget(self._stack)
        self.setCentralWidget(central)
        central.installEventFilter(self)  # it moves when the sidebar is resized, shown or hidden
        self.setAcceptDrops(True)
        self._status = StatusBar(self.state)
        self.setStatusBar(self._status)
        self._sidebar = Sidebar(self.state)
        self._dock = QDockWidget(objectName="sidebar_dock", features=QDockWidget.DockWidgetFeature.NoDockWidgetFeatures)
        self._dock.setTitleBarWidget(QWidget())  # no title bar: the menu/F4 toggles it, the edge drag resizes it
        self._dock.setWidget(self._sidebar)
        self._sidebar.setMinimumWidth(1)  # not the tabs' width: the document may take the window up to its left edge
        self.addDockWidget(Qt.DockWidgetArea.LeftDockWidgetArea, self._dock)
        self._restore_settings()
        self._search_bar.setVisible(False)  # after restoreState, which would bring back a saved visibility

        self.state.tabs_changed.connect(self._sync_checks)
        self.state.document_changed.connect(self._apply_document)  # first: the view must be shown to take focus
        self.state.document_changed.connect(self._update_title)
        self.state.document_changed.connect(lambda: QTimer.singleShot(0, self._align_toolbar))  # "/ 31" → "/ 100" widens the page group
        self.state.document_changed.connect(self._focus_main)
        self.state.fullscreen_changed.connect(self._apply_fullscreen)
        self.state.sidebar_changed.connect(self._apply_sidebar)
        self.state.search_changed.connect(self._apply_search)
        self._apply_sidebar()
        self._apply_document()
        for signal in (self.state.document_changed, self.state.layout_changed, self.state.tool_changed, self.state.fullscreen_changed,
                       self.state.sidebar_changed, self.state.search_changed):
            signal.connect(self._sync_checks)
        self._sync_checks()
        self._focus_main()

    def _open_menu(self, menu):
        if self.menuBar().isVisible():  # hidden in presentation mode
            self.menuBar().setActiveAction(menu.menuAction())

    def _focus_main(self):
        (self._view if self.state.document else self._empty).setFocus()

    def _make_actions(self):
        st = self.state
        actions = {}

        def add(name, label, slot, toolbar=False, checkable=False):
            action = QAction(label, self, checkable=checkable)
            keys = shortcuts.KEYS.get(name, [])
            if toolbar:
                action.setIcon(icon(name))
                action.setIconVisibleInMenu(False)  # an icon would hide the menu's check mark
            key = QKeySequence(keys[0]).toString(QKeySequence.SequenceFormat.NativeText) if keys else ""
            action.setToolTip(f"{label.rstrip('…')} ({key})" if key else label.rstrip("…"))  # icon buttons show only this
            action.triggered.connect(lambda checked=False: slot())
            action.triggered.connect(self._sync_checks)  # undo Qt's own check toggling if the state refused
            action.setShortcuts([QKeySequence(key) for key in keys])
            self.addAction(action)  # keeps the shortcut alive while the menu bar is hidden (presentation)
            actions[name] = action

        add("open", "열기…", self.choose_file, True)
        add("close_tab", "탭 닫기", st.close_tab)
        add("properties", "문서 속성…", lambda: show_properties(self, st.document))
        add("quit", "종료", self.close)
        add("copy", "복사", st.copy)
        add("open_search", "찾기…", st.open_search)
        add("prev", "이전 페이지", st.prev, True)
        add("next", "다음 페이지", st.next, True)
        add("first_page", "첫 페이지", st.first_page)
        add("last_page", "마지막 페이지", st.last_page)
        add("page_up", "한 화면 위로", st.page_up)
        add("page_down", "한 화면 아래로", st.page_down)
        add("zoom_in", "확대", st.zoom_in, True)
        add("zoom_out", "축소", st.zoom_out, True)
        add("actual_size", "실제 크기", st.actual_size)
        add("fit_width", "폭 맞춤", st.fit_width)
        add("fit_page", "페이지 맞춤", st.fit_page)
        for mode, label in zip(VIEW_MODES, ("단일 페이지", "연속 스크롤", "두 페이지 펼침")):
            add(mode, label, lambda mode=mode: st.set_view_mode(mode), True, checkable=True)
        add("cover_alone", "펼침: 표지 단독", lambda: st.set_cover_alone(not st.cover_alone), checkable=True)
        add("rotate_left", "왼쪽으로 회전", st.rotate_left, True)
        add("rotate_right", "오른쪽으로 회전", st.rotate_right, True)
        add("select_tool", "선택 도구", lambda: st.set_tool("select"), True, checkable=True)
        add("hand_tool", "손 도구", lambda: st.set_tool("hand"), True, checkable=True)
        add("toggle_sidebar", "사이드바", st.toggle_sidebar, checkable=True)
        add("toggle_fullscreen", "전체 화면", st.toggle_fullscreen, checkable=True)
        add("toggle_presentation", "발표 모드", st.toggle_presentation, checkable=True)
        add("escape", "찾기 닫기 / 전체 화면 끝내기", st.escape)
        add("next_tab", "다음 탭", st.next_tab)
        add("prev_tab", "이전 탭", st.prev_tab)
        add("shortcut_help", "단축키 목록…", lambda: show_shortcuts(self, actions))
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
        a["escape"].setEnabled(st.fullscreen or st.search_open)  # Esc stays free for other uses otherwise
        for name in DOCUMENT_ACTIONS:
            a[name].setEnabled(st.document is not None)
        for name in ("next_tab", "prev_tab"):
            a[name].setEnabled(len(st.tabs) > 1)

    def _apply_fullscreen(self):
        if self.state.fullscreen and not self.isFullScreen():
            self._was_maximized = self.isMaximized()
            self.showFullScreen()
        elif not self.state.fullscreen and self.isFullScreen():
            self.showMaximized() if self._was_maximized else self.showNormal()
        self.menuBar().setVisible(not self.state.presentation)
        self._toolbar.setVisible(not self.state.presentation)
        self._status.setVisible(not self.state.presentation)
        self._apply_sidebar()
        self._apply_search()

    def _apply_search(self):
        shown = self.state.search_open and not self.state.presentation
        focus = self.focusWidget()
        if not shown and focus and self._search_bar.isAncestorOf(focus):
            self._view.setFocus()  # hiding the focused box would leave the keys nowhere
        self._search_bar.setVisible(shown)

    def _apply_document(self):
        self._stack.setCurrentWidget(self._view if self.state.document else self._empty)

    def _apply_sidebar(self):
        self._dock.setVisible(self.state.sidebar and not self.state.presentation)

    def choose_file(self):
        path, _ = QFileDialog.getOpenFileName(self, "PDF 열기", "", "PDF (*.pdf);;모든 파일 (*)")
        if path:
            self.open_file(path)

    def open_file(self, path):
        index = self.state.find_tab(os.path.abspath(path))
        if index is not None:  # already open: no second password prompt
            self.state.switch_tab(index)
            return
        try:
            doc = Document(path)
        except (OSError, RuntimeError) as error:  # pymupdf.FileDataError also covers unreadable files
            log.warning("cannot open %s", path, exc_info=True)
            reason, forget = unopenable_reason(path)
            QMessageBox.warning(self, "열기 실패", f"{reason}\n\n{path}\n{error}")
            if forget:
                settings.remove_recent(os.path.abspath(path))
                self._empty.reload()
            return
        retry = False
        while doc.is_locked:
            password = ask_password(self, Path(path).name, retry)
            if password is None:
                doc.close()
                return
            retry = not doc.authenticate(password)
        self.state.open(doc)

    def _fill_recent_menu(self):
        self._recent_menu.clear()
        for i, path in enumerate(settings.recent_files(), 1):
            action = self._recent_menu.addAction(f"&{i % 10} {Path(path).name}", lambda path=path: self.open_file(path))
            action.setToolTip(path)
        if self._recent_menu.isEmpty():
            self._recent_menu.addAction("(없음)").setEnabled(False)

    @staticmethod
    def _dropped_pdfs(event):
        urls = event.mimeData().urls()
        return [url.toLocalFile() for url in urls if url.isLocalFile() and url.toLocalFile().lower().endswith(".pdf")]

    def dragEnterEvent(self, event):
        if self._dropped_pdfs(event):
            event.acceptProposedAction()

    def dropEvent(self, event):
        paths = self._dropped_pdfs(event)
        if paths:
            event.acceptProposedAction()
            # after the drop returns: a password or error dialog inside it would hold the file manager's drag
            QTimer.singleShot(0, lambda: [self.open_file(path) for path in paths])

    def _restore_settings(self):
        geometry, dock_state, sidebar_shown, sidebar_tab = settings.window()
        if not self.restoreGeometry(geometry):  # first run
            self.resize(theme.token("size.window_width"), theme.token("size.window_height"))
        if not self.restoreState(dock_state):
            self.resizeDocks([self._dock], [theme.token("size.sidebar_width")], Qt.Orientation.Horizontal)
        self.state.set_sidebar(sidebar_shown)
        self._sidebar.setCurrentIndex(sidebar_tab)

    def closeEvent(self, event):
        geometry = settings.window()[0] if self.isFullScreen() else self.saveGeometry()  # don't reopen fullscreen
        settings.save_window(geometry, self.saveState(), self.state.sidebar, self._sidebar.currentIndex())
        self.state.save_view()
        self.state.renderer.shutdown()
        super().closeEvent(event)

    def eventFilter(self, watched, event):
        if watched is self.centralWidget() and event.type() in (QEvent.Type.Move, QEvent.Type.Resize):
            QTimer.singleShot(0, self._align_toolbar)  # after the toolbar's own layout settles
        return super().eventFilter(watched, event)

    def _align_toolbar(self):
        """The zoom group starts above the first document tab, not over the sidebar."""
        tabs = self._tab_bar
        left = tabs.mapTo(self, QPoint(tabs.tabRect(0).left() if tabs.count() else 0, 0))
        self._toolbar.align_zoom(self._toolbar.mapFrom(self, left).x())

    def mouseDoubleClickEvent(self, event):
        x, dock, central = event.position().x(), self._dock.geometry(), self.centralWidget().geometry()
        if self._dock.isVisible() and dock.right() < x < central.left():  # the sidebar's resize border
            self.resizeDocks([self._dock], [theme.token("size.sidebar_width")], Qt.Orientation.Horizontal)
        else:
            super().mouseDoubleClickEvent(event)

    def _update_title(self):
        doc = self.state.document
        self.setWindowTitle(f"{Path(doc.path).name} · {APP_NAME}" if doc else APP_NAME)
