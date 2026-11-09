"""Phase 10a: AI chat on the current page or the selection."""
import threading

import pytest
from PySide6.QtCore import Qt

from app.chat_state import MAX_TURNS, ChatState
from app.core.document import Document
from app.core.llm.anthropic_api import AnthropicBackend
from app.core.llm.base import LLMBackend, LLMError
from app.main_window import MainWindow
from app.viewer_state import ViewerState


class FakeBackend(LLMBackend):
    """Answers "answer N"; records what it was sent. gate: hold the answer until set (to test cancel)."""

    name, model = "fake", "fake"

    def __init__(self, available=True, error=None):
        self.available, self.error = available, error
        self.calls = []
        self.gate = None

    def is_available(self):
        return self.available

    def stream(self, system, messages):
        self.calls.append(messages)
        if self.error:
            raise self.error
        yield "answer "
        if self.gate:
            self.gate.wait(5)
        yield str(len(self.calls))


@pytest.fixture
def setup(text_pdf):
    viewer = ViewerState()
    viewer.set_viewport(800, 600)
    viewer.open(Document(text_pdf))
    backend = FakeBackend()
    yield viewer, ChatState(viewer, backend), backend
    viewer.renderer.shutdown()


def ask(qtbot, chat, question):
    chat.send(question)
    qtbot.waitUntil(lambda: not chat.busy, timeout=10000)


def test_page_question_sends_the_page_text_with_the_question(qtbot, setup):
    viewer, chat, backend = setup
    ask(qtbot, chat, "무슨 내용?")
    sent = backend.calls[0][-1]["content"]
    assert sent.startswith('<excerpt pages="p.1">') and "Hello brave new world" in sent and sent.endswith("무슨 내용?")
    assert [(m["role"], m["text"]) for m in chat.messages] == [("user", "무슨 내용?"), ("assistant", "answer 1")]


def test_turns_already_sent_are_resent_unchanged(qtbot, setup):
    viewer, chat, backend = setup
    ask(qtbot, chat, "first")
    viewer.go_to(1)  # the next question carries page 2; the first keeps page 1's excerpt
    ask(qtbot, chat, "second")
    first, second = backend.calls
    assert second[:2] == [first[0], {"role": "assistant", "content": "answer 1"}]
    assert second[2]["content"].startswith('<excerpt pages="p.2">')


def test_selection_scope(qtbot, setup):
    viewer, chat, backend = setup
    chat.set_scope("selection")
    chat.send("뜻?")
    assert not chat.busy and chat.messages[-1]["role"] == "error" and backend.calls == []
    viewer.renderer.request_info([0])
    qtbot.waitUntil(lambda: viewer.renderer.info(0) is not None, timeout=10000)
    viewer.select(0, 1, 2)
    ask(qtbot, chat, "뜻?")
    assert backend.calls[0][-1]["content"] == '<excerpt pages="p.1">\nbrave new\n</excerpt>\n\n뜻?'


def test_failed_turns_are_not_sent_again(qtbot, setup):
    viewer, chat, backend = setup
    backend.error = LLMError("한도", "rate_limit")
    ask(qtbot, chat, "first")
    assert chat.messages[-1] == {"role": "error", "kind": "rate_limit", "text": "한도"}
    backend.error = None
    ask(qtbot, chat, "second")
    assert len(backend.calls[-1]) == 1 and backend.calls[-1][0]["content"].endswith("second")


def test_cancel_keeps_the_partial_answer(qtbot, setup):
    viewer, chat, backend = setup
    backend.gate = threading.Event()
    chat.send("q")
    qtbot.waitUntil(lambda: chat.messages[-1]["text"] == "answer ", timeout=10000)
    chat.cancel()
    backend.gate.set()
    assert not chat.busy and chat.messages[-1] == {"role": "assistant", "text": "answer "}
    qtbot.wait(100)  # the cancelled worker's late signals change nothing
    assert chat.messages[-1] == {"role": "assistant", "text": "answer "}


def test_history_keeps_the_last_turns_starting_with_a_question(qtbot, setup):
    viewer, chat, backend = setup
    for i in range(MAX_TURNS + 2):
        ask(qtbot, chat, f"q{i}")
    sent = backend.calls[-1]
    assert len(sent) == 2 * MAX_TURNS - 1 and sent[0]["role"] == "user" and sent[-1]["content"].endswith(f"q{MAX_TURNS + 1}")


