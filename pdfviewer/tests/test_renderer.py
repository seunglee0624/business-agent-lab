import time

import pytest
from PySide6.QtCore import QTimer
from PySide6.QtGui import QImage

from app.core.document import Document
from app.core.renderer import Renderer


@pytest.fixture
def renderer():
    r = Renderer()
    yield r
    r.shutdown()


def test_lru_evicts_oldest_over_limit():
    image = QImage(100, 100, QImage.Format.Format_RGB888)
    r = Renderer(cache_limit=image.sizeInBytes() * 2)
    r._store((0, 1.0, 0), image)
    r._store((1, 1.0, 0), image)
    r.get(0, 1.0, 0)  # touch page 0 so page 1 is the oldest
    r._store((2, 1.0, 0), image)
    assert r.get(1, 1.0, 0) is None
    assert r.get(0, 1.0, 0) is not None and r.get(2, 1.0, 0) is not None
    assert r.best(0, 2.0, 0) == (r.get(0, 1.0, 0), 1.0)  # falls back to another zoom of the page
    assert r.best(0, 2.0, 90) == (None, None)  # but never to another rotation
    r.shutdown()


def test_worker_render_reaches_cache(qtbot, renderer, pdf100):
    renderer.set_document(Document(pdf100))
    with qtbot.waitSignal(renderer.page_ready, timeout=15000) as ready:
        renderer.request([(3, 0.5, 0)])
    assert ready.args == [3, 0.5, 0]
    image = renderer.get(3, 0.5, 0)
    assert (image.width(), image.height()) == (300, 400)


def test_new_document_drops_old_results(qtbot, renderer, pdf100, locked_pdf):
    renderer.set_document(Document(pdf100))
    renderer.request([(0, 0.5, 0)])
    locked = Document(locked_pdf)
    locked.authenticate("secret")
    renderer.set_document(locked)
    with qtbot.waitSignal(renderer.page_ready, timeout=15000):
        renderer.request([(1, 0.5, 0)])  # worker must use the password
    assert renderer.get(0, 0.5, 0) is None


def test_ui_keeps_running_during_heavy_render(qtbot, renderer, heavy_pdf):
    # Phase 2 completion: no UI freeze while a slow page renders
    renderer.set_document(Document(heavy_pdf))
    with qtbot.waitSignal(renderer.page_ready, timeout=15000):
        renderer.request([(0, 0.1, 0)])  # warm up: start the worker and open the file
    ticks = []
    timer = QTimer(interval=10, timeout=lambda: ticks.append(time.perf_counter()))
    timer.start()
    start = time.perf_counter()
    with qtbot.waitSignal(renderer.page_ready, timeout=30000):
        renderer.request([(0, 2.0, 0)])
    timer.stop()
    gaps = [b - a for a, b in zip([start, *ticks], ticks)]
    assert time.perf_counter() - start > 0.3, "page rendered too fast to prove anything"
    assert max(gaps) < 0.1


def test_rerequest_cancels_queued_jobs(qtbot, renderer, pdf100):
    renderer.set_document(Document(pdf100))
    renderer.request([(i, 1.0, 0) for i in range(20)])
    renderer.request([(50, 0.5, 0)])  # cancels most of the 20; used to raise KeyError
    with qtbot.waitSignal(renderer.page_ready, timeout=15000, check_params_cb=lambda i, z, r: i == 50):
        pass
    assert len(renderer._pending) <= 3  # only jobs that were already running remain


def test_crashed_worker_is_replaced(qtbot, renderer, heavy_pdf, pdf100):
    renderer.set_document(Document(heavy_pdf))
    renderer.request([(0, 2.0, 0)])
    qtbot.waitUntil(lambda: bool(renderer._pool._processes), timeout=15000)
    broken_pool = renderer._pool
    qtbot.wait(300)  # let the slow render start
    for process in list(broken_pool._processes.values()):
        process.kill()
    qtbot.waitUntil(lambda: renderer._pool is not broken_pool, timeout=15000)
    # the killed job was not the page's fault: it is run once more in the new pool
    qtbot.waitUntil(lambda: renderer.get(0, 2.0, 0) is not None, timeout=30000)
    renderer.set_document(Document(pdf100))
    with qtbot.waitSignal(renderer.page_ready, timeout=15000):
        renderer.request([(0, 0.5, 0)])
