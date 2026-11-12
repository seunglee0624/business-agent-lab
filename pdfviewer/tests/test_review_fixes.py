"""Regressions for the code-review findings."""
import pytest
from PySide6.QtCore import QPointF, Qt

from app.core.document import Document
from app.main_window import MainWindow
from app.viewer_state import ViewerState
from app.widgets.toolbar import Toolbar


@pytest.fixture
def window(qtbot):
    w = MainWindow()
    qtbot.addWidget(w)
    w.resize(900, 700)
    w.show()
    w.activateWindow()
    qtbot.waitUntil(w.isActiveWindow)
    return w


def test_zoom_box_takes_no_typing_and_opens_on_click(qtbot, window, pdf100):
    window.open_file(pdf100)
    box = window.findChild(Toolbar)._zoom
    qtbot.keyClicks(box.lineEdit(), "130")
    assert box.currentText() == "페이지 맞춤" and window.state.zoom_mode == "fit_page"
    qtbot.mouseClick(box.lineEdit(), Qt.MouseButton.LeftButton)
    qtbot.waitUntil(box.view().isVisible)
    box.hidePopup()
    box.textActivated.emit("150%")  # picked from the list
    assert window.state.zoom == pytest.approx(1.5) and box.currentText() == "150%"


def test_paging_during_drag_does_not_crash(qtbot, window, pdf100):
    window.open_file(pdf100)
    window.state.set_view_mode("single")
    view = window._view
    start = view.mapFromScene(view._rects[0].center())
    qtbot.mousePress(view.viewport(), Qt.MouseButton.LeftButton, pos=start)
    window.state.next()  # page 0 leaves the layout while the button is down
    qtbot.mouseMove(view.viewport(), pos=start + QPointF(40, 40).toPoint())  # used to raise KeyError
    qtbot.mouseRelease(view.viewport(), Qt.MouseButton.LeftButton, pos=start)


def test_zoom_box_follows_mode_even_when_zoom_is_equal(qtbot, window, pdf100):
    window.open_file(pdf100)
    box = window.findChild(Toolbar)._zoom
    assert box.currentText() == "페이지 맞춤"
    window.state.set_zoom(window.state.zoom)  # same number, mode becomes custom
    assert box.currentText().endswith("%")
    window.state.fit_page()  # same number again, mode back to fit page
    assert box.currentText() == "페이지 맞춤"


def test_presentation_returns_to_fullscreen_it_started_from(pdf100):
    state = ViewerState()
    state.open(Document(pdf100))
    state.toggle_fullscreen()
    state.toggle_presentation()
    state.exit_fullscreen()
    assert not state.presentation and state.fullscreen
    state.exit_fullscreen()
    assert not state.fullscreen


def test_layout_signal_comes_after_refit(pdf100):
    state = ViewerState()
    state.set_viewport(300, 300)
    state.open(Document(pdf100))
    zooms = []
    state.layout_changed.connect(lambda: zooms.append(state.zoom))
    state.rotate_right()
    assert zooms == [pytest.approx(300 / 800)]  # listeners already see the refitted zoom


def test_high_zoom_skips_prefetch(qtbot, window, pdf100, monkeypatch):
    window.open_file(pdf100)
    view, state = window._view, window.state
    state.set_zoom(state.MAX_ZOOM)
    asked = []
    monkeypatch.setattr(state.renderer, "request", asked.extend)
    view._request()
    assert {key[0] for key in asked} == set(view._visible_pages())
