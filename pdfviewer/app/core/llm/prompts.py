SYSTEM = (
    "당신은 PDF 읽기 도우미입니다. 사용자는 PDF를 읽으면서 질문합니다. 질문에는 지금 보고 있는 부분의 발췌가 "
    "<excerpt> 태그로 붙어 오고, 문서 전체를 대상으로 할 때는 아래 <document> 에 문서가 페이지별로 들어 있습니다. "
    "주어진 내용을 근거로 답하고, 근거가 된 페이지를 p.12 처럼 적으세요. "
    "주어진 내용에 없는 것은 없다고 말한 뒤, 일반 지식으로 보충할 때는 그렇다고 밝히세요. "
    "질문한 언어로 답하세요. 대화형 화면이라 바로 답을 시작하고, 길이는 질문에 맞게 짧게 유지하세요."
)

NO_TEXT = "(이 부분에는 추출할 수 있는 글자가 없습니다. 스캔 이미지일 수 있습니다.)"


def user_turn(where, excerpt, question):
    """One question as sent: the excerpt first, then the question. excerpt None: about the whole document.
    Kept as sent, so later turns reuse the cache."""
    if excerpt is None:
        return f"(문서 전체에 대한 질문)\n\n{question}"
    return f'<excerpt pages="{where}">\n{excerpt.strip() or NO_TEXT}\n</excerpt>\n\n{question}'


def document_block(texts, page_count, truncated):
    """The whole document, added to the system prompt for the rest of the conversation (cached with it)."""
    note = f" 글자 수 상한 때문에 p.1–p.{len(texts)} 까지만 들어 있습니다." if truncated else ""
    pages = "\n".join(f'<page n="{n}">\n{text.strip()}\n</page>' for n, text in enumerate(texts, 1))  # p.N citable
    return f'<document pages="{page_count}">{note}\n{pages}\n</document>'
