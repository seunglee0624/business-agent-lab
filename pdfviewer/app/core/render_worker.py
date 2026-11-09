"""Code that runs inside render worker processes. Imports only pymupdf so a spawned worker starts fast.
PyMuPDF keeps the GIL while it works, so anything slow happens here; a thread would freeze the UI."""
import re

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


def page_text(key, password, index):
    """Plain text of a page, top-to-bottom (see page_info for why sorted)."""
    return _open(key, password)[index].get_text(sort=True)


def outline(key, password):
    """Table of contents: [level, title, 1-based page or -1], as pymupdf get_toc(simple=True) gives it."""
    return _open(key, password).get_toc(simple=True)


def search(key, password, first, last, query, case, whole):
    """Matches of query on pages [first, last): [(page, rects, context)], rects in page.rect coordinates
    (one per line the match covers). Spaces in the query match any whitespace, line breaks included."""
    pattern = re.escape(query).replace(r"\ ", r"\s+")
    if whole:
        pattern = rf"(?<!\w){pattern}(?!\w)"
    regex = re.compile(pattern, 0 if case else re.IGNORECASE)
    doc, found = _open(key, password), []
    for index in range(first, last):
        page = doc[index]
        if not regex.search(page.get_text()):  # cheap check before the per-character pass
            continue
        text, boxes = [], []  # one character each; boxes: (bbox, line number), None between lines
        lines = (line for block in page.get_text("rawdict")["blocks"] for line in block.get("lines", []))
        for number, line in enumerate(lines):
            for span in line["spans"]:
                for char in span["chars"]:
                    text.append(char["c"])
                    boxes.append((char["bbox"], number))
            text.append(" ")
            boxes.append(None)
        text, m = "".join(text), page.rotation_matrix
        for match in regex.finditer(text):
            lines = {}
            for box in boxes[match.start():match.end()]:
                if box:
                    lines.setdefault(box[1], pymupdf.Rect(box[0])).include_rect(box[0])
            rects = [tuple(r * m) for r in lines.values()]
            context = " ".join(text[max(0, match.start() - 30):match.end() + 30].split())
            found.append((index, rects, context))
    return found
