import os

import tempfile

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
os.environ["XDG_CONFIG_HOME"] = tempfile.mkdtemp()  # QSettings must not touch the real user settings
os.environ["XDG_DATA_HOME"] = tempfile.mkdtemp()  # nor the real notes and log folders

import pymupdf
import pytest
from PySide6.QtCore import QCoreApplication, QSettings

QCoreApplication.setOrganizationName("pdfviewer-tests")
QCoreApplication.setApplicationName("pdfviewer-tests")


@pytest.fixture(autouse=True)
def fresh_settings(monkeypatch):
    monkeypatch.setattr("app.core.settings._vault", lambda: None)  # never the real Windows Credential Manager
    QSettings().clear()
    yield
    QSettings().clear()


def make_pdf(path, pages, password=None):
    doc = pymupdf.open()
    for i in range(pages):
        page = doc.new_page(width=600, height=800)  # 3:4 page, easy fit math
        page.insert_text((72, 72), f"Page {i + 1}")
    if password:
        doc.save(path, encryption=pymupdf.PDF_ENCRYPT_AES_256, user_pw=password, owner_pw=password)
    else:
        doc.save(path)
    return str(path)


@pytest.fixture
def pdf100(tmp_path):
    return make_pdf(tmp_path / "hundred.pdf", 100)


@pytest.fixture
def locked_pdf(tmp_path):
    return make_pdf(tmp_path / "locked.pdf", 2, password="secret")


@pytest.fixture(scope="session")
def heavy_pdf(tmp_path_factory):
    """One page that takes ~1 s to render at zoom 2 (thousands of vector shapes)."""
    import random
    rng = random.Random(1)
    doc = pymupdf.open()
    page = doc.new_page(width=2000, height=2800)
    shape = page.new_shape()  # one shape: per-call page.draw_circle is quadratic
    for _ in range(4000):
        shape.draw_circle((rng.random() * 2000, rng.random() * 2800), 30)
        shape.finish(color=(rng.random(), 0, 1))
    shape.commit()
    path = tmp_path_factory.mktemp("heavy") / "heavy.pdf"
    doc.save(path)
    return str(path)


@pytest.fixture
def outline_pdf(tmp_path):
    """5 pages with a two-level outline: Chapter 1 (p1) > Section 1.1 (p2), Chapter 2 (p4)."""
    doc = pymupdf.open()
    for _ in range(5):
        doc.new_page(width=600, height=800)
    doc.set_toc([[1, "Chapter 1", 1], [2, "Section 1.1", 2], [1, "Chapter 2", 4]])
    path = tmp_path / "outline.pdf"
    doc.save(path)
    return str(path)


@pytest.fixture
def text_pdf(tmp_path):
    """3 pages; page 1 has a sentence, an internal link to page 3 and a web link."""
    doc = pymupdf.open()
    for _ in range(3):
        doc.new_page(width=600, height=800)
    page = doc[0]
    page.insert_text((72, 72), "Hello brave new world", fontsize=14)
    page.insert_text((72, 200), "Go to page three", fontsize=14)
    page.insert_link({"kind": pymupdf.LINK_GOTO, "from": pymupdf.Rect(72, 185, 200, 205), "page": 2})
    page.insert_link({"kind": pymupdf.LINK_URI, "from": pymupdf.Rect(72, 300, 200, 320), "uri": "https://example.com"})
    path = tmp_path / "text.pdf"
    doc.save(path)
    return str(path)
