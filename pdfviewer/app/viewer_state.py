from PySide6.QtCore import QObject, QUrl, Signal
from PySide6.QtGui import QDesktopServices, QGuiApplication

from app import theme
from app.core.renderer import Renderer

VIEW_MODES = ("single", "continuous", "spread")
SAFE_URL_SCHEMES = {"http", "https", "mailto"}  # a PDF must not launch file:// or other handlers


class ViewerState(QObject):
    """Sole owner of viewer state. Widgets call methods here and listen to the signals."""

    document_changed = Signal()
    page_changed = Signal(int)
    zoom_changed = Signal(float)
    layout_changed = Signal()  # view mode, cover option or rotation
    tool_changed = Signal()
    fullscreen_changed = Signal()  # fullscreen or presentation
    sidebar_changed = Signal()
    selection_changed = Signal()

    MIN_ZOOM, MAX_ZOOM = 0.1, 8.0
    ZOOM_STEP = 1.25

    def __init__(self):
        super().__init__()
        self.document = None
        self.current_page = 0
        self.zoom = 1.0
        self.zoom_mode = "fit_width"  # "custom" | "fit_width" | "fit_page"
        self.view_mode = "continuous"
        self.cover_alone = True  # spread mode: first page on its own, like a book cover
        self.rotation = 0  # extra clockwise degrees for the whole document
        self.tool = "select"  # "select" | "hand"
        self.fullscreen = False
        self.presentation = False
        self.sidebar = True  # shown (presentation hides it without changing this)
        self.selection = None  # (page, first word, last word), inclusive
        self._before_presentation = None
        self._viewport = (0, 0)  # space the pages may use, in logical px
        self.renderer = Renderer()

    @property
    def page_count(self):
        return self.document.page_count if self.document else 0

    def open(self, document):
        if self.document:
            self.document.close()
        self.document = document
        self.renderer.set_document(document)
        self.current_page = 0
        self.rotation = 0
        self.selection = None
        self.renderer.request_outline()
        fit = self._fit_zoom()
        if fit:
            self.zoom = self._clamp(fit)
        self.document_changed.emit()

    # ---- pages and layout

    def page_size(self, index):
        """Page size in points as displayed, i.e. after the document rotation."""
        w, h = self.document.page_size(index)
        return (h, w) if self.rotation % 180 else (w, h)

    def rows(self):
        """Pages grouped the way they are shown side by side."""
        n = self.page_count
        if not n:
            return []
        if self.view_mode != "spread":
            return [[i] for i in range(n)]
        first = 1 if self.cover_alone else 0
        return [[0]] * first + [list(range(i, min(i + 2, n))) for i in range(first, n, 2)]

    def row_of(self, page):
        if self.view_mode != "spread":
            return page
        return (page + 1) // 2 if self.cover_alone else page // 2

    def go_to(self, page):
        if not self.document:
            return
        page = max(0, min(page, self.page_count - 1))
        if page == self.current_page:
            return
        self.current_page = page
        self._refit()  # pages can differ in size; refit first so the view requests renders at the new zoom
        self.page_changed.emit(page)

    def next(self):
        rows = self.rows()
        row = self.row_of(self.current_page)
        if row + 1 < len(rows):
            self.go_to(rows[row + 1][0])

    def prev(self):
        row = self.row_of(self.current_page)
        if row > 0:
            self.go_to(self.rows()[row - 1][0])

    def set_view_mode(self, mode):
        assert mode in VIEW_MODES
        if mode != self.view_mode:
            self.view_mode = mode
            self._layout_changed()

    def set_cover_alone(self, on):
        if on != self.cover_alone:
            self.cover_alone = on
            self._layout_changed()

    def rotate_right(self):
        self.rotation = (self.rotation + 90) % 360
        self._layout_changed()

    def rotate_left(self):
        self.rotation = (self.rotation - 90) % 360
        self._layout_changed()

    def _layout_changed(self):
        self._refit()  # before the signal, so the view requests renders at the new zoom
        self.layout_changed.emit()

    # ---- zoom

    def set_zoom(self, zoom):
        self._apply_zoom("custom", zoom)

    def zoom_in(self):
        self.set_zoom(self.zoom * self.ZOOM_STEP)

    def zoom_out(self):
        self.set_zoom(self.zoom / self.ZOOM_STEP)

    def fit_width(self):
        self._apply_zoom("fit_width", self._fit_zoom("fit_width"))

    def fit_page(self):
        self._apply_zoom("fit_page", self._fit_zoom("fit_page"))

    def set_viewport(self, width, height):
        self._viewport = (width, height)
        self._refit()

    def _fit_zoom(self, mode=None):
        mode = mode or self.zoom_mode
        width, height = self._viewport
        if mode == "custom" or not self.page_count or width <= 0 or height <= 0:
            return None
        # single: fit the shown page. continuous / spread: fit the widest row of the document, so zoom
        # does not jump while scrolling or between the lone cover and the two-page spreads
        rows = [[self.current_page]] if self.view_mode == "single" else self.rows()
        gap = theme.token("spacing.page_gap")
        widest = max((sum(self.page_size(i)[0] for i in row), len(row)) for row in rows)
        tallest = max(self.page_size(i)[1] for row in rows for i in row)
        fit_w = (width - gap * (widest[1] - 1)) / widest[0]
        return fit_w if mode == "fit_width" else min(fit_w, height / tallest)

    def _refit(self):
        self._apply_zoom(self.zoom_mode, self._fit_zoom())

    def _apply_zoom(self, mode, zoom):
        """Set zoom mode and zoom (None keeps the zoom). zoom_changed fires when either changes:
        the toolbar shows the mode."""
        zoom = self._clamp(zoom) if zoom else self.zoom
        if (mode, zoom) != (self.zoom_mode, self.zoom):
            self.zoom_mode, self.zoom = mode, zoom
            self.zoom_changed.emit(zoom)

    def _clamp(self, zoom):
        return max(self.MIN_ZOOM, min(zoom, self.MAX_ZOOM))

    # ---- tools, window modes

    def set_tool(self, tool):
        assert tool in ("select", "hand")
        if tool != self.tool:
            self.tool = tool
            self.tool_changed.emit()

    def set_sidebar(self, on):
        if on != self.sidebar:
            self.sidebar = on
            self.sidebar_changed.emit()

    def toggle_sidebar(self):
        self.set_sidebar(not self.sidebar)

    def toggle_fullscreen(self):
        if self.fullscreen:
            self._end_presentation()
        self._set_fullscreen(not self.fullscreen)

    def toggle_presentation(self):
        if self.presentation:
            self._end_presentation()
            return
        self._before_presentation = (self.view_mode, self.zoom_mode, self.zoom, self.fullscreen)
        self.presentation = self.fullscreen = True
        self.view_mode = "single"
        self.fullscreen_changed.emit()
        self._apply_zoom("fit_page", self._fit_zoom("fit_page"))
        self.layout_changed.emit()

    def exit_fullscreen(self):
        """Esc: one step back. Presentation returns to the window it started from (fullscreen or not)."""
        if self.presentation:
            self._end_presentation()
        else:
            self._set_fullscreen(False)

    def _set_fullscreen(self, on):
        if on != self.fullscreen:
            self.fullscreen = on
            self.fullscreen_changed.emit()

    def _end_presentation(self):
        if not self.presentation:
            return
        self.view_mode, mode, zoom, self.fullscreen = self._before_presentation
        self.presentation = False
        self.fullscreen_changed.emit()
        self._apply_zoom(mode, zoom if mode == "custom" else self._fit_zoom(mode))
        self.layout_changed.emit()

    # ---- text selection and links

    def select(self, page, first, last):
        self.selection = (page, min(first, last), max(first, last))
        self.selection_changed.emit()

    def clear_selection(self):
        if self.selection is not None:
            self.selection = None
            self.selection_changed.emit()

    def selected_text(self):
        if self.selection is None:
            return ""
        page, first, last = self.selection
        words = self.renderer.info(page)[0][first:last + 1]
        parts = []
        for i, word in enumerate(words):
            if i:
                same_line = word[5:7] == words[i - 1][5:7]  # (block, line)
                parts.append(" " if same_line else "\n")
            parts.append(word[4])
        return "".join(parts)

    def copy(self):
        text = self.selected_text()
        if text:
            QGuiApplication.clipboard().setText(text)

    def follow_link(self, link):
        _, uri, target = link
        if target is not None:
            self.go_to(target)
        elif uri and QUrl(uri).scheme().lower() in SAFE_URL_SCHEMES:
            QDesktopServices.openUrl(QUrl(uri))
