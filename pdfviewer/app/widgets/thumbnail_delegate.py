from PySide6.QtCore import QRectF, QSize, Qt
from PySide6.QtGui import QPainter, QPen
from PySide6.QtWidgets import QStyle, QStyledItemDelegate

from app import theme


class ThumbnailDelegate(QStyledItemDelegate):
    """Draws a thumbnail cell: the page (paper until its render arrives), a frame on the current page,
    and the page number below."""

    def sizeHint(self, option, index):
        box, pad = theme.token("size.thumbnail"), theme.token("spacing.md")
        return QSize(box + 2 * pad, box + 2 * pad + option.fontMetrics.height())

    def paint(self, painter, option, index):
        model, row, cell = index.model(), index.row(), option.rect
        box, pad = theme.token("size.thumbnail"), theme.token("spacing.md")
        w, h = model.size(row)
        page = QRectF(cell.center().x() - w / 2, cell.top() + pad + (box - h) / 2, w, h)
        painter.save()
        painter.setRenderHint(QPainter.RenderHint.SmoothPixmapTransform)
        painter.fillRect(page, theme.color("color.paper"))
        image = model.image(row, option.widget.devicePixelRatioF())
        if image is not None:
            painter.drawImage(page, image)
        if option.state & QStyle.StateFlag.State_Selected:
            painter.setPen(QPen(theme.color("color.accent"), theme.token("size.current_frame")))
            painter.drawRect(page)
        painter.setPen(theme.color("color.text"))
        label = QRectF(cell.left(), cell.top() + pad + box, cell.width(), cell.bottom() - cell.top() - pad - box)
        painter.drawText(label, Qt.AlignmentFlag.AlignHCenter | Qt.AlignmentFlag.AlignVCenter, index.data())
        painter.restore()
