import re

from PySide6.QtCore import QEvent, QSize, Qt, QTimer, Signal
from PySide6.QtGui import (QActionGroup, QDesktopServices, QPalette, QTextBlockFormat, QTextCharFormat, QTextCursor, QTextFormat,
                           QTextFrameFormat, QTextLength, QTextTableFormat)
from PySide6.QtWidgets import (QFrame, QHBoxLayout, QLabel, QMenu, QMessageBox, QPlainTextEdit, QPushButton,
                               QTextBrowser, QToolButton, QVBoxLayout, QWidget)

from app import theme
from app.chat_state import SCOPES
from app.dialogs.llm_settings_dialog import llm_settings_dialog
from app.dialogs.quick_questions_dialog import quick_questions_dialog
from app.icons import icon

RENDER_MS = 50  # an answer streams in many small pieces: redraw at most this often
PAGE_REF = re.compile(r"(?<![\w\[/])p\.\s?(\d+)(?:\s?[–-]\s?\d+)?")  # p.12, p. 12, p.3–5 (links to the first page)

HINTS = {  # what to do about each kind of error
    "auth": "AI 설정의 API 키가 맞는지 확인하세요. 비워 뒀다면 ANTHROPIC_API_KEY 환경변수를 씁니다.",
    "rate_limit": "계속되면 제공자 콘솔에서 잔액과 사용 한도를 확인하세요.",
    "network": "인터넷 연결(Ollama 라면 서버가 켜져 있는지)과 AI 설정의 주소를 확인하고 다시 보내세요.",
    "context_too_long": "범위를 '현재 페이지'나 '선택한 부분'으로 줄이거나, 대화를 지우고 다시 물어보세요.",
    "refused": "질문을 바꿔 다시 물어보세요.",
    "no_selection": "페이지에서 글자를 드래그해 선택한 뒤 다시 물어보세요.",
    "other": "잠시 뒤 다시 보내세요. 계속되면 AI 설정의 모델 이름과 로그 파일을 확인하세요.",
}
SETTINGS_HINTS = {"auth", "rate_limit", "network", "other"}  # error cards that end with a "AI 설정 열기" link


def _tokens(n):
    return f"{n / 1000:.1f}k" if n >= 1000 else str(n)


