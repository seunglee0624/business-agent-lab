"""Everything the app keeps between runs, in QSettings (API keys: the OS password store, see llm_config). Lists and dicts are stored as JSON strings:
QSettings' own list handling differs between backends (a one-item list comes back as a str in INI)."""
import json
import logging
import os

from PySide6.QtCore import QSettings

log = logging.getLogger(__name__)

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
    "anthropic_key": "",
    "openai_base_url": "",
    "openai_model": "",
    "openai_key": "",  # some servers (Ollama) need none
    "max_tokens": 4096,  # covers thinking too, so well above a typical answer
    "document_limit": 60000,  # characters of a whole document sent at most
}


SECRETS = ("anthropic_key", "openai_key")
VAULT_SERVICE = "pdfviewer"


def _vault():
    """The OS password store (Windows Credential Manager, macOS Keychain) through keyring, or None:
    WSL and bare Linux desktops have none, and then the keys stay in the settings file."""
    try:
        import keyring
        from keyring.backends.fail import Keyring as NoVault
    except ImportError:
        return None
    return None if isinstance(keyring.get_keyring(), NoVault) else keyring


def keys_protected():
    """Whether API keys go to the OS password store (the settings dialog says where they are)."""
    return _vault() is not None


def _store_secret(vault, key, value):
    """True once the vault holds value (or, for "", holds nothing). False: keep it in the settings file."""
    try:
        if value:
            vault.set_password(VAULT_SERVICE, key, value)
        elif vault.get_password(VAULT_SERVICE, key) is not None:
            vault.delete_password(VAULT_SERVICE, key)
        return True
    except Exception:  # a locked or broken store must not lose the key
        log.exception("API 키를 암호 저장소에 넣지 못했습니다")
        return False


def llm_config():
    """The AI backend and how it answers. API keys come from the OS password store when there is one;
    a key an older version left in the settings file moves there on the first read."""
    s = QSettings()
    config = {key: s.value(f"llm/{key}", default, type=type(default)) for key, default in LLM_DEFAULTS.items()}
    _owner_only(s)  # also a file an older version wrote readable for all
    vault = _vault()
    for key in SECRETS if vault else ():
        if config[key]:
            if _store_secret(vault, key, config[key]):
                s.remove(f"llm/{key}")
        else:
            try:
                config[key] = vault.get_password(VAULT_SERVICE, key) or ""
            except Exception:
                log.exception("API 키를 암호 저장소에서 읽지 못했습니다")
    return config


def save_llm_config(config):
    s = QSettings()
    vault = _vault()
    for key in LLM_DEFAULTS:
        if key in SECRETS and vault and _store_secret(vault, key, config[key]):
            s.remove(f"llm/{key}")
        else:
            s.setValue(f"llm/{key}", config[key])
    s.sync()
    _owner_only(s)


def _owner_only(s):
    if os.name == "posix" and os.path.isfile(s.fileName()):
        os.chmod(s.fileName(), 0o600)  # keys may be in it (no password store): other users must not read it


def chat_panel():
    """Whether the AI chat panel was open."""
    return QSettings().value("chat/visible", False, type=bool)


def save_chat_panel(shown):
    QSettings().setValue("chat/visible", shown)


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


def comment_size():
    """[width, height] the comment box was last dragged to, or None."""
    return _load("notes/comment_size", None)


def save_comment_size(width, height):
    _save("notes/comment_size", [width, height])
