"""Phase 4: sidebar with thumbnails and outline."""
import pytest
from PySide6.QtCore import Qt
from PySide6.QtWidgets import QDockWidget, QLabel, QTreeView

from app import theme
from app.main_window import MainWindow
from app.core.renderer import RENDER_DEBOUNCE_MS
from app.widgets.sidebar import OutlinePanel, Sidebar, ThumbnailList


def make_window(qtbot):
    w = MainWindow()
    qtbot.addWidget(w)
    w.resize(900, 700)
    w.show()
    w.activateWindow()
    qtbot.waitUntil(w.isActiveWindow)
    return w


@pytest.fixture
def window(qtbot):
    return make_window(qtbot)


def test_first_run_shows_thumbnails(window):
    dock = window.findChild(QDockWidget)
    assert dock.isVisible() and window.findChild(Sidebar).currentIndex() == 0
    assert dock.width() == pytest.approx(theme.token("size.sidebar_width"), abs=20)
    assert window._stack.currentWidget() is window._empty  # the dock does not replace the central area


def test_outline_loads_and_jumps_to_page_top(qtbot, window, outline_pdf):
    window.open_file(outline_pdf)
    qtbot.waitUntil(lambda: window.state.renderer.outline is not None)
    panel = window.findChild(OutlinePanel)
    assert panel.currentWidget() is panel.findChild(QTreeView)
    model = panel.findChild(QTreeView).model()
    chapter1 = model.index(0, 0)
    assert [model.index(i, 0).data() for i in range(model.rowCount())] == ["Chapter 1", "Chapter 2"]
    assert model.index(0, 0, chapter1).data() == "Section 1.1"
    panel._go(model.index(1, 0))
    assert window.state.current_page == 3
    panel._go(model.index(0, 0, chapter1))
    assert window.state.current_page == 1


def test_no_outline_message(qtbot, window, pdf100):
    window.open_file(pdf100)
    qtbot.waitUntil(lambda: window.state.renderer.outline == [])
    panel = window.findChild(OutlinePanel)
    assert isinstance(panel.currentWidget(), QLabel) and panel.currentWidget().text() == "목차가 없습니다"


def test_thumbnail_click_and_follow(qtbot, window, pdf100):
    window.open_file(pdf100)
    thumbs = window.findChild(ThumbnailList)
    assert thumbs.model().rowCount() == 100 and thumbs.currentIndex().row() == 0
    thumbs.setCurrentIndex(thumbs.model().index(7))  # what a click does
    assert window.state.current_page == 7
    window.state.go_to(42)
    assert thumbs.currentIndex().row() == 42
    assert thumbs.viewport().rect().intersects(thumbs.visualRect(thumbs.currentIndex()))


def test_visible_thumbnails_get_rendered(qtbot, window, pdf100):
    window.open_file(pdf100)
    thumbs = window.findChild(ThumbnailList)
    model, dpr = thumbs.model(), thumbs.devicePixelRatioF()
    qtbot.waitUntil(lambda: window.state.renderer.get(*model.render_key(0, dpr)) is not None, timeout=10000)
    assert window.state.renderer.get(*model.render_key(99, dpr)) is None  # off-screen rows stay lazy



def test_thumbnails_far_down_render_without_extra_delay(qtbot, window, pdf100):
    window.open_file(pdf100)
    thumbs = window.findChild(ThumbnailList)
    window.state.go_to(90)  # scrolls the list thousands of pixels
    assert thumbs._debounce.interval() == RENDER_DEBOUNCE_MS  # the scroll position must not become the delay

def test_thumbnail_requests_do_not_cancel_view_renders(qtbot, window, pdf100):
    window.open_file(pdf100)
    renderer = window.state.renderer
    renderer.request([(50, 1.0, 0)], "view")
    renderer.request([(60, 0.2, 0)], "thumbs")
    assert (50, 1.0, 0) in renderer._pending


def test_f4_toggles_sidebar(qtbot, window):
    dock = window.findChild(QDockWidget)
    qtbot.keyClick(window, Qt.Key.Key_F4)
    assert not window.state.sidebar and not dock.isVisible()
    qtbot.keyClick(window, Qt.Key.Key_F4)
    assert dock.isVisible()


def test_presentation_hides_sidebar_and_restores_it(window):
    dock = window.findChild(QDockWidget)
    window.state.toggle_presentation()
    assert not dock.isVisible() and window.state.sidebar
    window.state.toggle_presentation()
    assert dock.isVisible()


def test_sidebar_settings_persist(qtbot, window):
    dock = window.findChild(QDockWidget)
    window.resizeDocks([dock], [360], Qt.Orientation.Horizontal)
    window.findChild(Sidebar).setCurrentIndex(1)
    window.state.set_sidebar(False)
    window.close()
    again = make_window(qtbot)
    assert not again.state.sidebar and not again.findChild(QDockWidget).isVisible()
    assert again.findChild(Sidebar).currentIndex() == 1
    again.state.set_sidebar(True)
    qtbot.waitUntil(lambda: again.findChild(QDockWidget).isVisible())
    assert again.findChild(QDockWidget).width() == pytest.approx(360, abs=20)


def test_page_is_centred_with_scrollbar(qtbot, window, pdf100):
    window.open_file(pdf100)
    view = window._view
    qtbot.waitUntil(view.verticalScrollBar().isVisible)
    qtbot.wait(50)  # let the viewport take its final size
    page = view.mapFromScene(view._rects[0]).boundingRect()
    assert page.left() == pytest.approx(view.viewport().width() - 1 - page.right(), abs=1)
