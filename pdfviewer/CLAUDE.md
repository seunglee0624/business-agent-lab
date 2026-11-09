# PDF Viewer — 프로젝트 규칙

사용자의 진행 방식(계획 → 직접 확인 → 피드백 → 다음 단계)은 WORKFLOW.md 참고.

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
  표는 기본값이다. 사용자가 바꾼 키는 core/settings.py 에만 저장하고, 액션은 shortcuts.keys(name) 으로 키를 받는다.
- `import fitz` 대신 `import pymupdf` 사용.
- PLAN.md 체크박스 업데이트와 커밋은 사용자가 요청할 때만 한다.
- AI 호출은 app/core/llm/base.py 의 LLMBackend 를 통해서만. 위젯·chat_state 가 anthropic·httpx·openai 를 직접 import 하지 않는다.
- core/llm/ 의 백엔드 클래스는 순수 파이썬. Qt 는 worker.py(QThread·Signal, QtCore 만)에서만.
- PDF 텍스트 추출도 UI 프로세스에서 PyMuPDF 를 부르지 않고 renderer.py → render_worker.py 경로를 쓴다.
- 채팅 상태(대화 기록·컨텍스트 범위·진행 중 여부)는 app/chat_state.py 만 소유. viewer_state 와는 시그널로만 연결.
- 채팅 메시지는 append-only: 이미 보낸 턴은 고치지 않는다 (프롬프트 캐시가 깨진다). 페이지 발췌는 그 턴의 질문에 붙인다.
- API 키는 코드·git 에 넣지 않는다. 환경변수 또는 QSettings 에서만 읽는다.
- PDF 원본 파일은 절대 수정하지 않는다. pymupdf 의 save / saveIncr / insert_* / add_*_annot 호출 금지. 메모·하이라이트는 전부 sidecar JSON.
- 메모 데이터 읽기·쓰기는 app/core/annotations/store.py 만 한다. 위젯·상태 객체가 notes/ 폴더의 파일을 직접 열지 않는다.
- 하이라이트 좌표는 단어·검색 좌표와 같은 page.rect 좌표로 저장한다. 화면 좌표 변환은 page_view 가 하고, 저장 데이터에는 줌·회전·보기 모드가 들어가지 않는다.
- 메모 상태(하이라이트·메모·북마크·문서 노트·대화 기록)는 app/annotation_state.py 만 소유. page_view·sidebar·chat_panel 은 시그널로만 연결.
- 파일 저장은 디바운스 + 임시 파일 → rename 의 원자적 쓰기만 사용.

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
