from PySide6.QtCore import QPointF, QRectF, Qt, QTimer
from PySide6.QtGui import QPainterPath, QPixmap, QTransform
from PySide6.QtWidgets import (QApplication, QGraphicsPathItem, QGraphicsPixmapItem, QGraphicsRectItem,
                               QGraphicsScene, QGraphicsSimpleTextItem, QGraphicsView)

from app import theme
from app.core.layout import layout
from app.core.renderer import RENDER_DEBOUNCE_MS

PREVIEW_ZOOM = 0.25  # quick low-res first pass when nothing of a page is cached yet
PREFETCH = 2  # pages beyond the visible ones to render ahead


class PageView(QGraphicsView):
    """Document area for all view modes. Lays pages out from ViewerState, shows the best cached image
    of each nearby page (a paper rectangle until one arrives), and turns mouse input into state calls."""

    def __init__(self, state):
        super().__init__()
        self.setObjectName("pageView")
        self.setAccessibleName("문서 페이지")
        self._state = state
        self.setScene(QGraphicsScene(self))
        self.viewport().setMouseTracking(True)  # hover cursor over links and text
        self._items = []  # per page: (shadow, paper, image) scene items
        self._rects = {}  # page -> QRectF of the pages laid out now
        self._shown = {}  # page -> (zoom, rotation) of the image its item holds
        self._press = None  # (view pos, page, page point) while the left button is down
        self._dragged = False
        self._adjusting = False  # scroll changes made by code, not by the user
        self._zoom_anchor = None  # viewport point a Ctrl+wheel zoom keeps in place (else the view's centre)
        self._following_scroll = False  # current page changes because the user scrolled
        self._selection = None
        self._debounce = QTimer(self, singleShot=True, interval=RENDER_DEBOUNCE_MS, timeout=self._request)
        self.verticalScrollBar().valueChanged.connect(self._on_scroll)
        self.horizontalScrollBar().valueChanged.connect(self._on_scroll)
        state.document_changed.connect(self._rebuild)
        state.layout_changed.connect(self._on_layout_changed)
        state.zoom_changed.connect(self._on_zoom)
        state.page_changed.connect(self._on_page_changed)
        state.scroll_requested.connect(self._scroll_screen)
        state.selection_changed.connect(self._draw_selection)
        state.search_changed.connect(self._draw_search)
        state.search_current_changed.connect(self._on_search_current)
        state.tool_changed.connect(self._apply_tool)
        state.fullscreen_changed.connect(self._apply_presentation)
        state.renderer.page_ready.connect(self._on_ready)
        self._rebuild()
        self._apply_tool()
        self._apply_presentation()

    # ---- building and laying out

    def _rebuild(self):
        self.scene().clear()
        self._items, self._rects, self._shown = [], {}, {}
        self._selection = QGraphicsPathItem()
        self._selection.setPen(Qt.PenStyle.NoPen)
        self._selection.setBrush(theme.color("color.selection"))
        self._selection.setZValue(1)
        self.scene().addItem(self._selection)
        self._hits, self._active_hit = QGraphicsPathItem(), QGraphicsPathItem()
        for item, color in ((self._hits, "color.search_hit"), (self._active_hit, "color.search_hit_current")):
            item.setPen(Qt.PenStyle.NoPen)
            item.setBrush(theme.color(color))
            item.setZValue(1)
            self.scene().addItem(item)
        doc = self._state.document
        for i in range(doc.page_count if doc else 0):
            shadow, paper, image = QGraphicsRectItem(), QGraphicsRectItem(), QGraphicsPixmapItem()
            for rect, color in ((shadow, "color.page_shadow"), (paper, "color.page")):
                rect.setPen(Qt.PenStyle.NoPen)
                rect.setBrush(theme.color(color))
            # page number on the paper until the render covers it, so loading doesn't look like a blank page
            number = QGraphicsSimpleTextItem(str(i + 1), paper)
            number.setBrush(theme.color("color.text_disabled"))
            font = number.font()
            font.setPixelSize(theme.token("font.title_size"))
            number.setFont(font)
            image.setTransformationMode(Qt.TransformationMode.SmoothTransformation)
            for item in (shadow, paper, image):
                item.hide()
                self.scene().addItem(item)
            self._items.append((shadow, paper, image))
        self._relayout()
        self._scroll_to_page(self._state.current_page)
        self._refresh()
        self._request()

    def _relayout(self):
        st = self._state
        if not st.page_count:
            self.scene().setSceneRect(QRectF())
            return
        rows = st.rows() if st.view_mode == "continuous" else [st.rows()[st.row_of(st.current_page)]]
        sizes = {i: st.page_size(i) for row in rows for i in row}
        rects, (width, height) = layout(rows, sizes, st.zoom, theme.token("spacing.page_gap"))
        for i in self._rects.keys() - rects.keys():
            self._hide(i)
        offset = theme.token("size.shadow_offset")
        self._rects = {i: QRectF(*r) for i, r in rects.items()}
        for i, rect in self._rects.items():
            shadow, paper, _ = self._items[i]
            shadow.setRect(rect.translated(offset, offset))
            paper.setRect(rect)
            number = paper.childItems()[0]
            number.setPos(rect.center() - number.boundingRect().center())
            shadow.show()
            paper.show()
        m = theme.token("spacing.page_margin")
        self._adjusting = True
        self.scene().setSceneRect(QRectF(-m, -m, width + 2 * m, height + 2 * m))
        self._adjusting = False
        self._draw_selection()
        self._draw_search()

    def _hide(self, page):
        for item in self._items[page]:
            item.hide()
        self._items[page][2].setPixmap(QPixmap())
        self._shown.pop(page, None)

    def _page_transform(self, page):
        """Maps page.rect coordinates (points, before our rotation) to scene coordinates."""
        st = self._state
        w, h = st.document.page_size(page)
        rotate = QTransform().rotate(st.rotation)
        box = rotate.mapRect(QRectF(0, 0, w, h))
        rect = self._rects[page]
        return (rotate * QTransform.fromTranslate(-box.x(), -box.y())
                * QTransform.fromScale(st.zoom, st.zoom) * QTransform.fromTranslate(rect.x(), rect.y()))

    # ---- scrolling

    def _scroll_to_page(self, page):
        rect = self._rects.get(page)
        if rect is not None:
            self._set_scroll_top(rect.top() - theme.token("spacing.page_margin"))

    def _set_scroll_top(self, y):
        self._adjusting = True
        self.verticalScrollBar().setValue(round(y))  # identity view transform: scroll value = scene y
        self._adjusting = False

    def _visible_pages(self):
        area = self.mapToScene(self.viewport().rect()).boundingRect()
        return [i for i, rect in self._rects.items() if rect.intersects(area)]

    def _nearby_pages(self):
        """Visible pages first (current page first), then PREFETCH pages on each side."""
        visible = sorted(self._visible_pages(), key=lambda i: i != self._state.current_page)
        if not visible:
            return [], []
        lo, hi = max(0, min(visible) - PREFETCH), min(self._state.page_count - 1, max(visible) + PREFETCH)
        return visible, [i for i in range(lo, hi + 1) if i not in visible]

    def _page_at_center(self):
        center = self.mapToScene(self.viewport().rect().center())
        if not self._rects:
            return None
        return min(self._rects, key=lambda i: abs(self._rects[i].center().y() - center.y()))

    def _on_scroll(self):
        st = self._state
        if self._adjusting or not st.document:
            return
        if st.view_mode == "continuous":
            page = self._page_at_center()
            if page is not None and page != st.current_page:
                self._following_scroll = True
                st.go_to(page)
                self._following_scroll = False
        self._refresh()
        self._debounce.start()

    def _scroll_screen(self, direction):
        """PgDn/PgUp: one screen down/up; at the end of the shown row (single/spread) turn the page."""
        bar = self.verticalScrollBar()
        at_edge = bar.value() == (bar.maximum() if direction > 0 else bar.minimum())
        if at_edge and self._state.view_mode != "continuous":
            page = self._state.current_page
            (self._state.next if direction > 0 else self._state.prev)()
            if direction < 0 and self._state.current_page != page:
                self._set_scroll_top(bar.maximum())  # reading backwards: land on the previous page's end
        else:
            bar.setValue(bar.value() + direction * bar.pageStep())  # continuous: _on_scroll follows the page

    # ---- state signals

    def _on_page_changed(self, page):
        if self._following_scroll:
            return  # _on_scroll refreshes and debounces the renders
        if self._state.view_mode != "continuous":
            self._relayout()
        self._scroll_to_page(page)
        self._refresh()
        self._request()  # a jump: no need to wait for the debounce

    def _on_layout_changed(self):
        self._relayout()
        self._scroll_to_page(self._state.current_page)
        self._refresh()
        self._request()

    def _on_zoom(self):
        # the spot of the page under the anchor stays under it: the mouse for Ctrl+wheel, else the view's centre
        anchor = (self._zoom_anchor or QPointF(self.viewport().rect().center())).toPoint()
        before = self.mapToScene(anchor)
        page = next((i for i, r in self._rects.items() if r.contains(before)), self._state.current_page)
        rect = self._rects.get(page)
        spot = ((before.x() - rect.left()) / rect.width(), (before.y() - rect.top()) / rect.height()) if rect else None
        self._relayout()
        rect = self._rects.get(page)
        if spot is not None and rect is not None:
            now = self.mapToScene(anchor)
            self._adjusting = True
            for bar, shift in ((self.horizontalScrollBar(), rect.left() + spot[0] * rect.width() - now.x()),
                               (self.verticalScrollBar(), rect.top() + spot[1] * rect.height() - now.y())):
                bar.setValue(bar.value() + round(shift))
            self._adjusting = False
        self._refresh()  # old images scaled until the sharp ones arrive
        self._debounce.start()

    def _on_ready(self, index, zoom, rotation):
        visible, ahead = self._nearby_pages()
        if index in self._rects and (index in visible or index in ahead):
            self._show_image(index)

    def _apply_tool(self):
        hand = self._state.tool == "hand"
        self.setDragMode(QGraphicsView.DragMode.ScrollHandDrag if hand else QGraphicsView.DragMode.NoDrag)

    def _apply_presentation(self):
        off = self._state.presentation
        # The vertical bar is always on outside presentation: Qt centres a narrow scene on the viewport
        # width plus an as-needed bar, which leaves the page off-centre whenever that bar shows.
        self.setVerticalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff if off else Qt.ScrollBarPolicy.ScrollBarAlwaysOn)
        self.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff if off else Qt.ScrollBarPolicy.ScrollBarAsNeeded)

    # ---- images

    def _target_zoom(self):
        return self._state.zoom * self.devicePixelRatioF()  # render in device pixels for HiDPI

    def _show_image(self, page):
        st = self._state
        image, image_zoom = st.renderer.best(page, self._target_zoom(), st.rotation)
        item = self._items[page][2]
        if image is None:
            item.hide()
            return
        if self._shown.get(page) != (image_zoom, st.rotation):  # converting to a pixmap is not free
            item.setPixmap(QPixmap.fromImage(image))
            self._shown[page] = (image_zoom, st.rotation)
        item.setScale(st.zoom / image_zoom)
        item.setPos(self._rects[page].topLeft())
        item.show()

    def _refresh(self):
        """Show images on visible and nearby laid-out pages; free the pixmaps of the rest."""
        visible, ahead = self._nearby_pages()
        keep = {i for i in visible + ahead if i in self._rects}
        for i in list(self._shown):
            if i not in keep:
                self._items[i][2].setPixmap(QPixmap())
                self._items[i][2].hide()
                del self._shown[i]
        for i in keep:
            self._show_image(i)

    def _request(self):
        st = self._state
        visible, ahead = self._nearby_pages()
        if not visible:
            return
        target, rot = self._target_zoom(), st.rotation
        pixels = lambda i: st.page_size(i)[0] * st.page_size(i)[1] * target ** 2
        if sum(pixels(i) * 3 for i in visible + ahead) > st.renderer.cache_limit:  # RGB: 3 bytes a pixel
            ahead = []  # high zoom: prefetched pages would push the visible ones out of the cache
        keys = [(i, PREVIEW_ZOOM, rot) for i in visible if st.renderer.best(i, target, rot)[0] is None]
        keys += [(i, target, rot) for i in visible + ahead]
        st.renderer.request(keys)
        st.renderer.request_info(visible)

    # ---- selection, links, mouse

    def _draw_selection(self):
        if self._selection is None:
            return
        path = QPainterPath()
        sel = self._state.selection
        info = self._state.renderer.info(sel[0]) if sel else None
        if sel and info and sel[0] in self._rects:
            transform = self._page_transform(sel[0])
            for x0, y0, x1, y1, *_ in info[0][sel[1]:sel[2] + 1]:
                path.addRect(transform.mapRect(QRectF(x0, y0, x1 - x0, y1 - y0)))
        self._selection.setPath(path)

    def _draw_search(self):
        hits, active = QPainterPath(), QPainterPath()
        st = self._state
        for i, (page, rects, _) in enumerate(st.search_results):
            if page in self._rects:
                transform = self._page_transform(page)
                for x0, y0, x1, y1 in rects:
                    (active if i == st.search_index else hits).addRect(transform.mapRect(QRectF(x0, y0, x1 - x0, y1 - y0)))
        self._hits.setPath(hits)
        self._active_hit.setPath(active)

    def _on_search_current(self):
        self._draw_search()
        hit = self._active_hit.path().boundingRect()
        if not hit.isEmpty() and not self.mapToScene(self.viewport().rect()).boundingRect().contains(hit):
            self._adjusting = True  # ViewerState already moved to this result's page
            self.centerOn(hit.center())
            self._adjusting = False
            self._refresh()
            self._request()

    def _page_point(self, page, view_pos):
        inverse, _ = self._page_transform(page).inverted()
        return inverse.map(self.mapToScene(view_pos.toPoint()))

    def _hit(self, view_pos):
        """(page, point in page.rect coordinates) under a view position, or (None, None)."""
        scene_pos = self.mapToScene(view_pos.toPoint())
        for i, rect in self._rects.items():
            if rect.contains(scene_pos):
                return i, self._page_point(i, view_pos)
        return None, None

    def _word_at(self, page, point, exact=False):
        info = self._state.renderer.info(page)
        if not info or not info[0]:
            return None
        def distance(word):
            dx = max(word[0] - point.x(), 0, point.x() - word[2])
            dy = max(word[1] - point.y(), 0, point.y() - word[3])
            return dx * dx + dy * dy
        best = min(range(len(info[0])), key=lambda k: distance(info[0][k]))
        return best if not exact or distance(info[0][best]) == 0 else None

    def _link_at(self, page, point):
        info = self._state.renderer.info(page)
        for link in info[1] if info else ():
            x0, y0, x1, y1 = link[0]
            if x0 <= point.x() <= x1 and y0 <= point.y() <= y1:
                return link
        return None

    def mousePressEvent(self, event):
        if event.button() == Qt.MouseButton.LeftButton:
            page, point = self._hit(event.position())
            self._press = (event.position(), page, point)
            self._dragged = False
        super().mousePressEvent(event)  # the hand tool's drag-scrolling lives here

    def mouseDoubleClickEvent(self, event):
        self.mousePressEvent(event)  # a quick second click is still a click (QGraphicsView would swallow it)

    def mouseMoveEvent(self, event):
        super().mouseMoveEvent(event)
        if self._press is None:
            self._update_cursor(event.position())
            return
        if (event.position() - self._press[0]).manhattanLength() >= QApplication.startDragDistance():
            self._dragged = True
        page = self._press[1] if self._press[1] in self._rects else None  # a key may page away mid-drag
        if self._dragged and self._state.tool == "select" and page is not None:
            start = self._word_at(page, self._press[2])
            end = self._word_at(page, self._page_point(page, event.position()))
            if start is not None and end is not None:
                self._state.select(page, start, end)

    def mouseReleaseEvent(self, event):
        super().mouseReleaseEvent(event)
        if event.button() != Qt.MouseButton.LeftButton or self._press is None:
            return
        _, page, point = self._press
        self._press = None
        if not self._dragged:
            link = self._link_at(page, point) if page is not None else None
            if link:
                self._state.follow_link(link)
            else:
                self._state.clear_selection()

    def _update_cursor(self, view_pos):
        page, point = self._hit(view_pos)
        if page is not None and self._link_at(page, point):
            shape = Qt.CursorShape.PointingHandCursor
        elif self._state.tool == "hand":
            shape = Qt.CursorShape.OpenHandCursor
        elif page is not None and self._word_at(page, point, exact=True) is not None:
            shape = Qt.CursorShape.IBeamCursor
        else:
            shape = Qt.CursorShape.ArrowCursor
        self.viewport().setCursor(shape)

    # ---- Qt events

    def resizeEvent(self, event):
        super().resizeEvent(event)
        # Size without the as-needed horizontal bar (the vertical one is always on), so fit-width
        # does not change when a scrollbar appears (avoids a resize/refit loop).
        size = self.maximumViewportSize()
        m = 2 * theme.token("spacing.page_margin")
        self._state.set_viewport(size.width() - m, size.height() - m)
        self._refresh()
        self._debounce.start()

    def wheelEvent(self, event):
        if event.modifiers() & Qt.KeyboardModifier.ControlModifier:
            self._zoom_anchor = event.position()
            self._state.set_zoom(self._state.zoom * 1.1 ** (event.angleDelta().y() / 120))
            self._zoom_anchor = None
            event.accept()
        else:
            super().wheelEvent(event)
