import re

from PySide6.QtCore import QEvent, QPoint, QRect, QSize, Qt, QTimer, Signal
from PySide6.QtGui import QDesktopServices, QPalette, QTextBlockFormat, QTextCharFormat, QTextCursor, QTextFrameFormat
from PySide6.QtWidgets import (QButtonGroup, QHBoxLayout, QLabel, QLayout, QPlainTextEdit, QPushButton, QTextBrowser,
                               QToolButton, QVBoxLayout, QWidget)

from app import theme
from app.chat_state import SCOPES
from app.dialogs.quick_questions_dialog import quick_questions_dialog
from app.icons import icon

RENDER_MS = 50  # an answer streams in many small pieces: redraw at most this often
PAGE_REF = re.compile(r"(?<![\w\[/])p\.\s?(\d+)(?:\s?[–-]\s?\d+)?")  # p.12, p. 12, p.3–5 (links to the first page)

HINTS = {  # what to do about each kind of error
    "auth": "환경변수 ANTHROPIC_API_KEY 에 콘솔에서 발급한 키가 정확히 들어 있는지 확인하고 앱을 다시 시작하세요.",
    "rate_limit": "계속되면 Anthropic 콘솔에서 잔액과 월 사용 한도를 확인하세요.",
    "network": "인터넷 연결을 확인하고 다시 보내세요.",
    "context_too_long": "범위를 '현재 페이지'나 '선택한 부분'으로 줄이거나, 대화를 지우고 다시 물어보세요.",
    "refused": "질문을 바꿔 다시 물어보세요.",
    "no_selection": "페이지에서 글자를 드래그해 선택한 뒤 다시 물어보세요.",
    "other": "잠시 뒤 다시 보내세요. 계속되면 로그 파일을 확인하세요.",
}


def _tokens(n):
    return f"{n / 1000:.1f}k" if n >= 1000 else str(n)


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


class _Flow(QLayout):
    """Buttons left to right, wrapping onto the next row when the panel is narrow."""

    def __init__(self, spacing):
        super().__init__()
        self._items = []
        self.setSpacing(spacing)
        self.setContentsMargins(0, 0, 0, 0)

    def addItem(self, item):
        self._items.append(item)

    def count(self):
        return len(self._items)

    def itemAt(self, i):
        return self._items[i] if 0 <= i < len(self._items) else None

    def takeAt(self, i):
        return self._items.pop(i) if 0 <= i < len(self._items) else None

    def hasHeightForWidth(self):
        return True

    def heightForWidth(self, width):
        return self._place(QRect(0, 0, width, 0), move=False)

    def setGeometry(self, rect):
        super().setGeometry(rect)
        self._place(rect, move=True)

    def sizeHint(self):
        return self.minimumSize()

    def minimumSize(self):
        size = QSize()
        for item in self._items:
            size = size.expandedTo(item.minimumSize())
        return size

    def _place(self, rect, move):
        x, y, row_height, gap = rect.x(), rect.y(), 0, self.spacing()
        for item in self._items:
            hint = item.sizeHint()
            if x > rect.x() and x + hint.width() > rect.right() + 1:
                x, y, row_height = rect.x(), y + row_height + gap, 0
            if move:
                item.setGeometry(QRect(QPoint(x, y), hint))
            x += hint.width() + gap
            row_height = max(row_height, hint.height())
        return y + row_height - rect.y()


