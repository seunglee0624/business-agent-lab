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
from app.models.notes_model import ITEM_ROLE, KIND_ROLE, NotesModel
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
    assert view._bar.mode == "selection" and {"복사", "AI에게 질문", "초록 하이라이트"} <= set(bar_buttons(window))
    assert "메모" not in bar_buttons(window)
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
    notes.start_editing(notes.highlight_selection())  # highlight + comment box
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
    notes.start_editing(notes.highlight_selection())
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
    notes.start_editing(notes.highlight_selection())
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
    notes.start_editing(notes.highlight_selection())
    qtbot.keyClicks(view._bar._box, "hi")
    st.set_view_mode("single")
    st.go_to(1)  # the highlight is on page 1: the box must not stay pinned over page 2
    qtbot.waitUntil(lambda: notes.editing is None)
    assert not view._bar.isVisible() and [h["comment"] for h in notes.highlights()] == ["hi"]


# ---- 11b: page notes, bookmarks, the document note

def test_page_note_add_change_delete_and_undo(qtbot, notes_setup):
    viewer, notes = notes_setup
    notes.set_page_note(0, "  첫 메모 ")
    assert notes.page_note(0)["text"] == "첫 메모" and notes.page_note(1) is None
    notes.set_page_note(0, "고침")
    notes.set_page_note(0, "   ")  # empty: deleted
    assert notes.page_note(0) is None
    notes.undo_group.undo()
    assert notes.page_note(0)["text"] == "고침"
    notes.undo_group.undo()
    assert notes.page_note(0)["text"] == "첫 메모"


def test_note_box_saves_into_its_page(qtbot, notes_setup):
    viewer, notes = notes_setup
    notes.start_note(1)
    assert notes.is_editing and notes.editing_note == 1 and notes.draft == ""
    notes.set_draft("p2")
    notes.stop_editing(save=True)
    assert not notes.is_editing and notes.page_note(1)["text"] == "p2"
    notes.start_note(1)
    assert notes.draft == "p2"
    notes.stop_editing()  # cancel
    assert notes.page_note(1)["text"] == "p2"


def test_bookmark_toggle_and_undo(qtbot, notes_setup):
    viewer, notes = notes_setup
    viewer.go_to(2)
    notes.toggle_bookmark()
    assert notes.is_bookmarked(2) and not notes.is_bookmarked(0)
    notes.toggle_bookmark(2)
    assert not notes.is_bookmarked(2)
    notes.undo_group.undo()
    assert notes.is_bookmarked(2)


def test_bookmark_is_named_after_its_first_line_and_the_list_says_so(notes_setup):
    viewer, notes = notes_setup
    notes.toggle_bookmark(0)  # page 1's text is read
    notes.toggle_bookmark(2)  # page 3's is not (and it is blank): no name
    assert [b["label"] for b in notes.store.items("bookmarks")] == ["Hello brave new world", ""]
    model = NotesModel(notes)
    model.set_filter("bookmarks")
    assert model.index(0).data() == "1쪽 북마크: Hello brave new world"


def test_next_and_previous_bookmark_wrap_around(notes_setup):
    viewer, notes = notes_setup
    notes.go_to_bookmark(1)  # none yet: stays
    assert viewer.current_page == 0
    notes.toggle_bookmark(0)
    notes.toggle_bookmark(2)
    for step, page in ((1, 2), (1, 0), (-1, 2), (-1, 0)):
        notes.go_to_bookmark(step)
        assert viewer.current_page == page


def test_doc_note_and_save_state(qtbot, notes_setup, tmp_path):
    viewer, notes = notes_setup
    assert notes.save_state == ""
    notes.set_doc_note("# 정리\n시험 범위")
    assert notes.doc_note() == "# 정리\n시험 범위" and notes.save_state == "pending"
    qtbot.waitUntil(lambda: notes.save_state == "saved")
    saved = json.loads(notes.store.path.read_text(encoding="utf-8"))
    assert saved["doc_note"] == "# 정리\n시험 범위"


def test_notes_and_bookmarks_of_the_wrong_shape_are_kept_aside(tmp_path):
    (tmp_path / "abc.json").write_text(json.dumps({"v": 1, "notes": [{"id": "n", "page": "x"}]}), encoding="utf-8")
    assert ".bak" in AnnotationStore(tmp_path, "abc", "/x/a.pdf", "a").problem


# ---- 11b on screen

def test_b_key_ribbon_and_a_click_keeps_it(qtbot, window):
    view, notes = window._view, window.notes
    qtbot.keyClick(view, Qt.Key.Key_B)
    assert notes.is_bookmarked(0) and not view._marker_paths()[0].isEmpty()
    view.ensureVisible(view._marker_rects(0)[0])
    ribbon, _ = view._marker_rects(0)  # after scrolling: the marks follow the view's top
    view._update_cursor(view.mapFromScene(ribbon.center()).toPointF())
    assert "북마크" in view.viewport().toolTip()
    qtbot.mouseClick(view.viewport(), Qt.MouseButton.LeftButton, pos=view.mapFromScene(ribbon.center()))
    assert notes.is_bookmarked(0)  # not lost to a stray click
    qtbot.keyClick(view, Qt.Key.Key_B)
    assert not notes.is_bookmarked(0) and view._marker_paths()[0].isEmpty()


