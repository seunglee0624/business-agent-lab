import json
import re
from pathlib import Path

from PySide6.QtGui import QColor

STYLES = Path(__file__).resolve().parent.parent / "styles"


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


def stylesheet():
    qss = (STYLES / "base.qss").read_text(encoding="utf-8")
    return re.sub(r"\{\{([\w.]+)\}\}", lambda m: str(token(m[1])), qss)


def apply(app):
    app.setStyleSheet(stylesheet())
