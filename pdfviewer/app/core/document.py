import os

import pymupdf


class Document:
    """PyMuPDF wrapper for page info. Page indexes are 0-based; sizes in points.
    Pixels come from core/renderer.py, never from here (rendering on the UI side freezes it)."""

    def __init__(self, path):
        self.path = str(path)
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

    def close(self):
        self._doc.close()