class ChatPanel(QWidget):
    """Right-side AI chat: scope and clear on top, what the question will carry, the conversation,
    quick questions, then the question box. Everything it shows comes from ChatState."""

    leave = Signal()  # Esc in the question box

    def __init__(self, chat):
        super().__init__(objectName="chatPanel")
        self._chat = chat
        # one button per scope, not a drop-down: one click, and no popup (WSLg's Wayland popups do not close)
        self._scope = QButtonGroup(self, exclusive=True)
        top = QHBoxLayout()
        top.setSpacing(theme.token("spacing.sm"))
        for key, label in SCOPES.items():
            button = QPushButton(label, objectName="scope", checkable=True, toolTip="질문과 함께 보낼 부분")
            button.setAccessibleName(f"질문 범위: {label}")
            button.clicked.connect(lambda checked=False, key=key: self._choose_scope(key))
            self._scope.addButton(button)
            button.scope = key
            top.addWidget(button)
        top.addStretch(1)
        top.addWidget(self._button("clear_chat", "대화 지우기", chat.clear))
        self._info = QLabel(objectName="chatInfo", wordWrap=True)

        self._notice = QLabel("AI 채팅을 쓰려면 ANTHROPIC_API_KEY 환경변수에 API 키를 넣고 앱을 다시 시작하세요.",
                              objectName="chatNotice", wordWrap=True)
        self._log = QTextBrowser(objectName="chatLog", openLinks=False,
                                 placeholderText="지금 보는 페이지나 선택한 부분에 대해 물어보세요.")
        palette = self._log.palette()
        palette.setColor(QPalette.ColorRole.Link, theme.color("color.accent"))
        self._log.setPalette(palette)
        self._log.anchorClicked.connect(self._open_link)

        self._quick = QWidget()
        self._quick.setLayout(_Flow(theme.token("spacing.sm")))
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
        layout.addWidget(self._info)
        layout.addWidget(self._notice)
        layout.addWidget(self._log, 1)
        layout.addWidget(self._quick)
        layout.addLayout(bottom)

        self._timer = QTimer(self, singleShot=True, interval=RENDER_MS, timeout=self._render)
        chat.changed.connect(lambda: self._timer.isActive() or self._timer.start())
        chat.busy_changed.connect(self._apply_busy)
        chat.scope_changed.connect(self._apply_scope)
        chat.context_changed.connect(self._show_info)
        chat.quick_changed.connect(self._fill_quick)
        self._available = chat.backend.is_available()
        self._notice.setVisible(not self._available)
        self._input.setEnabled(self._available)
        self._fill_quick()
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

    def _choose_scope(self, scope):
        """A scope picked: the keys go straight to the question box."""
        self._chat.set_scope(scope)
        if self._input.isEnabled():
            self._input.setFocus()

    def _send(self):
        if not self._chat.busy:
            self._chat.send(self._input.toPlainText())
            if self._chat.busy:  # sent: an empty box or no document leaves the text where it is
                self._input.clear()

    def _send_or_stop(self):
        self._chat.cancel() if self._chat.busy else self._send()

    def _open_link(self, url):
        if url.scheme() == "page":
            self._chat.open_page(int(url.path()))
        elif url.scheme() in ("http", "https"):
            QDesktopServices.openUrl(url)

    def _fill_quick(self):
        layout = self._quick.layout()
        while layout.count():
            layout.takeAt(0).widget().deleteLater()
        for question in self._chat.quick_questions:
            chip = QPushButton(question["label"], objectName="chip")
            scope = SCOPES.get(question.get("scope"), "지금 범위")
            chip.setToolTip(f"{question['text']}\n({scope})")
            chip.clicked.connect(lambda checked=False, q=question: self._chat.ask_quick(q))
            layout.addWidget(chip)
        layout.addWidget(self._button("edit", "빠른 질문 편집", self._edit_quick))
        self._apply_busy()

    def _edit_quick(self):
        questions = quick_questions_dialog(self, self._chat.quick_questions, SCOPES)
        if questions is not None:
            self._chat.set_quick_questions(questions)

    def _apply_busy(self):
        busy = self._chat.busy
        self._send_button.setIcon(icon("stop" if busy else "send"))
        tip = "중지" if busy else "보내기 (Enter)"
        self._send_button.setToolTip(tip)
        self._send_button.setAccessibleName(tip.split(" (")[0])
        self._send_button.setEnabled(self._available)
        for chip in self._quick.findChildren(QPushButton, "chip"):
            chip.setEnabled(self._available and not busy)

    def _apply_scope(self):
        for button in self._scope.buttons():
            button.setChecked(button.scope == self._chat.scope)

    def _show_info(self):
        info = self._chat.context_info()
        self._info.setText(f"{info} · {self._chat.backend.model}" if info else self._chat.backend.model)

    def _render(self):
        self._show_info()
        bar = self._log.verticalScrollBar()
        follow = bar.value() >= bar.maximum() - theme.token("spacing.xl")  # the reader was at the end: keep up
        document = self._log.document()
        document.clear()
        cursor = QTextCursor(document)
        plain, muted, danger = QTextCharFormat(), QTextCharFormat(), QTextCharFormat()
        muted.setForeground(theme.color("color.text_muted"))
        danger.setForeground(theme.color("color.danger"))
        for message in self._chat.messages:
            role, text = message["role"], message["text"]
            if role == "note":
                cursor.insertText(text, muted)
                cursor.insertBlock()
                continue
            frame = QTextFrameFormat()
            frame.setPadding(theme.token("spacing.md"))
            frame.setBottomMargin(theme.token("spacing.md"))
            if role == "error":
                frame.setBorder(1)
                frame.setBorderBrush(theme.color("color.danger"))
                frame.setBorderStyle(QTextFrameFormat.BorderStyle.BorderStyle_Solid)
                cursor.insertFrame(frame)
                cursor.insertText(text, danger if message.get("kind") != "cancelled" else muted)
                if message.get("kind") in HINTS:
                    cursor.insertBlock()
                    cursor.insertText(HINTS[message["kind"]], muted)
            else:
                frame.setBackground(theme.color("color.chat_user" if role == "user" else "color.chat_assistant"))
                cursor.insertFrame(frame)
                if role == "user":
                    cursor.insertText(f"{message['where']}  ", muted)
                    cursor.insertText(text, plain)
                elif text:
                    cursor.insertMarkdown(PAGE_REF.sub(lambda m: f"[{m[0]}](page:{m[1]})", text))
                else:
                    cursor.insertText("…" if message.get("streaming") else "중단됨", muted)
                if message.get("usage"):
                    total, cached, output = message["usage"]
                    cache = f" (캐시 {_tokens(cached)})" if cached else ""
                    cursor.insertBlock(QTextBlockFormat())  # a fresh format: not part of the answer's last list
                    cursor.insertText(f"입력 {_tokens(total)}{cache} · 출력 {_tokens(output)} 토큰", muted)
            cursor.movePosition(QTextCursor.MoveOperation.End)  # out of the frame
        if follow:
            bar.setValue(bar.maximum())
