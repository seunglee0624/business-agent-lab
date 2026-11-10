from PySide6.QtCore import QEvent, QPoint, QPointF, QRectF, Qt, QTimer
from PySide6.QtGui import QPainterPath, QPen, QPixmap, QPolygonF, QTransform
from PySide6.QtWidgets import (QApplication, QFrame, QGraphicsPathItem, QGraphicsPixmapItem, QGraphicsRectItem,
                               QGraphicsScene, QGraphicsSimpleTextItem, QGraphicsView, QHBoxLayout, QPlainTextEdit,
                               QToolButton, QVBoxLayout)

from app import theme
from app.annotation_state import COLORS
from app.icons import icon
from app.core.layout import layout
from app.core.renderer import RENDER_DEBOUNCE_MS

PREVIEW_ZOOM = 0.25  # quick low-res first pass when nothing of a page is cached yet
PREFETCH = 2  # pages beyond the visible ones to render ahead


class _CommentBox(QPlainTextEdit):
    """Ctrl+Enter saves, Esc cancels."""

    def __init__(self, save, cancel):
        super().__init__(objectName="noteComment", placeholderText="코멘트 (Ctrl+Enter 저장, Esc 취소)")
        self._save, self._cancel = save, cancel
        self.setTabChangesFocus(True)

    def event(self, event):
        if event.type() == QEvent.Type.ShortcutOverride and event.key() == Qt.Key.Key_Escape:
            event.accept()  # ours, not the window's Esc action
            return True
        return super().event(event)

    def keyPressEvent(self, event):
        enter = event.key() in (Qt.Key.Key_Return, Qt.Key.Key_Enter)
        if enter and event.modifiers() & Qt.KeyboardModifier.ControlModifier:
            self._save()
        elif event.key() == Qt.Key.Key_Escape:
            self._cancel()
        else:
            super().keyPressEvent(event)


