from pathlib import Path

from PySide6.QtWidgets import QLabel, QStatusBar

from app.annotation_state import SAVE_STATES
from app.core.document import format_size


class StatusBar(QStatusBar):
    """File name and size on the left; renders in progress, notes saving, page and zoom on the right."""

    def __init__(self, state, notes):
        super().__init__()
        self.setObjectName("statusBar")
        self.setSizeGripEnabled(False)
        self._state = state
        self._file, self._renders, self._page, self._zoom = QLabel(), QLabel(), QLabel(), QLabel()
        self._saved = QLabel(toolTip="하이라이트·메모·북마크 저장 상태")
        self.addWidget(self._file)
        for label in (self._renders, self._saved, self._page, self._zoom):
            self.addPermanentWidget(label)
        notes.save_state_changed.connect(lambda: self._saved.setText(SAVE_STATES[notes.save_state]))
        self._renders.setToolTip("렌더링을 기다리는 페이지 수")
        self._page.setToolTip("현재 페이지 / 전체 페이지")
        self._zoom.setToolTip("확대 비율")
        state.document_changed.connect(self._refresh)
        state.page_changed.connect(self._refresh)
        state.zoom_changed.connect(self._refresh)
        state.renderer.renders_changed.connect(self._show_renders)
        self._refresh()
        self._show_renders(0)

    def _refresh(self):
        st, doc = self._state, self._state.document
        try:
            size = f" · {format_size(doc.file_size)}" if doc else ""
        except OSError:  # deleted or moved since it was opened
            size = ""
        self._file.setText(f"{Path(doc.path).name}{size}" if doc else "")
        self._file.setToolTip(doc.path if doc else "")
        self._page.setText(f"{st.current_page + 1} / {st.page_count}쪽" if doc else "")
        self._zoom.setText(f"{round(st.zoom * 100)}%" if doc else "")

    def _show_renders(self, count):
        self._renders.setText(f"페이지 불러오는 중 ({count})" if count else "")
