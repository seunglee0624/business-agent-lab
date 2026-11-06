import pymupdf
import pytest
from PySide6.QtCore import QPointF, Qt
from PySide6.QtGui import QGuiApplication

from app.core.document import Document
from app.core.layout import layout
from app.core.render_worker import page_info
from app.main_window import MainWindow
from app.viewer_state import ViewerState


def test_layout_centres_rows():
    sizes = {0: (100, 200), 1: (100, 200), 2: (100, 200)}
    rects, size = layout([[0], [1, 2]], sizes, 1.0, 10)
    assert size == (210, 410)
    assert rects[0] == (55, 0, 100, 200)
    assert rects[1] == (0, 210, 100, 200) and rects[2] == (110, 210, 100, 200)


def test_spread_rows_and_paging(pdf100):
    state = ViewerState()
    state.open(Document(pdf100))
    state.set_view_mode("spread")
    assert state.rows()[:3] == [[0], [1, 2], [3, 4]] and state.rows()[-1] == [99]
    state.next()
    assert state.current_page == 1
    state.next()
    assert state.current_page == 3
    state.go_to(4)
    state.prev()
    assert state.current_page == 1
    state.set_cover_alone(False)
    assert state.rows()[:2] == [[0, 1], [2, 3]]


def test_rotation_swaps_size_and_refits(pdf100):
    state = ViewerState()
    state.set_viewport(300, 300)
    state.open(Document(pdf100))
    state.rotate_right()
    assert state.rotation == 90 and state.page_size(0) == (800, 600)
    assert state.zoom == pytest.approx(300 / 800)
    state.rotate_left()
    state.rotate_left()
    assert state.rotation == 270


def test_spread_fit_width_counts_the_gap(pdf100):
    from app import theme
    state = ViewerState()
    state.set_viewport(1000, 1000)
    state.open(Document(pdf100))
    state.set_view_mode("spread")
    state.go_to(1)  # row [1, 2]: two 600 pt pages
    assert state.zoom == pytest.approx((1000 - theme.token("spacing.page_gap")) / 1200)


def test_presentation_restores_previous_view(pdf100):
    state = ViewerState()
    state.open(Document(pdf100))
    state.set_zoom(1.3)
    state.toggle_presentation()
    assert (state.view_mode, state.zoom_mode, state.fullscreen) == ("single", "fit_page", True)
    state.exit_fullscreen()
    assert (state.view_mode, state.zoom_mode, state.zoom, state.fullscreen) == ("continuous", "custom", 1.3, False)


def test_selected_text_keeps_line_breaks(qapp, pdf100):
    state = ViewerState()
    state.open(Document(pdf100))
    state.renderer._info[0] = ([(0, 0, 10, 10, "Hello", 0, 0), (12, 0, 20, 10, "world", 0, 0),
                                (0, 20, 10, 30, "next", 0, 1)], [])
    state.select(0, 2, 0)
    assert state.selected_text() == "Hello world\nnext"
    state.copy()
    assert QGuiApplication.clipboard().text() == "Hello world\nnext"


def test_links_only_open_safe_schemes(monkeypatch, pdf100):
    opened = []
    monkeypatch.setattr("app.viewer_state.QDesktopServices.openUrl", lambda url: opened.append(url.toString()))
    state = ViewerState()
    state.open(Document(pdf100))
    state.follow_link(((0, 0, 1, 1), "https://example.com", None))
    state.follow_link(((0, 0, 1, 1), "file:///etc/passwd", None))
    state.follow_link(((0, 0, 1, 1), "javascript:alert(1)", None))
    state.follow_link(((0, 0, 1, 1), None, 7))
    assert opened == ["https://example.com"] and state.current_page == 7


