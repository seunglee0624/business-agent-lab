import logging
import multiprocessing
from collections import OrderedDict
from concurrent.futures import ProcessPoolExecutor
from concurrent.futures.process import BrokenProcessPool

from PySide6.QtCore import QObject, Qt, Signal
from PySide6.QtGui import QImage

from app.core.render_worker import outline, page_info, page_text, render, search

log = logging.getLogger(__name__)

CACHE_LIMIT = 200 * 1024 * 1024
WORKERS = 2
SEARCH_CHUNK = 20  # pages per search job
RENDER_DEBOUNCE_MS = 80  # views wait for scroll / wheel-zoom / resize bursts to settle before requesting renders
JOBS = {"info": page_info, "outline": outline, "search": search, "text": page_text}  # non-image job keys: (name, *args); image keys are render args


class Renderer(QObject):
    """Runs PyMuPDF work in worker processes.
    Images: LRU cache of QImages keyed by (page, zoom, rotation). Page info (words, links) and the outline:
    kept per document."""

    page_ready = Signal(int, float, int)  # page index, render zoom, rotation
    outline_ready = Signal()
    search_found = Signal(object, int)  # [(page, rects, context)] of the next pages, pages searched so far
    renders_changed = Signal(int)  # page images queued or rendering (status bar)
    text_ready = Signal(int)  # page index whose plain text arrived (for the AI chat)
    _finished = Signal(object, object, object, object)  # future, key, doc key, pool

    def __init__(self, cache_limit=CACHE_LIMIT):
        super().__init__()
        self.cache_limit = cache_limit
        self._pool = self._new_pool()
        self._cache = OrderedDict()  # (index, zoom, rotation) -> QImage, oldest first
        self._bytes = 0
        self._info = {}  # index -> (words, links)
        self._text = {}  # index -> plain text in reading order
        self.outline = None  # [level, title, 1-based page or -1], once loaded
        self._pending = {}  # image key or ("info", index) -> Future
        self._retried = set()  # keys already resubmitted once after a worker crash
        self._doc = None
        self._search_future = None  # the search job whose results are still wanted
        # Queued always: cancel() runs the done-callback right away on this thread, mid-iteration
        self._finished.connect(self._on_finished, Qt.ConnectionType.QueuedConnection)

    @staticmethod
    def _new_pool():
        # spawn: forking a process that runs Qt is unsafe, and Windows only has spawn anyway
        return ProcessPoolExecutor(WORKERS, mp_context=multiprocessing.get_context("spawn"))

    def set_document(self, doc):
        for future in self._pending.values():
            future.cancel()
        self._pending.clear()
        self._cache.clear()
        self._bytes = 0
        self._info.clear()
        self._text.clear()
        self.outline = None
        self._retried.clear()
        self._search_future = None
        self._doc = doc

    def get(self, index, zoom, rotation):
        image = self._cache.get((index, zoom, rotation))
        if image is not None:
            self._cache.move_to_end((index, zoom, rotation))
        return image

    def best(self, index, zoom, rotation):
        """(image, its zoom): the exact render if cached, else the sharpest cached one of that page, else (None, None)."""
        exact = self.get(index, zoom, rotation)
        if exact is not None:
            return exact, zoom
        zooms = [z for i, z, r in self._cache if i == index and r == rotation]
        return (self._cache[(index, max(zooms), rotation)], max(zooms)) if zooms else (None, None)

    def info(self, index):
        """(words, links) of a page, or None until requested and ready."""
        return self._info.get(index)

    def request(self, keys, group="view"):
        """Render these (index, zoom, rotation) keys, most important first. Queued renders of the same group
        (one per asking widget) that are not listed are cancelled."""
        if self._doc is None:  # no document, or shut down (a closed window's late timer)
            return
        keys = list(dict.fromkeys(keys))
        wanted = set(keys)
        for key, future in list(self._pending.items()):
            if future.group == group and key not in wanted and future.cancel():
                del self._pending[key]
        for key in keys:
            if key not in self._cache and key not in self._pending:
                self._start(key, group)

    def request_info(self, indexes):
        if self._doc is None:
            return
        for index in indexes:
            key = ("info", index)
            if index not in self._info and key not in self._pending:
                self._start(key)

    def text(self, index):
        """Plain text of a page, or None until requested and ready ("" if it has none or failed)."""
        return self._text.get(index)

    def request_text(self, index):
        if self._doc is not None and index not in self._text and ("text", index) not in self._pending:
            self._start(("text", index))

    def request_outline(self):
        if self._doc is not None and self.outline is None and ("outline",) not in self._pending:
            self._start(("outline",))

    def search(self, query, case, whole):
        """Search the document from the first page, one chunk of pages at a time: a single job in flight,
        so page renders keep their turn in the queue. A new search (or an empty query) stops the old one."""
        for key, future in list(self._pending.items()):
            if key[0] == "search" and future.cancel():
                del self._pending[key]
        self._search_future = None
        if self._doc is not None and query:
            self._search_chunk(0, query, case, whole)

    def _search_chunk(self, first, *params):
        if first < self._doc.page_count:
            self._start(("search", first, min(first + SEARCH_CHUNK, self._doc.page_count), *params))

    def shutdown(self):
        self.set_document(None)
        self._pool.shutdown(wait=False, cancel_futures=True)

    def _start(self, key, group=None):
        fn, args = (JOBS[key[0]], key[1:]) if key[0] in JOBS else (render, key)
        future = self._pool.submit(fn, self._doc.key, self._doc.password, *args)
        future.group = group  # None: never cancelled by request()
        doc_key, pool = self._doc.key, self._pool
        future.add_done_callback(lambda f: self._finished.emit(f, key, doc_key, pool))
        self._pending[key] = future
        if key[0] == "search":
            self._search_future = future
        self._renders_changed()

    def _renders_changed(self):
        self.renders_changed.emit(sum(key[0] not in JOBS for key in self._pending))

    def _on_finished(self, future, key, doc_key, pool):
        if self._pending.get(key) is future:
            del self._pending[key]
        self._renders_changed()  # cancelled jobs land here too, so every way out of _pending is counted
        if future.cancelled():
            return
        error = future.exception()
        current = self._doc is not None and doc_key == self._doc.key
        wanted_search = key[0] == "search" and future is self._search_future
        # A worker crashed (e.g. a malformed page): every job of that pool fails; replace it once.
        if isinstance(error, BrokenProcessPool) and pool is self._pool and current:
            self._pending.clear()
            self._pool.shutdown(wait=False, cancel_futures=True)
            self._pool = self._new_pool()
        # Failed jobs of the other pages were innocent: run each once more. Only once, so a page
        # that always crashes cannot loop.
        # shortcut: an innocent page that runs next to the crashing one again is dropped too,
        # until the next scroll/zoom; retry one job at a time if that shows up in practice.
        if (isinstance(error, BrokenProcessPool) and current and key not in self._retried and key not in self._pending
                and (key[0] != "search" or wanted_search)):
            self._retried.add(key)
            self._start(key, future.group)
            return
        if error is not None:
            log.warning("job %s failed: %r", key, error)
            if not wanted_search and key[0] != "text":
                return
        if not current:
            return
        self._retried.discard(key)
        if key[0] == "search":
            if wanted_search:  # a failed chunk counts as searched with no matches
                self._search_chunk(key[2], *key[3:])
                self.search_found.emit([] if error else future.result(), key[2])
            return
        if key[0] == "info":
            self._info[key[1]] = future.result()
            return
        if key[0] == "text":  # a failed page counts as one without text: the question still goes out
            self._text[key[1]] = "" if error else future.result()
            self.text_ready.emit(key[1])
            return
        if key[0] == "outline":
            self.outline = future.result()
            self.outline_ready.emit()
            return
        width, height, stride, samples = future.result()
        self._store(key, QImage(samples, width, height, stride, QImage.Format.Format_RGB888).copy())
        self.page_ready.emit(*key)

    def _store(self, key, image):
        if key in self._cache:
            self._bytes -= self._cache.pop(key).sizeInBytes()
        self._cache[key] = image
        self._bytes += image.sizeInBytes()
        while self._bytes > self.cache_limit and len(self._cache) > 1:
            _, old = self._cache.popitem(last=False)
            self._bytes -= old.sizeInBytes()
