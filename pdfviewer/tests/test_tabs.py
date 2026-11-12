"""Phase 6b: tabs."""
import pytest
from PySide6.QtCore import Qt
from PySide6.QtWidgets import QTabBar

from app.core import settings
from app.core.document import Document
from app.main_window import MainWindow
from app.viewer_state import ViewerState
from conftest import make_pdf


@pytest.fixture
def files(tmp_path, pdf100):
    return [pdf100, make_pdf(tmp_path / "b.pdf", 5), make_pdf(tmp_path / "c.pdf", 7)]


@pytest.fixture
def st(files):
    s = ViewerState()
    s.set_viewport(800, 600)
    for path in files:
        s.open(Document(path))
    yield s
    s.renderer.shutdown()


def paths(s):
    return [tab.document.path for tab in s.tabs]


def test_each_tab_keeps_its_own_view(st, files):
    assert paths(st) == files and st.tab_index == 2
    st.switch_tab(0)
    st.go_to(41)
    st.set_zoom(1.5)
    st.set_view_mode("spread")
    st.rotate_right()
    st.switch_tab(1)
    assert (st.current_page, st.view_mode, st.rotation, st.document.path) == (0, "single", 0, files[1])
    st.go_to(3)
    st.prev_tab()
    assert (st.current_page, st.zoom, st.view_mode, st.rotation) == (41, 1.5, "spread", 90)
    st.next_tab()
    assert st.current_page == 3
    st.next_tab()
    st.next_tab()  # wraps
    assert st.tab_index == 0


def test_opening_an_open_file_switches_to_its_tab(st, files):
    st.open(Document(files[0]))
    assert paths(st) == files and st.tab_index == 0


def test_close_tabs(st, files):
    st.switch_tab(1)
    st.close_tab()  # current: the next one takes its place
    assert paths(st) == [files[0], files[2]] and st.document.path == files[2]
    st.close_tab(0)  # not current: the current tab stays
    assert paths(st) == [files[2]] and st.tab_index == 0 and st.document.path == files[2]
    st.close_tab()
    assert st.tabs == [] and st.document is None and st.tab_index is None
    st.close_tab()  # nothing to close


def test_closing_the_last_tab_selects_the_new_last(st, files):
    st.close_tab()
    assert st.document.path == files[1]


def test_move_keeps_the_current_tab(st, files):
    st.switch_tab(0)
    st.move_tab(0, 2)
    assert paths(st) == [files[1], files[2], files[0]] and st.tab_index == 2


def test_closing_a_tab_in_presentation_keeps_its_real_view(st, files):
    st.switch_tab(0)
    st.set_zoom(1.5)
    st.toggle_presentation()
    st.switch_tab(1)
    assert not st.presentation and st.view_mode == "single"
    assert settings.file_view(files[0])[1:] == ("custom", 1.5)
    st.switch_tab(0)
    st.toggle_presentation()
    st.close_tab()
    assert not st.presentation and not st.fullscreen


def test_search_follows_the_tab(qtbot, st):
    st.open_search()
    st.set_search("page 7")
    qtbot.waitUntil(lambda: st.search_done, timeout=20000)
    assert len(st.search_results) == 1  # c.pdf: page 7 only
    st.switch_tab(0)
    qtbot.waitUntil(lambda: st.search_done, timeout=20000)
    assert len(st.search_results) == 11  # 7, 70..79


def test_tab_bar_follows_and_drives_the_state(qtbot, files):
    w = MainWindow()
    qtbot.addWidget(w)
    w.resize(900, 700)
    w.show()
    bar = w.findChild(QTabBar, "tabBar")
    assert not bar.isVisible()
    for path in files:
        w.open_file(path)
    w.open_file(files[1])  # already open: switch, no new tab
    st = w.state
    assert [bar.tabText(i) for i in range(bar.count())] == ["hundred.pdf", "b.pdf", "c.pdf"]
    assert bar.isVisible() and bar.currentIndex() == st.tab_index == 1
    bar.setCurrentIndex(0)
    assert st.tab_index == 0
    w._actions["next_tab"].trigger()
    assert bar.currentIndex() == 1
    qtbot.mouseClick(bar, Qt.MouseButton.MiddleButton, pos=bar.tabRect(2).center())
    assert bar.count() == 2 and len(st.tabs) == 2
    qtbot.mouseClick(bar.tabButton(0, QTabBar.ButtonPosition.RightSide), Qt.MouseButton.LeftButton)  # its x
    assert bar.count() == 1 and st.document.path == files[1]
    w._actions["close_tab"].trigger()
    assert not bar.isVisible() and w._stack.currentWidget() is w._empty
    assert not w._actions["close_tab"].isEnabled()
