# Action name -> key sequences. Every shortcut lives here.
# Names are ViewerState methods, except open/properties/quit/shortcut_help which are window commands.
KEYS = {
    "open": ["Ctrl+O"],
    "close_tab": ["Ctrl+W"],
    "properties": ["Ctrl+D"],
    "quit": ["Ctrl+Q"],
    "copy": ["Ctrl+C"],
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
    "toggle_fullscreen": ["F11"],
    "toggle_presentation": ["F5"],
    "escape": ["Esc"],
    "next_tab": ["Ctrl+Tab", "Ctrl+PgDown"],
    "prev_tab": ["Ctrl+Shift+Tab", "Ctrl+PgUp"],
    "shortcut_help": ["?", "F1"],
}

# Menu title -> Alt key that opens it. The titles stay plain Korean: no "(F)" in the menu bar.
MENU_KEYS = {"파일": "Alt+F", "편집": "Alt+E", "보기": "Alt+V", "도움말": "Alt+H"}
