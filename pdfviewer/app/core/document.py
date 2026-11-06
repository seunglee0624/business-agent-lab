import os

import pymupdf


class Document:
    """PyMuPDF wrapper for page info. Page indexes are 0-based; sizes in points.
    Pixels come from core/renderer.py, never from here (rendering on the UI side freezes it)."""

    def __init__(self, path):
        self.path = os.path.abspath(path)  # recent files and per-file settings key on it
        self._doc = pymupdf.open(self.path)
        self.password = None
        # identifies this file version for the render workers' own open copies
        self.key = (self.path, os.stat(self.path).st_mtime_ns)
        self._sizes = {}  # index -> (w, h); continuous layout asks for every page often

    @property
    def is_locked(self):
        # needs_pass stays True after authenticate(); is_encrypted turns False
        return self._doc.is_encrypted

    def authenticate(self, password):
        ok = bool(self._doc.authenticate(password))
        if ok:
            self.password = password
        return ok

    @property
    def page_count(self):
        return self._doc.page_count

    def page_size(self, index):
        if index not in self._sizes:
            rect = self._doc[index].rect
            self._sizes[index] = (rect.width, rect.height)
        return self._sizes[index]

    @property
    def file_size(self):
        return os.path.getsize(self.path)

    def properties(self):
        """Metadata for the properties dialog. Dates stay in PDF form ("D:20240131...")."""
        meta = self._doc.metadata or {}
        return {"title": meta.get("title"), "author": meta.get("author"), "created": meta.get("creationDate"),
                "modified": meta.get("modDate"), "version": meta.get("format"), "encryption": meta.get("encryption"),
                "page_size": self.page_size(0) if self.page_count else None}

    def close(self):
        self._doc.close()


def format_size(size):
    """1234567 -> "1.2 MB"."""
    for unit in ("B", "KB", "MB"):
        if size < 1024:
            return f"{size:.0f} {unit}" if unit == "B" else f"{size:.1f} {unit}"
        size /= 1024
    return f"{size:.1f} GB"
