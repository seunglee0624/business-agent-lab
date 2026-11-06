import re
from pathlib import Path

from PySide6.QtCore import Qt
from PySide6.QtWidgets import QDialog, QDialogButtonBox, QFormLayout, QLabel, QVBoxLayout

from app.core.document import format_size

MM_PER_POINT = 25.4 / 72
PDF_DATE = re.compile(r"D:(\d{4})(\d\d)?(\d\d)?(\d\d)?(\d\d)?(\d\d)?")


def pdf_date(value):
    """'D:20240131093000+09'00'' -> '2024-01-31 09:30:00'. The time zone is dropped; unknown forms pass through."""
    match = PDF_DATE.match(value or "")
    if not match:
        return value or ""
    year, month, day, hour, minute, second = (part or default for part, default in
                                               zip(match.groups(), ("", "01", "01", "00", "00", "00")))
    return f"{year}-{month}-{day} {hour}:{minute}:{second}"


def rows(doc):
    """(label, text) pairs shown in the dialog."""
    props = doc.properties()
    size = props["page_size"]
    try:
        file_size = format_size(doc.file_size)
    except OSError:  # deleted or moved since it was opened
        file_size = ""
    return [
        ("파일", doc.path),
        ("크기", file_size),
        ("제목", props["title"] or ""),
        ("작성자", props["author"] or ""),
        ("만든 날짜", pdf_date(props["created"])),
        ("수정한 날짜", pdf_date(props["modified"])),
        ("페이지 수", str(doc.page_count)),
        # shortcut: first page only; list the distinct sizes if mixed-size documents need it
        ("페이지 크기", f"{size[0] * MM_PER_POINT:.0f} × {size[1] * MM_PER_POINT:.0f} mm" if size else ""),
        ("PDF 버전", props["version"] or ""),
        ("암호화", props["encryption"] or "없음"),
    ]


def show_properties(parent, doc):
    dialog = QDialog(parent, windowTitle=f"{Path(doc.path).name} 속성", objectName="propertiesDialog")
    form = QFormLayout()
    for label, text in rows(doc):
        value = QLabel(text or "없음")
        value.setTextInteractionFlags(Qt.TextInteractionFlag.TextSelectableByMouse)
        value.setWordWrap(True)
        form.addRow(QLabel(label, objectName="fieldName"), value)
    buttons = QDialogButtonBox()
    buttons.addButton("닫기", QDialogButtonBox.ButtonRole.RejectRole)  # a standard button would be English
    buttons.rejected.connect(dialog.reject)
    layout = QVBoxLayout(dialog)
    layout.addLayout(form)
    layout.addWidget(buttons)
    dialog.exec()
