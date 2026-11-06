"""Phase 5: search."""
import pymupdf
import pytest
from PySide6.QtCore import Qt
from PySide6.QtWidgets import QLineEdit

from app import viewer_state
from app.core.document import Document
from app.core.render_worker import search
from app.core.renderer import Renderer
from app.main_window import MainWindow
from app.viewer_state import ViewerState
from app.widgets.search_bar import SearchBar
from app.widgets.sidebar import SearchResultList, Sidebar


@pytest.fixture
def words_pdf(tmp_path):
    doc = pymupdf.open()
    page = doc.new_page(width=600, height=800)
    page.insert_text((72, 72), "Hello brave new World", fontsize=14)
    page.insert_text((72, 100), "world peace newworld", fontsize=14)
    page.insert_text((72, 130), "안녕하세요 세계", fontsize=14, fontname="korea")
    turned = doc.new_page(width=600, height=800)
    turned.insert_text((72, 72), "turned world", fontsize=14)
    turned.set_rotation(90)
    path = tmp_path / "words.pdf"
    doc.save(path)
    return str(path)


def find(path, query, case=False, whole=False):
    return search(Document(path).key, None, 0, 2, query, case, whole)


def test_worker_search_options(words_pdf):
    assert [r[0] for r in find(words_pdf, "world")] == [0, 0, 0, 1]
    assert len(find(words_pdf, "World", case=True)) == 1
    assert len(find(words_pdf, "world", whole=True)) == 3  # not "newworld"
    assert find(words_pdf, "세계")[0][2].endswith("newworld 안녕하세요 세계")  # 30 characters of context


def test_worker_phrase_across_lines_gets_a_rect_per_line(words_pdf):
    (page, rects, _), = find(words_pdf, "World world")
    assert page == 0 and len(rects) == 2
    assert rects[0][1] < rects[1][1]


def test_worker_rects_follow_page_rotation(words_pdf):
    *_, (page, (rect,), _) = find(words_pdf, "world")
    x0, y0, x1, y1 = rect
    assert page == 1 and y1 - y0 > x1 - x0  # text runs down the turned page
    assert 0 <= x0 < x1 <= 800 and 0 <= y0 < y1 <= 600  # inside page.rect (800 x 600 once turned)


def test_renderer_searches_in_chunks_and_drops_a_replaced_search(qtbot, pdf100):
    r = Renderer()
    r.set_document(Document(pdf100))
    progress = []
    r.search_found.connect(lambda results, searched: progress.append((searched, [p for p, *_ in results])))
    r.search("page 1", False, False)
    r.search("page 99", False, False)
    qtbot.waitUntil(lambda: bool(progress) and progress[-1][0] == 100, timeout=20000)
    assert [s for s, _ in progress] == [20, 40, 60, 80, 100]
    assert [p for _, pages in progress for p in pages] == [98]
    r.shutdown()


@pytest.fixture
def state(pdf100):
    st = ViewerState()
    st.open(Document(pdf100))
    yield st
    st.renderer.shutdown()


def run(qtbot, st, query, **options):
    st.set_search(query, **options)
    qtbot.waitUntil(lambda: st.search_done, timeout=20000)


def test_first_result_is_at_or_after_the_current_page_and_steps_wrap(qtbot, state):
    state.open_search()
    state.go_to(30)
    run(qtbot, state, "page 5")  # pages 5, 50..59
    assert len(state.search_results) == 11
    assert (state.search_index, state.current_page) == (1, 49)
    state.search_prev()
    state.search_prev()
    assert (state.search_index, state.current_page) == (10, 58)


def test_no_result_after_the_current_page_wraps_to_the_first(qtbot, state):
    state.open_search()
    state.go_to(80)
    run(qtbot, state, "page 5", whole=True)
    assert (state.search_index, state.current_page) == (0, 4)


def test_results_are_capped(qtbot, state, monkeypatch):
    monkeypatch.setattr(viewer_state, "MAX_SEARCH_RESULTS", 30)
    state.open_search()
    run(qtbot, state, "page")
    assert len(state.search_results) == 30


def test_closing_clears_results_and_reopening_searches_again(qtbot, state):
    state.open_search()
    run(qtbot, state, "page 7", whole=True)
    state.close_search()
    assert state.search_results == [] and state.search_query == "page 7"
    state.open_search()
    qtbot.waitUntil(lambda: state.search_done)
    assert len(state.search_results) == 1


@pytest.fixture
def window(qtbot):
    w = MainWindow()
    qtbot.addWidget(w)
    w.resize(900, 700)
    w.show()
    w.activateWindow()
    qtbot.waitUntil(w.isActiveWindow)
    return w


def test_ctrl_f_type_enter_and_esc(qtbot, window, pdf100):
    window.open_file(pdf100)
    bar, view = window.findChild(SearchBar), window._view
    assert not bar.isVisible()
    qtbot.keyClick(view, Qt.Key.Key_F, Qt.KeyboardModifier.ControlModifier)
    edit = bar.findChild(QLineEdit)
    assert bar.isVisible() and edit.hasFocus()
    assert window.findChild(Sidebar).currentWidget() is window.findChild(SearchResultList)
    qtbot.keyClicks(edit, "page 2")  # pages 2, 20..29
    qtbot.waitUntil(lambda: window.state.search_done and bool(window.state.search_results), timeout=20000)
    assert window.state.search_index == 0 and bar._count.text() == "1 / 11"
    assert not view._active_hit.path().isEmpty() and not view._hits.path().isEmpty()
    qtbot.keyClick(edit, Qt.Key.Key_Return)
    assert window.state.current_page == 19
    qtbot.keyClick(edit, Qt.Key.Key_Return, Qt.KeyboardModifier.ShiftModifier)
    assert window.state.current_page == 1
    qtbot.keyClick(edit, Qt.Key.Key_Escape)
    assert not bar.isVisible() and view.hasFocus() and view._hits.path().isEmpty()
    assert not window.state.fullscreen


def test_result_list_click_goes_to_the_result(qtbot, window, pdf100):
    window.open_file(pdf100)
    window.state.open_search()
    run(qtbot, window.state, "page 3")
    results = window.findChild(SearchResultList)
    assert results.model().rowCount() == 11
    assert results.model().index(4).data().startswith("33쪽")
    results.setCurrentIndex(results.model().index(4))  # what a click does
    assert window.state.current_page == 32
    view = window._view
    visible = view.mapToScene(view.viewport().rect()).boundingRect()
    assert visible.contains(view._active_hit.path().boundingRect())


def test_esc_in_presentation_ends_it_even_with_search_open(window):
    window.state.open_search()
    window.state.toggle_presentation()
    assert not window.findChild(SearchBar).isVisible()
    window.state.escape()
    assert not window.state.presentation and window.state.search_open
