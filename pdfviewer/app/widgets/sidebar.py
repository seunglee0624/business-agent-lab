from PySide6.QtCore import QPoint, Qt, QTimer
from PySide6.QtWidgets import QAbstractItemView, QLabel, QListView, QStackedWidget, QTabWidget, QTreeView

from app.models.outline_model import PAGE_ROLE, OutlineModel
from app.models.thumbnail_model import ThumbnailModel
from app.widgets.page_view import RENDER_DEBOUNCE_MS
from app.widgets.thumbnail_delegate import ThumbnailDelegate


class Sidebar(QTabWidget):
    """Thumbnails and outline tabs. Clicks call ViewerState.go_to; the current page comes from its signals."""

    def __init__(self, state):
        super().__init__()
        self.setObjectName("sidebar")
        self.thumbnails = ThumbnailList(state)
        self.addTab(self.thumbnails, "썸네일")
        self.addTab(OutlinePanel(state), "목차")


class ThumbnailList(QListView):
    def __init__(self, state):
        super().__init__()
        self._state = state
        self.setModel(ThumbnailModel(state, self))
        self.setItemDelegate(ThumbnailDelegate(self))
        self.setUniformItemSizes(True)  # one square cell size: fast for thousands of pages
        self.setVerticalScrollMode(QAbstractItemView.ScrollMode.ScrollPerPixel)
        self._debounce = QTimer(self, singleShot=True, interval=RENDER_DEBOUNCE_MS, timeout=self._request)
        self.verticalScrollBar().valueChanged.connect(self._debounce.start)
        self.model().modelReset.connect(self._follow)
        self.selectionModel().currentRowChanged.connect(self._on_current)
        state.page_changed.connect(self._follow)

    def _on_current(self, current, _previous):
        if current.isValid():  # a model reset clears the current row; that is not a click
            self._state.go_to(current.row())

    def _follow(self):
        """Mark the current page and keep it in view."""
        if self._state.page_count:
            index = self.model().index(self._state.current_page)
            self.setCurrentIndex(index)  # its currentRowChanged → go_to(same page) does nothing
            self.scrollTo(index)
        self._debounce.start()

    def _request(self):
        rows = self.model().rowCount()
        if not rows or not self.isVisible():
            return
        x, height = self.viewport().width() // 2, self.viewport().height()
        first, last = self.indexAt(QPoint(x, 0)).row(), self.indexAt(QPoint(x, height - 1)).row()
        first, last = max(first, 0), last if last >= 0 else rows - 1
        dpr = self.devicePixelRatioF()
        # shortcut: thumbnails share the workers' FIFO queue with the page view, so a burst of thumbnails
        # can delay a page render; add priorities to the Renderer if that shows up on heavy PDFs.
        self._state.renderer.request([self.model().render_key(r, dpr) for r in range(first, last + 1)], "thumbs")

    def showEvent(self, event):
        super().showEvent(event)
        self._debounce.start()

    def resizeEvent(self, event):
        super().resizeEvent(event)
        self._debounce.start()


class OutlinePanel(QStackedWidget):
    def __init__(self, state):
        super().__init__()
        self._state = state
        self._tree = QTreeView()
        self._tree.setHeaderHidden(True)
        self._tree.setModel(OutlineModel(state, self))  # created first, so it reloads before _update runs
        self._tree.clicked.connect(self._go)
        self._tree.activated.connect(self._go)
        self._empty = QLabel("목차가 없습니다", alignment=Qt.AlignmentFlag.AlignCenter, wordWrap=True)
        self.addWidget(self._tree)
        self.addWidget(self._empty)
        state.document_changed.connect(self._update)
        state.renderer.outline_ready.connect(self._update)
        self._update()

    def _update(self):
        empty = self._state.document is None or self._state.renderer.outline == []
        self.setCurrentWidget(self._empty if empty else self._tree)
        self._tree.expandToDepth(0)

    def _go(self, index):
        page = index.data(PAGE_ROLE)
        if page and page > 0:
            self._state.go_to(page - 1)
