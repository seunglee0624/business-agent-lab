import json
import re
import tempfile
from pathlib import Path

from PySide6.QtGui import QColor, QFontDatabase, QPalette

STYLES = Path(__file__).resolve().parent.parent / "styles"
FONTS = Path(__file__).resolve().parent.parent / "assets" / "fonts"
ICONS = Path(__file__).resolve().parent.parent / "assets" / "icons"
# QPalette role -> token. Menus, scrollbars, inputs, dialogs and tab bars are drawn from the palette, not the QSS.
PALETTE = {
    "Window": "color.bg_panel", "WindowText": "color.text", "Base": "color.bg_elevated", "AlternateBase": "color.bg_panel",
    "Text": "color.text", "Button": "color.bg_elevated", "ButtonText": "color.text", "BrightText": "color.text",
    "Highlight": "color.bg_highlight", "HighlightedText": "color.text", "Link": "color.accent",
    "ToolTipBase": "color.bg_elevated", "ToolTipText": "color.text", "PlaceholderText": "color.text_muted",
}


def _flatten(tree, prefix=""):
    flat = {}
    for key, value in tree.items():
        if isinstance(value, dict):
            flat.update(_flatten(value, f"{prefix}{key}."))
        else:
            flat[f"{prefix}{key}"] = value
    return flat


_tokens = _flatten(json.loads((STYLES / "tokens.json").read_text(encoding="utf-8")))


def token(name):
    """theme.token("spacing.md") -> value from styles/tokens.json. Unknown names raise KeyError."""
    return _tokens[name]


def color(name):
    return QColor.fromString(token(name))


def _tinted_icon(name, color_name):
    """QSS loads images only from files, so {{icon:name:color.x}} becomes a copy of the svg painted that colour."""
    path = Path(tempfile.gettempdir()) / "pdfviewer-qss" / f"{name}.{color_name}.svg"
    path.parent.mkdir(exist_ok=True)
    path.write_text((ICONS / f"{name}.svg").read_text(encoding="utf-8").replace("currentColor", token(color_name)), encoding="utf-8")
    return path.as_posix()


def stylesheet():
    qss = (STYLES / "base.qss").read_text(encoding="utf-8")
    qss = re.sub(r"\{\{icon:(\w+):([\w.]+)\}\}", lambda m: _tinted_icon(m[1], m[2]), qss)
    return re.sub(r"\{\{([\w.]+)\}\}", lambda m: str(token(m[1])), qss)


def palette():
    p = QPalette(color("color.bg_elevated"), color("color.bg_panel"))  # derives the bevel shades (Light, Mid, Dark…)
    for role, name in PALETTE.items():
        p.setColor(getattr(QPalette.ColorRole, role), color(name))
    for role in (QPalette.ColorRole.WindowText, QPalette.ColorRole.Text, QPalette.ColorRole.ButtonText):
        p.setColor(QPalette.ColorGroup.Disabled, role, color("color.text_disabled"))
    return p


def apply(app):
    for font in sorted(FONTS.glob("*.otf")):  # Pretendard ships with the app: most PCs do not have it
        QFontDatabase.addApplicationFont(str(font))
    app.setStyle("Fusion")  # the native Windows styles ignore most of the palette
    app.setPalette(palette())
    app.setStyleSheet(stylesheet())
