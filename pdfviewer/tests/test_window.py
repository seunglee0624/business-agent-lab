from PySide6.QtCore import Qt
from PySide6.QtWidgets import QLineEdit

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
    view = window._view
    qtbot.waitUntil(lambda: not view._items[0][2].pixmap().isNull(), timeout=15000)  # worker render arrived

    qtbot.keyClick(window._view, Qt.Key.Key_Right)
    qtbot.keyClick(window._view, Qt.Key.Key_Right)
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


def test_toolbar_buttons_are_icons_with_tooltips(qtbot):
    from PySide6.QtWidgets import QToolBar
    w = MainWindow()
    qtbot.addWidget(w)
    for bar in w.findChildren(QToolBar):
        for action in bar.actions():
            if action.isSeparator() or not action.text() or action.text() in ("Aa", "단어"):
                continue  # widgets (page box, zoom box) and the text toggles
            assert not action.icon().isNull() and action.toolTip(), action.text()
    assert w._actions["zoom_in"].toolTip() == "확대 (Ctrl++)"


def test_tab_key_follows_the_screen_order(qtbot, pdf100):
    """Toolbar, sidebar, document, chat: also after the chat panel remakes its quick-question buttons."""
    from PySide6.QtWidgets import QApplication
    window = MainWindow()
    qtbot.addWidget(window)
    window.show()
    window.activateWindow()
    qtbot.waitUntil(window.isActiveWindow)
    window.open_file(pdf100)
    window._actions["toggle_chat"].trigger()
    window._chat_panel._fill_quick()
    regions = [window._toolbar, window._sidebar, window.centralWidget(), window._chat_panel]
    seen = []
    window._toolbar.findChild(QLineEdit).setFocus()  # the page number box, the first stop
    for _ in range(40):
        widget = QApplication.focusWidget()
        seen.append(next(i for i, r in enumerate(regions) if r.isAncestorOf(widget)))
        window.focusNextChild()
    first_lap = seen[:seen.index(0, seen.index(3))]  # up to the return to the toolbar
    assert first_lap == sorted(first_lap) and set(first_lap) == {0, 1, 2, 3}
    window.state.renderer.shutdown()


def test_chat_card_starts_level_with_the_page(qtbot, pdf100):
    from PySide6.QtCore import QPoint
    window = MainWindow()
    qtbot.addWidget(window)
    window.show()
    window.chat.set_panel(True)
    top = lambda widget: widget.mapTo(window, QPoint(0, 0)).y()
    qtbot.waitUntil(lambda: top(window._chat_panel) == top(window._stack))  # no tabs yet: both at the top
    window.open_file(pdf100)
    qtbot.waitUntil(lambda: top(window._chat_panel) == top(window._view) > top(window._tab_bar))
