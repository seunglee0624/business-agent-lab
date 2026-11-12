import time

import pytest

from app import theme
from app.core.document import Document
from app.core.render_worker import render as _render
from app.viewer_state import ViewerState


def test_document_basics(pdf100):
    doc = Document(pdf100)
    assert doc.page_count == 100
    assert not doc.is_locked
    assert doc.page_size(0) == (600, 800)
    width, height, _, _ = _render(doc.key, None, 0, 0.5, 0)
    assert (width, height) == (300, 400)


def test_password(locked_pdf):
    doc = Document(locked_pdf)
    assert doc.is_locked
    assert not doc.authenticate("wrong")
    assert doc.authenticate("secret")
    assert not doc.is_locked and doc.page_count == 2


def test_missing_file_raises(tmp_path):
    with pytest.raises((OSError, RuntimeError)):
        Document(tmp_path / "nope.pdf")


def test_navigation_clamps_and_signals(pdf100):
    state = ViewerState()
    pages = []
    state.page_changed.connect(pages.append)
    state.prev()  # no document: no-op
    state.open(Document(pdf100))
    state.prev()
    state.next()
    state.go_to(500)
    assert pages == [1, 99]
    assert state.current_page == 99


def test_fit_and_custom_zoom(pdf100):
    state = ViewerState()
    state.set_viewport(300, 300)
    state.open(Document(pdf100))
    assert state.zoom == pytest.approx(0.375)  # default fit_page: 300 / 800
    state.fit_width()
    assert state.zoom == pytest.approx(0.5)  # 300 / 600
    state.set_zoom(100)
    assert state.zoom_mode == "custom" and state.zoom == ViewerState.MAX_ZOOM
    state.set_viewport(900, 900)  # custom zoom ignores viewport changes
    assert state.zoom == ViewerState.MAX_ZOOM


def test_every_qss_placeholder_has_a_token():
    assert "{{" not in theme.stylesheet()


def test_page_render_is_fast(pdf100):
    # Phase 1 completion: paging through 100 pages must feel instant
    doc = Document(pdf100)
    start = time.perf_counter()
    for i in range(100):
        _render(doc.key, None, i, 1.5, 0)
    assert (time.perf_counter() - start) / 100 < 0.05


def test_palette_comes_from_the_tokens():
    from PySide6.QtGui import QPalette
    p = theme.palette()  # every PALETTE entry names a real role and token, or this raises
    assert p.color(QPalette.ColorRole.Window) == theme.color("color.bg_panel")
    assert p.color(QPalette.ColorGroup.Disabled, QPalette.ColorRole.Text) == theme.color("color.text_disabled")
