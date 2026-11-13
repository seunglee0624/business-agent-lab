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
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-env")  # ignored: keys come only from the AI settings
    config = settings.llm_config()
    assert config["backend"] == "anthropic" and config["document_limit"] == 60000
    assert isinstance(make_backend(config), AnthropicBackend) and not make_backend(config).is_available()
    config.update(anthropic_key="sk-test")
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


def test_a_key_never_goes_over_plain_http(monkeypatch):
    sent = []
    monkeypatch.setattr("urllib.request.urlopen", lambda *args, **kw: sent.append(args))
    with pytest.raises(LLMError, match="https"):
        list(OpenAICompatBackend("http://example.com/v1", "key", "m", 100).stream("s", []))
    assert not sent


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
    window = MainWindow()
    qtbot.addWidget(window)
    window.show()
    window.open_file(text_pdf)
    window.chat.set_panel(True)
    panel = window._chat_panel
    assert panel._notice.isVisible() and not panel._input.isEnabled()
    window.chat.apply_config({**settings.llm_config(), "backend": "openai_compat", "openai_base_url": server.url,
                              "openai_model": "gemini-x"})
    assert not panel._notice.isVisible() and panel._input.isEnabled() and panel._model_button.text() == "gemini-x"
    window.chat.send("요약해줘")
    qtbot.waitUntil(lambda: not window.chat.busy)
    assert window.chat.messages[-1] == {"role": "assistant", "text": "안녕", "usage": Usage(12, 0, 3)}
    window.state.renderer.shutdown()


def test_model_menu_switches_model_and_effort(qtbot, monkeypatch):
    from app.chat_state import ChatState
    from app.viewer_state import ViewerState
    from app.widgets.chat_panel import ChatPanel
    viewer = ViewerState()
    chat = ChatState(viewer)
    panel = ChatPanel(chat)
    qtbot.addWidget(panel)
    chat.update_config(backend="anthropic", anthropic_model="claude-sonnet-5-5", anthropic_effort="low",
                       openai_model="gemini-x")
    assert panel._model_button.text() == "Sonnet 5.5 · 낮음"
    pick = lambda text: next(a for a in panel._model_button.menu().actions() if a.text().startswith(text)).trigger()
    pick("Haiku 5.5")
    pick("높음")
    assert (settings.llm_config()["anthropic_model"], chat.backend.model, chat.backend.effort) == \
        ("claude-haiku-5-5", "claude-haiku-5-5", "high")
    assert panel._model_button.text() == "Haiku 5.5 · 높음"
    pick("gemini-x")
    assert chat.config["backend"] == "openai_compat" and panel._model_button.text() == "gemini-x"
    assert not next(a for a in panel._model_button.menu().actions() if a.text() == "보통").isEnabled()
    viewer.renderer.shutdown()


def test_api_keys_live_in_the_os_password_store(monkeypatch):
    from PySide6.QtCore import QSettings

    class Vault:
        stored = {}
        get_password = staticmethod(lambda service, key: Vault.stored.get((service, key)))
        delete_password = staticmethod(lambda service, key: Vault.stored.pop((service, key)))

        @staticmethod
        def set_password(service, key, value):
            Vault.stored[service, key] = value

    QSettings().setValue("llm/anthropic_key", "old-plain")  # left by an older version
    monkeypatch.setattr(settings, "_vault", lambda: Vault)
    assert settings.llm_config()["anthropic_key"] == "old-plain"
    assert Vault.stored == {("pdfviewer", "anthropic_key"): "old-plain"} and not QSettings().contains("llm/anthropic_key")
    settings.save_llm_config({**settings.llm_config(), "anthropic_key": "", "openai_key": "g"})
    assert Vault.stored == {("pdfviewer", "openai_key"): "g"} and not QSettings().contains("llm/openai_key")
    assert settings.llm_config()["openai_key"] == "g"

    def broken(*args):
        raise RuntimeError("locked")
    Vault.set_password = staticmethod(broken)
    settings.save_llm_config({**settings.llm_config(), "openai_key": "new"})
    assert QSettings().value("llm/openai_key") == "new"  # kept, not lost


def test_without_a_password_store_only_the_user_reads_the_settings_file():
    import os
    import stat
    from PySide6.QtCore import QSettings
    settings.save_llm_config({**settings.llm_config(), "openai_key": "k"})
    assert stat.S_IMODE(os.stat(QSettings().fileName()).st_mode) == 0o600
