"""Phase 11c: AI answers kept in page notes (the conversation itself is not saved), Markdown export."""
import pytest
from PySide6.QtCore import QPointF, QUrl

from app.annotation_state import AnnotationState
from app.chat_state import ChatState
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
    assert to_markdown(empty) == "# 노트\n"


def test_an_answer_goes_into_the_question_pages_own_note(qtbot, setup):
    viewer, notes, chat = setup
    ask(qtbot, chat, "무슨 내용?")
    chat.messages[1]["text"] = "**굵게** 핵심"  # an answer in markdown
    viewer.go_to(2)  # saved on the page it was asked on, not the one shown now
    chat.save_answer(1)
    assert notes.page_note(0)["text"] == "굵게 핵심" and notes.page_note(0)["source"] == "user"  # plain text
    assert chat.answer_saved(chat.messages[1]) and notes.marked_pages()[1] == {0}  # the yellow ribbon
    chat.save_answer(1)  # once only
    assert len(notes.store.items("notes")) == 1 and notes.page_note(0)["text"] == "굵게 핵심"
    notes.undo_group.undo()
    assert not chat.answer_saved(chat.messages[1]) and notes.page_note(0) is None


def test_an_answer_is_added_under_a_note_already_there(qtbot, setup):
    viewer, notes, chat = setup
    notes.set_page_note(0, "내 메모")
    ask(qtbot, chat, "질문")
    chat.save_answer(1)
    assert notes.page_note(0)["text"] == "내 메모\n\nanswer 1" and len(notes.store.items("notes")) == 1


def test_the_conversation_is_not_saved(qtbot, setup, text_pdf, tmp_path):
    viewer, notes, chat = setup
    ask(qtbot, chat, "첫 질문")
    chat.save_answer(1)
    notes.flush()
    assert notes.store.data["chat"] == []
    path = viewer.document.path
    viewer.close_tab()
    viewer.open(Document(path))  # closed and opened again in the same run
    assert chat.messages == []
    again, again_notes, again_chat = open_with_notes(text_pdf, tmp_path / "data", FakeBackend())
    try:
        qtbot.waitUntil(lambda: again_notes.store is not None)
        assert again_chat.messages == [] and again_notes.page_note(0)["text"] == "answer 1"
    finally:
        again.renderer.shutdown()


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


def test_chat_panel_save_link_and_copy(qtbot, text_pdf, tmp_path, monkeypatch):
    from PySide6.QtWidgets import QApplication
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
        window._actions["copy_notes"].trigger()
        assert QApplication.clipboard().text().startswith("# text\n\n## 하이라이트·메모\n\n### p.1\n\n**메모**: answer 1")
    finally:
        window.state.renderer.shutdown()


def test_ai_text_never_fetches_images(qtbot, tmp_path):
    """file:/// and //host/share images in an answer, a note or a PDF's title are not loaded (a Windows UNC
    fetch sends the login hash)."""
    from PySide6.QtCore import QUrl
    from PySide6.QtGui import QImage, QTextDocument
    from app.models import notes_model
    from app.widgets.chat_panel import ChatPanel
    image = tmp_path / "x.png"
    QImage(4, 4, QImage.Format.Format_RGB32).save(str(image))
    url = QUrl.fromLocalFile(str(image))
    from app.chat_state import ChatState
    from app.viewer_state import ViewerState
    viewer = ViewerState()
    panel = ChatPanel(ChatState(viewer))
    qtbot.addWidget(panel)
    panel._log.setMarkdown(f"![x]({url.toString()})")
    panel._log.show()
    panel._log.grab()  # lays out and paints the image
    assert panel._log.document().resource(QTextDocument.ResourceType.ImageResource, url).size().width() == 1
    panel._open_link(QUrl("page:abc"))  # an answer's own odd link: ignored, no crash
    viewer.renderer.shutdown()
    plain = notes_model.TextOnly()
    plain.setMarkdown(f"![x]({url.toString()})")
    plain.size()  # lays it out
    assert plain.resource(QTextDocument.ResourceType.ImageResource, url).size().width() == 1
    unguarded = QTextDocument()
    unguarded.setMarkdown(f"![x]({url.toString()})")
    unguarded.size()
    assert unguarded.resource(QTextDocument.ResourceType.ImageResource, url).size().width() == 4  # what Qt does unasked
