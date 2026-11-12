"""Phase 10c: the AI settings, the OpenAI-compatible backend (against a local fake server) and the settings dialog."""
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest
from PySide6.QtCore import QTimer
from PySide6.QtWidgets import QApplication, QLabel, QLineEdit, QPushButton, QRadioButton

from app.core import settings
from app.core.llm import AnthropicBackend, OpenAICompatBackend, make_backend
from app.core.llm.base import LLMError, Usage
from app.dialogs.llm_settings_dialog import llm_settings_dialog


class _Handler(BaseHTTPRequestHandler):
    status, message = 200, "nope"  # set per test on the server's handler class
    requests = []

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        type(self).requests.append((self.path, self.headers.get("Authorization"), body))
        if self.status != 200:
            payload = json.dumps({"error": {"message": self.message}}).encode()
            self.send_response(self.status)
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.end_headers()
        events = [{"choices": [{"delta": {"role": "assistant"}}]},
                  {"choices": [{"delta": {"content": "안"}}]},
                  {"choices": [{"delta": {"content": "녕"}, "finish_reason": "stop"}]},
                  {"choices": [], "usage": {"prompt_tokens": 12, "completion_tokens": 3}}]
        for event in events:
            self.wfile.write(f"data: {json.dumps(event, ensure_ascii=False)}\n\n".encode())
        self.wfile.write(b": keep-alive comment\n\ndata: [DONE]\n\n")

    def log_message(self, *args):
        pass


@pytest.fixture
def server():
    handler = type("Handler", (_Handler,), {"status": 200, "requests": []})
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    httpd.url = f"http://127.0.0.1:{httpd.server_port}/v1"
    yield httpd
    httpd.shutdown()
    httpd.server_close()


def test_settings_round_trip_and_backend_choice(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    config = settings.llm_config()
    assert config["backend"] == "anthropic" and config["document_limit"] == 60000
    assert isinstance(make_backend(config), AnthropicBackend) and not make_backend(config).is_available()
    config.update(anthropic_key="sk-test")  # a key saved in the settings works without the environment variable
    assert make_backend(config).is_available()
    config.update(backend="openai_compat", openai_base_url="http://x/v1/", openai_model="m", document_limit=5000)
    settings.save_llm_config(config)
    assert settings.llm_config() == config
    backend = make_backend(settings.llm_config())
    assert isinstance(backend, OpenAICompatBackend) and backend.is_available() and backend.base_url == "http://x/v1"


def test_openai_compatible_stream(server):
    backend = OpenAICompatBackend(server.url, "key", "gemini-x", 100)
    assert list(backend.stream("시스템", [{"role": "user", "content": "q"}])) == ["안", "녕", Usage(12, 0, 3)]
    path, auth, body = server.RequestHandlerClass.requests[0]
    assert path == "/v1/chat/completions" and auth == "Bearer key"
    assert body["stream"] and body["model"] == "gemini-x"
    assert body["messages"] == [{"role": "system", "content": "시스템"}, {"role": "user", "content": "q"}]


def test_openai_compatible_without_a_key(server):
    list(OpenAICompatBackend(server.url, "", "llama", 100).stream("s", []))  # Ollama: no key, no header
    assert server.RequestHandlerClass.requests[0][1] is None


@pytest.mark.parametrize("status, message, kind", [
    (401, "nope", "auth"), (400, "Please pass a valid API key", "auth"), (429, "nope", "rate_limit"),
    (503, "high demand", "other"), (500, "nope", "other")])
def test_openai_compatible_errors(server, status, message, kind):
    server.RequestHandlerClass.status, server.RequestHandlerClass.message = status, message
    with pytest.raises(LLMError) as error:
        list(OpenAICompatBackend(server.url, "key", "m", 100).stream("s", []))
    assert error.value.kind == kind


def test_openai_compatible_no_server():
    with pytest.raises(LLMError) as error:
        list(OpenAICompatBackend("http://127.0.0.1:9/v1", "", "m", 100).stream("s", []))
    assert error.value.kind == "network"


def test_settings_dialog_and_connection_test(qtbot, server):
    def fill():
        dialog = QApplication.activeModalWidget()
        next(b for b in dialog.findChildren(QRadioButton) if b.text().startswith("OpenAI")).click()
        chips = {b.text(): b for b in dialog.findChildren(QPushButton) if b.objectName() == "chip"}
        chips["Gemini"].click()
        chips["Gemini"].click()  # again: still the one in use
        edits = {e.placeholderText(): e for e in dialog.findChildren(QLineEdit)}
        assert edits["https://…/v1"].text().startswith("https://generativelanguage")
        assert [name for name, chip in chips.items() if chip.isChecked()] == ["Gemini"]
        edits["https://…/v1"].setText(server.url)
        assert not any(chip.isChecked() for chip in chips.values())  # a typed address is no provider's
        edits["모델 이름 (제공자 문서 참고)"].setText("gemini-x")
        next(b for b in dialog.findChildren(QPushButton) if b.text() == "연결 테스트").click()
        qtbot.waitUntil(lambda: any("연결됨 (gemini-x): 안녕" in label.text() for label in dialog.findChildren(QLabel)))
        dialog.accept()

    QTimer.singleShot(0, fill)
    config = llm_settings_dialog(None, settings.llm_config())
    assert config["backend"] == "openai_compat" and config["openai_base_url"] == server.url
    assert config["openai_model"] == "gemini-x" and config["anthropic_effort"] == "low"
    assert server.RequestHandlerClass.requests  # the connection test reached the server


def test_saved_settings_unlock_the_panel(qtbot, text_pdf, monkeypatch, server):
    from app.main_window import MainWindow
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    window = MainWindow()
    qtbot.addWidget(window)
    window.show()
    window.open_file(text_pdf)
    window.chat.set_panel(True)
    panel = window._chat_panel
    assert panel._notice.isVisible() and not panel._input.isEnabled()
    window.chat.apply_config({**settings.llm_config(), "backend": "openai_compat", "openai_base_url": server.url,
                              "openai_model": "gemini-x"})
    assert not panel._notice.isVisible() and panel._input.isEnabled() and "gemini-x" in panel._info.text()
    window.chat.send("요약해줘")
    qtbot.waitUntil(lambda: not window.chat.busy)
    assert window.chat.messages[-1] == {"role": "assistant", "text": "안녕", "usage": Usage(12, 0, 3)}
    window.state.renderer.shutdown()
