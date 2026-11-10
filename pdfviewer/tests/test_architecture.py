"""The layer rules from CLAUDE.md, checked on the import statements so a redesign cannot quietly break them."""
import ast
from pathlib import Path

APP = Path(__file__).resolve().parent.parent / "app"
LOGIC = [*sorted((APP / "core").rglob("*.py")), *sorted((APP / "models").glob("*.py")), APP / "viewer_state.py",
         APP / "chat_state.py", APP / "annotation_state.py"]
UI = ("PySide6.QtWidgets", "app.widgets", "app.dialogs", "app.main_window")


def imports(path):
    for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
        if isinstance(node, ast.Import):
            yield from (alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            yield node.module


def module(path):
    return ".".join(path.relative_to(APP.parent).with_suffix("").parts)


def test_logic_does_not_import_the_screen():
    bad = [f"{module(p)} -> {name}" for p in LOGIC for name in imports(p) if name.startswith(UI)]
    assert bad == []


def test_widgets_do_not_import_each_other():
    widgets = sorted((APP / "widgets").glob("*.py"))
    # a delegate only paints its own list's rows, so the list that owns it may import it
    bad = [f"{module(p)} -> {name}" for p in widgets for name in imports(p)
           if name.startswith("app.widgets.") and not name.endswith("_delegate")]
    assert bad == []


def test_only_the_backends_talk_to_ai_services():
    services = ("anthropic", "httpx", "openai")
    files = [p for p in APP.rglob("*.py") if (APP / "core" / "llm") not in p.parents]
    bad = [f"{module(p)} -> {name}" for p in files for name in imports(p) if name.split(".")[0] in services]
    assert bad == []


def test_llm_backends_are_pure_python():
    backends = [p for p in (APP / "core" / "llm").glob("*.py") if p.name != "worker.py"]
    bad = [f"{module(p)} -> {name}" for p in backends for name in imports(p) if name.startswith("PySide6")]
    assert bad == []
