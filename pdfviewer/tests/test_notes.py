"""Phase 11a: notes stored beside the PDF, highlights on the page, undo."""
import hashlib
import json
import shutil

import pytest
from PySide6.QtCore import QPoint, QRectF, Qt
from PySide6.QtWidgets import QToolButton

from app.annotation_state import AnnotationState
from app.core import settings
from app.core.annotations.store import AnnotationStore, doc_id
from app.core.document import Document
from app.main_window import MainWindow
from app.viewer_state import ViewerState


def sha(path):
    return hashlib.sha256(open(path, "rb").read()).hexdigest()


def highlight_item(item_id, **fields):
    return {"id": item_id, "page": 0, "words": [0, 1], "quads": [[1, 2, 3, 4]], "text": "", "color": "yellow",
            "comment": "", "created": "", "updated": "", **fields}


# ---- store

def test_store_round_trip_and_atomic_save(tmp_path):
    store = AnnotationStore(tmp_path, "abc", "/x/a.pdf", "a")
    store.save()
    assert not store.path.exists()  # nothing changed: no file for every PDF ever opened
    store.add("highlights", highlight_item("h1", text="한글"))
    store.save()
    assert json.loads(store.path.read_text(encoding="utf-8"))["highlights"][0]["text"] == "한글"
    assert [p.name for p in tmp_path.iterdir()] == ["abc.json"]  # the temporary file was renamed into place
    again = AnnotationStore(tmp_path, "abc", "/y/a.pdf", "a")
    assert again.items("highlights")[0]["id"] == "h1" and again.data["source_path"] == "/y/a.pdf"
    again.update("highlights", "h1", {"text": "새"})
    assert again.find("highlights", "h1")["text"] == "새"
    again.update("highlights", "h1", {"updated": "2020-01-01T00:00:00"})  # undo brings back the old time
    assert again.find("highlights", "h1")["updated"] == "2020-01-01T00:00:00"
    again.remove("highlights", "h1")
    assert again.items("highlights") == []


def test_broken_file_is_kept_aside(tmp_path):
    (tmp_path / "abc.json").write_text("{broken", encoding="utf-8")
    store = AnnotationStore(tmp_path, "abc", "/x/a.pdf", "a")
    assert store.items("highlights") == [] and ".bak" in store.problem
    assert (tmp_path / "abc.json.bak").read_text(encoding="utf-8") == "{broken"


def test_a_newer_file_is_never_overwritten(tmp_path):
    (tmp_path / "abc.json").write_text(json.dumps({"v": 99, "highlights": []}), encoding="utf-8")
    store = AnnotationStore(tmp_path, "abc", "/x/a.pdf", "a")
    store.add("highlights", {"id": "h1"})
    store.save()
    assert store.read_only and json.loads((tmp_path / "abc.json").read_text())["v"] == 99


def test_doc_id_follows_the_content(text_pdf, tmp_path):
    copy = shutil.copy(text_pdf, tmp_path / "renamed.pdf")
    assert doc_id(text_pdf) == doc_id(copy) and len(doc_id(text_pdf)) == 16
    settings.save_doc_id(text_pdf, 1, 2, "id1")
    assert settings.cached_doc_id(text_pdf, 1, 2) == "id1" and settings.cached_doc_id(text_pdf, 1, 3) is None


# ---- state

@pytest.fixture
def notes_setup(qtbot, text_pdf, tmp_path):
    viewer = ViewerState()
    viewer.set_viewport(800, 600)
    notes = AnnotationState(viewer, tmp_path / "data")
    viewer.open(Document(text_pdf))
    viewer.renderer.request_info([0])
    qtbot.waitUntil(lambda: notes.store is not None and viewer.renderer.info(0) is not None)
    yield viewer, notes
    viewer.renderer.shutdown()


def select_words(viewer, first, last):
    viewer.select(0, first, last)
    return viewer.selected_text()


def test_highlight_is_saved_and_survives_a_move(qtbot, notes_setup, text_pdf, tmp_path):
    viewer, notes = notes_setup
    before = sha(text_pdf)
    assert select_words(viewer, 0, 1) == "Hello brave"
    highlight_id = notes.highlight_selection("green")
    item = notes.highlight(highlight_id)
    assert item["text"] == "Hello brave" and item["color"] == "green" and item["words"] == [0, 1]
    (x0, y0, x1, y1), = item["quads"]  # one line: one box, in page.rect points
    assert 70 < x0 < x1 < 200 and 50 < y0 < y1 < 80
    assert viewer.selection is None and notes.color == "green"
    notes.set_highlight_comment(highlight_id, "  중요  ")
    notes.flush()
    assert sha(text_pdf) == before  # the PDF itself is never written

    moved = shutil.copy(text_pdf, tmp_path / "elsewhere.pdf")  # same content, another folder and name
    other = ViewerState()
    other_notes = AnnotationState(other, tmp_path / "data")
    other.open(Document(moved))
    qtbot.waitUntil(lambda: other_notes.store is not None)
    assert [(h["text"], h["comment"]) for h in other_notes.highlights()] == [("Hello brave", "중요")]
    other.renderer.shutdown()


