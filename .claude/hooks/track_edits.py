"""PostToolUse 훅: Claude가 Write/Edit/NotebookEdit로 고친 파일 경로를 세션별 로그에 기록한다."""
import json
import os
import sys


def main():
    try:
        data = json.loads(sys.stdin.buffer.read().decode("utf-8"))
    except Exception:
        return 0  # 입력을 못 읽으면 조용히 통과

    tool_input = data.get("tool_input") or {}
    path = tool_input.get("file_path") or tool_input.get("notebook_path")
    if not path:
        return 0

    root = os.environ.get("CLAUDE_PROJECT_DIR") or data.get("cwd") or os.getcwd()
    session = data.get("session_id", "default")

    state_dir = os.path.join(root, ".claude", "state")
    os.makedirs(state_dir, exist_ok=True)
    log_path = os.path.join(state_dir, f"edits-{session}.txt")

    try:
        rel = os.path.relpath(path, root)
    except ValueError:  # Windows에서 드라이브가 다른 경우
        rel = path
    rel = rel.replace("\\", "/")

    with open(log_path, "a", encoding="utf-8") as f:
        f.write(rel + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
