from PySide6.QtCore import QSize
from PySide6.QtWidgets import (QComboBox, QDialog, QDialogButtonBox, QGridLayout, QHBoxLayout, QLabel, QLineEdit,
                               QPushButton, QToolButton, QVBoxLayout, QWidget)

from app import theme
from app.core import settings
from app.icons import icon


def quick_questions_dialog(parent, questions, scopes):
    """Edit the chat's quick-question buttons: name, question and scope per row.
    Returns the new list, or None when cancelled. Rows without a name or a question are dropped."""
    dialog = QDialog(parent, windowTitle="빠른 질문 편집", objectName="quickQuestionsDialog")
    grid_widget = QWidget()
    grid = QGridLayout(grid_widget)
    rows = []  # (name edit, question edit, scope combo)

    def fill(items):
        while grid.count():
            grid.takeAt(0).widget().deleteLater()
        rows.clear()
        for header, column in (("버튼 이름", 0), ("질문", 1), ("범위", 2)):
            grid.addWidget(QLabel(header, objectName="fieldName"), 0, column)
        for row, item in enumerate(items, start=1):
            name = QLineEdit(item["label"], placeholderText="버튼 이름", accessibleName=f"{row}번 버튼 이름")
            name.setCursorPosition(0)
            name.setMinimumWidth(theme.token("size.menu_label"))
            text = QLineEdit(item["text"], placeholderText="AI에게 보낼 질문", accessibleName=f"{row}번 질문")
            text.setCursorPosition(0)  # show the start, not the end
            text.setMinimumWidth(theme.token("size.comment_width"))  # a default question fits; the dialog stays near the others' width
            scope = QComboBox(accessibleName=f"{row}번 범위")
            scope.addItem("지금 범위", "")
            for key, label in scopes.items():
                scope.addItem(label, key)
            scope.setCurrentIndex(max(0, scope.findData(item.get("scope", ""))))
            remove = QToolButton(objectName="rowRemove", toolTip="이 줄 지우기")
            remove.setAccessibleName(f"{row}번 지우기")
            remove.setIcon(icon("close"))
            size = theme.token("size.control_sm")
            remove.setFixedSize(size, size)  # a square as tall as the row's boxes, easy to hit
            remove.setIconSize(QSize(size, size))  # icons are drawn on a button-sized square: full size = the usual 20px glyph
            remove.clicked.connect(lambda checked=False, i=row - 1: fill([r for j, r in enumerate(current()) if j != i]))
            for column, widget in enumerate((name, text, scope, remove)):
                grid.addWidget(widget, row, column)
            rows.append((name, text, scope))
        grid.setColumnStretch(1, 1)

    def current(keep_empty=True):
        items = [{"label": name.text().strip(), "text": text.text().strip(), "scope": scope.currentData()}
                 for name, text, scope in rows]
        return items if keep_empty else [item for item in items if item["label"] and item["text"]]

    fill(questions)
    tools = QHBoxLayout()  # under the rows on the left, where a new row appears; not one at each end
    add, reset = QPushButton("추가"), QPushButton("기본값으로")
    add.clicked.connect(lambda: (fill([*current(), {"label": "", "text": "", "scope": ""}]), rows[-1][0].setFocus()))
    reset.clicked.connect(lambda: fill(settings.DEFAULT_QUICK_QUESTIONS))
    tools.addWidget(add)
    tools.addWidget(reset)
    tools.addStretch(1)
    buttons = QDialogButtonBox()
    save = buttons.addButton("저장", QDialogButtonBox.ButtonRole.AcceptRole)  # standard buttons would be English
    save.setObjectName("primary")
    buttons.addButton("취소", QDialogButtonBox.ButtonRole.RejectRole)
    buttons.accepted.connect(dialog.accept)
    buttons.rejected.connect(dialog.reject)
    layout = QVBoxLayout(dialog)
    layout.addWidget(QLabel("패널 아래 버튼을 누르면 이 질문을 바로 보냅니다. 범위를 정하면 그 범위로 바꿔서 보냅니다.",
                            objectName="fieldName", wordWrap=True))
    layout.addWidget(grid_widget)
    layout.addLayout(tools)
    layout.addWidget(buttons)
    return current(keep_empty=False) if dialog.exec() == QDialog.DialogCode.Accepted else None