class _NoteBar(QFrame):
    """Floats under the selected text or the clicked highlight. A child of the view, not a popup window:
    WSLg's Wayland popups do not close, and this one behaves the same everywhere.
    selection: copy, ask the AI, a colour to highlight.
    highlight: its colour, comment, ask the AI, delete. comment: a box to write the comment in."""

    def __init__(self, view, notes, copy_action, ask_action):
        super().__init__(view.viewport(), objectName="noteBar")
        self.setAttribute(Qt.WidgetAttribute.WA_NoMousePropagation)  # a click between buttons is not a page click
        self._view, self._notes, self._ask = view, notes, ask_action
        self.mode = None
        self._shown = None  # (mode, colour) the buttons were last set up for
        row = QHBoxLayout()
        row.setSpacing(theme.token("spacing.xs"))
        self._groups = {"selection": [], "highlight": []}

        def add(modes, widget):
            row.addWidget(widget)
            for mode in modes:
                self._groups[mode].append(widget)
            return widget

        for action in (copy_action, ask_action):
            button = QToolButton(focusPolicy=Qt.FocusPolicy.NoFocus, objectName="noteIcon")
            button.setDefaultAction(action)
            add(["selection"], button)
        self._dots = {}
        for key, label in COLORS.items():
            dot = add(["selection", "highlight"], self._button("", lambda checked=False, key=key: self._color(key), f"{label} 하이라이트"))
            dot.setObjectName("hlDot")
            dot.setProperty("hl", key)
            self._dots[key] = dot
        add(["highlight"], self._button("코멘트", lambda: notes.start_editing(notes.active), "코멘트 쓰기·고치기",
                                        "comment"))
        add(["highlight"], self._button("AI에게 질문", self._ask_about_highlight, "이 부분에 대해 AI에게 질문", "ask_ai"))
        add(["highlight"], self._button("삭제", lambda: self._notes.remove_highlight(self._notes.active),
                                        "하이라이트 지우기 (Ctrl+Z 로 되돌리기)", "delete"))
        self._box = _CommentBox(lambda: notes.stop_editing(save=True), notes.stop_editing)
        self._box.textChanged.connect(lambda: notes.set_draft(self._box.toPlainText()))
        self._box.setFixedSize(theme.token("size.comment_width"), theme.token("size.comment_height"))
        self._editor_buttons = QHBoxLayout()
        self._editor_buttons.addStretch(1)
        self._save_button = self._button("저장", lambda: notes.stop_editing(save=True), "저장 (Ctrl+Enter)")
        self._cancel_button = self._button("취소", notes.stop_editing, "취소 (Esc)")
        self._editor_buttons.addWidget(self._save_button)
        self._editor_buttons.addWidget(self._cancel_button)
        column = QVBoxLayout(self)
        gap = theme.token("spacing.sm")
        column.setContentsMargins(gap, gap, gap, gap)
        column.addLayout(row)
        column.addWidget(self._box)
        column.addLayout(self._editor_buttons)
        notes.editing_changed.connect(self._on_editing)
        self.hide()

    @staticmethod
    def _button(text, slot, tip, icon_name=None):
        """With an icon, only the icon shows (the text stays for screen readers and tests)."""
        button = QToolButton(text=text, toolTip=tip, focusPolicy=Qt.FocusPolicy.NoFocus)  # the keys stay on the page
        if icon_name:
            button.setIcon(icon(icon_name))
            button.setObjectName("noteIcon")  # the square icon button style in base.qss
        button.setAccessibleName(tip)
        button.clicked.connect(slot)
        return button

    def show_mode(self, mode):
        """None hides the bar. A comment being written stays until it is saved or cancelled."""
        mode = "comment" if self._notes.is_editing else mode
        self.mode = mode
        if mode is None:
            self._shown = None
            self.hide()
            return
        current = self._notes.highlight(self._notes.active)
        shown = (mode, current and current["color"])
        if shown == self._shown:  # scrolling: only the position changes
            return
        self._shown = shown
        for widgets in self._groups.values():
            for widget in widgets:
                widget.hide()
        for widget in self._groups.get(mode, []):
            widget.show()
        for widget in (self._box, self._save_button, self._cancel_button):
            widget.setVisible(mode == "comment")
        for key, dot in self._dots.items():
            dot.setProperty("current", mode == "highlight" and current is not None and current["color"] == key)
            dot.style().unpolish(dot)  # re-read the [current="true"] rule
            dot.style().polish(dot)
        self.layout().activate()  # the size of the buttons just shown, not of the last mode's
        self.adjustSize()
        self.show()
        self.raise_()

    def _color(self, key):
        if self.mode == "highlight":
            self._notes.set_highlight_color(self._notes.active, key)
        else:
            self._notes.highlight_selection(key)

    def _ask_about_highlight(self):
        self._notes.select_highlight(self._notes.active)
        self._notes.set_active(None)
        self._ask.trigger()

    def _on_editing(self):
        if self._notes.is_editing:
            what = "코멘트" if self._notes.editing else f"{self._notes.editing_note + 1}쪽 메모"
            self._box.setPlaceholderText(f"{what} (Ctrl+Enter 저장, Esc 취소)")
            self._box.setPlainText(self._notes.draft)
            self._view.update_bar()
            self._box.setFocus()
            self._box.moveCursor(self._box.textCursor().MoveOperation.End)
        else:
            if self._box.hasFocus():
                self._view.setFocus()
            self._view.update_bar()


