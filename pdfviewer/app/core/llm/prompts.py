SYSTEM = (
    "당신은 PDF 읽기 도우미입니다. 사용자는 PDF를 읽으면서 질문하고, 질문마다 지금 보고 있는 부분의 발췌가 "
    "<excerpt> 태그로 함께 옵니다. 발췌 안의 내용을 근거로 답하고, 근거가 된 페이지를 p.12 처럼 적으세요. "
    "발췌에 없는 내용은 발췌에 없다고 말한 뒤, 일반 지식으로 보충할 때는 그렇다고 밝히세요. "
    "질문한 언어로 답하세요. 대화형 화면이라 바로 답을 시작하고, 길이는 질문에 맞게 짧게 유지하세요."
)


def user_turn(pages, excerpt, question):
    """One question as sent: the excerpt first, then the question. Kept as sent, so later turns reuse the cache."""
    excerpt = excerpt.strip() or "(이 부분에는 추출할 수 있는 글자가 없습니다. 스캔 이미지일 수 있습니다.)"
    return f'<excerpt pages="{pages}">\n{excerpt}\n</excerpt>\n\n{question}'
