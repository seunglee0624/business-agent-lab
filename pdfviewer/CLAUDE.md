# PDF Viewer — 프로젝트 규칙

## 스택
PySide6 + PyMuPDF. Python 3.11+. 테스트는 pytest-qt. 개발은 WSL, 가상환경은 `pdfviewer/.venv` (lab 루트 `.venv` 아님).

## 아키텍처 규칙 (디자인은 나중에 교체된다 — 반드시 지킬 것)
- app/core/ 는 Qt 위젯(QtWidgets)을 import 하지 않는다. QtCore(시그널)와 QtGui 의 데이터 타입(QImage 등)만 허용.
- 상태(현재 페이지, 줌, 보기 모드, 검색 결과 등)는 app/viewer_state.py 만 소유한다.
  위젯은 상태를 멤버 변수로 들고 있지 않는다.
- 위젯 → 로직: viewer_state 의 메서드 호출로만. 로직 → 위젯: viewer_state 의 시그널로만.
- 위젯끼리 직접 참조 금지. (toolbar 가 page_view 를 import 하거나 호출하지 않는다.)
- 목록(썸네일·목차·검색결과)은 app/models/ 의 Qt 모델 + 위젯 측 delegate 로 분리.
- PDF 렌더는 core/renderer.py 의 워커 프로세스 풀에서만 수행. UI 프로세스에서 get_pixmap 금지.
  (PyMuPDF는 렌더 중 GIL을 놓지 않아 스레드로 옮겨도 UI가 멈춘다. 무거운 PyMuPDF 작업은 모두 같은 이유로 프로세스에서.)
- 색·폰트·크기·간격·반지름 하드코딩 금지 → styles/tokens.json + QSS 에서만.
  코드에서 수치가 필요하면 theme.token("...") 로 조회.
- 아이콘은 icons.icon("name") 으로만 참조. 경로 직접 사용 금지.
- 새 단축키는 app/shortcuts.py 표에만 추가하고 viewer_state 메서드에 매핑.
- `import fitz` 대신 `import pymupdf` 사용.
- PLAN.md 체크박스 업데이트와 커밋은 사용자가 요청할 때만 한다.

## 위젯을 새로 만들 때 체크
1. 이 위젯이 들고 있는 self.xxx 중 "상태"가 있나? → viewer_state 로 옮긴다.
2. 다른 위젯을 import 하고 있나? → viewer_state 시그널로 바꾼다.
3. 숫자나 색이 코드에 있나? → tokens.json 으로 옮긴다.

## 실행 (pdfviewer/ 에서)
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt   # 최초 1회
.venv/bin/python main.py [file.pdf]
.venv/bin/pytest -q

## 커밋 규칙
Phase 단위 또는 기능 단위로 작게 커밋. 메시지는 한국어 가능.
