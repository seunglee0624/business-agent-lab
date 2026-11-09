"""Everything the app keeps between runs, in QSettings. Lists and dicts are stored as JSON strings:
QSettings' own list handling differs between backends (a one-item list comes back as a str in INI)."""
import json

from PySide6.QtCore import QSettings

MAX_RECENT = 10
MAX_FILE_VIEWS = 200  # shortcut: the oldest files are forgotten beyond this; raise it if users complain


def _load(key, default):
    try:
        return json.loads(QSettings().value(key, "") or "null") or default
    except ValueError:  # hand-edited or corrupt
        return default


def _save(key, value):
    QSettings().setValue(key, json.dumps(value))


def recent_files():
    """Most recent first."""
    return _load("files/recent", [])


def add_recent(path):
    _save("files/recent", [path, *(p for p in recent_files() if p != path)][:MAX_RECENT])


def remove_recent(path):
    _save("files/recent", [p for p in recent_files() if p != path])


def file_view(path):
    """(page, zoom mode, zoom) last used for this file, or None."""
    view = _load("files/views", {}).get(path)
    return tuple(view) if view else None


def save_file_view(path, page, zoom_mode, zoom):
    views = _load("files/views", {})
    views.pop(path, None)  # re-insert: dicts keep insertion order, so the oldest is first
    views[path] = [page, zoom_mode, zoom]
    while len(views) > MAX_FILE_VIEWS:
        views.pop(next(iter(views)))
    _save("files/views", views)


def window():
    """(geometry, dock state, sidebar shown, sidebar tab); the byte values are empty on first run."""
    s = QSettings()
    return (s.value("window/geometry", b""), s.value("window/state", b""),
            s.value("sidebar/visible", True, type=bool), s.value("sidebar/tab", 0, type=int))


def save_window(geometry, dock_state, sidebar_shown, sidebar_tab):
    s = QSettings()
    s.setValue("window/geometry", geometry)
    s.setValue("window/state", dock_state)
    s.setValue("sidebar/visible", sidebar_shown)
    s.setValue("sidebar/tab", sidebar_tab)


def shortcut_overrides():
    """{action name: [keys]} for the actions whose keys the user changed; [] means no key."""
    return _load("shortcuts/overrides", {})


def save_shortcut_overrides(overrides):
    _save("shortcuts/overrides", overrides)
