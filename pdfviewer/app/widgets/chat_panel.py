from PySide6.QtCore import QEvent, QSize, Qt, QTimer, Signal
from PySide6.QtGui import QTextCharFormat, QTextCursor, QTextFrameFormat
from PySide6.QtWidgets import (QComboBox, QHBoxLayout, QLabel, QPlainTextEdit, QTextBrowser, QToolButton, QVBoxLayout,
                               QWidget)

from app import theme
from app.chat_state import SCOPES
from app.icons import icon

RENDER_MS = 50  # an answer streams in many small pieces: redraw at most this often


class _Input(QPlainTextEdit):
    """Enter sends, Shift+Enter starts a new line, Esc goes back to the page."""

    submitted = Signal()
    leave = Signal()

    def event(self, event):
        if event.type() == QEvent.Type.ShortcutOverride and event.key() == Qt.Key.Key_Escape:
            event.accept()  # ours, not the window's Esc action
            return True
        return super().event(event)

    def keyPressEvent(self, event):
        if event.key() in (Qt.Key.Key_Return, Qt.Key.Key_Enter) and not event.modifiers() & Qt.KeyboardModifier.ShiftModifier:
            self.submitted.emit()
        elif event.key() == Qt.Key.Key_Escape:
            self.leave.emit()
        else:
            super().keyPressEvent(event)


class ChatPanel(QWidget):
    """Right-side AI chat: scope and clear on top, the conversation, then the question box.
    Everything it shows comes from ChatState; it keeps no conversation of its own."""

    leave = Signal()  # Esc in the question box

    def __init__(self, chat):
        super().__init__(objectName="chatPanel")
        self._chat = chat
        self._scope = QComboBox(accessibleName="질문 범위", toolTip="질문과 함께 보낼 부분")
        for key, label in SCOPES.items():
            self._scope.addItem(label, key)
        self._scope.activated.connect(lambda i: chat.set_scope(self._scope.itemData(i)))
        clear = self._button("clear_chat", "대화 지우기", chat.clear)
        top = QHBoxLayout()
        top.addWidget(self._scope, 1)
        top.addWidget(clear)

        self._notice = QLabel("AI 채팅을 쓰려면 ANTHROPIC_API_KEY 환경변수에 API 키를 넣고 앱을 다시 시작하세요.",
                              objectName="chatNotice", wordWrap=True)
        self._log = QTextBrowser(objectName="chatLog", openLinks=False,
                                 placeholderText="지금 보는 페이지나 선택한 부분에 대해 물어보세요.")
        self._input = _Input(objectName="chatInput", accessibleName="질문",
                             placeholderText="질문 입력 (Enter 보내기, Shift+Enter 줄바꿈)")
        self._input.setTabChangesFocus(True)
        self._input.submitted.connect(self._send)
        self._input.leave.connect(self.leave)
        self._send_button = self._button("send", "보내기 (Enter)", self._send_or_stop)
        bottom = QHBoxLayout()
        bottom.addWidget(self._input, 1)
        bottom.addWidget(self._send_button, 0, Qt.AlignmentFlag.AlignBottom)

        layout = QVBoxLayout(self)
        gap = theme.token("spacing.md")
        layout.setContentsMargins(gap, gap, gap, gap)
        layout.setSpacing(gap)
        layout.addLayout(top)
        layout.addWidget(self._notice)
        layout.addWidget(self._log, 1)
        layout.addLayout(bottom)

        self._timer = QTimer(self, singleShot=True, interval=RENDER_MS, timeout=self._render)
        chat.changed.connect(lambda: self._timer.isActive() or self._timer.start())
        chat.busy_changed.connect(self._apply_busy)
        chat.scope_changed.connect(self._apply_scope)
        available = chat.backend.is_available()
        self._notice.setVisible(not available)
        self._input.setEnabled(available)
        self._send_button.setEnabled(available)
        self._apply_scope()
        self._apply_busy()
        self._render()

    def _button(self, name, tip, slot):
        button = QToolButton(objectName="chatButton", toolTip=tip, autoRaise=True)
        button.setAccessibleName(tip.split(" (")[0])
        button.setIcon(icon(name))
        size = theme.token("size.control_sm")
        button.setIconSize(QSize(size, size))  # icons.py centres the glyph in the button square
        button.clicked.connect(slot)
        return button

    def sizeHint(self):  # the dock's first width (also for a window state saved before the panel existed)
        return QSize(theme.token("size.chat_width"), super().sizeHint().height())

    def focus_input(self):
        self._input.setFocus()

    def _send(self):
        if not self._chat.busy:
            self._chat.send(self._input.toPlainText())
            if self._chat.busy:  # sent: an empty box or no document leaves the text where it is
                self._input.clear()

    def _send_or_stop(self):
        self._chat.cancel() if self._chat.busy else self._send()

    def _apply_busy(self):
        busy = self._chat.busy
        self._send_button.setIcon(icon("stop" if busy else "send"))
        tip = "중지" if busy else "보내기 (Enter)"
        self._send_button.setToolTip(tip)
        self._send_button.setAccessibleName(tip.split(" (")[0])

    def _apply_scope(self):
        self._scope.setCurrentIndex(self._scope.findData(self._chat.scope))

    def _render(self):
        bar = self._log.verticalScrollBar()
        follow = bar.value() >= bar.maximum() - theme.token("spacing.xl")  # the reader was at the end: keep up
        document = self._log.document()
        document.clear()
        cursor = QTextCursor(document)
        frame = QTextFrameFormat()
        frame.setPadding(theme.token("spacing.md"))
        frame.setBottomMargin(theme.token("spacing.md"))
        muted, danger = QTextCharFormat(), QTextCharFormat()
        muted.setForeground(theme.color("color.text_muted"))
        danger.setForeground(theme.color("color.danger"))
        for message in self._chat.messages:
            role = message["role"]
            if role == "error":
                cursor.insertText(message["text"], danger)
                cursor.insertBlock()
                continue
            frame.setBackground(theme.color("color.chat_user" if role == "user" else "color.chat_assistant"))
            cursor.insertFrame(frame)
            if role == "user":
                cursor.insertText(f"{message['where']}  ", muted)
                cursor.insertText(message["text"], QTextCharFormat())
            elif message["text"]:
                cursor.insertMarkdown(message["text"])
            else:
                cursor.insertText("중단됨" if not message.get("streaming") else "…", muted)
            cursor.movePosition(QTextCursor.MoveOperation.End)  # out of the frame
        if follow:
            bar.setValue(bar.maximum())