class PageView(QGraphicsView):
    """Document area for all view modes. Lays pages out from ViewerState, shows the best cached image
    of each nearby page (a paper rectangle until one arrives), and turns mouse input into state calls.
    Highlights come from AnnotationState; right-click shows copy_action and ask_action."""

    def __init__(self, state, notes, copy_action, ask_action):
        super().__init__()
        self.setObjectName("pageView")
        self.setAccessibleName("문서 페이지")
        self._state = state
        self._notes = notes
        self.setContextMenuPolicy(Qt.ContextMenuPolicy.ActionsContextMenu)
        self.addActions([copy_action, ask_action])
        self._bar = _NoteBar(self, notes, copy_action, ask_action)
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
        self._marks = {}
        self._debounce = QTimer(self, singleShot=True, interval=RENDER_DEBOUNCE_MS, timeout=self._request)
        self.verticalScrollBar().valueChanged.connect(self._on_scroll)
        self.horizontalScrollBar().valueChanged.connect(self._on_scroll)
        state.document_changed.connect(self._rebuild)
        state.layout_changed.connect(self._on_layout_changed)
        state.zoom_changed.connect(self._on_zoom)
        state.page_changed.connect(self._on_page_changed)
        state.scroll_requested.connect(self._scroll_screen)
        state.selection_changed.connect(self._draw_selection)
        state.selection_changed.connect(self.update_bar)
        notes.changed.connect(self._draw_highlights)
        notes.active_changed.connect(self._on_active)
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
        self._marks = {}  # colour -> all highlights of that colour on the laid-out pages
        alpha = theme.token("opacity.highlight")
        for key in COLORS:
            item = self._marks[key] = QGraphicsPathItem()
            color = theme.color(f"color.hl_{key}")
            color.setAlphaF(alpha)
            item.setPen(Qt.PenStyle.NoPen)
            item.setBrush(color)
            item.setZValue(0.5)  # over the page image, under the selection
            self.scene().addItem(item)
        self._active_mark = QGraphicsPathItem()  # outline of the clicked highlight
        self._active_mark.setPen(QPen(theme.color("color.accent"), theme.token("size.current_frame")))
        self._active_mark.setZValue(0.6)
        self.scene().addItem(self._active_mark)
        self._ribbons, self._note_marks = QGraphicsPathItem(), QGraphicsPathItem()  # bookmarks, page notes
        for item, color in ((self._ribbons, "color.accent"), (self._note_marks, "color.hl_yellow")):
            item.setPen(QPen(theme.color("color.page_shadow"), 1))
            item.setBrush(theme.color(color))
            item.setZValue(0.7)
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
        self._draw_highlights()

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
        self._draw_markers()
        self.update_bar()

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

    def _draw_highlights(self):
        if not self._marks:
            return
        paths = {key: QPainterPath() for key in COLORS}
        active = QPainterPath()
        for item in self._notes.highlights():
            if item["page"] in self._rects:
                transform = self._page_transform(item["page"])
                for x0, y0, x1, y1 in item["quads"]:
                    box = transform.mapRect(QRectF(x0, y0, x1 - x0, y1 - y0))
                    paths.get(item["color"], paths["yellow"]).addRect(box)
                    if item["id"] == self._notes.active:
                        active.addRect(box)
        for key, path in paths.items():
            self._marks[key].setPath(path)
        self._active_mark.setPath(active)
        self._draw_markers()
        self.update_bar()

    def _draw_markers(self):
        """Bookmark and page-note ribbons; they follow a page scrolled half out of view (_marker_rects)."""
        ribbons, notes = QPainterPath(), QPainterPath()
        bookmarked, noted = self._notes.marked_pages()
        for page in (bookmarked | noted) & self._rects.keys():  # only marked pages: cheap on thousands of pages
            ribbon, note = self._marker_rects(page)
            if page in bookmarked:
                ribbons.addPolygon(_ribbon(ribbon))
            if page in noted:  # the same ribbon, in the note colour
                notes.addPolygon(_ribbon(note))
        self._ribbons.setPath(ribbons)
        self._note_marks.setPath(notes)

    def _marker_rects(self, page):
        """Scene rects of a page's bookmark ribbon (top-right corner) and note mark (left of it).
        A page bigger than the view keeps them in the view's top-right corner while the page is in view."""
        rect, size, gap = self._rects[page], theme.token("size.marker"), theme.token("spacing.md")
        view = self.mapToScene(self.viewport().rect()).boundingRect()
        top = min(max(rect.top(), view.top()), rect.bottom() - size * 1.5)
        right = max(min(rect.right(), view.right()), rect.left() + 2 * (gap + size))
        ribbon = QRectF(right - gap - size, top, size, size * 1.5)
        return ribbon, QRectF(ribbon.left() - gap - size, top, size, size * 1.5)  # same size as the ribbon

    def _marker_at(self, scene_pos):
        """("bookmark" | "note", page) under a scene point, for the marks that are shown."""
        bookmarked, noted = self._notes.marked_pages()
        for page in (bookmarked | noted) & self._rects.keys():
            ribbon, note = self._marker_rects(page)
            if ribbon.contains(scene_pos) and page in bookmarked:
                return "bookmark", page
            if note.contains(scene_pos) and page in noted:
                return "note", page
        return None

    def _on_active(self):
        """Draw the clicked highlight; one chosen from the notes list may be off screen: bring it in."""
        self._draw_highlights()
        mark = self._active_mark.path().boundingRect()
        if not mark.isEmpty() and not self.mapToScene(self.viewport().rect()).boundingRect().intersects(mark):
            self._adjusting = True  # the list already moved ViewerState to its page
            self.centerOn(mark.center())
            self._adjusting = False
            self._refresh()
            self._request()

    def update_bar(self):
        """Show the note bar under the selection (once the drag ends) or the clicked highlight, inside the view."""
        st, bar, page = self._state, self._bar, self._notes.editing_note
        if page is not None:  # a page note: under its mark
            mode, anchor = "comment", self._marker_rects(page)[1] if page in self._rects else QRectF()
        elif self._notes.active:  # also while its comment is written
            mode, anchor = "highlight", self._active_mark.path().boundingRect()
        elif st.selection and self._press is None and st.tool == "select" and self._selection:
            mode, anchor = "selection", self._selection.path().boundingRect()
        else:
            mode, anchor = None, QRectF()
        area = self.viewport().rect()
        box = self.mapFromScene(anchor).boundingRect()
        on_screen = not anchor.isEmpty() and box.intersects(area)
        if self._notes.is_editing and not on_screen:  # its highlight scrolled or paged away: keep the text, close the box
            self._notes.stop_editing(save=True)
            return
        bar.show_mode(mode if on_screen else None)
        if bar.mode is None:
            return
        gap = theme.token("spacing.sm")
        y = box.bottom() + gap
        if y + bar.height() > area.bottom():
            y = max(area.top(), box.top() - gap - bar.height())  # no room below: above it
        bar.move(QPoint(max(area.left(), min(box.left(), area.right() - bar.width())), y))

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
            if not self._dragged:
                self._notes.set_active(None)  # a new selection starts: the clicked highlight lets go
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
        marker = None if self._dragged else self._marker_at(self.mapToScene(event.position().toPoint()))
        if marker:
            kind, page = marker
            if kind == "note":  # a bookmark click does nothing: B or the menu turns it off, so it isn't lost by accident
                self._notes.start_note(page)
        elif not self._dragged:
            link = self._link_at(page, point) if page is not None else None
            mark = self._notes.highlight_at(page, point.x(), point.y()) if page is not None else None
            if link:
                self._state.follow_link(link)
            else:
                self._state.clear_selection()
                self._notes.set_active(mark)
        self.update_bar()

    def _update_cursor(self, view_pos):
        page, point = self._hit(view_pos)
        marker = self._marker_at(self.mapToScene(view_pos.toPoint()))
        mark = self._notes.highlight(self._notes.highlight_at(page, point.x(), point.y())) if page is not None else None
        if marker and marker[0] == "note":
            tip = self._notes.page_note(marker[1])["text"]
        elif marker:
            tip = "북마크 (B 로 끄기)"
        else:
            tip = mark["comment"] if mark else ""  # the comment shows on hover
        self.viewport().setToolTip(tip)
        if marker and marker[0] == "note" or page is not None and self._link_at(page, point):
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
        self._draw_markers()  # a fixed zoom does not re-lay out, but the view's corner moved

    def wheelEvent(self, event):
        if event.modifiers() & Qt.KeyboardModifier.ControlModifier:
            self._zoom_anchor = event.position()
            self._state.set_zoom(self._state.zoom * 1.1 ** (event.angleDelta().y() / 120))
            self._zoom_anchor = None
            event.accept()
        else:
            super().wheelEvent(event)


def _ribbon(rect):
    """A ribbon hanging from the page's top edge, notched at the bottom."""
    return QPolygonF([rect.topLeft(), rect.topRight(), rect.bottomRight(),
                      QPointF(rect.center().x(), rect.bottom() - rect.width() / 2), rect.bottomLeft(), rect.topLeft()])
