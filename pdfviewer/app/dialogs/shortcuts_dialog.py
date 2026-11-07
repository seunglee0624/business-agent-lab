from PySide6.QtCore import Qt
from PySide6.QtGui import QKeySequence
from PySide6.QtWidgets import QDialog, QDialogButtonBox, QFormLayout, QLabel, QScrollArea, QVBoxLayout, QWidget


def shortcut_rows(actions):
    """(name, keys) for every action that has a shortcut. Built from the actions, so it follows shortcuts.KEYS."""
    native = QKeySequence.SequenceFormat.NativeText
    return [(action.text().replace("&", "").rstrip("…"), ", ".join(key.toString(native) for key in action.shortcuts()))
            for action in actions.values() if action.shortcuts()]


def show_shortcuts(parent, actions):
    dialog = QDialog(parent, windowTitle="단축키 목록", objectName="shortcutsDialog")
    form_widget = QWidget()
    form = QFormLayout(form_widget)
    for name, keys in shortcut_rows(actions):
        form.addRow(QLabel(name, objectName="fieldName"), QLabel(keys))
    scroll = QScrollArea(widgetResizable=True)  # the list outgrows short screens
    scroll.setWidget(form_widget)
    scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
    frame = 2 * scroll.frameWidth()
    scroll.setMinimumWidth(form_widget.sizeHint().width() + scroll.verticalScrollBar().sizeHint().width() + frame)
    buttons = QDialogButtonBox()
    buttons.addButton("닫기", QDialogButtonBox.ButtonRole.RejectRole)  # a standard button would be English
    buttons.rejected.connect(dialog.reject)
    layout = QVBoxLayout(dialog)
    layout.addWidget(scroll)
    layout.addWidget(buttons)
    # tall enough for the whole list, but within the screen (4/5 leaves room for the title bar)
    needed = dialog.sizeHint().height() - scroll.sizeHint().height() + form_widget.sizeHint().height() + frame
    dialog.resize(dialog.sizeHint().width(), min(needed, dialog.screen().availableGeometry().height() * 4 // 5))
    dialog.exec()
