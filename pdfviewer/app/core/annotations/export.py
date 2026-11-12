"""One document's notes as Markdown, for a study summary. Pure Python, like store.py."""


def to_markdown(data):
    """data: an AnnotationStore's data. Document note, bookmarks, then each page's highlights and notes."""
    out = [f"# {data.get('title') or '메모'}"]
    if data["doc_note"].strip():
        out += ["## 문서 노트", data["doc_note"].strip()]
    bookmarks = sorted(data["bookmarks"], key=lambda b: b["page"])
    if bookmarks:
        out += ["## 북마크", "\n".join(f"- p.{b['page'] + 1}" + (f": {b['label']}" if b.get("label") else "")
                                      for b in bookmarks)]
    pages = {}
    # highlights top to bottom, then the page's notes in the order they were made
    for item in sorted(data["highlights"], key=lambda h: (h["page"], h["quads"][0][1] if h["quads"] else 0)):
        pages.setdefault(item["page"], []).append(_quote(item["text"])
                                                  + (f"\n\n코멘트: {item['comment']}" if item["comment"] else ""))
    for note in data["notes"]:
        if note["source"] == "ai":
            question = f" (질문: {note['question']})" if note.get("question") else ""
            text = f"**AI**{question}\n\n{note['text'].strip()}"
        else:
            text = f"**메모**: {note['text'].strip()}"
        pages.setdefault(note["page"], []).append(text)
    if pages:
        out.append("## 하이라이트·메모")
        for page in sorted(pages):
            out += [f"### p.{page + 1}", *pages[page]]
    return "\n\n".join(out) + "\n"


def _quote(text):
    return "\n".join(f"> {line}" for line in text.strip().splitlines() or [""])
