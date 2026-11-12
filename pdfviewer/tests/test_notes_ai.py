"""Phase 11c: AI answers kept as notes, the conversation saved with the notes, Markdown export."""
import pytest
from PySide6.QtCore import QPointF, QUrl

from app.annotation_state import AnnotationState
from app.chat_state import ChatState
from app.core import settings
from app.core.annotations.export import to_markdown
from app.core.document import Document
from app.models.notes_model import NotesModel
from app.viewer_state import ViewerState
from tests.test_chat import FakeBackend, ask


def open_with_notes(text_pdf, folder, backend):
    viewer = ViewerState()
    viewer.set_viewport(800, 600)
    notes = AnnotationState(viewer, folder)
    chat = ChatState(viewer, backend, notes=notes)
    viewer.open(Document(text_pdf))
    viewer.renderer.request_info([0])
    return viewer, notes, chat


@pytest.fixture
def setup(qtbot, text_pdf, tmp_path):
    viewer, notes, chat = open_with_notes(text_pdf, tmp_path / "data", FakeBackend())
    qtbot.waitUntil(lambda: notes.store is not None and viewer.renderer.info(0) is not None)
    yield viewer, notes, chat
    viewer.renderer.shutdown()


def test_markdown_export():
    data = {"title": "lecture", "doc_note": "# 정리\n시험 범위", "chat": [],
            "bookmarks": [{"id": "b2", "page": 4, "label": ""}, {"id": "b1", "page": 0, "label": "Intro"}],
            "highlights": [{"id": "h2", "page": 0, "quads": [[0, 300, 1, 310]], "text": "second", "comment": ""},
                           {"id": "h1", "page": 0, "quads": [[0, 100, 1, 110]], "text": "first\nline", "comment": "중요"}],
            "notes": [{"id": "n1", "page": 0, "text": "my note", "source": "user"},
                      {"id": "n2", "page": 2, "text": "AI says", "source": "ai", "question": "뭐야?"}]}
    assert to_markdown(data) == (
        "# lecture\n\n## 문서 노트\n\n# 정리\n시험 범위\n\n## 북마크\n\n- p.1: Intro\n- p.5\n\n## 하이라이트·메모\n\n"
        "### p.1\n\n> first\n> line\n\n코멘트: 중요\n\n> second\n\n**메모**: my note\n\n"
        "### p.3\n\n**AI** (질문: 뭐야?)\n\nAI says\n")
    empty = {"title": "", "doc_note": "", "bookmarks": [], "highlights": [], "notes": [], "chat": []}
    assert to_markdown(empty) == "# 메모\n"


def test_an_answer_becomes_an_ai_note_of_the_question_page(qtbot, setup):
    viewer, notes, chat = setup
    ask(qtbot, chat, "무슨 내용?")
    viewer.go_to(2)  # saved on the page it was asked on, not the one shown now
    chat.save_answer(1)
    note = notes.store.items("notes")[0]
    assert (note["page"], note["text"], note["source"], note["question"]) == (0, "answer 1", "ai", "무슨 내용?")
    assert chat.answer_saved(chat.messages[1]) and notes.page_note(0) is None  # not the user's own page note
    chat.save_answer(1)  # once only
    assert len(notes.store.items("notes")) == 1
    model = NotesModel(notes)
    model.set_filter("notes")
    assert model.index(0).data() == "1쪽 AI 메모: answer 1"
    notes.undo_group.undo()
    assert not chat.answer_saved(chat.messages[1]) and notes.marked_pages() == (set(), set())  # no yellow ribbon


def test_the_conversation_comes_back_when_the_file_is_reopened(qtbot, setup, text_pdf, tmp_path):
    viewer, notes, chat = setup
    ask(qtbot, chat, "첫 질문")
    chat.save_answer(1)
    notes.flush()
    again, again_notes, again_chat = open_with_notes(text_pdf, tmp_path / "data", FakeBackend())
    try:
        qtbot.waitUntil(lambda: again_notes.store is not None)
        assert [(m["role"], m["text"]) for m in again_chat.messages] == [("user", "첫 질문"), ("assistant", "answer 1")]
        assert again_chat.answer_saved(again_chat.messages[1])
        ask(qtbot, again_chat, "다음 질문")  # the restored turns are sent as history
        assert [m["role"] for m in again_chat.backend.calls[0]] == ["user", "assistant", "user"]
    finally:
        again.renderer.shutdown()


def test_clearing_forgets_the_saved_conversation_and_saving_can_be_off(qtbot, setup):
    viewer, notes, chat = setup
    ask(qtbot, chat, "질문")
    assert len(notes.store.data["chat"]) == 2
    chat.clear()
    assert notes.store.data["chat"] == []
    settings.save_llm_config({**settings.llm_config(), "save_chat": False})
    ask(qtbot, chat, "질문")
    assert notes.store.data["chat"] == []


def test_ribbons_are_painted_at_the_page_top_after_a_page_turn(qtbot, text_pdf):
    from app import theme
    from app.main_window import MainWindow
    window = MainWindow()
    qtbot.addWidget(window)
    window.resize(1000, 700)
    window.show()
    window.open_file(text_pdf)
    qtbot.waitUntil(lambda: window.notes.store is not None)
    try:
        view, state = window._view, window.state
        state.set_view_mode("single")
        state.set_zoom(2.5)  # page 1 is taller than the view
        window.notes.toggle_bookmark(0)
        view.verticalScrollBar().setValue(400)  # its ribbon follows the view down the page
        state.go_to(1)
        state.go_to(0)  # the view scrolls itself back to the page top
        ribbon = view._marker_rects(0)[0]
        assert ribbon.top() == view._rects[0].top()
        point = view.mapFromScene(ribbon.center() - QPointF(0, ribbon.height() / 4))
        qtbot.waitUntil(lambda: view.viewport().grab().toImage().pixelColor(point).name()
                        == theme.color("color.accent").name())
    finally:
        window.state.renderer.shutdown()


def test_chat_panel_save_link_and_export(qtbot, text_pdf, tmp_path, monkeypatch):
    from PySide6.QtWidgets import QFileDialog
    from app.main_window import MainWindow
    window = MainWindow()
    qtbot.addWidget(window)
    window.open_file(text_pdf)
    qtbot.waitUntil(lambda: window.notes.store is not None)
    try:
        window.chat.backend = FakeBackend()
        ask(qtbot, window.chat, "질문")
        panel = window._chat_panel
        panel._render()
        assert "메모로 저장" in panel._log.toPlainText()
        panel._open_link(QUrl("save:1"))
        panel._render()
        assert "메모에 저장됨" in panel._log.toPlainText() and "메모로 저장" not in panel._log.toPlainText()
        target = tmp_path / "out" / "text_notes.md"
        target.parent.mkdir()
        monkeypatch.setattr(QFileDialog, "getSaveFileName", lambda *args: (str(target), ""))
        window._actions["export_notes"].trigger()
        assert target.read_text(encoding="utf-8").startswith("# text\n\n## 하이라이트·메모\n\n### p.1\n\n**AI** (질문: 질문)")
        assert settings.export_folder() == str(target.parent)
    finally:
        window.state.renderer.shutdown()
