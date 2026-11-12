from PySide6.QtCore import QRectF, QSize, Qt
from PySide6.QtGui import QFontMetrics, QTextLayout
from PySide6.QtWidgets import QStyle, QStyledItemDelegate

from app import theme
from app.models.notes_model import ITEM_ROLE, KIND_ROLE, label, text

QUOTE_LINES = 2


class NotesDelegate(QStyledItemDelegate):
    """A notes list row: a colour band, the kind and "p.N", the quoted text (two lines at most),
    and a highlight's comment under it."""

    def _lines(self, index):
        """(main text, its colour token, comment) of a row."""
        kind, item = index.data(KIND_ROLE), index.data(ITEM_ROLE)
        if kind == "bookmarks":
            return item.get("label") or "북마크한 페이지", "color.text_muted", ""
        return text(kind, item), "color.text", item.get("comment", "")

    def sizeHint(self, option, index):
        pad, line = theme.token("spacing.md"), option.fontMetrics.height()
        text, _, comment = self._lines(index)
        width = option.widget.viewport().width() if option.widget else theme.token("size.sidebar_width")
        text_width = width - theme.token("size.hl_band") - 2 * pad  # as in paint
        lines = 1 + len(_wrap(text, option.font, text_width)[:QUOTE_LINES]) + bool(comment)
        return QSize(width, 2 * pad + lines * line)

    def paint(self, painter, option, index):
        kind, item = index.data(KIND_ROLE), index.data(ITEM_ROLE)
        cell, pad, line = QRectF(option.rect), theme.token("spacing.md"), option.fontMetrics.height()
        band = theme.token("size.hl_band")
        painter.save()
        if option.state & QStyle.StateFlag.State_Selected:
            painter.fillRect(cell, theme.color("color.bg_highlight"))
        color = {"highlights": f"color.hl_{item.get('color', 'yellow')}", "bookmarks": "color.accent",
                 "notes": "color.text_muted" if item.get("source") == "ai" else "color.hl_yellow"}[kind]
        painter.fillRect(QRectF(cell.left(), cell.top() + pad, band, cell.height() - 2 * pad), theme.color(color))
        left, width = cell.left() + band + pad, cell.width() - band - 2 * pad
        y = cell.top() + pad
        painter.setPen(theme.color("color.text_muted"))
        painter.drawText(QRectF(left, y, width, line), Qt.AlignmentFlag.AlignLeft, label(kind, item))
        painter.drawText(QRectF(left, y, width, line), Qt.AlignmentFlag.AlignRight, f"p.{item['page'] + 1}")
        text, text_color, comment = self._lines(index)
        painter.setPen(theme.color(text_color))
        for text_line in _wrap(text, option.font, width)[:QUOTE_LINES]:
            y += line
            painter.drawText(QRectF(left, y, width, line), Qt.AlignmentFlag.AlignLeft, text_line)
        if comment:
            y += line
            painter.setPen(theme.color("color.text_muted"))
            painter.drawText(QRectF(left, y, width, line), Qt.AlignmentFlag.AlignLeft,
                             option.fontMetrics.elidedText(comment, Qt.TextElideMode.ElideRight, int(width)))
        painter.restore()


def _wrap(text, font, width):
    """Lines of text wrapped to width; the last shown line ends in "…" when more follow."""
    layout = QTextLayout(" ".join(text.split()), font)
    layout.beginLayout()
    lines = []
    while (line := layout.createLine()).isValid():
        line.setLineWidth(max(width, 1))
        lines.append(layout.text()[line.textStart():line.textStart() + line.textLength()])
    layout.endLayout()
    if len(lines) > QUOTE_LINES:
        rest = "".join(lines[QUOTE_LINES - 1:])
        lines[QUOTE_LINES - 1] = QFontMetrics(font).elidedText(rest, Qt.TextElideMode.ElideRight, int(width))
    return lines or [""]
