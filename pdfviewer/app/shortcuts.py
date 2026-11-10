from PySide6.QtGui import QKeySequence

from app.core import settings

# Action name -> default key sequences. Every shortcut lives here; the user's own keys are kept in settings.
# Names are ViewerState methods, except open/properties/quit/shortcut_help which are window commands.
KEYS = {
    "open": ["Ctrl+O"],
    "close_tab": ["Ctrl+W"],
    "properties": ["Ctrl+D"],
    "quit": ["Ctrl+Q"],
    "copy": ["Ctrl+C"],
    "ask_ai": ["Ctrl+Shift+K"],
    "highlight": ["H"],
    "undo": ["Ctrl+Z"],
    "redo": ["Ctrl+Shift+Z", "Ctrl+Y"],
    "open_search": ["Ctrl+F"],
    "prev": ["Left"],
    "next": ["Right"],
    "first_page": ["Home"],
    "last_page": ["End"],
    "page_up": ["PgUp"],
    "page_down": ["PgDown"],
    "zoom_in": ["Ctrl++", "Ctrl+="],
    "zoom_out": ["Ctrl+-"],
    "actual_size": ["Ctrl+0"],
    "rotate_right": ["R"],
    "toggle_sidebar": ["F4"],
    "toggle_chat": ["Ctrl+Shift+L"],
    "toggle_fullscreen": ["F11"],
    "toggle_presentation": ["F5"],
    "escape": ["Esc"],
    "next_tab": ["Ctrl+Tab", "Ctrl+PgDown"],
    "prev_tab": ["Ctrl+Shift+Tab", "Ctrl+PgUp"],
    "shortcut_help": ["?", "F1"],
}

# Menu title -> Alt key that opens it. The titles stay plain Korean: no "(F)" in the menu bar.
MENU_KEYS = {"파일": "Alt+F", "편집": "Alt+E", "보기": "Alt+V", "도움말": "Alt+H"}

# Not changeable: Esc closes the search and fullscreen, Ctrl+C copies in every app. MENU_KEYS are fixed too.
FIXED = ("escape", "copy")


def keys(name):
    """The keys an action uses: the user's own if they changed them, else the default."""
    return settings.shortcut_overrides().get(name, KEYS.get(name, []))


def set_keys(name, new_keys):
    """Give an action new keys; going back to the default drops the user's entry."""
    if name in FIXED:
        raise ValueError(f"{name} keeps its keys")
    overrides = settings.shortcut_overrides()
    overrides.pop(name, None)
    if new_keys != KEYS.get(name, []):
        overrides[name] = new_keys
    settings.save_shortcut_overrides(overrides)


def reset_all():
    settings.save_shortcut_overrides({})


def conflicts(names):
    """name -> the other owners (action names, or menu titles for MENU_KEYS) of a key it uses.
    Qt runs neither action when two share a key, so these are the keys that do nothing."""
    owners = {}
    for name in names:
        for key in keys(name):
            owners.setdefault(QKeySequence(key).toString(), []).append(name)  # toString: "ctrl+o" == "Ctrl+O"
    for title, key in MENU_KEYS.items():
        owners.setdefault(QKeySequence(key).toString(), []).append(title)
    clashes = {}
    for group in owners.values():
        for name in group:
            if name in names:
                others = clashes.setdefault(name, [])
                others += [o for o in group if o != name and o not in others]
    return {name: others for name, others in clashes.items() if others}
