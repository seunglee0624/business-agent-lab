"""Stop 훅: 이번 턴에 코드는 고쳤는데 knowledge/ 페이지는 그대로면 Claude가 멈추지 못하게 하고 갱신을 지시한다."""
import json
import os
import sys

# ===== 설정 (프로젝트에 맞게 수정) =====
KNOWLEDGE_DIR = "knowledge"  # LLM Wiki(OKF 번들) 폴더
CODE_EXTS = {".py", ".ipynb", ".r", ".js", ".ts", ".jsx", ".tsx", ".sql", ".html", ".css"}
IGNORE_PREFIXES = (".claude/",)  # 검사에서 뺄 경로
# =====================================


def main():
    try:
        data = json.loads(sys.stdin.buffer.read().decode("utf-8"))
    except Exception:
        return 0

    root = os.environ.get("CLAUDE_PROJECT_DIR") or data.get("cwd") or os.getcwd()
    session = data.get("session_id", "default")
    log_path = os.path.join(root, ".claude", "state", f"edits-{session}.txt")

    if not os.path.exists(log_path):
        return 0  # 이번 턴에 고친 파일 없음

    def clear_log():
        try:
            os.remove(log_path)
        except OSError:
            pass

    # 무한 루프 방지: 이미 한 번 막아서 이어서 작업 중이면 통과시키고 기록 초기화
    if data.get("stop_hook_active"):
        clear_log()
        return 0

    with open(log_path, encoding="utf-8") as f:
        edited = sorted({line.strip() for line in f if line.strip()})

    knowledge_prefix = KNOWLEDGE_DIR.rstrip("/") + "/"
    knowledge_edited = [p for p in edited if p.startswith(knowledge_prefix)]
    code_edited = [
        p for p in edited
        if not p.startswith(knowledge_prefix)
        and not p.startswith(IGNORE_PREFIXES)
        and os.path.splitext(p)[1].lower() in CODE_EXTS
    ]

    if code_edited and not knowledge_edited:
        reason = (
            "코드 파일이 바뀌었지만 knowledge/ 페이지는 갱신되지 않았습니다.\n"
            "바뀐 파일:\n" + "\n".join(f"- {p}" for p in code_edited) + "\n\n"
            f"1) {KNOWLEDGE_DIR}/index.md를 읽고 위 파일과 관련된 페이지를 찾아 내용을 고치세요.\n"
            "2) 새 기능이면 페이지를 새로 만들고 frontmatter(type·title·description)를 채우세요.\n"
            f"3) 페이지를 추가·삭제·설명 변경했다면 {KNOWLEDGE_DIR}/index.md 목록도 맞추세요.\n"
            "4) 갱신할 필요가 없는 변경이면 이유를 한 줄로 말하고 끝내세요."
        )
        print(json.dumps({"decision": "block", "reason": reason}, ensure_ascii=False))
        return 0  # 기록은 남겨 둠 → knowledge 수정이 추가되면 다음 검사에서 통과

    clear_log()
    return 0


if __name__ == "__main__":
    sys.exit(main())
