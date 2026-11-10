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


def cached_doc_id(path, size, mtime):
    """A file's content id from last time, while its size and modification time are unchanged."""
    entry = _load("files/doc_ids", {}).get(path)
    return entry[2] if entry and entry[:2] == [size, mtime] else None


def save_doc_id(path, size, mtime, doc_id):
    ids = _load("files/doc_ids", {})
    ids.pop(path, None)
    ids[path] = [size, mtime, doc_id]
    while len(ids) > MAX_FILE_VIEWS:
        ids.pop(next(iter(ids)))
    _save("files/doc_ids", ids)


def export_folder():
    """Where notes were last exported ("" before the first time)."""
    return QSettings().value("notes/export_folder", "")


def save_export_folder(folder):
    QSettings().setValue("notes/export_folder", folder)


def highlight_color():
    return QSettings().value("notes/color", "yellow")


def save_highlight_color(color):
    QSettings().setValue("notes/color", color)


def notes_filter():
    return QSettings().value("notes/filter", "highlights")


def save_notes_filter(kind):
    QSettings().setValue("notes/filter", kind)


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


LLM_DEFAULTS = {
    "backend": "anthropic",  # or "openai_compat"
    "anthropic_model": "claude-sonnet-5-5",
    "anthropic_effort": "low",  # quick replies for a reading aid (the model defaults to high)
    "anthropic_key": "",  # empty: the ANTHROPIC_API_KEY environment variable
    "openai_base_url": "",
    "openai_model": "",
    "openai_key": "",  # some servers (Ollama) need none
    "max_tokens": 4096,  # covers thinking too, so well above a typical answer
    "document_limit": 60000,  # characters of a whole document sent at most
    "save_chat": True,  # keep each file's AI conversation in its notes
}


def llm_config():
    """The AI backend and how it answers. API keys are stored in plain text (a local, personal app; see README)."""
    s = QSettings()
    return {key: s.value(f"llm/{key}", default, type=type(default)) for key, default in LLM_DEFAULTS.items()}


def save_llm_config(config):
    s = QSettings()
    for key in LLM_DEFAULTS:
        s.setValue(f"llm/{key}", config[key])


def chat_panel():
    """Whether the AI chat panel was open."""
    return QSettings().value("chat/visible", False, type=bool)


def save_chat_panel(shown):
    QSettings().setValue("chat/visible", shown)


def chat_scope():
    return QSettings().value("chat/scope", "page")


def save_chat_scope(scope):
    QSettings().setValue("chat/scope", scope)


DEFAULT_QUICK_QUESTIONS = [  # scope "": whatever scope is chosen at the time
    {"label": "페이지 요약", "text": "이 페이지의 핵심을 3~5줄로 요약해줘.", "scope": "page"},
    {"label": "쉽게 설명", "text": "선택한 부분을 쉽게 풀어서 설명해줘.", "scope": "selection"},
    {"label": "용어 정리", "text": "여기에 나오는 핵심 용어를 뜻과 함께 정리해줘.", "scope": ""},
]


def quick_questions():
    """[{"label", "text", "scope"}]: the chat panel's one-click questions, as the user edited them."""
    if not QSettings().contains("chat/quick_questions"):  # checked apart: an emptied list stays empty
        return [dict(q) for q in DEFAULT_QUICK_QUESTIONS]
    return _load("chat/quick_questions", [])


def save_quick_questions(questions):
    _save("chat/quick_questions", questions)