class _Input(QPlainTextEdit):
    """Enter sends, Shift+Enter starts a new line, Esc goes back to the page."""

    submitted = Signal()
    leave = Signal()
    focused = Signal(bool)  # the box around it shows the focus ring

    def focusInEvent(self, event):
        super().focusInEvent(event)
        self.focused.emit(True)

    def focusOutEvent(self, event):
        super().focusOutEvent(event)
        self.focused.emit(False)

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
    """Right-side AI chat: what the question will carry on top, the conversation (or, before it, a greeting
    and the quick questions), then one rounded box with the question, its scope and send.
    Everything it shows comes from ChatState."""

    leave = Signal()  # Esc in the question box

    def __init__(self, chat):
        super().__init__(objectName="chatPanel")
        self.setAttribute(Qt.WidgetAttribute.WA_StyledBackground)  # the rounded card is drawn from QSS
        self._chat = chat
        top = QHBoxLayout()
        top.setSpacing(theme.token("spacing.sm"))
        self._info = QLabel(objectName="chatInfo", wordWrap=True)
        top.addWidget(self._info, 1)
        top.addWidget(self._button("clear_chat", "대화 지우기", self._clear))
        top.addWidget(self._button("settings", "AI 설정", self._open_settings))

        self._notice = QLabel('AI 채팅을 쓰려면 <a href="settings:">AI 설정</a>에서 API 키를 넣으세요 '
                              "(또는 ANTHROPIC_API_KEY 환경변수).", objectName="chatNotice", wordWrap=True)
        self._notice.linkActivated.connect(self._open_settings)
        self._log = QTextBrowser(objectName="chatLog", openLinks=False)
        palette = self._log.palette()
        palette.setColor(QPalette.ColorRole.Link, theme.color("color.accent"))
        self._log.setPalette(palette)
        self._log.anchorClicked.connect(self._open_link)

        # before the first question: a greeting in the middle, the quick questions one per row under it
        self._empty = QWidget(objectName="chatEmpty")
        greeting = QLabel("이 문서에서 무엇이 궁금하세요?", objectName="chatGreeting", wordWrap=True,
                          alignment=Qt.AlignmentFlag.AlignCenter)
        self._quick = QVBoxLayout()
        self._quick.setSpacing(theme.token("spacing.sm"))
        empty = QVBoxLayout(self._empty)
        empty.setContentsMargins(0, 0, 0, 0)
        empty.addStretch(1)
        empty.addWidget(greeting)
        empty.addStretch(1)
        empty.addLayout(self._quick)

        self._composer = QFrame(objectName="chatComposer")
        self._input = _Input(objectName="chatInput", accessibleName="질문",
                             placeholderText="질문 입력 (Enter 보내기, Shift+Enter 줄바꿈)")
        self._input.setTabChangesFocus(True)
        self._input.submitted.connect(self._send)
        self._input.leave.connect(self.leave)
        self._input.focused.connect(self._mark_composer)
        # the scope as a menu button, like the model picker in other chat apps
        self._scope = QActionGroup(self, exclusive=True)
        menu = QMenu(self)
        for key, label in SCOPES.items():
            action = menu.addAction(label)
            action.setCheckable(True)
            action.setData(key)  # not a Python attribute: Qt may hand back a fresh wrapper without it
            action.triggered.connect(lambda checked=False, key=key: self._choose_scope(key))
            self._scope.addAction(action)
        self._scope_button = QPushButton(objectName="chatScope", toolTip="질문과 함께 보낼 부분")
        self._scope_button.setMenu(menu)
        self._scope_button.setIcon(icon("dropdown"))
        caret = theme.token("spacing.xl")
        self._scope_button.setIconSize(QSize(caret, caret))
        self._scope_button.setLayoutDirection(Qt.LayoutDirection.RightToLeft)  # text, then the caret
        self._send_button = self._button("send", "보내기 (Enter)", self._send_or_stop)
        controls = QHBoxLayout()
        controls.setSpacing(theme.token("spacing.sm"))
        controls.addStretch(1)
        controls.addWidget(self._scope_button)
        controls.addWidget(self._send_button)
        inside = QVBoxLayout(self._composer)
        gap = theme.token("spacing.md")
        inside.setContentsMargins(gap, gap, gap, gap)
        inside.setSpacing(theme.token("spacing.xs"))
        inside.addWidget(self._input)
        inside.addLayout(controls)

        layout = QVBoxLayout(self)
        layout.setContentsMargins(gap, gap, gap, gap)
        layout.setSpacing(gap)
        layout.addLayout(top)
        layout.addWidget(self._log, 1)
        layout.addWidget(self._empty, 1)
        layout.addWidget(self._notice)
        layout.addWidget(self._composer)

        self._timer = QTimer(self, singleShot=True, interval=RENDER_MS, timeout=self._render)
        chat.changed.connect(lambda: self._timer.isActive() or self._timer.start())
        chat.busy_changed.connect(self._apply_busy)
        chat.scope_changed.connect(self._apply_scope)
        chat.context_changed.connect(self._show_info)
        chat.quick_changed.connect(self._fill_quick)
        chat.backend_changed.connect(self._apply_backend)
        self._available = False
        self._fill_quick()
        self._apply_backend()
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

    def _open_settings(self):
        config = llm_settings_dialog(self, self._chat.config)
        if config is not None:
            self._chat.apply_config(config)

    def _apply_backend(self):
        self._available = self._chat.backend.is_available()
        self._notice.setVisible(not self._available)
        self._input.setEnabled(self._available)
        self._apply_busy()

    def _open_link(self, url):
        if url.scheme() == "settings":
            self._open_settings()
        elif url.scheme() == "page":
            self._chat.open_page(int(url.path()))
        elif url.scheme() == "save":
            self._chat.save_answer(int(url.path()))
        elif url.scheme() in ("http", "https"):
            QDesktopServices.openUrl(url)

    def _clear(self):
        """Asks first: the saved copy goes too."""
        if self._chat.messages and QMessageBox.question(
                self, "대화 지우기", "이 문서의 AI 대화를 지울까요? 저장된 기록도 지워집니다.") == QMessageBox.StandardButton.Yes:
            self._chat.clear()

    def _mark_composer(self, focused):
        self._composer.setProperty("focused", focused)
        self._composer.style().polish(self._composer)

    def _fill_quick(self):
        layout = self._quick
        while layout.count():
            layout.takeAt(0).widget().deleteLater()
        for question in self._chat.quick_questions:
            chip = QPushButton(question["label"], objectName="chip")
            scope = SCOPES.get(question.get("scope"), "지금 범위")
            chip.setToolTip(f"{question['text']}\n({scope})")
            chip.clicked.connect(lambda checked=False, q=question: self._chat.ask_quick(q))
            layout.addWidget(chip, 0, Qt.AlignmentFlag.AlignLeft)
        layout.addWidget(self._button("edit", "빠른 질문 편집", self._edit_quick), 0, Qt.AlignmentFlag.AlignLeft)
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
        for chip in self._empty.findChildren(QPushButton, "chip"):
            chip.setEnabled(self._available and not busy)

    def _apply_scope(self):
        for action in self._scope.actions():
            action.setChecked(action.data() == self._chat.scope)
        self._scope_button.setText(SCOPES[self._chat.scope])
        self._scope_button.setAccessibleName(f"질문 범위: {SCOPES[self._chat.scope]}")

    def _show_info(self):
        info = self._chat.context_info()
        self._info.setText(f"{info} · {self._chat.backend.model}" if info else self._chat.backend.model)

    @staticmethod
    def _tidy_answer(frame):
        """What insertMarkdown leaves plain: no empty line above an answer that opens with a list or
        table, quiet table lines with room in the cells, and code on its own darker ground."""
        def drop_empty_first_line(area):  # a frame or a table cell
            first = area.firstCursorPosition().block()
            if not first.text() and first.next().position() < area.lastCursorPosition().position():
                QTextCursor(first.next()).deletePreviousChar()  # keeps the next block's list format

        drop_empty_first_line(frame)
        first = frame.firstCursorPosition()
        top = first.blockFormat()
        top.setTopMargin(0)
        first.setBlockFormat(top)
        for table in frame.childFrames():
            for row in range(table.rows()):  # a table right after code gets an empty line in its first cell
                for column in range(table.columns()):
                    drop_empty_first_line(table.cellAt(row, column))
            box = table.format()
            box.setBorder(1)
            box.setBorderBrush(theme.color("color.bg_highlight"))
            box.setBorderCollapse(True)
            box.setCellPadding(theme.token("spacing.sm"))
            table.setFormat(box)
        block, end = frame.firstCursorPosition().block(), frame.lastPosition()
        while block.isValid() and block.position() < end:
            at, look = QTextCursor(block), block.blockFormat()
            if at.currentTable():
                look.setTopMargin(0)  # a paragraph's gap would push one cell's text off its row
                look.setBottomMargin(0)
            elif look.hasProperty(QTextFormat.Property.BlockCodeFence):
                look.setBackground(theme.color("color.bg_base"))
                look.setLeftMargin(theme.token("spacing.sm"))
            at.setBlockFormat(look)
            block = block.next()

    @staticmethod
    def _question_box(cursor, index):
        """The user's question: a grey box with a grey band on the left, so it reads as the reader's own words,
        not a heading. Grey, not the accent: the band marks no state. Returns a cursor inside it."""
        box = QTextTableFormat()
        box.setBorder(0)
        box.setCellSpacing(0)
        box.setCellPadding(0)
        box.setWidth(QTextLength(QTextLength.Type.PercentageLength, 100))
        box.setColumnWidthConstraints([QTextLength(QTextLength.Type.FixedLength, theme.token("size.hl_band")),
                                       QTextLength(QTextLength.Type.VariableLength, 0)])
        box.setBackground(theme.color("color.chat_user"))
        box.setTopMargin(theme.token("spacing.xl") if index else 0)  # a turn starts with the space before it
        table = cursor.insertTable(1, 2, box)
        band = table.cellAt(0, 0).format()
        band.setBackground(theme.color("color.outline"))
        table.cellAt(0, 0).setFormat(band)
        cell = table.cellAt(0, 1)
        text = cell.format().toTableCellFormat()
        text.setPadding(theme.token("spacing.md"))
        cell.setFormat(text)
        return cell.firstCursorPosition()

    def _render(self):
        self._show_info()
        self._log.setVisible(bool(self._chat.messages))
        self._empty.setVisible(not self._chat.messages)
        bar = self._log.verticalScrollBar()
        follow = bar.value() >= bar.maximum() - theme.token("spacing.xl")  # the reader was at the end: keep up
        document = self._log.document()
        document.clear()
        document.setIndentWidth(theme.token("spacing.xl"))  # list bullets; Qt's 40px crowds the narrow panel
        cursor = QTextCursor(document)
        gap = QTextBlockFormat()  # the empty block Qt keeps between two frames: spacing comes from the margins
        gap.setLineHeight(1, QTextBlockFormat.LineHeightTypes.FixedHeight.value)
        plain, muted, danger = QTextCharFormat(), QTextCharFormat(), QTextCharFormat()
        muted.setForeground(theme.color("color.text_muted"))
        danger.setForeground(theme.color("color.danger"))
        link = QTextCharFormat()
        link.setAnchor(True)
        link.setAnchorHref("settings:")
        link.setForeground(theme.color("color.accent"))
        save = QTextCharFormat(link)
        save.setAnchorHref("")  # set per answer below
        for index, message in enumerate(self._chat.messages):
            role, text = message["role"], message["text"]
            if role == "note":
                cursor.setBlockFormat(QTextBlockFormat())  # not the collapsed gap
                cursor.insertText(text, muted)
                cursor.insertBlock()
                continue
            frame = QTextFrameFormat()
            frame.setPadding(theme.token("spacing.md"))
            frame.setBottomMargin(theme.token("spacing.md"))
            frame.setTopMargin(theme.token("spacing.xs"))  # an answer or error sits right under its question
            if role == "error":
                frame.setBorder(1)
                frame.setBorderBrush(theme.color("color.danger"))
                frame.setBorderStyle(QTextFrameFormat.BorderStyle.BorderStyle_Solid)
                cursor.insertFrame(frame)
                cursor.insertText(text, danger if message.get("kind") != "cancelled" else muted)
                if message.get("kind") in HINTS:
                    cursor.insertBlock()
                    cursor.insertText(HINTS[message["kind"]], muted)
                if message.get("kind") in SETTINGS_HINTS:
                    cursor.insertBlock()
                    cursor.insertText("AI 설정 열기", link)
            elif role == "user":
                cursor = self._question_box(cursor, index)
                cursor.insertText(f"{message['where']}  ", muted)
                cursor.insertText(text, plain)
            else:
                frame.setBackground(theme.color("color.chat_assistant"))
                cursor.insertFrame(frame)
                if text:
                    cursor.insertMarkdown(PAGE_REF.sub(lambda m: f"[{m[0]}](page:{m[1]})", text))
                    self._tidy_answer(cursor.currentFrame())
                else:
                    cursor.insertText("…" if message.get("streaming") else "중단됨", muted)
                if role == "assistant" and (message.get("usage") or text and not message.get("streaming")):
                    cursor.insertBlock(QTextBlockFormat())  # a fresh format: not part of the answer's last list
                if message.get("usage"):
                    total, cached, output = message["usage"]
                    cache = f" (캐시 {_tokens(cached)})" if cached else ""
                    cursor.insertText(f"입력 {_tokens(total)}{cache} · 출력 {_tokens(output)} 토큰   ", muted)
                if role == "assistant" and text and not message.get("streaming"):
                    if self._chat.answer_saved(message):
                        cursor.insertText("메모에 저장됨", muted)
                    elif self._chat.can_save_answers:
                        save.setAnchorHref(f"save:{index}")
                        cursor.insertText("메모로 저장", save)
            cursor.movePosition(QTextCursor.MoveOperation.End)  # out of the frame
            cursor.setBlockFormat(gap)
        if follow:
            bar.setValue(bar.maximum())
