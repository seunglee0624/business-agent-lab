"""Phase 6a: settings, empty state, drag & drop, status bar, document properties."""
import pytest
from PySide6.QtCore import QMimeData, QPointF, Qt, QUrl
from PySide6.QtGui import QDragEnterEvent, QDropEvent

from app.core import settings
from app.core.document import Document, format_size
from app.dialogs.properties_dialog import pdf_date, rows
from app.main_window import MainWindow
from app.viewer_state import ViewerState
from conftest import make_pdf


def make_window(qtbot):
    w = MainWindow()
    qtbot.addWidget(w)
    w.resize(900, 700)
    w.show()
    return w


def test_recent_files_newest_first_without_duplicates(monkeypatch):
    monkeypatch.setattr(settings, "MAX_RECENT", 3)
    for path in ["/a", "/b", "/c", "/a", "/d"]:
        settings.add_recent(path)
    assert settings.recent_files() == ["/d", "/a", "/c"]
    settings.remove_recent("/a")
    assert settings.recent_files() == ["/d", "/c"]


def test_file_views_forget_the_oldest(monkeypatch):
    monkeypatch.setattr(settings, "MAX_FILE_VIEWS", 2)
    for i, path in enumerate(["/a", "/b", "/a", "/c"]):
        settings.save_file_view(path, i, "custom", 1.5)
    assert settings.file_view("/b") is None  # /a was saved again, so /b was the oldest
    assert settings.file_view("/a") == (2, "custom", 1.5) and settings.file_view("/c") == (3, "custom", 1.5)


def test_reopen_returns_to_page_and_zoom(qtbot, pdf100, tmp_path):
    other = make_pdf(tmp_path / "other.pdf", 3)
    st = ViewerState()
    st.set_viewport(800, 600)
    st.open(Document(pdf100))
    st.go_to(41)
    st.set_zoom(1.5)
    st.open(Document(other))  # leaving a file remembers it
    assert (st.current_page, st.zoom_mode) == (0, "custom")  # a new file starts at the top
    st.fit_width()
    st.open(Document(pdf100))
    assert (st.current_page, st.zoom_mode, st.zoom) == (41, "custom", 1.5)
    st.open(Document(other))
    assert st.zoom_mode == "fit_width" and st.zoom == pytest.approx(800 / 600)  # a fit mode refits
    assert settings.recent_files()[:2] == [other, pdf100]
    st.renderer.shutdown()


def test_saved_page_beyond_the_end_is_clamped(qtbot, pdf100):
    settings.save_file_view(pdf100, 500, "fit_width", 1.0)
    st = ViewerState()
    st.open(Document(pdf100))
    assert st.current_page == 99
    st.renderer.shutdown()


def test_empty_state_then_document(qtbot, pdf100):
    settings.add_recent(pdf100)
    window = make_window(qtbot)
    assert window._stack.currentWidget() is window._empty
    assert not window._actions["properties"].isEnabled()
    recent = window._empty._list
    assert recent.isVisible() and recent.model().rowCount() == 1
    recent.clicked.emit(recent.model().index(0, 0))  # pick it from the recent list
    assert window.state.page_count == 100
    assert window._stack.currentWidget() is window._view
    assert window._actions["properties"].isEnabled()


def test_missing_recent_file_is_dropped(qtbot, tmp_path, monkeypatch):
    warnings = []
    monkeypatch.setattr("app.main_window.QMessageBox.warning", lambda *args: warnings.append(args))
    gone = str(tmp_path / "gone.pdf")
    settings.add_recent(gone)
    window = make_window(qtbot)
    window.open_file(gone)
    assert warnings and settings.recent_files() == []
    assert window._empty._model.rowCount() == 0


_mime = []  # events do not own their QMimeData: keep it alive until the test ends


def drag_event(cls, paths):
    data = QMimeData()
    data.setUrls([QUrl.fromLocalFile(p) for p in paths])
    _mime.append(data)
    if cls is QDropEvent:
        return QDropEvent(QPointF(10, 10), Qt.DropAction.CopyAction, data, Qt.MouseButton.NoButton, Qt.KeyboardModifier.NoModifier)
    return QDragEnterEvent(QPointF(10, 10), Qt.DropAction.CopyAction, data, Qt.MouseButton.NoButton, Qt.KeyboardModifier.NoModifier)


def test_drop_a_pdf_to_open_it(qtbot, pdf100, tmp_path):
    window = make_window(qtbot)
    text = tmp_path / "notes.txt"
    text.write_text("hi")
    enter = drag_event(QDragEnterEvent, [str(text)])
    window.dragEnterEvent(enter)
    assert not enter.isAccepted()  # only PDFs
    enter = drag_event(QDragEnterEvent, [str(text), pdf100])
    window.dragEnterEvent(enter)
    assert enter.isAccepted()
    window.dropEvent(drag_event(QDropEvent, [pdf100]))
    qtbot.waitUntil(lambda: window.state.page_count == 100)
    assert not window._view.acceptDrops() and not window._view.viewport().acceptDrops()  # drops reach the window


def test_status_bar(qtbot, pdf100):
    window = make_window(qtbot)
    status = window._status
    assert status._file.text() == "" and status._page.text() == ""
    window.open_file(pdf100)
    assert status._file.text() == f"hundred.pdf · {format_size(window.state.document.file_size)}"
    window.state.go_to(9)
    window.state.set_zoom(1.25)
    assert (status._page.text(), status._zoom.text()) == ("10 / 100쪽", "125%")
    qtbot.waitUntil(lambda: status._renders.text().startswith("페이지 불러오는 중"), timeout=5000)
    qtbot.waitUntil(lambda: status._renders.text() == "", timeout=15000)
    window.state.toggle_presentation()
    assert status.isHidden()


def test_window_and_file_view_saved_on_close(qtbot, pdf100):
    window = make_window(qtbot)
    window.resize(700, 500)
    window.open_file(pdf100)
    window.state.go_to(7)
    window.close()
    assert settings.file_view(pdf100)[0] == 7
    again = MainWindow()
    qtbot.addWidget(again)
    assert (again.width(), again.height()) == (700, 500)


def test_properties(tmp_path, locked_pdf):
    assert pdf_date("D:20240131093005+09'00'") == "2024-01-31 09:30:05"
    assert pdf_date("D:2024") == "2024-01-01 00:00:00"
    assert pdf_date("") == "" and pdf_date("yesterday") == "yesterday"
    assert format_size(500) == "500 B" and format_size(2.5 * 1024 ** 2) == "2.5 MB"
    doc = Document(make_pdf(tmp_path / "p.pdf", 2))
    shown = dict(rows(doc))
    assert shown["페이지 크기"] == "212 × 282 mm" and shown["페이지 수"] == "2" and shown["암호화"] == "없음"
    assert shown["PDF 버전"].startswith("PDF")
    locked = Document(locked_pdf)
    locked.authenticate("secret")
    assert "AES" in dict(rows(locked))["암호화"]
