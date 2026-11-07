from dataclasses import dataclass

from PySide6.QtCore import QObject, QUrl, Signal
from PySide6.QtGui import QDesktopServices, QGuiApplication

from app import theme
from app.core import settings
from app.core.renderer import Renderer

VIEW_MODES = ("single", "continuous", "spread")
MAX_SEARCH_RESULTS = 10000  # shortcut: a one-letter query stops here; page through results if users need more
SAFE_URL_SCHEMES = {"http", "https", "mailto"}  # a PDF must not launch file:// or other handlers


@dataclass
class Tab:
    """An open file and how it was left. The visible tab's live values are on ViewerState."""
    document: object
    page: int = 0
    zoom_mode: str = "fit_width"
    zoom: float = 1.0
    view_mode: str = "continuous"
    cover_alone: bool = True
    rotation: int = 0


class ViewerState(QObject):
    """Sole owner of viewer state. Widgets call methods here and listen to the signals."""

    document_changed = Signal()  # also on a tab switch
    tabs_changed = Signal()  # opened, closed, moved or switched
    page_changed = Signal(int)
    scroll_requested = Signal(int)  # PgDn +1 / PgUp -1 screen: only the view knows how tall a screen is
    zoom_changed = Signal(float)
    layout_changed = Signal()  # view mode, cover option or rotation
    tool_changed = Signal()
    fullscreen_changed = Signal()  # fullscreen or presentation
    sidebar_changed = Signal()
    selection_changed = Signal()
    search_opened = Signal()  # Ctrl+F: focus the search box
    search_changed = Signal()  # bar shown/hidden, query, options, results or progress
    search_current_changed = Signal()

    MIN_ZOOM, MAX_ZOOM = 0.1, 8.0
    ZOOM_STEP = 1.25

    def __init__(self):
        super().__init__()
        self.document = None  # the current tab's
        self.tabs = []
        self.tab_index = None  # current tab
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
        self.search_open = False
        self.search_query, self.search_case, self.search_whole = "", False, False
        self.search_results = []  # [(page, rects in page.rect coordinates, context)], document order
        self.search_searched = 0  # pages searched so far
        self.search_index = None  # current result
        self._search_anchor = 0  # page the search started from: the first current result is at or after it
        self._before_presentation = None
        self._viewport = (0, 0)  # space the pages may use, in logical px
        self.renderer = Renderer()
        self.renderer.search_found.connect(self._on_search_found)

    @property
    def page_count(self):
        return self.document.page_count if self.document else 0

    # ---- tabs

    def open(self, document):
        """Open in a new last tab, where the file was left last time. A file already open gets its tab back."""
        settings.add_recent(document.path)
        index = self.find_tab(document.path)
        if index is not None:
            document.close()
            self.switch_tab(index)
            return
        # a new file keeps the current view mode, and the zoom unless it has its own from last time
        page, zoom_mode, zoom = settings.file_view(document.path) or (0, self.zoom_mode, self.zoom)
        tab = Tab(document, page, zoom_mode, zoom, self.view_mode, self.cover_alone)
        self._leave_tab()
        self.tabs.append(tab)
        self._show_tab(len(self.tabs) - 1)

    def find_tab(self, path):
        return next((i for i, tab in enumerate(self.tabs) if tab.document.path == path), None)

    def switch_tab(self, index):
        if index != self.tab_index and 0 <= index < len(self.tabs):
            self._leave_tab()
            self._show_tab(index)

    def next_tab(self):
        if self.tabs:
            self.switch_tab((self.tab_index + 1) % len(self.tabs))

    def prev_tab(self):
        if self.tabs:
            self.switch_tab((self.tab_index - 1) % len(self.tabs))

    def close_tab(self, index=None):
        """Close a tab (the current one by default); its neighbour, or the empty screen, takes its place."""
        index = self.tab_index if index is None else index
        if index is None or not 0 <= index < len(self.tabs):
            return
        if index == self.tab_index:
            self._leave_tab()
            tab = self.tabs.pop(index)
            self.tab_index = None
            self._show_tab(min(index, len(self.tabs) - 1) if self.tabs else None)
        else:  # left earlier, so already saved
            tab = self.tabs.pop(index)
            self.tab_index -= index < self.tab_index
            self.tabs_changed.emit()
        tab.document.close()  # after the renderer moved on to the next document

    def move_tab(self, source, target):
        current = self.tabs[self.tab_index]
        self.tabs.insert(target, self.tabs.pop(source))
        self.tab_index = self.tabs.index(current)
        self.tabs_changed.emit()

    def save_view(self):
        """Remember where the current file is, for this session's tab and for the next time it is opened.
        Other tabs were saved when they were left."""
        if self.tab_index is None:
            return
        tab = self.tabs[self.tab_index]
        # presentation's single page and fit-page zoom are temporary: keep what it will return to
        view_mode, zoom_mode, zoom = (self._before_presentation[:3] if self.presentation
                                      else (self.view_mode, self.zoom_mode, self.zoom))
        tab.page, tab.zoom_mode, tab.zoom = self.current_page, zoom_mode, zoom
        tab.view_mode, tab.cover_alone, tab.rotation = view_mode, self.cover_alone, self.rotation
        settings.save_file_view(tab.document.path, tab.page, tab.zoom_mode, tab.zoom)

    def _leave_tab(self):
        self._end_presentation()  # the next tab brings its own view mode
        self.save_view()

    def _show_tab(self, index):
        self.tab_index = index
        tab = self.tabs[index] if index is not None else None
        self.document = tab.document if tab else None
        self.renderer.set_document(self.document)
        self.selection = None
        self.current_page, self.rotation = (max(0, min(tab.page, self.page_count - 1)), tab.rotation) if tab else (0, 0)
        if tab:
            self.zoom_mode, self.zoom = tab.zoom_mode, self._clamp(tab.zoom)
            self.view_mode, self.cover_alone = tab.view_mode, tab.cover_alone
            self.renderer.request_outline()
            fit = self._fit_zoom()  # a fit mode refits to this window
            if fit:
                self.zoom = self._clamp(fit)
        self.tabs_changed.emit()
        self.document_changed.emit()
        self._restart_search()  # the open bar searches this document for the same query

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

    def first_page(self):
        self.go_to(0)

    def last_page(self):
        self.go_to(self.page_count - 1)

    def page_down(self):
        if self.document:
            self.scroll_requested.emit(1)

    def page_up(self):
        if self.document:
            self.scroll_requested.emit(-1)

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

    def actual_size(self):
        self.set_zoom(1.0)

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

    def escape(self):
        """Esc: close the search bar first (presentation hides it, so there Esc ends presentation)."""
        if self.search_open and not self.presentation:
            self.close_search()
        else:
            self.exit_fullscreen()

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

    # ---- search

    @property
    def search_done(self):
        return self.search_searched >= self.page_count

    def open_search(self):
        if not self.search_open:
            self.search_open = True
            self._restart_search()
        self.search_opened.emit()

    def close_search(self):
        if self.search_open:
            self.search_open = False
            self._restart_search()  # stops the search and clears the highlights; the query stays for next time

    def set_search(self, query, case=False, whole=False):
        if (query, case, whole) != (self.search_query, self.search_case, self.search_whole):
            self.search_query, self.search_case, self.search_whole = query, case, whole
            self._restart_search()

    def _restart_search(self):
        active = self.search_open and self.search_query.strip() and self.document
        self.search_results, self.search_index, self.search_searched = [], None, 0
        self._search_anchor = self.current_page
        self.renderer.search(self.search_query if active else "", self.search_case, self.search_whole)
        self.search_changed.emit()
        self.search_current_changed.emit()

    def _on_search_found(self, results, searched):
        room = MAX_SEARCH_RESULTS - len(self.search_results)
        self.search_results += results[:room]
        self.search_searched = searched
        if len(results) >= room:
            self.renderer.search("", False, False)
            self.search_searched = self.page_count  # done: capped
        self.search_changed.emit()
        if self.search_index is None:
            first = next((i for i, r in enumerate(self.search_results) if r[0] >= self._search_anchor), None)
            if first is None and self.search_done and self.search_results:
                first = 0  # nothing after the anchor: wrap to the start
            if first is not None:
                self.set_search_index(first)

    def set_search_index(self, index):
        if self.search_results and index != self.search_index:
            self.search_index = index % len(self.search_results)
            self.go_to(self.search_results[self.search_index][0])
            self.search_current_changed.emit()

    def search_next(self):
        self._step_search(1)

    def search_prev(self):
        self._step_search(-1)

    def _step_search(self, step):
        if self.search_index is not None:
            self.set_search_index(self.search_index + step)
        elif self.search_results:  # results so far, none after the anchor yet
            self.set_search_index(0 if step > 0 else -1)
