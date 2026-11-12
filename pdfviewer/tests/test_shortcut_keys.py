import pytest
from PySide6.QtCore import Qt
from PySide6.QtGui import QKeySequence
from PySide6.QtWidgets import QKeySequenceEdit, QLineEdit, QPushButton, QTabBar, QToolButton

from app import shortcuts
from app.core import settings
from app.dialogs.shortcuts_dialog import shortcuts_dialog
from app.main_window import MainWindow


def test_user_keys_override_the_defaults_and_reset_drops_them():
    assert shortcuts.keys("next") == ["Right"]
    shortcuts.set_keys("next", ["J"])
    assert shortcuts.keys("next") == ["J"]
    shortcuts.set_keys("next", ["Right"])  # back to the default: nothing left to store
    assert settings.shortcut_overrides() == {}
    shortcuts.set_keys("fit_width", ["W"])  # an action without a default key can get one
    shortcuts.set_keys("zoom_in", [])  # and a key can be removed
    assert shortcuts.keys("fit_width") == ["W"] and shortcuts.keys("zoom_in") == []
    shortcuts.reset_all()
    assert shortcuts.keys("zoom_in") == ["Ctrl++", "Ctrl+="]


def test_fixed_keys_cannot_change():
    for name in shortcuts.FIXED:
        with pytest.raises(ValueError):
            shortcuts.set_keys(name, ["J"])


def test_conflicts_name_every_owner_of_a_shared_key():
    names = list(shortcuts.KEYS)
    assert shortcuts.conflicts(names) == {}  # the defaults never clash
    shortcuts.set_keys("next", ["ctrl+o"])  # spelled differently, same key
    shortcuts.set_keys("prev", ["Alt+F"])  # the File menu's key
    assert shortcuts.conflicts(names) == {"next": ["open"], "open": ["next"], "prev": ["파일"]}


@pytest.fixture
def window(qtbot, pdf100):
    window = MainWindow()
    qtbot.addWidget(window)
    window.show()
    window.activateWindow()
    qtbot.waitUntil(window.isActiveWindow)  # window shortcuts fire only in the active window
    window.open_file(pdf100)
    return window


@pytest.fixture
def dialog(qtbot, window):
    dialog = shortcuts_dialog(window, window._actions, window._keys_changed)
    qtbot.addWidget(dialog)
    return dialog


def edit_of(dialog, label):
    return next(e for e in dialog.findChildren(QKeySequenceEdit) if e.accessibleName() == f"{label} 단축키")


def record(edit, key):
    edit.setKeySequence(QKeySequence(key))
    edit.editingFinished.emit()


def red(edit):
    return edit.findChild(QLineEdit).property("conflict") is True


def test_saved_keys_apply_at_startup(window):
    shortcuts.set_keys("next", ["J"])
    fresh = MainWindow()
    assert [k.toString() for k in fresh._actions["next"].shortcuts()] == ["J"]
    assert fresh._actions["next"].toolTip() == "다음 페이지 (J)"
    fresh.close()


def test_a_recorded_key_works_at_once(qtbot, window, dialog):
    record(edit_of(dialog, "다음 페이지"), "J")
    assert window._actions["next"].toolTip() == "다음 페이지 (J)"
    page = window.state.current_page
    qtbot.keyClick(window._view, Qt.Key.Key_J)
    assert window.state.current_page == page + 1


def test_clashing_keys_turn_red_until_one_changes(window, dialog):
    next_edit, open_edit = edit_of(dialog, "다음 페이지"), edit_of(dialog, "열기")
    record(next_edit, "Ctrl+O")
    assert red(next_edit) and red(open_edit)
    assert next_edit.toolTip() == "‘열기’와 겹침"
    record(next_edit, "J")
    assert not red(next_edit) and not red(open_edit)


def test_clear_default_and_reset_buttons(window, dialog):
    edit = edit_of(dialog, "확대")
    row = dialog.findChild(QToolButton, "rowRemove").parentWidget().layout()
    index = row.indexOf(edit)
    r, _, _, _ = row.getItemPosition(index)
    clear, default = row.itemAtPosition(r, 2).widget(), row.itemAtPosition(r, 3).widget()
    assert isinstance(default, QPushButton) and default.isHidden()  # nothing to undo yet
    clear.click()
    assert window._actions["zoom_in"].shortcuts() == [] and not default.isHidden()
    default.click()
    assert [k.toString() for k in window._actions["zoom_in"].shortcuts()] == ["Ctrl++", "Ctrl+="]
    record(edit_of(dialog, "축소"), "Z")
    next(b for b in dialog.findChildren(QPushButton) if b.text() == "전체 초기화").click()
    assert settings.shortcut_overrides() == {}
    assert edit_of(dialog, "축소").keySequence().toString() == "Ctrl+-"


def test_leaving_an_edit_keeps_its_keys(window, dialog):
    edit_of(dialog, "확대").editingFinished.emit()  # Tab through: no key was recorded
    assert shortcuts.keys("zoom_in") == ["Ctrl++", "Ctrl+="]


def test_fixed_keys_are_shown_but_not_editable(dialog):
    names = {e.accessibleName() for e in dialog.findChildren(QKeySequenceEdit)}
    assert "복사 단축키" not in names and "다음 페이지 단축키" in names
    assert "폭 맞춤 단축키" in names  # actions without a key are listed too


def test_tab_close_tooltip_follows_the_key(window, dialog):
    record(edit_of(dialog, "탭 닫기"), "Ctrl+K")
    tabs = window._tab_bar
    assert tabs.tabButton(0, QTabBar.ButtonPosition.RightSide).toolTip() == "탭 닫기 (Ctrl+K)"


def test_esc_in_a_key_edit_cancels(qtbot, dialog):
    dialog.show()
    edit = edit_of(dialog, "다음 페이지")
    edit.setFocus()
    qtbot.waitUntil(edit.hasFocus)
    qtbot.keyClick(edit, Qt.Key.Key_Escape)
    assert shortcuts.keys("next") == ["Right"] and edit.keySequence().toString() == "Right"
    assert not edit.hasFocus() and dialog.isVisible()  # the next Esc closes the dialog


def test_every_key_box_shows_its_whole_text(qtbot, dialog):
    dialog.show()
    qtbot.waitExposed(dialog)
    for edit in dialog.findChildren(QKeySequenceEdit):
        box = edit.findChild(QLineEdit)
        assert box.fontMetrics().horizontalAdvance(box.text()) <= box.contentsRect().width() - 8, box.text()
