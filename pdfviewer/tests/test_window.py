from PySide6.QtCore import Qt

from app.main_window import MainWindow
from app.widgets.toolbar import Toolbar


def test_open_and_page_with_arrow_keys(qtbot, pdf100):
    window = MainWindow()
    qtbot.addWidget(window)
    window.show()
    window.activateWindow()
    qtbot.waitUntil(window.isActiveWindow)  # window shortcuts fire only in the active window
    window.open_file(pdf100)
    assert window.windowTitle().startswith("hundred.pdf")
    view = window.centralWidget()
    qtbot.waitUntil(lambda: not view._items[0][2].pixmap().isNull(), timeout=15000)  # worker render arrived

    qtbot.keyClick(window.centralWidget(), Qt.Key.Key_Right)
    qtbot.keyClick(window.centralWidget(), Qt.Key.Key_Right)
    assert window.state.current_page == 2

    toolbar = window.findChild(Toolbar)
    assert toolbar._page.value() == 3
    toolbar._zoom.textActivated.emit("150%")
    assert window.state.zoom == 1.5 and toolbar._zoom.currentText() == "150%"


def test_cancelled_password_keeps_viewer_empty(qtbot, locked_pdf, monkeypatch):
    monkeypatch.setattr("app.main_window.ask_password", lambda *args: None)
    window = MainWindow()
    qtbot.addWidget(window)
    window.open_file(locked_pdf)
    assert window.state.document is None


def test_password_retry_then_open(qtbot, locked_pdf, monkeypatch):
    answers = iter(["wrong", "secret"])
    monkeypatch.setattr("app.main_window.ask_password", lambda *args: next(answers))
    window = MainWindow()
    qtbot.addWidget(window)
    window.open_file(locked_pdf)
    assert window.state.page_count == 2
