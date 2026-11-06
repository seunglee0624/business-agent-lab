from pathlib import Path

from PySide6.QtCore import QByteArray, QRectF, Qt
from PySide6.QtGui import QColor, QIcon, QPainter, QPixmap
from PySide6.QtSvg import QSvgRenderer

from app import theme

ICONS = Path(__file__).resolve().parent.parent / "assets" / "icons"
OFF = {QIcon.Mode.Normal: "color.text_muted", QIcon.Mode.Active: "color.text", QIcon.Mode.Disabled: "color.text_disabled"}
ON = {QIcon.Mode.Normal: "color.accent", QIcon.Mode.Active: "color.accent", QIcon.Mode.Disabled: "color.text_disabled"}
SCALES = (1, 1.5, 2)  # sharp on 100%, 150% and 200% displays


def _pixmap(svg, color, scale, dot):
    """The glyph centred in a whole button-sized square, so a toggle's dot fits under it."""
    box, glyph = theme.token("size.control_sm"), theme.token("size.icon")
    pixmap = QPixmap(round(box * scale), round(box * scale))
    pixmap.fill(Qt.GlobalColor.transparent)
    painter = QPainter(pixmap)
    painter.setRenderHint(QPainter.RenderHint.Antialiasing)
    painter.scale(scale, scale)
    margin = (box - glyph) / 2
    QSvgRenderer(QByteArray(svg.replace("currentColor", color).encode())).render(painter, QRectF(margin, margin, glyph, glyph))
    if dot:
        size = theme.token("size.dot")
        painter.setPen(Qt.PenStyle.NoPen)
        painter.setBrush(QColor.fromString(color))
        painter.drawEllipse(QRectF((box - size) / 2, box - size, size, size))
    painter.end()
    pixmap.setDevicePixelRatio(scale)
    return pixmap


def icon(name):
    """icon("zoom_in") -> assets/icons/zoom_in.svg: muted, white on hover, dimmed when disabled.
    A toggle also has zoom_in.fill.svg, shown when checked: filled, in the accent colour, with a dot under it."""
    regular, fill = (ICONS / f"{name}.svg").read_text(encoding="utf-8"), ICONS / f"{name}.fill.svg"
    fill = fill.read_text(encoding="utf-8") if fill.exists() else None
    result = QIcon()
    for scale in SCALES:
        for mode, color in OFF.items():
            result.addPixmap(_pixmap(regular, theme.token(color), scale, False), mode, QIcon.State.Off)
        for mode, color in ON.items() if fill else ():
            on = _pixmap(fill, theme.token(color), scale, mode != QIcon.Mode.Disabled)
            result.addPixmap(on, mode, QIcon.State.On)
    return result
