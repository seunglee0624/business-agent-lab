from PySide6.QtCore import QEvent, QPoint, Qt, QTimer
from PySide6.QtWidgets import QAbstractItemView, QLabel, QListView, QStackedWidget, QTabWidget, QTreeView

from app.models.outline_model import PAGE_ROLE, OutlineModel
from app.models.search_result_model import SearchResultModel
from app.models.thumbnail_model import ThumbnailModel
from app.core.renderer import RENDER_DEBOUNCE_MS
from app.widgets.thumbnail_delegate import ThumbnailDelegate


class Sidebar(QTabWidget):
    """Thumbnails and outline tabs. Clicks call ViewerState.go_to; the current page comes from its signals."""

    def __init__(self, state):
        super().__init__()
        self.setObjectName("sidebar")
        self.thumbnails = ThumbnailList(state)
        self.addTab(self.thumbnails, "썸네일")
        self.addTab(OutlinePanel(state), "목차")
        self.search_results = SearchResultList(state)
        self.addTab(self.search_results, "검색")
        for i, tip in enumerate(("페이지 썸네일", "문서 목차", "검색 결과")):
            self.setTabToolTip(i, tip)
        self._state = state
        state.search_opened.connect(lambda: self.setCurrentWidget(self.search_results))
        self.tabBarClicked.connect(self._on_tab_clicked)  # clicks only, not the tab restored at start-up

    def _on_tab_clicked(self, index):
        """The search tab opens the search box like Ctrl+F; the other tabs close it."""
        if index != self.indexOf(self.search_results):
            self._state.close_search()
        elif self._state.document:
            self._state.open_search()


class OwnKeys:
    """While a list has focus, its navigation keys move the list instead of firing the window's page shortcuts."""
    OWN_KEYS = {Qt.Key.Key_Home, Qt.Key.Key_End, Qt.Key.Key_PageUp, Qt.Key.Key_PageDown}

    def event(self, event):
        if (event.type() == QEvent.Type.ShortcutOverride and event.key() in self.OWN_KEYS
                and event.modifiers() == Qt.KeyboardModifier.NoModifier):
            event.accept()
            return True
        return super().event(event)


class OutlineTree(OwnKeys, QTreeView):
    OWN_KEYS = OwnKeys.OWN_KEYS | {Qt.Key.Key_Left, Qt.Key.Key_Right}  # collapse / expand a chapter


class ThumbnailList(OwnKeys, QListView):
    def __init__(self, state):
        super().__init__()
        self._state = state
        self.setAccessibleName("썸네일")
        self.setModel(ThumbnailModel(state, self))
        self.setItemDelegate(ThumbnailDelegate(self))
        self.setUniformItemSizes(True)  # one cell size (fits the tallest page): fast for thousands of pages
        self.setVerticalScrollMode(QAbstractItemView.ScrollMode.ScrollPerPixel)
        self._debounce = QTimer(self, singleShot=True, interval=RENDER_DEBOUNCE_MS, timeout=self._request)
        # not .connect(self._debounce.start): the scroll value would become the delay in ms
        self.verticalScrollBar().valueChanged.connect(lambda: self._debounce.start())
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
        self._tree = OutlineTree()
        self._tree.setHeaderHidden(True)
        self._tree.setAccessibleName("목차")
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


class SearchResultList(OwnKeys, QListView):
    def __init__(self, state):
        super().__init__()
        self._state = state
        self.setAccessibleName("검색 결과")
        self.setModel(SearchResultModel(state, self))
        self.setUniformItemSizes(True)
        self.setTextElideMode(Qt.TextElideMode.ElideRight)
        self.selectionModel().currentRowChanged.connect(self._on_current)
        state.search_current_changed.connect(self._follow)

    def _on_current(self, current, _previous):
        if current.isValid():
            self._state.set_search_index(current.row())

    def _follow(self):
        index = self._state.search_index
        if index is not None and index < self.model().rowCount():
            self.setCurrentIndex(self.model().index(index))  # its currentRowChanged → same index does nothing
            self.scrollTo(self.currentIndex())
