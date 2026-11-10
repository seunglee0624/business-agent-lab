from PySide6.QtWidgets import (QButtonGroup, QCheckBox, QDialog, QDialogButtonBox, QFormLayout, QGroupBox, QHBoxLayout,
                               QLabel, QLineEdit, QPushButton, QRadioButton, QSpinBox, QVBoxLayout)

from app import theme
from app.core.llm import make_backend
from app.core.llm.worker import LLMWorker

BACKENDS = {"anthropic": "Anthropic (Claude)", "openai_compat": "OpenAI 호환 (Gemini·Groq·OpenRouter·Ollama)"}
EFFORTS = {"low": "낮음 (빠름)", "medium": "보통", "high": "높음 (느림·비쌈)"}
PRESETS = {  # base_url per provider; check each provider's docs when one stops answering
    "Gemini": "https://generativelanguage.googleapis.com/v1beta/openai",
    "Groq": "https://api.groq.com/openai/v1",
    "OpenRouter": "https://openrouter.ai/api/v1",
    "Ollama": "http://localhost:11434/v1",
}
TEST_PROMPT = [{"role": "user", "content": "연결 확인입니다. '연결됨' 한 단어로만 답하세요."}]


def _choices(parent, options, current):
    """Radio buttons, not a drop-down: no popup (WSLg's Wayland popups do not close)."""
    group, row = QButtonGroup(parent), QHBoxLayout()
    for key, label in options.items():
        button = QRadioButton(label, checked=key == current)
        button.key = key
        group.addButton(button)
        row.addWidget(button)
    row.addStretch(1)
    return group, row


def _secret(value, placeholder):
    edit = QLineEdit(value, placeholderText=placeholder, echoMode=QLineEdit.EchoMode.Password)
    edit.setMinimumWidth(theme.token("size.dialog_width"))
    return edit


def llm_settings_dialog(parent, config):
    """The AI backend, its key and model, the whole-document limit and chat saving. Returns the new config, or None."""
    dialog = QDialog(parent, windowTitle="AI 설정", objectName="llmSettingsDialog")
    backend, backend_row = _choices(dialog, BACKENDS, config["backend"])

    anthropic = QGroupBox("Anthropic")
    anthropic_key = _secret(config["anthropic_key"], "비워 두면 ANTHROPIC_API_KEY 환경변수")
    anthropic_model = QLineEdit(config["anthropic_model"], placeholderText="claude-sonnet-5-5")
    effort, effort_row = _choices(dialog, EFFORTS, config["anthropic_effort"])
    form = QFormLayout(anthropic)
    form.addRow("API 키", anthropic_key)
    form.addRow("모델", anthropic_model)
    form.addRow("생각 정도", effort_row)

    compat = QGroupBox("OpenAI 호환")
    base_url = QLineEdit(config["openai_base_url"], placeholderText="https://…/v1")
    presets = QHBoxLayout()
    for name, url in PRESETS.items():
        button = QPushButton(name, objectName="chip", toolTip=url)
        button.clicked.connect(lambda checked=False, url=url: base_url.setText(url))
        presets.addWidget(button)
    presets.addStretch(1)
    compat_key = _secret(config["openai_key"], "Ollama 는 비워 둬도 됨")
    compat_model = QLineEdit(config["openai_model"], placeholderText="모델 이름 (제공자 문서 참고)")
    form = QFormLayout(compat)
    form.addRow("주소", base_url)
    form.addRow("", presets)
    form.addRow("API 키", compat_key)
    form.addRow("모델", compat_model)

    limit = QSpinBox(minimum=1000, maximum=1_000_000, singleStep=10000, value=config["document_limit"], suffix="자")
    limit.setGroupSeparatorShown(True)
    limits = QFormLayout()
    limits.addRow("문서 전체 상한", limit)
    save_chat = QCheckBox("문서마다 대화 기록 저장 (다시 열면 복원)", checked=config["save_chat"])
    limits.addRow("", save_chat)

    def current():
        return {**config, "backend": backend.checkedButton().key,
                "anthropic_key": anthropic_key.text().strip(), "anthropic_model": anthropic_model.text().strip(),
                "anthropic_effort": effort.checkedButton().key, "openai_base_url": base_url.text().strip(),
                "openai_key": compat_key.text().strip(), "openai_model": compat_model.text().strip(),
                "document_limit": limit.value(), "save_chat": save_chat.isChecked()}

    def show_backend():
        chosen = backend.checkedButton().key
        anthropic.setEnabled(chosen == "anthropic")
        compat.setEnabled(chosen == "openai_compat")

    backend.buttonClicked.connect(show_backend)
    show_backend()

    result = QLabel(objectName="fieldName", wordWrap=True)
    test = QPushButton("연결 테스트")
    workers = []  # the test in progress, kept alive until it reports

    def run_test():
        backend_ = make_backend(current())
        if not backend_.is_available():
            result.setText("키(Anthropic) 또는 주소와 모델(OpenAI 호환)을 먼저 넣으세요.")
            return
        worker = LLMWorker(backend_, "짧게 답하세요.", TEST_PROMPT)
        worker.setParent(dialog)  # deleted with the dialog; its signals stop with it
        workers.append(worker)
        worker.done.connect(lambda text, usage: finish(f"연결됨 ({backend_.model}): {text.strip()[:80]}"))
        worker.failed.connect(lambda kind, message: finish(f"실패: {message}"))
        test.setEnabled(False)
        result.setText("확인 중…")
        worker.start()

    def finish(text):
        result.setText(text)
        test.setEnabled(True)

    test.clicked.connect(run_test)
    test_row = QHBoxLayout()
    test_row.addWidget(test)
    test_row.addWidget(result, 1)

    buttons = QDialogButtonBox()
    save = buttons.addButton("저장", QDialogButtonBox.ButtonRole.AcceptRole)  # standard buttons would be English
    save.setObjectName("primary")
    buttons.addButton("취소", QDialogButtonBox.ButtonRole.RejectRole)
    buttons.accepted.connect(dialog.accept)
    buttons.rejected.connect(dialog.reject)

    layout = QVBoxLayout(dialog)
    layout.addLayout(backend_row)
    layout.addWidget(anthropic)
    layout.addWidget(compat)
    layout.addLayout(limits)
    layout.addLayout(test_row)
    layout.addWidget(QLabel("API 키는 이 컴퓨터의 앱 설정에 암호화 없이 저장됩니다.", objectName="fieldName", wordWrap=True))
    layout.addWidget(buttons)
    return current() if dialog.exec() == QDialog.DialogCode.Accepted else None