def test_undo_and_redo(qtbot, notes_setup):
    viewer, notes = notes_setup
    undo = notes.undo_group
    select_words(viewer, 0, 0)
    first = notes.highlight_selection()
    select_words(viewer, 2, 3)
    second = notes.highlight_selection()
    notes.set_highlight_color(first, "pink")
    notes.remove_highlight(first)
    assert [h["id"] for h in notes.highlights()] == [second]
    undo.undo()  # the delete
    assert [h["id"] for h in notes.highlights()] == [first, second] and notes.highlight(first)["color"] == "pink"
    undo.undo()  # the colour
    assert notes.highlight(first)["color"] == "yellow"
    undo.undo()  # the second highlight
    assert [h["id"] for h in notes.highlights()] == [first]
    undo.redo()
    assert len(notes.highlights()) == 2


def test_undoing_the_clicked_highlight_lets_it_go(qtbot, notes_setup):
    viewer, notes = notes_setup
    select_words(viewer, 0, 0)
    notes.set_active(notes.highlight_selection())
    notes.undo_group.undo()
    assert notes.active is None


def test_highlight_at_a_point(qtbot, notes_setup):
    viewer, notes = notes_setup
    select_words(viewer, 0, 1)
    highlight_id = notes.highlight_selection()
    x0, y0, x1, y1 = notes.highlight(highlight_id)["quads"][0]
    assert notes.highlight_at(0, (x0 + x1) / 2, (y0 + y1) / 2) == highlight_id
    assert notes.highlight_at(0, x1 + 50, y1) is None and notes.highlight_at(1, x0, y0) is None


# ---- on screen

@pytest.fixture
def window(qtbot, text_pdf):
    window = MainWindow()
    qtbot.addWidget(window)
    window.show()
    window.activateWindow()
    qtbot.waitUntil(window.isActiveWindow)
    window.open_file(text_pdf)
    qtbot.waitUntil(lambda: window.notes.store is not None and window.state.renderer.info(0) is not None)
    yield window
    window.state.renderer.shutdown()


def bar_buttons(window):
    bar = window._view._bar
    return {b.toolTip() if b.objectName() == "hlDot" else b.text(): b
            for b in bar.findChildren(QToolButton) if b.isVisible()}


def select_on_screen(window, first, last):
    """Select words of page 1 and scroll them into the middle of the view."""
    window.state.select(0, first, last)
    view = window._view
    view.centerOn(view._selection.path().boundingRect().center())


def same_box(a, b):
    """Equal up to the 0.01 pt the quads are rounded to."""
    return all(abs(x - y) < 0.1 for x, y in zip(a.getRect(), b.getRect()))


def view_point(view, scene_rect):
    return view.mapFromScene(scene_rect.center())


def test_bar_highlights_the_selection_and_follows_zoom_and_rotation(qtbot, window):
    view, st, notes = window._view, window.state, window.notes
    select_on_screen(window, 0, 1)
    qtbot.waitUntil(lambda: view._bar.isVisible())
    assert view._bar.mode == "selection" and {"복사", "AI에게 질문", "메모", "초록 하이라이트"} <= set(bar_buttons(window))
    selected = view._selection.path().boundingRect()
    qtbot.mouseClick(bar_buttons(window)["초록 하이라이트"], Qt.MouseButton.LeftButton)
    assert [h["color"] for h in notes.highlights()] == ["green"] and not view._bar.isVisible()
    assert same_box(view._marks["green"].path().boundingRect(), selected)

    for change in (st.zoom_in, st.rotate_right, lambda: st.set_view_mode("single")):
        change()
        notes.select_highlight(notes.highlights()[0]["id"])  # the same words, drawn by the selection code
        assert same_box(view._marks["green"].path().boundingRect(), view._selection.path().boundingRect())
        st.clear_selection()