def test_each_file_has_its_own_conversation(qtbot, setup, tmp_path):
    from conftest import make_pdf
    viewer, chat, backend = setup
    ask(qtbot, chat, "q")
    viewer.open(Document(make_pdf(tmp_path / "other.pdf", 2)))
    assert chat.messages == []
    viewer.switch_tab(0)
    assert len(chat.messages) == 2
    chat.clear()
    assert chat.messages == []


def test_renderer_extracts_page_text(qtbot, setup):
    viewer = setup[0]
    viewer.renderer.request_text(0)
    qtbot.waitUntil(lambda: viewer.renderer.text(0) is not None, timeout=10000)
    assert "Go to page three" in viewer.renderer.text(0)


def test_anthropic_request(monkeypatch):
    seen = {}

    class Stream:
        text_stream = iter(["안", "녕"])

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

        def get_final_message(self):
            usage = type("U", (), {"input_tokens": 1, "cache_read_input_tokens": 0, "output_tokens": 2})
            return type("M", (), {"usage": usage, "stop_reason": "end_turn"})

    class Client:
        def __init__(self, api_key):
            seen["key"] = api_key
            self.beta = self
            self.messages = self

        def stream(self, **params):
            seen.update(params)
            return Stream()

    import anthropic
    monkeypatch.setattr(anthropic, "Anthropic", Client)
    backend = AnthropicBackend("claude-sonnet-5-5", "low", 4096, api_key="k")
    assert "".join(backend.stream("sys", [{"role": "user", "content": "q"}])) == "안녕"
    assert seen["key"] == "k" and seen["output_config"] == {"effort": "low"} and seen["fallbacks"] == "default"
    assert seen["cache_control"] == {"type": "ephemeral"} and seen["max_tokens"] == 4096
    seen.clear()
    "".join(AnthropicBackend("claude-haiku-5-5", "low", 4096, api_key="k").stream("sys", []))
    assert "fallbacks" not in seen and "betas" not in seen


def test_no_key_backend_is_unavailable(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    assert not AnthropicBackend("claude-sonnet-5-5", "low", 4096).is_available()


@pytest.fixture
def window(qtbot, text_pdf, monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    window = MainWindow()
    qtbot.addWidget(window)
    window.show()
    window.activateWindow()
    qtbot.waitUntil(window.isActiveWindow)
    window.open_file(text_pdf)
    yield window
    window.state.renderer.shutdown()


def test_ctrl_shift_l_toggles_the_panel_and_esc_goes_back(qtbot, window):
    assert not window._chat_dock.isVisible()
    qtbot.keyClick(window._view, Qt.Key.Key_L, Qt.KeyboardModifier.ControlModifier | Qt.KeyboardModifier.ShiftModifier)
    assert window._chat_dock.isVisible() and window._actions["toggle_chat"].isChecked()
    window._chat_panel._input.setEnabled(True)  # no key in tests: unlock the box to check Esc
    window._chat_panel.focus_input()
    qtbot.keyClick(window._chat_panel._input, Qt.Key.Key_Escape)
    assert window._view.hasFocus()
    qtbot.keyClick(window._view, Qt.Key.Key_L, Qt.KeyboardModifier.ControlModifier | Qt.KeyboardModifier.ShiftModifier)
    assert not window._chat_dock.isVisible()


def test_without_a_key_the_panel_says_how_to_set_one(qtbot, window):
    window.chat.set_panel(True)
    panel = window._chat_panel
    assert panel._notice.isVisible() and "ANTHROPIC_API_KEY" in panel._notice.text()
    assert not panel._input.isEnabled()


def test_panel_shows_the_conversation_and_enter_sends(qtbot, window):
    window.chat.backend = FakeBackend()
    panel = window._chat_panel
    window.chat.set_panel(True)
    panel._input.setEnabled(True)
    qtbot.keyClicks(panel._input, "hello")
    qtbot.keyClick(panel._input, Qt.Key.Key_Return)
    assert panel._input.toPlainText() == ""
    qtbot.waitUntil(lambda: "answer 1" in panel._log.toPlainText(), timeout=10000)
    assert "p.1" in panel._log.toPlainText() and "hello" in panel._log.toPlainText()