def test_ribbons_stay_in_view_on_a_page_bigger_than_the_view(qtbot, window):
    view, notes = window._view, window.notes
    window.state.set_zoom(4)  # the page is much taller and wider than the view
    notes.toggle_bookmark(0)
    notes.set_page_note(0, "idea")
    page = view._rects[0]
    view.verticalScrollBar().setValue(view.verticalScrollBar().value() + round(page.height() / 3))
    top = view.mapToScene(0, 0).y()
    assert page.top() < top < page.bottom()
    for path in view._marker_paths():
        assert path.boundingRect().top() == pytest.approx(top)
    assert view.mapToScene(view.viewport().rect()).boundingRect().contains(view._marker_paths()[0].boundingRect())
    assert view._marker_at(view._marker_rects(0)[0].center()) == ("bookmark", 0)
    window._actions["toggle_chat"].trigger()  # the view narrows; nothing scrolls
    qtbot.waitUntil(lambda: view.mapToScene(view.viewport().rect()).boundingRect().contains(
        view._marker_paths()[0].boundingRect()))


def test_m_key_writes_a_page_note_and_its_mark_reopens_it(qtbot, window):
    view, notes = window._view, window.notes
    view.ensureVisible(view._marker_rects(0)[1])
    _, mark = view._marker_rects(0)  # after scrolling: the marks follow the view's top
    qtbot.keyClick(view, Qt.Key.Key_M)
    box = view._bar._box
    assert notes.editing_note == 0 and box.isVisible() and box.hasFocus() and "1쪽 메모" in box.placeholderText()
    qtbot.keyClicks(box, "Big idea")  # B and M typed into the box: not the shortcuts
    qtbot.keyClick(box, Qt.Key.Key_Return, Qt.KeyboardModifier.ControlModifier)
    assert notes.page_note(0)["text"] == "Big idea" and not notes.is_bookmarked(0)
    assert not view._marker_paths()[1].isEmpty() and not box.isVisible()
    view._update_cursor(view.mapFromScene(mark.center()).toPointF())
    assert view.viewport().toolTip() == "Big idea"
    qtbot.mouseClick(view.viewport(), Qt.MouseButton.LeftButton, pos=view.mapFromScene(mark.center()))
    assert notes.editing_note == 0 and box.toPlainText() == "Big idea"


def notes_tab(window):
    window._actions["notes_tab"].trigger()
    return window._sidebar.notes


def test_notes_tab_lists_filters_and_goes(qtbot, window):
    st, notes, view = window.state, window.notes, window._view
    select_on_screen(window, 0, 1)
    highlight_id = notes.highlight_selection()
    notes.set_page_note(2, "p3 note")
    notes.toggle_bookmark(1)
    panel = notes_tab(window)
    assert window._sidebar.currentWidget() is panel and st.sidebar
    model = panel._model
    rows = lambda: [(model.index(r).data(KIND_ROLE), model.index(r).data(ITEM_ROLE)["page"]) for r in range(model.rowCount())]
    assert [b.text() for b in panel._filters.buttons()] == ["하이라이트", "메모", "북마크"]  # no "전체"
    model.set_filter("highlights")
    assert rows() == [("highlights", 0)] and panel._count.text() == "1개"
    panel._go(model.index(0))
    assert notes.active == highlight_id and view._bar.mode == "highlight"
    model.set_filter("notes")
    assert rows() == [("notes", 2)]
    panel._go(model.index(0))
    assert st.current_page == 2 and notes.editing_note == 2
    notes.stop_editing()
    model.set_filter("bookmarks")
    assert rows() == [("bookmarks", 1)]
    panel._remove("bookmarks", model.index(0).data(ITEM_ROLE))
    assert not notes.is_bookmarked(1) and rows() == []


def test_doc_note_box_saves_and_follows_the_tab(qtbot, window, pdf100):
    panel, notes = notes_tab(window), window.notes
    panel._fold.click()
    assert panel._doc_note.isVisible() and panel._doc_note.isEnabled()
    qtbot.keyClicks(panel._doc_note, "summary")
    assert notes.doc_note() == "summary"
    qtbot.waitUntil(lambda: window._status._saved.text() == "저장됨")
    window.open_file(pdf100)
    qtbot.waitUntil(lambda: notes.store is not None)
    assert panel._doc_note.toPlainText() == ""
    window.state.switch_tab(0)
    qtbot.waitUntil(lambda: panel._doc_note.toPlainText() == "summary")


def test_notes_actions_are_on_the_toolbar_with_icons(qtbot, window):
    for name in ("page_note", "bookmark", "undo", "redo", "open_search", "toggle_chat", "toggle_presentation"):
        action = window._actions[name]
        assert window._toolbar.widgetForAction(action) is not None and not action.icon().isNull(), name
