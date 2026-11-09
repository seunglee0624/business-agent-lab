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


def test_alt_keys_open_the_plain_titled_menus(qtbot, window):
    titles = [action.text() for action in window.menuBar().actions()]
    assert titles == ["파일", "편집", "보기", "도움말"]  # no "(F)" in the bar
    qtbot.keyClick(window, Qt.Key.Key_V, Qt.KeyboardModifier.AltModifier)
    assert window.menuBar().activeAction().text() == "보기"
    window.menuBar().activeAction().menu().close()


@pytest.fixture
def empty(qtbot):
    # one path far wider than the list: its row must still end at the list's edge, x included
    paths = [os.path.abspath(f"recent{i}.pdf") for i in range(3)]
    paths[1] = os.path.abspath(os.path.join(*["a very long folder name"] * 8, "recent1.pdf"))
    for path in settings.recent_files():
        settings.remove_recent(path)
    for path in reversed(paths):
        settings.add_recent(path)
    window = MainWindow()
    qtbot.addWidget(window)
    window.resize(1200, 800)
    window.show()
    chosen = []
    window._empty.file_chosen.disconnect()
    window._empty.file_chosen.connect(chosen.append)
    yield window._empty, paths, chosen
    for path in settings.recent_files():
        settings.remove_recent(path)


def test_recent_x_removes_without_opening(qtbot, empty):
    screen, paths, chosen = empty
    view = screen._list
    from app.widgets.empty_state import close_area
    row = view.visualRect(view.model().index(1, 0))
    assert row.right() < view.viewport().width()
    x = close_area(row).center()
    qtbot.mouseClick(view.viewport(), Qt.MouseButton.LeftButton, pos=x)
    qtbot.mouseDClick(view.viewport(), Qt.MouseButton.LeftButton, pos=x)  # a quick second click on the row that moved up
    assert paths[1] not in settings.recent_files() and chosen == []  # nothing opened
    assert not view.hasFocus()  # no focus frame around the list after a mouse click
    qtbot.mouseClick(view.viewport(), Qt.MouseButton.LeftButton, pos=view.visualRect(view.model().index(0, 0)).center())
    assert chosen == [paths[0]]


def test_recent_delete_key(qtbot, empty):
    screen, paths, chosen = empty
    view = screen._list
    view.setFocus()
    view.setCurrentIndex(view.model().index(0, 0))
    qtbot.keyClick(view, Qt.Key.Key_Delete)
    assert settings.recent_files() == paths[1:] and view.currentIndex().row() == 0  # Delete again takes the next one
    qtbot.keyClick(view, Qt.Key.Key_Delete)
    qtbot.keyClick(view, Qt.Key.Key_Delete)
    assert settings.recent_files() == [] and not view.isVisible() and chosen == []


def test_landscape_thumbnails_get_short_cells(qtbot, tmp_path):
    import pymupdf
    path = str(tmp_path / "deck.pdf")
    doc = pymupdf.open()
    for _ in range(3):
        doc.new_page(width=800, height=450)  # 16:9 slides
    doc.save(path)
    window = MainWindow()
    qtbot.addWidget(window)
    window.open_file(path)
    thumbs = window._sidebar.widget(0)
    box, pad = theme.token("size.thumbnail"), theme.token("spacing.md")
    cell = thumbs.visualRect(thumbs.model().index(0)).height()
    assert cell == round(box * 450 / 800) + 2 * pad + thumbs.fontMetrics().height()  # not a square box


def test_ctrl_wheel_zooms_around_the_mouse(qtbot, window):
    from PySide6.QtCore import QPointF
    from PySide6.QtGui import QWheelEvent
    from PySide6.QtWidgets import QApplication
    view, st = window._view, window.state
    st.set_zoom(1.5)
    view.verticalScrollBar().setValue(view.verticalScrollBar().value() + 300)
    mouse = QPoint(view.viewport().width() // 4, view.viewport().height() // 3)

    def page_spot():  # where on the page the mouse points, as fractions of the page
        point = view.mapToScene(mouse)
        rect = next(r for r in view._rects.values() if r.contains(point))
        return (point.x() - rect.left()) / rect.width(), (point.y() - rect.top()) / rect.height()

    spot = page_spot()
    wheel = QWheelEvent(QPointF(mouse), QPointF(view.viewport().mapToGlobal(mouse)), QPoint(), QPoint(0, 240),
                        Qt.MouseButton.NoButton, Qt.KeyboardModifier.ControlModifier, Qt.ScrollPhase.NoScrollPhase, False)
    QApplication.sendEvent(view.viewport(), wheel)
    assert st.zoom > 1.5
    assert page_spot() == pytest.approx(spot, abs=0.005)


def test_zoom_group_starts_above_the_document_tab(qtbot, window):
    def lines_up():
        button = window._toolbar.widgetForAction(window._actions["zoom_out"])
        tab = window._tab_bar
        return button.mapTo(window, QPoint()).x() == tab.mapTo(window, tab.tabRect(0).topLeft()).x()

    window.resize(1200, 800)
    window.resizeDocks([window._dock], [400], Qt.Orientation.Horizontal)
    qtbot.waitUntil(lines_up)
    window.resizeDocks([window._dock], [320], Qt.Orientation.Horizontal)  # follows the sidebar edge
    qtbot.waitUntil(lines_up)
    window._toolbar.align_zoom(0)  # back to the usual place
    qtbot.wait(50)  # laid out without the lead
    window._align_toolbar()
    window._align_toolbar()  # twice before the toolbar re-lays out (as at startup): must not add the lead twice
    qtbot.waitUntil(lines_up)


def test_recent_box_hugs_its_rows(qtbot, empty):
    screen, paths, _ = empty
    view = screen._list
    rows = sum(view.sizeHintForRow(r) for r in range(view.model().rowCount()))
    qtbot.waitUntil(lambda: view.viewport().height() >= rows)
    assert view.viewport().height() - rows < view.sizeHintForRow(0)  # no empty space below the last file
    screen._remove(paths[0])
    qtbot.waitUntil(lambda: view.viewport().height() < rows)  # shrinks with the list
