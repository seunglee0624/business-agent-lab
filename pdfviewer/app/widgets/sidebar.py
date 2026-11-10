from PySide6.QtCore import QEvent, QPoint, Qt, QTimer
from PySide6.QtWidgets import (QAbstractItemView, QButtonGroup, QHBoxLayout, QLabel, QListView, QMenu, QPlainTextEdit,
                               QPushButton, QStackedWidget, QTabWidget, QToolButton, QTreeView, QVBoxLayout, QWidget)

from app import theme
from app.models.notes_model import FILTERS, ITEM_ROLE, KIND_ROLE, NotesModel
from app.models.outline_model import PAGE_ROLE, OutlineModel
from app.models.thumbnail_model import ThumbnailModel
from app.core.renderer import RENDER_DEBOUNCE_MS
from app.widgets.notes_delegate import NotesDelegate
from app.widgets.thumbnail_delegate import ThumbnailDelegate


class Sidebar(QTabWidget):
    """Thumbnails, outline and notes tabs. Clicks call ViewerState.go_to (and AnnotationState
    for notes); the current page comes from their signals."""

    def __init__(self, state, notes, ask_action):
        super().__init__()
        self.setObjectName("sidebar")
        self.thumbnails = ThumbnailList(state)
        self.addTab(self.thumbnails, "썸네일")
        self.addTab(OutlinePanel(state), "목차")
        self.notes = NotesPanel(state, notes, ask_action)
        self.addTab(self.notes, "메모")
        for i, tip in enumerate(("페이지 썸네일", "문서 목차", "하이라이트·메모·북마크와 문서 노트")):
            self.setTabToolTip(i, tip)


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


class NotesPanel(QWidget):
    """Filter buttons, the notes list in page order, its count, and the document note under a fold.
    A click goes to the item: a highlight is selected on the page, a page note opens its box."""

    def __init__(self, state, notes, ask_action):
        super().__init__()
        self._state, self._notes, self._ask = state, notes, ask_action
        self._model = NotesModel(notes, self)
        # buttons, not a drop-down: no popup (WSLg's Wayland popups do not close)
        self._filters = QButtonGroup(self, exclusive=True)
        chips = QHBoxLayout()
        chips.setSpacing(theme.token("spacing.sm"))
        for key, label in FILTERS.items():
            button = QPushButton(label, objectName="scope", checkable=True, checked=key == self._model.filter)
            button.clicked.connect(lambda checked=False, key=key: self._model.set_filter(key))
            self._filters.addButton(button)
            chips.addWidget(button)
        chips.addStretch(1)
        self._list = NotesList()
        self._list.setModel(self._model)
        self._list.setItemDelegate(NotesDelegate(self._list))
        self._list.setResizeMode(QListView.ResizeMode.Adjust)  # rows re-wrap to the sidebar's width
        self._list.setVerticalScrollMode(QAbstractItemView.ScrollMode.ScrollPerPixel)
        self._list.setAccessibleName("메모 목록")
        self._list.clicked.connect(self._go)
        self._list.activated.connect(self._go)
        self._list.setContextMenuPolicy(Qt.ContextMenuPolicy.CustomContextMenu)
        self._list.customContextMenuRequested.connect(self._menu)
        self._empty = QLabel(alignment=Qt.AlignmentFlag.AlignCenter, wordWrap=True, objectName="fieldName")
        self._count = QLabel(objectName="fieldName")
        self._fold = QToolButton(text="문서 노트", checkable=True, objectName="docNoteFold",
                                 toolTip="문서 전체에 대한 노트 (자동 저장)")
        self._fold.setToolButtonStyle(Qt.ToolButtonStyle.ToolButtonTextBesideIcon)
        self._fold.setArrowType(Qt.ArrowType.RightArrow)
        self._fold.toggled.connect(self._unfold)
        self._doc_note = QPlainTextEdit(objectName="docNote", placeholderText="이 문서에 대한 노트 (자동 저장)")
        self._doc_note.setFixedHeight(theme.token("size.doc_note"))
        self._doc_note.setAccessibleName("문서 노트")
        self._doc_note.hide()
        self._doc_note.textChanged.connect(lambda: notes.set_doc_note(self._doc_note.toPlainText()))
        footer = QHBoxLayout()
        footer.addWidget(self._fold)
        footer.addStretch(1)
        footer.addWidget(self._count)
        column = QVBoxLayout(self)
        m = theme.token("spacing.md")
        column.setContentsMargins(m, m, m, m)
        column.addLayout(chips)
        column.addWidget(self._list, 1)
        column.addWidget(self._empty, 1)
        column.addLayout(footer)
        column.addWidget(self._doc_note)
        self._model.modelReset.connect(self._update)
        notes.changed.connect(self._load_doc_note)
        self._update()
        self._load_doc_note()

    def _update(self):
        rows = self._model.rowCount()
        self._list.setVisible(rows > 0)
        self._empty.setVisible(rows == 0)
        self._empty.setText("하이라이트(H)·메모(M)·북마크(B)가 여기에 모입니다." if self._state.document
                            else "문서를 열면 메모가 여기에 모입니다.")
        self._count.setText(f"{rows}개" if rows else "")

    def _unfold(self, shown):
        self._fold.setArrowType(Qt.ArrowType.DownArrow if shown else Qt.ArrowType.RightArrow)
        self._doc_note.setVisible(shown)
        if shown:
            self._doc_note.setFocus()

    def _load_doc_note(self):
        """Another document: its note. Not while typing: the text is the box's own."""
        self._doc_note.setEnabled(self._notes.store is not None)
        text = self._notes.doc_note()
        if text != self._doc_note.toPlainText():
            self._doc_note.blockSignals(True)  # loading is not typing
            self._doc_note.setPlainText(text)
            self._doc_note.blockSignals(False)

    def _go(self, index):
        kind, item = index.data(KIND_ROLE), index.data(ITEM_ROLE)
        self._state.go_to(item["page"])
        if kind == "highlights":
            self._notes.set_active(item["id"])
        elif kind == "notes" and item["source"] == "user":
            self._notes.start_note(item["page"])

    def _menu(self, pos):
        index = self._list.indexAt(pos)
        if not index.isValid():
            return
        kind, item = index.data(KIND_ROLE), index.data(ITEM_ROLE)
        menu = QMenu(self)
        if kind == "highlights" or kind == "notes" and item["source"] == "user":  # an AI answer stays as given
            menu.addAction("편집", lambda: self._edit(kind, item))
        if kind == "highlights":
            menu.addAction("AI에게 질문", lambda: (self._notes.select_highlight(item["id"]), self._ask.trigger()))
        menu.addAction("삭제", lambda: self._remove(kind, item))
        menu.exec(self._list.viewport().mapToGlobal(pos))

    def _edit(self, kind, item):
        self._state.go_to(item["page"])
        if kind == "highlights":
            self._notes.start_editing(item["id"])
        else:
            self._notes.start_note(item["page"])

    def _remove(self, kind, item):
        if kind == "highlights":
            self._notes.remove_highlight(item["id"])
        elif kind == "notes":
            self._notes.remove_note(item["id"])
        else:
            self._notes.toggle_bookmark(item["page"])


class NotesList(OwnKeys, QListView):
    pass