def test_click_a_highlight_then_comment_and_delete(qtbot, window):
    view, st, notes = window._view, window.state, window.notes
    select_on_screen(window, 0, 1)
    highlight_id = notes.highlight_selection()
    mark = view._marks["yellow"].path().boundingRect()
    qtbot.mouseClick(view.viewport(), Qt.MouseButton.LeftButton, pos=view_point(view, mark))
    assert notes.active == highlight_id and view._bar.mode == "highlight"
    assert not view._active_mark.path().isEmpty()

    qtbot.mouseClick(bar_buttons(window)["코멘트"], Qt.MouseButton.LeftButton)
    box = view._bar._box
    assert box.isVisible() and box.hasFocus()
    qtbot.keyClicks(box, "Hi")  # H typed into the box: not the highlight shortcut
    qtbot.keyClick(box, Qt.Key.Key_Return, Qt.KeyboardModifier.ControlModifier)
    assert notes.highlight(highlight_id)["comment"] == "Hi" and len(notes.highlights()) == 1
    view._update_cursor(view_point(view, mark).toPointF())
    assert view.viewport().toolTip() == "Hi"

    qtbot.mouseClick(bar_buttons(window)["삭제"], Qt.MouseButton.LeftButton)
    assert notes.highlights() == [] and not view._bar.isVisible()
    qtbot.keyClick(view, Qt.Key.Key_Z, Qt.KeyboardModifier.ControlModifier)
    assert [h["comment"] for h in notes.highlights()] == ["Hi"]


def test_escape_cancels_a_comment(qtbot, window):
    view, notes = window._view, window.notes
    select_on_screen(window, 0, 0)
    qtbot.waitUntil(lambda: view._bar.isVisible())
    qtbot.mouseClick(bar_buttons(window)["메모"], Qt.MouseButton.LeftButton)  # highlight + comment box
    qtbot.keyClicks(view._bar._box, "x")
    qtbot.keyClick(view._bar._box, Qt.Key.Key_Escape)
    assert [h["comment"] for h in notes.highlights()] == [""] and view.hasFocus()


def test_h_key_and_undo_stay_out_of_text_boxes(qtbot, window):
    view, notes = window._view, window.notes
    window.state.select(0, 0, 0)
    qtbot.keyClick(view, Qt.Key.Key_H)
    assert len(notes.highlights()) == 1
    window.chat.set_panel(True)
    box = window._chat_panel._input
    box.setEnabled(True)  # no key in tests
    box.setFocus()
    qtbot.keyClicks(box, "ha")
    qtbot.keyClick(box, Qt.Key.Key_Z, Qt.KeyboardModifier.ControlModifier)  # the box's own undo
    assert len(notes.highlights()) == 1 and window._actions["undo"].isEnabled()


def test_notes_are_written_on_quit(qtbot, window, text_pdf):
    window.state.select(0, 0, 0)
    window.notes.highlight_selection()
    path = window.notes.store.path
    window.close()
    assert json.loads(path.read_text(encoding="utf-8"))["highlights"][0]["text"] == "Hello"


# ---- review fixes

@pytest.mark.parametrize("data", [
    {"v": 1, "highlights": None},
    {"v": 1, "highlights": [{"id": "h1"}]},  # keys missing
    {"v": 1, "highlights": ["text"]},
    {"v": 1, "doc_note": 3},
    [],
])
def test_a_file_of_the_wrong_shape_is_kept_aside(tmp_path, data):
    (tmp_path / "abc.json").write_text(json.dumps(data), encoding="utf-8")
    store = AnnotationStore(tmp_path, "abc", "/x/a.pdf", "a")
    assert store.items("highlights") == [] and ".bak" in store.problem and not store.read_only


def test_undo_brings_back_the_old_update_time(qtbot, notes_setup):
    viewer, notes = notes_setup
    select_words(viewer, 0, 0)
    highlight_id = notes.highlight_selection()
    notes.highlight(highlight_id)["updated"] = "2020-01-01T00:00:00"
    notes.set_highlight_comment(highlight_id, "x")
    notes.undo_group.undo()
    assert notes.highlight(highlight_id)["updated"] == "2020-01-01T00:00:00"


def test_an_unreadable_pdf_is_reported(qtbot, notes_setup):
    _, notes = notes_setup
    with qtbot.waitSignal(notes.problem) as signal:
        notes._on_hashed("/gone.pdf", "")
    assert "하이라이트" in signal.args[0]


def test_a_broken_notes_file_is_reported_and_the_pdf_still_gets_notes(qtbot, text_pdf, tmp_path):
    folder = tmp_path / "data" / "notes"
    folder.mkdir(parents=True)
    (folder / f"{doc_id(text_pdf)}.json").write_text("{broken", encoding="utf-8")
    viewer = ViewerState()
    notes = AnnotationState(viewer, tmp_path / "data")
    with qtbot.waitSignal(notes.problem) as signal:
        viewer.open(Document(text_pdf))
    assert ".bak" in signal.args[0] and notes.store is not None
    viewer.renderer.shutdown()