def test_page_info_uses_displayed_coordinates_on_rotated_pages(tmp_path):
    doc = pymupdf.open()
    page = doc.new_page(width=600, height=800)
    page.insert_text((72, 72), "Hello")
    page.set_rotation(90)  # the page's own /Rotate: shown 800 wide, 600 high
    path = tmp_path / "rotated.pdf"
    doc.save(path)
    d = Document(path)
    assert d.page_size(0) == (800, 600)
    (x0, y0, x1, y1, text, *_), = page_info(d.key, None, 0)[0]
    assert text == "Hello" and 700 < x0 < x1 < 800 and 0 < y0 < y1 < 120  # top-left text moved to the top-right


def test_page_info_links(text_pdf):
    d = Document(text_pdf)
    words, links = page_info(d.key, None, 0)
    assert [w[4] for w in words[:4]] == ["Hello", "brave", "new", "world"]
    assert {(uri, target) for _, uri, target in links} == {(None, 2), ("https://example.com", None)}


@pytest.fixture
def window(qtbot):
    w = MainWindow()
    qtbot.addWidget(w)
    w.resize(900, 700)
    w.show()
    w.activateWindow()
    qtbot.waitUntil(w.isActiveWindow)
    return w


def test_view_mode_switch_keeps_current_page(qtbot, window, pdf100):
    # Phase 3 completion: switching between the three view modes keeps the current page
    window.open_file(pdf100)
    window.state.go_to(10)
    view = window.centralWidget()
    for mode in ("spread", "single", "continuous", "spread", "continuous"):
        window.state.set_view_mode(mode)
        assert window.state.current_page == 10, mode
        assert 10 in view._visible_pages(), mode


def test_drag_selects_and_copies_text(qtbot, window, text_pdf):
    # Phase 3 completion: dragging over text and copying gives that text
    window.open_file(text_pdf)
    state, view = window.state, window.centralWidget()
    qtbot.waitUntil(lambda: state.renderer.info(0) is not None, timeout=15000)
    words = state.renderer.info(0)[0]

    def view_point(word):
        rect = view._page_transform(0).mapRect(view_rect(word))
        return view.mapFromScene(rect.center())

    def view_rect(word):
        from PySide6.QtCore import QRectF
        return QRectF(word[0], word[1], word[2] - word[0], word[3] - word[1])

    start, end = view_point(words[0]), view_point(words[3])
    qtbot.mousePress(view.viewport(), Qt.MouseButton.LeftButton, pos=start)
    qtbot.mouseMove(view.viewport(), pos=(start + end) / 2)
    qtbot.mouseMove(view.viewport(), pos=end)
    qtbot.mouseRelease(view.viewport(), Qt.MouseButton.LeftButton, pos=end)
    assert state.selection == (0, 0, 3)
    qtbot.keyClick(view, Qt.Key.Key_C, Qt.KeyboardModifier.ControlModifier)
    assert QGuiApplication.clipboard().text() == "Hello brave new world"

    blank = view.mapFromScene(view._page_transform(0).map(QPointF(300, 500)))
    qtbot.mouseClick(view.viewport(), Qt.MouseButton.LeftButton, pos=blank)  # plain click on empty paper
    assert state.selection is None


def test_internal_link_click_jumps(qtbot, window, text_pdf):
    window.open_file(text_pdf)
    state, view = window.state, window.centralWidget()
    qtbot.waitUntil(lambda: state.renderer.info(0) is not None, timeout=15000)
    (x0, y0, x1, y1), _, target = next(l for l in state.renderer.info(0)[1] if l[2] is not None)
    point = view.mapFromScene(view._page_transform(0).map(QPointF((x0 + x1) / 2, (y0 + y1) / 2)))
    qtbot.mouseClick(view.viewport(), Qt.MouseButton.LeftButton, pos=point)
    assert state.current_page == target == 2


def test_presentation_hides_ui_and_esc_exits(qtbot, window, pdf100):
    window.open_file(pdf100)
    qtbot.keyClick(window.centralWidget(), Qt.Key.Key_F5)
    assert window.state.presentation and not window.menuBar().isVisible()
    qtbot.keyClick(window.centralWidget(), Qt.Key.Key_Escape)  # menu bar hidden: shortcut must still work
    assert not window.state.fullscreen and window.menuBar().isVisible()
