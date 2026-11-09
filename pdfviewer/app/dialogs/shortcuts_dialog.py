from PySide6.QtCore import QSignalBlocker, QSize, Qt
from PySide6.QtGui import QKeySequence
from PySide6.QtWidgets import (QDialog, QDialogButtonBox, QGridLayout, QKeySequenceEdit, QLabel, QLineEdit, QPushButton,
                               QScrollArea, QToolButton, QVBoxLayout, QWidget)

from app import shortcuts, theme
from app.icons import icon

NATIVE = QKeySequence.SequenceFormat.NativeText


def _label(action):
    return action.text().replace("&", "").rstrip("…")


def _shown(keys):
    """Several keys shown in one edit: as a multi-chord sequence it reads "?, F1"."""
    return QKeySequence(", ".join(keys))


class _KeyEdit(QKeySequenceEdit):
    """Esc cancels instead of becoming the key, and leaves the edit so the next Esc closes the dialog."""

    def keyPressEvent(self, event):
        if event.key() == Qt.Key.Key_Escape and event.modifiers() == Qt.KeyboardModifier.NoModifier:
            self.clearFocus()
            return
        super().keyPressEvent(event)


def shortcuts_dialog(parent, actions, keys_changed):
    """Every action and its keys. Changing a key applies at once (keys_changed); keys that clash turn red,
    because Qt runs neither action while two share a key."""
    dialog = QDialog(parent, windowTitle="단축키 목록", objectName="shortcutsDialog")
    grid_widget = QWidget()
    grid = QGridLayout(grid_widget)
    rows = {}  # action name -> (key edit, default button)

    def owner_label(owner):
        return _label(actions[owner]) if owner in actions else f"{owner} 메뉴"

    def refresh():
        clashes = shortcuts.conflicts(list(actions))
        for name, (edit, default) in rows.items():
            with QSignalBlocker(edit):
                edit.setMaximumSequenceLength(4)  # room to show every key; lowering it again keeps them
                edit.setKeySequence(_shown(shortcuts.keys(name)))
                edit.setMaximumSequenceLength(1)  # recording takes one key, then finishes at once
            others = clashes.get(name, [])
            edit.setToolTip("\n".join(f"‘{owner_label(o)}’와 겹침" for o in others))
            text_box = edit.findChild(QLineEdit)  # the edit draws its keys in this inner box
            text_box.setProperty("conflict", bool(others))
            text_box.style().unpolish(text_box)  # QSS reads a dynamic property only on re-polish
            text_box.style().polish(text_box)
            default.setEnabled(shortcuts.keys(name) != shortcuts.KEYS.get(name, []))

    def change(name, keys):
        shortcuts.set_keys(name, keys)
        keys_changed()
        refresh()

    def recorded(name, edit):
        # also emitted when focus just leaves the edit: only a newly recorded key counts
        if not edit.keySequence().isEmpty() and edit.keySequence() != _shown(shortcuts.keys(name)):
            change(name, [QKeySequence(edit.keySequence()[0]).toString()])

    size = theme.token("size.control_sm") // 2
    for row, (name, action) in enumerate(actions.items()):
        grid.addWidget(QLabel(_label(action), objectName="fieldName"), row, 0)
        if name in shortcuts.FIXED:
            grid.addWidget(_fixed_keys(shortcuts.keys(name)), row, 1)
            continue
        edit = _KeyEdit()
        edit.setAccessibleName(f"{_label(action)} 단축키")
        edit.editingFinished.connect(lambda name=name, edit=edit: recorded(name, edit))
        clear = QToolButton(objectName="clearKey", toolTip="키 지우기", autoRaise=True)
        clear.setAccessibleName(f"{_label(action)} 키 지우기")
        clear.setIcon(icon("close"))
        clear.setIconSize(QSize(size, size))
        clear.clicked.connect(lambda checked=False, name=name: change(name, []))
        default = QPushButton("기본값으로")
        default.clicked.connect(lambda checked=False, name=name: change(name, shortcuts.KEYS.get(name, [])))
        grid.addWidget(edit, row, 1)
        grid.addWidget(clear, row, 2)
        grid.addWidget(default, row, 3)
        rows[name] = edit, default
    for row, (title, key) in enumerate(shortcuts.MENU_KEYS.items(), start=len(actions)):
        grid.addWidget(QLabel(f"{title} 메뉴 열기", objectName="fieldName"), row, 0)
        grid.addWidget(_fixed_keys([key]), row, 1)
    refresh()

    scroll = QScrollArea(widgetResizable=True)  # the list outgrows short screens
    scroll.setWidget(grid_widget)
    scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
    frame = 2 * scroll.frameWidth()
    scroll.setMinimumWidth(grid_widget.sizeHint().width() + scroll.verticalScrollBar().sizeHint().width() + frame)
    buttons = QDialogButtonBox()
    reset = buttons.addButton("전체 초기화", QDialogButtonBox.ButtonRole.ResetRole)  # standard buttons would be English
    reset.clicked.connect(lambda: (shortcuts.reset_all(), keys_changed(), refresh()))
    buttons.addButton("닫기", QDialogButtonBox.ButtonRole.RejectRole)
    buttons.rejected.connect(dialog.reject)
    layout = QVBoxLayout(dialog)
    layout.addWidget(QLabel("키 칸을 누르고 새 키를 누르면 바로 바뀝니다(Esc는 취소). 빨간 키는 다른 기능과 겹쳐 동작하지 않습니다.",
                            objectName="fieldName", wordWrap=True))
    layout.addWidget(scroll)
    layout.addWidget(buttons)
    # tall enough for the whole list, but within the screen (4/5 leaves room for the title bar)
    needed = dialog.sizeHint().height() - scroll.sizeHint().height() + grid_widget.sizeHint().height() + frame
    dialog.resize(dialog.sizeHint().width(), min(needed, dialog.screen().availableGeometry().height() * 4 // 5))
    return dialog


def _fixed_keys(keys):
    label = QLabel(", ".join(QKeySequence(key).toString(NATIVE) for key in keys), toolTip="바꿀 수 없는 키")
    label.setEnabled(False)
    return label
