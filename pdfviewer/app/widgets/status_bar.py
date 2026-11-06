from pathlib import Path

from PySide6.QtWidgets import QLabel, QStatusBar

from app.core.document import format_size


class StatusBar(QStatusBar):
    """File name and size on the left; renders in progress, page and zoom on the right."""

    def __init__(self, state):
        super().__init__()
        self.setObjectName("statusBar")
        self.setSizeGripEnabled(False)
        self._state = state
        self._file, self._renders, self._page, self._zoom = QLabel(), QLabel(), QLabel(), QLabel()
        self.addWidget(self._file)
        for label in (self._renders, self._page, self._zoom):
            self.addPermanentWidget(label)
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
        self._page.setText(f"{st.current_page + 1} / {st.page_count}쪽" if doc else "")
        self._zoom.setText(f"{round(st.zoom * 100)}%" if doc else "")

    def _show_renders(self, count):
        self._renders.setText(f"페이지 불러오는 중 ({count})" if count else "")