def test_a_file_changed_on_disk_gets_its_new_id(qtbot, notes_setup, text_pdf):
    viewer, notes = notes_setup
    old = notes.store.data["doc_id"]
    with open(text_pdf, "ab") as file:
        file.write(b"\n% changed\n")  # new size and time: the cached id no longer applies
    viewer._show_tab(0)
    qtbot.waitUntil(lambda: notes.store is not None and notes.store.data["doc_id"] != old)
    assert notes.store.data["doc_id"] == doc_id(text_pdf)


def test_closing_a_tab_saves_and_lets_go_of_its_notes(qtbot, notes_setup, pdf100):
    viewer, notes = notes_setup
    select_words(viewer, 0, 0)
    notes.highlight_selection()
    path, content_id = notes.store.path, notes.store.data["doc_id"]
    viewer.open(Document(pdf100))
    qtbot.waitUntil(lambda: notes.store is not None)
    viewer.close_tab(0)
    assert content_id not in notes._stores and content_id not in notes._stacks
    assert len(notes.undo_group.stacks()) == 1
    assert json.loads(path.read_text(encoding="utf-8"))["highlights"][0]["text"] == "Hello"


def test_a_comment_being_written_is_saved_on_a_tab_switch(qtbot, window, pdf100):
    view, st, notes = window._view, window.state, window.notes
    select_on_screen(window, 0, 0)
    qtbot.waitUntil(lambda: view._bar.isVisible())
    qtbot.mouseClick(bar_buttons(window)["메모"], Qt.MouseButton.LeftButton)
    qtbot.keyClicks(view._bar._box, "draft")
    first = notes.store
    window.open_file(pdf100)
    assert notes.editing is None and view._bar.mode != "comment"
    assert [h["comment"] for h in first.items("highlights")] == ["draft"]
    st.switch_tab(0)
    qtbot.waitUntil(lambda: notes.store is first)
    notes.undo_group.undo()  # the saved draft is one step on that document's own stack
    assert first.items("highlights")[0]["comment"] == ""


def test_undoing_the_highlight_closes_its_comment_box(qtbot, window):
    view, notes = window._view, window.notes
    select_on_screen(window, 0, 0)
    qtbot.waitUntil(lambda: view._bar.isVisible())
    qtbot.mouseClick(bar_buttons(window)["메모"], Qt.MouseButton.LeftButton)
    window._actions["undo"].trigger()  # from the menu: the box's own Ctrl+Z would undo its text
    assert notes.highlights() == [] and notes.editing is None and not view._bar._box.isVisible()


def test_clicking_another_highlight_keeps_the_comment_on_its_own(qtbot, window):
    view, notes = window._view, window.notes
    select_on_screen(window, 0, 0)
    first = notes.highlight_selection()
    select_on_screen(window, 2, 3)
    second = notes.highlight_selection()
    notes.start_editing(first)
    qtbot.keyClicks(view._bar._box, "one")
    other = QRectF(*notes.highlight(second)["quads"][0])
    qtbot.mouseClick(view.viewport(), Qt.MouseButton.LeftButton,
                     pos=view.mapFromScene(view._page_transform(0).mapRect(other).center()))
    assert notes.active == first and notes.editing == first
    qtbot.keyClick(view._bar._box, Qt.Key.Key_Return, Qt.KeyboardModifier.ControlModifier)
    assert (notes.highlight(first)["comment"], notes.highlight(second)["comment"]) == ("one", "")


def test_a_click_between_the_bar_buttons_is_not_a_page_click(qtbot, window):
    view, st = window._view, window.state
    select_on_screen(window, 0, 1)
    qtbot.waitUntil(lambda: view._bar.isVisible())
    qtbot.mouseClick(view._bar, Qt.MouseButton.LeftButton, pos=QPoint(1, 1))  # the bar's padding
    assert st.selection is not None and view._bar.isVisible()


def test_the_bar_follows_a_scroll(qtbot, window):
    view = window._view
    select_on_screen(window, 0, 1)
    qtbot.waitUntil(lambda: view._bar.isVisible())
    before = view._bar.pos()
    view.verticalScrollBar().setValue(view.verticalScrollBar().value() + 20)
    assert view._bar.isVisible() and view._bar.pos().y() == before.y() - 20


def test_paging_away_from_a_comment_saves_and_closes_it(qtbot, window):
    view, st, notes = window._view, window.state, window.notes
    select_on_screen(window, 0, 0)
    qtbot.waitUntil(lambda: view._bar.isVisible())
    qtbot.mouseClick(bar_buttons(window)["메모"], Qt.MouseButton.LeftButton)
    qtbot.keyClicks(view._bar._box, "hi")
    st.set_view_mode("single")
    st.go_to(1)  # the highlight is on page 1: the box must not stay pinned over page 2
    qtbot.waitUntil(lambda: notes.editing is None)
    assert not view._bar.isVisible() and [h["comment"] for h in notes.highlights()] == ["hi"]
