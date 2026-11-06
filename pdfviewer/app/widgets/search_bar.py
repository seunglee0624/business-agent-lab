from PySide6.QtCore import QEvent, Qt, QTimer
from PySide6.QtWidgets import QLabel, QLineEdit, QToolBar

from app.icons import icon

SEARCH_DEBOUNCE_MS = 100  # search once typing pauses; a stale search is cancelled, so short is cheap


class SearchBar(QToolBar):
    """Ctrl+F row under the toolbar: search box, previous/next, result count and options.
    Typing searches after a short pause; Enter / Shift+Enter step through the results."""

    def __init__(self, state):
        super().__init__("찾기")
        self.setObjectName("searchBar")
        self.setMovable(False)
        self._state = state
        self._edit = QLineEdit(placeholderText="문서에서 찾기", accessibleName="문서에서 찾기", clearButtonEnabled=True)
        self._edit.installEventFilter(self)
        self._debounce = QTimer(self, singleShot=True, interval=SEARCH_DEBOUNCE_MS, timeout=self._search)
        self._edit.textEdited.connect(self._debounce.start)
        self.addWidget(self._edit)
        self.addAction(icon("search_prev"), "이전 결과", state.search_prev).setToolTip("이전 결과 (Shift+Enter)")
        self.addAction(icon("search_next"), "다음 결과", state.search_next).setToolTip("다음 결과 (Enter)")
        self._count = QLabel()
        self.addWidget(self._count)
        self.addSeparator()
        self._case = self.addAction("Aa", self._search)
        self._case.setCheckable(True)
        self._case.setToolTip("대소문자 구분")
        self._whole = self.addAction("단어", self._search)
        self._whole.setCheckable(True)
        self._whole.setToolTip("단어 단위로 찾기")
        self.addSeparator()
        self.addAction(icon("close"), "닫기", state.close_search).setToolTip("닫기 (Esc)")
        state.search_opened.connect(self._focus)
        state.search_changed.connect(self._show_count)
        state.search_current_changed.connect(self._show_count)
        self._show_count()

    def _search(self):
        self._debounce.stop()
        self._state.set_search(self._edit.text(), self._case.isChecked(), self._whole.isChecked())

    def _focus(self):
        self._edit.setFocus()
        self._edit.selectAll()

    def eventFilter(self, watched, event):
        if event.type() == QEvent.Type.KeyPress and event.key() in (Qt.Key.Key_Return, Qt.Key.Key_Enter):
            if self._debounce.isActive():  # typed and pressed Enter before the pause: search now
                self._search()
            elif event.modifiers() & Qt.KeyboardModifier.ShiftModifier:
                self._state.search_prev()
            else:
                self._state.search_next()
            return True
        return super().eventFilter(watched, event)

    def _show_count(self):
        st = self._state
        total = len(st.search_results)
        if not (st.search_open and st.search_query.strip() and st.document):
            text = ""
        elif not total:
            text = "일치하는 결과가 없어요" if st.search_done else "찾는 중…"
        else:
            current = "-" if st.search_index is None else st.search_index + 1
            text = f"{current} / {total}"
            if not st.search_done:
                text += f"  ({round(100 * st.search_searched / st.page_count)}%)"
        self._count.setText(text)
