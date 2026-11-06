from PySide6.QtWidgets import QInputDialog, QLineEdit


def ask_password(parent, filename, retry=False):
    """Return the typed password, or None if the user cancelled."""
    label = "암호가 틀렸습니다. 다시 입력하세요." if retry else f"'{filename}' 파일은 암호로 보호되어 있습니다."
    text, ok = QInputDialog.getText(parent, "암호 입력", label, QLineEdit.EchoMode.Password)
    return text if ok else None
