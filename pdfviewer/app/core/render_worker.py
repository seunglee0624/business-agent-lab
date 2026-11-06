"""Code that runs inside render worker processes. Imports only pymupdf so a spawned worker starts fast.
PyMuPDF keeps the GIL while it works, so anything slow happens here; a thread would freeze the UI."""
import pymupdf

_docs = {}  # Document.key -> open pymupdf document (each worker keeps its own)


def _open(key, password):
    doc = _docs.get(key)
    if doc is None:
        if len(_docs) >= 8:
            _docs.pop(next(iter(_docs))).close()
        doc = _docs[key] = pymupdf.open(key[0])
        if password:
            doc.authenticate(password)
    return doc


def render(key, password, index, zoom, rotation):
    """rotation: extra clockwise degrees on top of the page's own /Rotate."""
    page = _open(key, password)[index]
    pix = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom).prerotate(rotation), alpha=False)
    return pix.width, pix.height, pix.stride, pix.samples


def page_info(key, password, index):
    """Words and links of a page, all in page.rect coordinates (the page as displayed before our rotation).
    words: (x0, y0, x1, y1, text, block, line) in reading order. links: ((x0, y0, x1, y1), uri, target page)."""
    page = _open(key, password)[index]
    m = page.rotation_matrix  # words come unrotated; links already use page.rect coordinates
    words = []
    # sort: top-to-bottom, left-to-right. Stream order can put a later paragraph before a table,
    # which makes a drag select the wrong span. (Cost: two-column pages interleave their columns.)
    for x0, y0, x1, y1, text, block, line, _ in page.get_text("words", sort=True):
        r = pymupdf.Rect(x0, y0, x1, y1) * m
        words.append((r.x0, r.y0, r.x1, r.y1, text, block, line))
    links = []
    for link in page.get_links():
        r = link["from"]
        uri = link.get("uri") if link["kind"] == pymupdf.LINK_URI else None
        target = link.get("page", -1)
        target = target if link["kind"] in (pymupdf.LINK_GOTO, pymupdf.LINK_NAMED) and target >= 0 else None
        if uri or target is not None:
            links.append(((r.x0, r.y0, r.x1, r.y1), uri, target))
    return words, links


def outline(key, password):
    """Table of contents: [level, title, 1-based page or -1], as pymupdf get_toc(simple=True) gives it."""
    return _open(key, password).get_toc(simple=True)
