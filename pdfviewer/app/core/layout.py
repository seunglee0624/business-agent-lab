def layout(rows, sizes, zoom, gap):
    """Place pages: rows stacked top to bottom, pages in a row side by side, each row centred.
    rows: lists of page indexes. sizes: index -> (w, h) in points, already rotated. gap: px.
    Returns ({index: (x, y, w, h) in px}, (total width, total height))."""
    dims = []
    for row in rows:
        widths = [sizes[i][0] * zoom for i in row]
        dims.append((sum(widths) + gap * (len(row) - 1), max(sizes[i][1] * zoom for i in row)))
    width = max(w for w, _ in dims)
    rects, y = {}, 0.0
    for row, (row_w, row_h) in zip(rows, dims):
        x = (width - row_w) / 2
        for i in row:
            w, h = sizes[i][0] * zoom, sizes[i][1] * zoom
            rects[i] = (x, y + (row_h - h) / 2, w, h)
            x += w + gap
        y += row_h + gap
    return rects, (width, y - gap)
