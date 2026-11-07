import logging
import os

import pytest
from PySide6.QtCore import QPoint, Qt

import main
from app import theme
from app.core import settings
from app.dialogs.shortcuts_dialog import shortcut_rows
from app.main_window import MainWindow, unopenable_reason


@pytest.fixture
def window(qtbot, pdf100):
    window = MainWindow()
    qtbot.addWidget(window)
    window.show()
    window.activateWindow()
    qtbot.waitUntil(window.isActiveWindow)  # window shortcuts fire only in the active window
    window.open_file(pdf100)
    return window


def test_home_end_and_actual_size_keys(qtbot, window):
    view, st = window._view, window.state
    qtbot.keyClick(view, Qt.Key.Key_End)
    assert st.current_page == 99
    qtbot.keyClick(view, Qt.Key.Key_Home)
    assert st.current_page == 0
    qtbot.keyClick(view, Qt.Key.Key_0, Qt.KeyboardModifier.ControlModifier)
    assert (st.zoom_mode, st.zoom) == ("custom", 1.0)


def test_page_down_scrolls_a_screen_in_continuous(qtbot, window):
    bar = window._view.verticalScrollBar()
    start = bar.value()
    qtbot.keyClick(window._view, Qt.Key.Key_PageDown)
    assert bar.value() == start + bar.pageStep()
    for _ in range(5):
        qtbot.keyClick(window._view, Qt.Key.Key_PageDown)
    assert window.state.current_page > 0  # the current page follows the scroll
    qtbot.keyClick(window._view, Qt.Key.Key_PageUp)
    assert bar.value() == start + 5 * bar.pageStep()


def test_page_down_turns_the_page_at_the_edge_in_single(qtbot, window):
    st = window.state
    st.set_view_mode("single")
    st.fit_page()  # whole page visible: already at the scroll edge
    qtbot.keyClick(window._view, Qt.Key.Key_PageDown)
    assert st.current_page == 1
    qtbot.keyClick(window._view, Qt.Key.Key_PageUp)
    assert st.current_page == 0


def test_page_up_lands_on_the_previous_page_end_in_single(qtbot, window):
    st, bar = window.state, window._view.verticalScrollBar()
    st.set_view_mode("single")
    st.fit_width()  # page taller than the screen
    st.go_to(3)
    assert bar.value() == bar.minimum()
    qtbot.keyClick(window._view, Qt.Key.Key_PageUp)
    assert st.current_page == 2 and bar.value() == bar.maximum()


def test_sidebar_lists_keep_their_navigation_keys(qtbot, outline_pdf):
    window = MainWindow()
    qtbot.addWidget(window)
    window.show()
    window.activateWindow()
    qtbot.waitUntil(window.isActiveWindow)
    window.open_file(outline_pdf)
    window._sidebar.setCurrentIndex(1)
    tree = window._sidebar.currentWidget()._tree
    qtbot.waitUntil(lambda: tree.model().rowCount() == 2, timeout=15000)  # Chapter 1, Chapter 2
    tree.setFocus()
    tree.setCurrentIndex(tree.model().index(0, 0))
    qtbot.keyClick(tree, Qt.Key.Key_End)
    assert tree.currentIndex().data() == "Chapter 2"
    assert window.state.current_page == 0  # the document stays put until a chapter is chosen
    qtbot.keyClick(tree, Qt.Key.Key_Home)
    qtbot.keyClick(tree, Qt.Key.Key_Left)  # collapse, not "previous page"
    assert not tree.isExpanded(tree.currentIndex())

    window._sidebar.setCurrentIndex(0)
    thumbs = window._sidebar.currentWidget()
    thumbs.setFocus()
    qtbot.keyClick(thumbs, Qt.Key.Key_End)
    assert thumbs.currentIndex().row() == 4 and window.state.current_page == 4  # a thumbnail pick turns the page


def test_shortcut_list_follows_the_key_table(window):
    rows = dict(shortcut_rows(window._actions))
    assert rows["첫 페이지"] == "Home"
    assert rows["단축키 목록"] == "?, F1"
    assert "Ctrl+0" in rows["실제 크기"]
    assert window._actions["shortcut_help"] in window.menuBar().actions()[-1].menu().actions()


def test_every_action_tooltip_names_its_key(window):
    for name, action in window._actions.items():
        if action.shortcuts():
            assert f"({action.shortcuts()[0].toString()})" in action.toolTip(), name


def test_open_failure_reasons(tmp_path):
    missing = str(tmp_path / "gone.pdf")
    assert unopenable_reason(missing)[1] is True
    junk = tmp_path / "junk.pdf"
    junk.write_bytes(b"not a pdf")
    assert unopenable_reason(str(junk))[1] is True
    junk.chmod(0)
    try:
        if os.access(junk, os.R_OK):
            pytest.skip("running as root: chmod cannot block reading")
        reason, forget = unopenable_reason(str(junk))
        assert "권한" in reason and forget is False
    finally:
        junk.chmod(0o600)


def test_unreadable_file_stays_in_recent_files(qtbot, pdf100, monkeypatch):
    monkeypatch.setattr("app.main_window.QMessageBox.warning", lambda *args: None)
    monkeypatch.setattr("app.main_window.Document", lambda path: (_ for _ in ()).throw(RuntimeError("cannot open")))
    monkeypatch.setattr("app.main_window.unopenable_reason", lambda path: ("권한", False))
    settings.add_recent(os.path.abspath(pdf100))
    window = MainWindow()
    qtbot.addWidget(window)
    window.open_file(pdf100)
    assert os.path.abspath(pdf100) in settings.recent_files()


def test_log_file_written(tmp_path):
    path = main.setup_logging(tmp_path / "logs")
    root = logging.getLogger()
    handler = root.handlers[-1]
    try:
        logging.getLogger("pdfviewer").warning("hello log")
        handler.flush()
        assert "hello log" in path.read_text(encoding="utf-8")
    finally:
        root.removeHandler(handler)
        handler.close()


def test_sidebar_narrows_to_the_left_edge_and_double_click_restores_it(qtbot):
    window = MainWindow()
    qtbot.addWidget(window)
    window.resize(1200, 800)
    window.show()
    window.resizeDocks([window._dock], [1], Qt.Orientation.Horizontal)
    qtbot.waitUntil(lambda: window._dock.width() < 10)  # the document takes the window up to its left edge
    y = window._dock.geometry().center().y()
    x = (window._dock.geometry().right() + window.centralWidget().geometry().left()) // 2 + 1
    qtbot.mouseDClick(window, Qt.MouseButton.LeftButton, pos=QPoint(x, y))
    qtbot.waitUntil(lambda: window._dock.width() == theme.token("size.sidebar_width"))


def test_search_tab_click_opens_the_search_box(qtbot, pdf100):
    window = MainWindow()
    qtbot.addWidget(window)
    tabs = window._sidebar
    search = tabs.indexOf(tabs.search_results)
    tabs.tabBarClicked.emit(search)  # empty screen: nothing to search
    assert not window.state.search_open
    window.open_file(pdf100)
    tabs.tabBarClicked.emit(search)
    assert window.state.search_open
    tabs.tabBarClicked.emit(0)  # thumbnails
    assert not window.state.search_open
    tabs.tabBarClicked.emit(search)
    tabs.tabBarClicked.emit(1)  # outline
    assert not window.state.search_open
