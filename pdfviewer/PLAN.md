# PDF 뷰어 (읽기 전용 · 풀구성) 개발 계획

> 이 파일을 프로젝트 루트에 두고 Claude Code에서 `PLAN.md 의 Phase N 진행해줘` 식으로 단계별로 지시하면 됩니다.
> 한 Phase가 끝날 때마다 "완료 조건"을 직접 실행해 확인하고 다음 Phase로 넘어가세요.

---

## 0. 결정 사항

| 항목 | 선택 | 이유 |
|---|---|---|
| 언어 | Python 3.11+ | 주 사용 언어 |
| GUI | **PySide6** (Qt6) | PyQt6와 API 거의 동일하지만 LGPL이라 배포 시 라이선스 부담이 적음. QSS로 스타일링 |
| PDF 엔진 | **PyMuPDF (fitz)** | C 기반 → 렌더 가장 빠름. 텍스트 추출·검색·목차·링크 모두 지원 |
| 스타일 | QSS 파일 분리 (`styles/*.qss`) + 디자인 토큰 | 코드 수정 없이 색·폰트·간격 교체 가능 |
| 설정 저장 | `QSettings` | 최근 파일, 마지막 페이지, 창 크기, 사이드바 상태 |
| 패키징 | PyInstaller | Windows `.exe` 단일 배포 |
| 테스트 | pytest + pytest-qt | 로직·위젯 테스트 |

> 라이선스 메모: PyMuPDF는 AGPL(비공개 배포 시 상용 라이선스 필요). 개인 사용·공개 소스 기준이면 문제 없음.

### 환경 세팅
개발은 WSL에서 `pdfviewer/.venv`로 한다 (명령은 CLAUDE.md "실행" 절). Windows `.exe` 빌드(Phase 9)만 Windows Python이 필요하다.
```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
```

---

## 1. 프로젝트 구조

```
pdfviewer/
├─ main.py                  # 진입점 (argv로 파일 경로 받음)
├─ app/
│  ├─ __init__.py
│  ├─ main_window.py        # QMainWindow, 레이아웃 조립, 메뉴/단축키
│  ├─ core/                 # ── Qt 위젯을 모르는 계층 (단위 테스트 대상)
│  │  ├─ document.py        # PyMuPDF 래퍼 (열기/암호/페이지 수/목차/링크/메타데이터) — import pymupdf
│  │  ├─ layout.py          # 보기 모드별 페이지 배치 계산
│  │  ├─ renderer.py        # 렌더·검색 요청 관리 + LRU 캐시 (워커 프로세스 풀)
│  │  ├─ render_worker.py   # 워커 프로세스 안에서 도는 PyMuPDF 렌더·검색·목차
│  │  ├─ settings.py        # QSettings 래퍼 (단축키 사용자 지정 포함)
│  │  ├─ llm/               # ── AI 채팅 백엔드 (Phase 10). Qt 는 worker.py 만(QtCore)
│  │  │  ├─ base.py         # LLMBackend 추상 클래스, LLMError
│  │  │  ├─ anthropic_api.py# 기본. `anthropic` 패키지, 스트리밍, 프롬프트 캐싱
│  │  │  ├─ openai_compat.py# OpenAI 호환 엔드포인트 (Gemini·Groq·OpenRouter·Ollama 등)
│  │  │  ├─ worker.py       # 백엔드 호출을 QThread 에서 돌리고 시그널로 청크 전달
│  │  │  └─ prompts.py      # 시스템 프롬프트·빠른 질문 템플릿 로드 (app/llm_prompts.json)
│  │  └─ annotations/       # ── 기록·메모 (Phase 11). 순수 파이썬
│  │     ├─ store.py        # AnnotationStore: notes/<doc_id>.json 읽기·쓰기 (원자적 저장)
│  │     └─ export.py       # 마크다운 내보내기
│  ├─ viewer_state.py       # ── ViewModel: 현재 페이지·줌·보기 모드·검색 결과 등 "상태"의 유일한 소유자.
│  │                        #    위젯은 여기의 메서드만 호출하고, 여기의 시그널만 구독한다.
│  ├─ chat_state.py         # ── 채팅 ViewModel (Phase 10): 문서별 대화 기록, 컨텍스트 범위, 진행 상태
│  ├─ annotation_state.py   # ── 메모 ViewModel (Phase 11): 하이라이트·메모·북마크·문서노트·대화기록 소유
│  ├─ models/               # ── Qt Model/View 데이터 모델 (그리는 방식과 분리)
│  │  ├─ thumbnail_model.py # QAbstractListModel
│  │  ├─ outline_model.py   # QAbstractItemModel (목차 트리)
│  │  ├─ search_result_model.py
│  │  ├─ chat_model.py      # 대화 메시지 목록 (Phase 10)
│  │  ├─ highlight_model.py # (Phase 11)
│  │  ├─ note_model.py      # (Phase 11)
│  │  └─ bookmark_model.py  # (Phase 11)
│  ├─ widgets/              # ── View: 그리기와 입력 전달만. 상태 소유 금지
│  │  ├─ toolbar.py         # 상단 툴바
│  │  ├─ page_view.py       # 중앙 문서 영역 (QGraphicsView 기반, 연속/단일/펼침)
│  │  ├─ sidebar.py         # 썸네일 / 목차 / 검색 결과 탭
│  │  ├─ thumbnail_delegate.py
│  │  ├─ search_bar.py      # 검색 바
│  │  ├─ status_bar.py      # 하단 상태바
│  │  ├─ empty_state.py     # 파일 없을 때 화면
│  │  ├─ tab_bar.py         # 다중 파일 탭
│  │  ├─ chat_panel.py      # 오른쪽 AI 채팅 패널 (Phase 10)
│  │  ├─ chat_message_delegate.py  # 말풍선 그리기 (모델과 분리)
│  │  └─ notes_delegate.py  # 메모 탭 항목 그리기 (Phase 11)
│  ├─ dialogs/
│  │  ├─ password_dialog.py
│  │  ├─ properties_dialog.py
│  │  ├─ shortcuts_dialog.py      # 단축키 목록 + 직접 지정 (Phase 9.5)
│  │  ├─ llm_settings_dialog.py   # 백엔드·API 키·모델 설정 (Phase 10)
│  │  └─ export_dialog.py         # 내보내기 옵션 (Phase 11)
│  ├─ shortcuts.py          # 단축키 테이블 한 곳에서 관리 → viewer_state 메서드에 매핑
│  ├─ icons.py              # icon("zoom_in") 식 이름 참조 → assets/icons/ 세트 교체 용이
│  └─ theme.py              # QSS 로드, 토큰 치환, 폰트 등록, 토큰 값(간격 등) 코드에서 조회
├─ styles/
│  ├─ tokens.json           # 색·폰트·반지름·간격 (디자인 토큰)
│  └─ base.qss              # 토큰 플레이스홀더 포함 템플릿
├─ assets/
│  ├─ icons/                # SVG 아이콘 (Phosphor, 단색, currentColor)
│  └─ fonts/                # Pretendard
├─ tests/
├─ build/pyinstaller.spec
├─ PLAN.md
└─ CLAUDE.md                # Claude Code용 프로젝트 규칙 (아래 11절)
```

**핵심 설계 원칙 — 디자인은 나중에 바꾼다는 전제**

디자인 변경은 두 종류이고, 각각 다른 층에서 막는다.

| 변경 종류 | 예시 | 고치는 곳 | 코드 수정 |
|---|---|---|---|
| ① 스타일 | 색, 폰트, 둥근 정도, 간격, 아이콘 모양 | `styles/`, `assets/icons/` | 없음 |
| ② 구조 | 툴바 위치 이동, 사이드바를 플로팅 패널로, 버튼 재배치 | `widgets/` 만 | 로직·모델 무수정 |

```
[core: Qt 모름]        [viewer_state: 상태 소유]        [widgets: 그리기만]
document.py     ◀──▶   현재 페이지·줌·모드·검색결과   ◀──▶   toolbar / page_view /
renderer.py            메서드 호출 ↑   시그널 통지 ↓          sidebar / search_bar …
render_worker.py                                           styles/*.qss
settings.py            [models: 썸네일·목차·검색결과 데이터]  → delegate로 그리기만 교체
```

- `core/`는 Qt 위젯을 import 하지 않음 → 단위 테스트 가능.
- **위젯은 상태를 소유하지 않음.** 입력은 `viewer_state.go_to(page)` 같은 메서드 호출로만, 화면 갱신은 `viewer_state.page_changed` 같은 시그널 구독으로만.
- **위젯 간 직접 참조 금지.** 툴바가 page_view를 부르지 않는다. 전부 `viewer_state` 경유. → 툴바를 통째로 다른 디자인으로 교체해도 다른 위젯은 무수정.
- 목록 성격(썸네일·목차·검색 결과)은 Qt **Model/View**: 데이터는 `models/`, 그리는 방식은 위젯의 delegate. 모양만 바꿀 땐 delegate만 교체.
- 렌더·검색은 항상 **워커 프로세스**, UI 프로세스에서 PDF 렌더 금지(렉 방지의 핵심). PyMuPDF는 렌더 중 GIL을 놓지 않아 스레드로는 UI가 멈춘다.
- 보이는 페이지 ± 2페이지만 렌더, LRU 캐시(메모리 상한 지정), 줌 변경 시 저해상도 → 고해상도 2단계 렌더.
- 색·폰트·간격·반지름 등 모든 시각 수치는 `styles/tokens.json`에서만. 코드에서 필요하면 `theme.token("spacing.md")`로 조회. 하드코딩 금지.
- 아이콘은 `icons.icon("zoom_in")` 이름 참조. 파일 경로 직접 쓰지 않음.

---

## 2. 개발 단계

### Phase 1 — 골격 + 단일 페이지 보기
**목표**: 파일 열어서 페이지 넘기고 줌 되는 최소 앱
- [x] 프로젝트 구조·venv·`requirements.txt`
- [x] `core/document.py`: open / needs_pass / page_count / render(page, zoom) → QImage (`import pymupdf`)
- [x] `viewer_state.py`: 상태(current_page, zoom, zoom_mode, view_mode) + 메서드(open, go_to, next, prev, set_zoom, fit_width …) + 시그널(document_changed, page_changed, zoom_changed …)
- [x] `theme.py` + `styles/tokens.json` + `base.qss` 최소 버전 (값은 임시, 구조만) — 처음부터 하드코딩 없이 시작
- [x] `main_window.py`: 메뉴(파일·보기·도움말), 중앙 `page_view`. 위젯들을 `viewer_state`에 연결만 함
- [x] `page_view.py`: 단일 페이지 모드, 스크롤, Ctrl+휠 줌 → `viewer_state.set_zoom` 호출
- [x] 툴바: 열기, ◀▶, 페이지 입력, ＋－, 배율 콤보(50/75/100/125/150/200%, 폭 맞춤, 페이지 맞춤) → 전부 `viewer_state` 메서드 호출, 표시값은 시그널로 갱신
- [x] `main.py file.pdf` 로 실행 시 바로 열기
- [x] 암호 PDF → `password_dialog`

**완료 조건**: 100페이지 PDF를 열어 방향키로 넘길 때 끊김 없음, 줌 변경 즉시 반영. `grep -r "QColor(\|#[0-9a-fA-F]\{6\}" app/` 결과가 비어 있음(하드코딩 없음).

### Phase 2 — 성능: 비동기 렌더 + 캐시
**목표**: 큰 PDF(500p+, 이미지 많은 스캔본)에서도 렉 없음
- [x] `renderer.py`: 워커 프로세스 풀(`ProcessPoolExecutor`) 렌더 작업, 결과 시그널로 UI에 전달
- [x] 보이는 페이지 우선 렌더, 범위 밖 작업 취소
- [x] LRU 캐시 (예: 200MB 상한), 줌 변경 시 캐시 무효화
- [x] 저해상도 미리보기 → 고해상도 교체 (2단계)
- [x] 로딩 중 페이지 자리에 플레이스홀더(종이 색 사각형)

**완료 조건**: 300MB 스캔 PDF를 빠르게 스크롤해도 UI 스레드 멈춤 없음(마우스 반응 유지).

### Phase 3 — 보기 모드 + 문서 영역 완성
- [x] 연속 스크롤 모드 (모든 페이지 세로 나열, 페이지 간 간격)
- [x] 두 페이지 펼침 모드 (표지 단독 옵션)
- [x] 회전 (90° 좌/우, 문서 단위)
- [x] 전체화면(F11), 발표 모드(페이지 맞춤 + UI 숨김)
- [x] 창 리사이즈 시 "폭 맞춤" 유지
- [x] 종이 그림자, 배경색(토큰)
- [x] 텍스트 선택 → 복사 (PyMuPDF `get_text("words")` 좌표 기반)
- [x] 선택 도구 ↔ 손(드래그 이동) 도구 전환
- [x] 내부 링크(목차 점프)·외부 URL 클릭

**완료 조건**: 세 가지 보기 모드 전환 시 현재 페이지 유지, 텍스트 드래그 복사 정상.

### Phase 4 — 사이드바
- [x] 접기/펴기 가능한 사이드바 (애니메이션 선택)
- [x] 썸네일 탭: `models/thumbnail_model.py` + `QListView` + 커스텀 delegate. 지연 렌더(보이는 것만), 현재 페이지 하이라이트, 클릭 → `viewer_state.go_to`
- [x] 목차 탭: `models/outline_model.py`(`doc.get_toc()`) + `QTreeView`, 클릭 시 해당 위치로
- [x] 목차 없을 때 안내 문구
- [x] 사이드바 너비 드래그 조절, 상태 저장

### Phase 5 — 검색
- [x] `search_bar.py`: Ctrl+F로 표시, Esc로 닫기
- [x] 전체 문서 검색(`page.search_for`): `renderer.py`가 워커 프로세스에 페이지 묶음 단위로 맡김, 진행률 시그널
- [x] `models/search_result_model.py` → 결과 목록은 모델, 하이라이트 오버레이는 page_view가 시그널 받아 그림
- [x] 결과 하이라이트 오버레이, 현재 결과 강조 색 구분 (색은 토큰 `color.search_hit`, `color.search_hit_current`)
- [x] 이전/다음(Enter / Shift+Enter), "n / 전체" 카운트
- [x] 옵션: 대소문자 구분, 단어 단위

### Phase 6 — 다중 탭 · 상태바 · 빈 화면 · 설정
- [x] 탭 바: 여러 파일, 중간 클릭/Ctrl+W 닫기, 드래그 순서 변경
- [x] 드래그&드롭으로 파일 열기 (빈 화면·탭 영역)
- [x] Empty state: 아이콘 + "PDF를 끌어다 놓거나 열기" + 최근 파일 목록
- [x] 상태바: 페이지/전체, 배율, 파일명·크기, 렌더 진행
- [x] `settings.py`: 최근 파일 10개, 파일별 마지막 페이지·배율 기억, 창 위치·크기, 사이드바 상태 (테마는 다크 하나라 저장 안 함)
- [x] 문서 속성 다이얼로그 (제목·작성자·생성/수정일·페이지 크기·PDF 버전·암호화 여부)
- [ ] ~~인쇄 (`QPrinter`로 렌더 이미지 출력)~~ → 제외 (사용자 결정: 쓰지 않음)

### Phase 7 — 디자인 시스템 + 테마
- [x] `tokens.json` 정의: `color.bg_base`·`bg_panel`·`bg_elevated`·`bg_highlight`, `color.text`, `color.accent`, `radius`, `spacing`, `font`, `size`
- [x] `base.qss`에 `{{color.accent}}` 식 플레이스홀더 → `theme.py`가 치환해서 적용
- [ ] ~~라이트/다크 테마, 시스템 설정 따라가기 옵션~~ → 제외: 2026-11-07 다크 단일 테마로 결정 (스포티파이 테마 명세, `anti-slop/audit-001-2026-11-07.md`)
- [ ] ~~페이지 색 반전(야간 읽기) — 렌더 결과 이미지 반전~~ → 제외 (사용자 결정: 필요 없음)
- [x] SVG 아이콘 세트 (`currentColor`로 테마에 따라 색 자동 변경)
- [x] 툴바 버튼 hover/pressed/disabled 상태 스타일
- [x] **여기서 "원하는 느낌"을 반영한 실제 디자인 작업** (레이아웃 밀도, 폰트, 포인트 색, 둥근 정도)

### Phase 8 — 단축키 · 접근성 · 마무리
- [x] `shortcuts.py` 표: ←→ PgUp/PgDn Home/End, Ctrl+± / Ctrl+0, Ctrl+F, Ctrl+O, Ctrl+W, Ctrl+Tab, F11, Esc, R(회전) (PgUp/PgDn은 연속 보기에서 한 화면 스크롤, Ctrl+0은 100%)
- [x] 단축키 안내 다이얼로그(`?`, F1, 도움말 메뉴) — 단축키 표에서 자동 생성
- [x] 툴팁 전부 채우기 (모든 액션 "이름 (단축키)", 입력 상자·사이드바 탭·상태바)
- [x] 에러 처리: 손상 파일, 없는 경로, 권한 거부 → 사용자 메시지 (권한 거부는 최근 파일에 남김)
- [x] 로깅(`logging`, 파일 출력): `%APPDATA%\pdfviewer\pdfviewer\pdfviewer.log`, 1MB × 3, 처리 안 된 예외 포함

### Phase 9 — 테스트 · 패키징 · 연결 프로그램 등록
- [x] `tests/`: document.py(열기·검색·목차), renderer 캐시 동작, 위젯 스모크 테스트(pytest-qt)
- [x] PyInstaller spec: `--windowed`, 아이콘, `styles/`·`assets/` 포함 (`pdfviewer.spec`, 폴더형 빌드, WSL에서 `build_win.sh`)
- [x] 실행 파일에서 `argv[1]`로 파일 열기 확인
- [x] Windows "연결 프로그램"에 `.exe` 등록 테스트 (더블클릭으로 열림)
- [x] README: 설치·빌드·단축키

### Phase 9 이후 다듬기 (2026-11-09, 사용자 피드백)
- [x] 첫 화면 최근 문서: 두 줄(파일 이름 / 흐린 폴더), 줄마다 ×·Delete로 목록에서 제거, 높이는 파일 수에 맞춤, 테두리는 Tab 포커스 때만
- [x] 메뉴 이름에서 `(F)` 표시 제거 (`파일`·`편집`·`보기`·`도움말`), Alt+F/E/V/H는 `shortcuts.MENU_KEYS`로 유지
- [x] 메뉴 막대·도구 모음 간격 조정 (도구 모음 여백 8px, 메뉴 항목 위 여백)
- [x] 썸네일 칸 높이를 문서에서 가장 높은 페이지에 맞춤 (가로 슬라이드는 정사각형 칸이 아님)
- [x] Ctrl+휠 확대·축소는 마우스 위치 기준, 버튼·키는 화면 가운데 기준
- [x] 배율 칸은 입력 불가, 클릭하면 목록이 열림
- [x] 툴바 확대 묶음(—)을 문서 영역 시작선(첫 탭) 위에 맞춤, 사이드바 폭을 따라감 (빈 화면 포함)
- [x] '파일 열기' 버튼: 알약 대신 배율 칸과 같은 둥근 사각형

### Phase 9.5 — 단축키 직접 지정
**목표**: 사용자가 단축키를 바꿀 수 있게. Phase 10·11 의 새 단축키는 `shortcuts.KEYS` 에 줄만 추가하면 자동으로 지정 대상이 된다 (그래서 Phase 10 전에 한다).
**결정 (2026-11-09)**: `KEYS` 는 기본값으로 두고, 사용자가 바꾼 키만 `settings.py` 에 저장해 실행 때 기본값 위에 덮어쓴다.

- [ ] `settings.py`: `shortcut_overrides()` / `save_shortcut_overrides(dict)` — `{액션 이름: [키, …]}`, 바꾼 액션만 저장 (빈 목록 = 키 없음)
- [ ] `shortcuts.py`: `keys(name)` = 사용자 지정이 있으면 그것, 없으면 `KEYS` 기본값. `main_window` 의 액션 생성이 `KEYS.get` 대신 이걸 사용. 충돌 검사 `conflict(name, key) -> 다른 액션 이름 | None`
- [ ] 바꿀 수 없는 키: `escape`(Esc), `copy`(Ctrl+C), 메뉴 열기(`MENU_KEYS`의 Alt+F/E/V/H). 대화상자에 회색으로 표시만
- [ ] `dialogs/shortcuts_dialog.py` 를 편집 가능하게: 행 클릭 → `QKeySequenceEdit` 로 새 키 입력, 행마다 "기본값으로", 하단 "전체 초기화"
  - 키가 겹치면 안내 창 없이, 겹치는 두 줄의 키 글씨를 **빨간색**(새 토큰 `color.danger`)으로 표시. 마우스를 올리면 "‘○○’와 겹침" 툴팁
  - 저장은 그대로 된다. Qt 는 같은 키가 두 액션에 걸리면 둘 다 실행하지 않으므로, 빨간 동안은 두 기능 모두 그 키로 동작하지 않음. 한쪽을 바꾸면 빨간색이 풀리고 다시 동작
  - 고정 키(`Esc`·`Ctrl+C`·메뉴 키)와 겹치면 고정 키 줄은 바꿀 수 없으므로 내가 바꾼 줄만 빨간색
- [ ] 바꾸면 재시작 없이 즉시 적용: 액션 `setShortcuts` 다시 호출 + 툴팁 "이름 (단축키)" 갱신
- [ ] `tests/`: 기본값·사용자 지정 병합, 충돌 검사, 초기화, 고정 키는 바꿀 수 없음
- [ ] README 단축키 절에 "도움말 → 단축키 목록에서 변경" 추가

**완료 조건**
1. 단축키 목록에서 "다음 페이지"를 `J` 로 바꾸면 즉시 `J` 로 넘어가고, 툴팁에도 `J` 로 표시
2. 재시작 후에도 유지, "기본값으로" 누르면 원래 키로 돌아감
3. `Ctrl+O` 를 다른 액션에 지정하면 그 줄과 "열기" 줄의 키가 빨간색이 되고, 한쪽을 다른 키로 바꾸면 빨간색이 풀림

### Phase 10 — AI 채팅 패널 (PDF 보면서 AI에게 질문)
**목표**: 오른쪽 패널에서 지금 보고 있는 PDF 내용을 컨텍스트로 AI와 대화. **API 키 방식**(약관상 가장 깨끗). 기본은 Anthropic API, 설정만 바꾸면 무료 제공자·로컬 모델도 사용.
**뷰어의 존재 이유**: PDF를 보면서 동시에 궁금한 점을 바로 물어보는 것. 이 Phase가 핵심 기능이다.

**결정 (2026-11-09)**: Claude Code 구독 로그인(`claude -p`) 방식은 약관 회색 지대라 **채택하지 않음**. API 키로 간다.

**10-0. 준비**
- [ ] Anthropic Console 에서 API 키 발급, 소액 충전($5 정도), **월 지출 한도 설정**(예: $7 ≈ 1만 원)
- [ ] 키 저장 위치: 설정 UI 에서만 입력(환경변수는 읽지 않음) → OS 암호 저장소(`keyring`, Windows 자격 증명 관리자). 저장소가 없으면(WSL) `QSettings` 파일, 권한 600. 키를 **git 에 절대 커밋하지 않음**(`.gitignore`, `.env`)
- [ ] `anthropic` 패키지 `requirements.txt` 추가. 최신 `anthropic`(1.x)은 `httpx` 가 아니라 `httpx2` 기반 → 설치된 버전 확인 후, OpenAI 호환 백엔드도 같은 HTTP 라이브러리를 써서 의존성을 늘리지 않음
- [ ] 모델 기본값: `llm.model = claude-sonnet-5-5` (품질, 입력 $2 / 출력 $10 per 1M), 가벼운 작업용 대안 `claude-haiku-5-5` ($0.10 / $0.50)
- [ ] **effort 기본값 `low`** (`output_config={"effort": "low"}`): Sonnet 5.5 는 생각 단계(thinking)를 끌 수 없고 기본 effort 가 `high` 라 첫 글자까지 느리고 출력비가 늘어남. 설정에서 바꿀 수 있게

**10-1. 백엔드 (core/llm/)**
- [ ] `base.py`: `LLMBackend` 추상 클래스 (순수 파이썬, Qt 모름)
  - `stream(system: str, messages: list[dict]) -> Iterator[str]` (텍스트 델타 yield)
  - `is_available() -> bool`, `name`, `model`
  - 예외는 `LLMError(message, kind)` 로 통일: `auth` / `rate_limit` / `network` / `context_too_long` / `refused` / `other`
- [ ] `anthropic_api.py`: `AnthropicBackend`
  - `anthropic.Anthropic(api_key=...)`, `messages.stream(...)` 으로 텍스트 델타 yield (thinking 블록은 무시)
  - **프롬프트 캐싱**: 요청 최상위 `cache_control={"type":"ephemeral"}` (자동 캐싱). 캐시는 요청 앞부분이 이전 요청과 똑같을 때만 맞으므로 메시지 구성은 10-2 의 append-only 규칙을 따른다
  - `max_tokens` 설정값(기본 1024), 시스템 프롬프트는 `prompts.py` 에서
  - 에러 매핑: `AuthenticationError`→auth, `RateLimitError`→rate_limit, `APIConnectionError`→network, 400 중 토큰 초과→context_too_long, `stop_reason == "refusal"`→refused
- [ ] `openai_compat.py`: `OpenAICompatBackend(base_url, api_key, model)`
  - `POST {base_url}/chat/completions` with `stream: true`, SSE 파싱 → 델타 yield
  - 설정 예시(README 에 기록, 값은 사용 시점에 각 제공자 문서로 확인):
    - Gemini: `https://generativelanguage.googleapis.com/v1beta/openai`
    - Groq: `https://api.groq.com/openai/v1`
    - OpenRouter: `https://openrouter.ai/api/v1`
    - Ollama(로컬): `http://localhost:11434/v1`, api_key 임의 문자열
  - 프롬프트 캐싱은 제공자마다 달라 미지원(그냥 전송)
- [ ] `worker.py`: `LLMWorker(QThread)` — 백엔드 `stream()` 을 돌리며 `chunk(str)`, `finished(str)`, `failed(str kind, str message)` 시그널 emit. `cancel()` 은 플래그 세우고 이터레이터 중단. **QtCore 만 import**
  - API 호출은 네트워크 I/O 라 스레드로 충분 (PyMuPDF 와 달리 GIL 문제 없음). 렌더 워커 프로세스와는 별개
- [ ] `prompts.py` + `app/llm_prompts.json`: 시스템 프롬프트("PDF 읽기 도우미. 제공된 발췌 범위 안에서 답하고 근거 페이지를 p.N 형식으로 표기. 발췌에 없는 내용은 모른다고 말할 것"), 빠른 질문 템플릿
- [ ] 백엔드 선택은 설정 `llm.backend = "anthropic" | "openai_compat"`, 기본 `anthropic`. 팩토리 함수 `make_backend(settings)` — `chat_state` 는 이 함수만 부르고 백엔드 이름 문자열을 직접 다루지 않음

**10-2. 상태 (chat_state.py)**
- [ ] 문서(탭)별 대화 기록 분리. 탭 전환 시 `viewer_state.document_changed`(탭 전환에도 발생) 받아 해당 기록으로 교체
- [ ] 컨텍스트 범위 enum: `SELECTION` / `CURRENT_PAGE` / `VISIBLE_PAGES` / `WHOLE_DOC`
  - 텍스트 추출은 기존 워커 경로 재사용: `renderer.py` 에 `request_text(page_range)` 추가 → `render_worker.py` 에서 `page.get_text()` (UI 프로세스에서 PyMuPDF 호출 금지 규칙 유지)
  - 추출 텍스트는 문서별로 캐시(같은 페이지 재추출 방지)
  - `WHOLE_DOC` 은 글자 수 상한(기본 60,000자, 설정 가능) 초과 시 경고 + 앞부분만 전송. 예상 비용을 "약 N원" 으로 표시(토큰≈글자수/2 추정, 모델 단가는 설정 파일)
  - 선택 텍스트는 `viewer_state.selection` (`(페이지, 첫 단어, 마지막 단어)`)에서 가져옴
- [ ] 메시지 구성 (**append-only**: 이미 보낸 턴은 고치지 않아야 캐시가 맞음)
  - `[system 고정] + (WHOLE_DOC 이면 문서 전체 블록 — 고정, 캐시 대상) + 이전 턴들 + 이번 질문`
  - `WHOLE_DOC` 외의 범위는 **그 턴의 질문 앞에** 발췌를 붙인다. 페이지가 바뀌어도 이전 턴은 그대로라 캐시 유지
  - 최근 N턴(기본 10) 초과 시 앞쪽을 잘라 비용 상한. 자르는 요청은 캐시 미스(허용)
- [ ] 메서드: `send(user_text)`, `cancel()`, `clear()`, `set_scope(scope)`, `ask_about_selection(text)`, `set_backend(name)`
- [ ] 시그널: `scope_changed`, `busy_changed(bool)`, `error(kind, message)`, `page_reference_clicked(int)` (답변 속 p.N 클릭 → `viewer_state.go_to`)
- [ ] `models/chat_model.py`: 메시지 목록 `QAbstractListModel` (role, text, streaming 여부, 사용 토큰·비용 메타). 스트리밍 중엔 마지막 행만 `dataChanged`

**10-3. 화면 (widgets/chat_panel.py)**
- [ ] 오른쪽 접이식 패널 (왼쪽 사이드바와 대칭 구조, 너비 드래그, 상태는 `settings.py` 에 저장)
- [ ] 상단: 컨텍스트 범위 콤보 + "p.12 · 1,240자 · 약 3원" 표시 + 모델 표시 + 대화 초기화 + 백엔드 상태 점(키 있음/없음)
- [ ] 메시지 목록: `QListView` + `chat_message_delegate.py`. 말풍선 색은 새 토큰 `color.chat_user`, `color.chat_assistant`, 텍스트는 `color.text`. 마크다운은 1차는 코드블록·굵게·목록 정도만 처리(QTextDocument), 완전한 렌더는 후순위
- [ ] 스트리밍: `chunk` 받을 때마다 마지막 말풍선 갱신, 자동 스크롤(사용자가 위로 올렸으면 멈춤)
- [ ] 하단: 입력창(Enter 전송, Shift+Enter 줄바꿈), 전송 ↔ 중지 버튼 토글, 빠른 질문 칩("이 페이지 요약", "선택 부분 쉽게 설명", "핵심 용어 정리")
- [ ] page_view 에 **우클릭 메뉴 새로 추가** (지금은 없음): "복사", "AI에게 질문" → `chat_state.ask_about_selection` (page_view 가 chat_panel 을 참조하지 않음. `chat_state` 경유)
- [ ] 답변 속 `p.12` 패턴을 링크로 → 클릭 시 해당 페이지 이동
- [ ] API 키 없음 / 인증 실패 / 한도 초과 / 네트워크 오류 / 답변 거절 → 패널 본문에 종류별 안내 카드(원인 + 해결 방법 + 설정 열기 버튼). 나머지 뷰어 기능은 영향 없음
- [ ] 설정 다이얼로그 `dialogs/llm_settings_dialog.py`: 백엔드 선택, API 키 입력(마스킹), 모델, effort, base_url(OpenAI 호환일 때), 전체 문서 상한, "연결 테스트" 버튼
- [ ] 아이콘은 `icons.icon("chat")`, `icons.icon("send")`, `icons.icon("stop")`, `icons.icon("settings")` (Phosphor 세트에서 추가)

**10-4. 단축키·설정·테스트**
- [ ] `shortcuts.py`: `Ctrl+Shift+L` 패널 토글, `Ctrl+Shift+K` 선택 텍스트로 질문 (Phase 9.5 덕분에 사용자가 바꿀 수 있음)
- [ ] 입력창 `Esc` → 포커스를 문서로. 전역 `escape` 액션(전체화면 해제 등)과 겹치므로 입력창이 `ShortcutOverride` 로 먼저 받음
- [ ] `settings.py`: 패널 열림/너비, 마지막 컨텍스트 범위, 백엔드·모델·effort·base_url, API 키, 전체 문서 상한
- [ ] `tests/`: SSE/스트림 파서(가짜 응답으로), `chat_state` 의 범위별 컨텍스트 조립·append-only·턴 자르기, 비용 추정, 키 없음 상태의 패널 스모크. **실제 API 호출 테스트는 없음**(비용·네트워크)
- [ ] 단축키 안내 다이얼로그·README 에 채팅 기능·키 설정 방법·제공자별 base_url 추가

**비용 메모**
- Sonnet 5.5 기준 페이지 단위 질문 1회 ≈ $0.005(약 7원)는 thinking 토큰을 뺀 값. effort `low` 여도 조금 더 나올 수 있음. Haiku 5.5 는 단가가 Sonnet 의 1/20
- 비용은 거의 전부 `WHOLE_DOC` 에서 나옴 → 상한·비용 표시·프롬프트 캐싱이 통제 장치. 캐싱은 같은 범위로 반복해 물을 때(특히 `WHOLE_DOC`) 효과가 큼
- 콘솔 월 지출 한도를 반드시 걸어둘 것

**완료 조건**
1. PDF 열고 한 문단 드래그 → 우클릭 "AI에게 질문" → 패널이 열리고 답변이 **스트리밍**으로 표시
2. 응답 중에 페이지 스크롤·줌이 평소처럼 부드러움 (워커 스레드 확인)
3. 답변의 `p.N` 클릭 → 해당 페이지로 이동
4. AI 설정의 키를 비우고 실행 → 안내 카드가 뜨고 뷰어 나머지 기능 정상
5. 설정에서 `openai_compat` + Ollama(또는 무료 제공자) 로 바꿔도 같은 패널이 그대로 동작
6. `grep -rn "anthropic\|httpx\|openai" app/widgets/ app/chat_state.py` 결과 없음 (위젯·상태가 백엔드를 직접 안 건드림)
7. `git grep -i "sk-ant"` 결과 없음 (키 커밋 안 됨)
8. `WHOLE_DOC` 로 같은 문서에 두 번 질문 → 두 번째 응답의 `usage.cache_read_input_tokens` 가 0 보다 큼 (로그로 확인)

### Phase 11 — 기록·메모 (하이라이트 · 메모 · 북마크 · 대화 저장 · 내보내기)
**목표**: PDF를 읽으면서 남긴 것(하이라이트, 메모, 북마크, AI 대화)을 **PDF 파일은 건드리지 않고** 뷰어 전용 sidecar 파일에 저장·복원. 시험 전에 마크다운으로 뽑아 정리본 재료로 쓸 수 있게.
**원칙**: 읽기 전용 뷰어 유지 — PDF 원본은 절대 수정하지 않는다. 모든 기록은 앱 데이터 폴더의 별도 JSON.

> **실제와 다른 점 (2026-11-13)**: 아래는 처음 계획이다. 만든 뒤 사용자 결정으로 바뀐 것 —
> - 문서 노트(`doc_note`) 제거. 묶음 이름은 "메모" → "노트"(노트 탭), 항목 이름 "메모" 는 그대로.
> - 내보내기 창·파일 내보내기(Ctrl+E)·`export_dialog.py` 없음. 파일 메뉴 "노트를 클립보드로 복사"(마크다운)만.
> - AI 답변 "메모로 저장" 은 `source="ai"` 메모가 아니라 그 페이지의 일반 메모에 글자만 이어 붙임. 하이라이트 연결 없음.
> - 대화 기록 저장·복원 없음(`save_chat`, 설정의 저장 여부 포함). 탭을 닫으면 대화도 버림.
> - 예전 파일의 `doc_note`·`chat`·AI 메모 데이터는 지우지 않고 둔다(AI 메모는 목록에 보임).
> - 자세한 기록은 README "진행 상황".

**결정 (2026-11-09)**: 범위는 학습용 풀세트. 저장 위치는 앱 데이터 폴더의 `notes/<doc_id>.json` — 로그와 같은 `QStandardPaths.AppDataLocation` 기준(Windows 에서는 `%APPDATA%\pdfviewer\pdfviewer\notes\`, WSL 개발 중에는 `~/.local/share/...`). 손글씨·도형은 제외. 하이라이트는 **한 페이지 안에서만** (지금 선택이 한 페이지 단위라서).

**11-0. 데이터 설계 (core/annotations/)**
- [ ] `doc_id` 결정: 파일 내용 해시(SHA-256 앞 16자리). 파일명·경로가 바뀌어도 같은 PDF면 같은 메모. 해시는 PyMuPDF 작업이 아니라서 `QThread` 에서 계산(UI 멈춤 방지, 렌더 워커까지 갈 필요 없음). 첫 열기 때 1회, 이후 `settings` 에 `경로→doc_id` 캐시(파일 크기·수정시각이 같을 때만 재사용)
- [ ] `store.py`: `AnnotationStore` (순수 파이썬)
  - 파일 1개 = 문서 1개: `notes/<doc_id>.json`
  - 스키마 `{"v":1, "doc_id", "source_path"(마지막 본 경로, 참고용), "title", "highlights":[], "notes":[], "bookmarks":[], "doc_note":"", "chat":[]}`
  - `Highlight {id, page, quads:[[x0,y0,x1,y1],…], text, color_key("yellow"|"green"|"blue"|"pink"), comment, created, updated}` — 좌표는 기존 단어·검색 좌표와 같은 **`page.rect` 좌표**(페이지 자체 /Rotate 적용, 앱 회전·줌 미적용)
  - `Note {id, page, text, created, updated, source: "user"|"ai", anchor_highlight_id?}` — 페이지 메모. AI 답변 저장 시 `source="ai"`
  - `Bookmark {id, page, label, created}`
  - `doc_note`: 문서 전체 마크다운 노트 1개
  - `chat`: Phase 10 대화 기록 `[{role, text, scope, page, created}]` (문서별)
  - 저장은 **디바운스(500ms) + 원자적 쓰기**(임시 파일 → rename). 손상 방지
  - 로드 실패(깨진 JSON) → `.bak` 로 옮기고 빈 상태로 시작 + 상태바 경고
- [ ] `export.py`: 마크다운 내보내기 (아래 11-5)
- [ ] `store.py` 는 Qt 모름. 시그널은 `annotation_state.py` 가 담당

**11-1. 상태 (annotation_state.py)**
- [ ] 문서(탭)별 `AnnotationStore` 보유. `viewer_state.document_changed` 받아 로드/교체
- [ ] 메서드: `add_highlight(page, quads, text, color_key)`, `set_highlight_comment(id, text)`, `set_highlight_color(id, color_key)`, `remove_highlight(id)`, `add_note(page, text, source)`, `update_note`, `remove_note`, `toggle_bookmark(page)`, `set_doc_note(text)`, `save_chat(messages)`, `load_chat()`
- [ ] 시그널: `highlights_changed(page)`, `notes_changed`, `bookmarks_changed`, `doc_note_changed`, `saved`, `load_failed(message)`
- [ ] 하이라이트 좌표는 `page.rect` 좌표로 저장. 화면 좌표 변환은 `page_view` 가 검색 하이라이트와 같은 기존 경로(`_page_transform`)로 처리 (저장 데이터가 줌·회전·보기 모드에 독립적이어야 함)
- [ ] Undo/Redo: `QUndoStack` 으로 추가·삭제·수정 되돌리기
- [ ] `models/`: `highlight_model.py`, `note_model.py`, `bookmark_model.py` — 사이드바 목록용 `QAbstractListModel`. 정렬은 페이지 순

**11-2. 화면 — 문서 영역 (widgets/page_view.py 확장)**
- [ ] 하이라이트 오버레이 렌더: 해당 페이지 `quads` 를 반투명 색으로. 색은 새 토큰 `color.hl_yellow`·`hl_green`·`hl_blue`·`hl_pink` (기존 `selection`·`search_hit` 와 구분되게)
- [ ] 텍스트 선택 팝오버 **새로 추가** (지금은 없음): 복사 / AI에게 질문 / **색 4개 점** / **메모** → 색 클릭 시 즉시 하이라이트, 메모 클릭 시 하이라이트 + 코멘트 입력 팝업
- [ ] 하이라이트 클릭 → 작은 팝오버: 색 변경, 코멘트 편집, AI에게 질문(이 구간 컨텍스트), 삭제
- [ ] 하이라이트 hover 시 코멘트 툴팁
- [ ] 페이지 모서리 북마크 리본 표시(북마크된 페이지). 클릭으로 토글
- [ ] 페이지 우클릭 메뉴(Phase 10 에서 만든 것)에 "이 페이지에 메모", "북마크 토글" 추가
- [ ] 코멘트 입력은 인라인 팝업(`QTextEdit`, Ctrl+Enter 저장, Esc 취소). 색·간격은 토큰

**11-3. 화면 — 사이드바 "메모" 탭 (widgets/sidebar.py 확장 + notes_delegate.py)**
- [ ] 기존 썸네일/목차/검색 옆에 **메모** 탭 추가 (아이콘 `icons.icon("note")`)
- [ ] 상단 필터 칩: 전체 / 하이라이트 / 메모 / 북마크 / AI 저장
- [ ] 목록: 페이지 순. 항목 = 색 띠 + 인용 텍스트(2줄 말줄임) + 코멘트 + "p.N". 클릭 → 해당 위치로 이동 + 하이라이트 깜빡임
- [ ] 항목 우클릭: 편집, 색 변경, 삭제, "AI에게 질문"
- [ ] 하단: 문서 노트 열기 버튼, 내보내기 버튼, 항목 개수
- [ ] **문서 노트** 는 사이드바 안 접이식 `QPlainTextEdit`(마크다운 원문 편집, 미리보기 없음 — 1차). 자동 저장

**11-4. AI 연동 (Phase 10 과 연결)**
- [ ] AI 말풍선에 **"메모로 저장"** 버튼 → `annotation_state.add_note(page=질문 당시 페이지, text=답변, source="ai")`. 선택 영역 컨텍스트였다면 `anchor_highlight_id` 로 해당 하이라이트에 연결(없으면 하이라이트 자동 생성)
- [ ] 대화 기록 저장: `chat_state` 가 메시지 추가될 때마다 `annotation_state.save_chat`. 문서 다시 열면 복원. "대화 초기화"는 저장본도 지움(확인 다이얼로그)
- [ ] 하이라이트 팝오버·메모 목록의 "AI에게 질문" → `chat_state.ask_about_selection(하이라이트 text)`
- [ ] 빠른 질문에 **"내 하이라이트 전체 요약"** 추가: 이 문서의 모든 하이라이트 텍스트를 컨텍스트로(글자 수 상한 적용)
- [ ] 위젯 간 직접 참조 금지 유지: `chat_panel` ↔ `annotation_state`, `page_view` ↔ `annotation_state` 모두 상태 객체 경유

**11-5. 내보내기 (core/annotations/export.py)**
- [ ] 마크다운: `# <문서 제목>` → `## 문서 노트` → `## 북마크` → `## 하이라이트·메모`(페이지별 `### p.N`, 인용 블록 `> 텍스트` + 코멘트, AI 메모는 `**AI**` 표시) → `## AI 대화`(선택)
- [ ] 내보내기 다이얼로그: 포함 항목 체크(하이라이트/메모/북마크/문서 노트/AI 대화), 색별 필터, 저장 위치 선택. 기본 파일명 `<PDF이름>_notes.md`
- [ ] 클립보드로 복사 옵션 (바로 정리본에 붙여넣기용)
- [ ] (후순위) JSON 원본 내보내기/가져오기 — 다른 PC로 옮길 때

**11-6. 단축키·설정·테스트**
- [ ] `shortcuts.py` (지금 있는 키와 겹치지 않게 정함 — `Ctrl+D` 는 문서 속성이라 북마크에 안 씀):
  - `H` 선택 영역 하이라이트(기본색), `M` 페이지 메모, `B` 북마크 토글 — 회전 `R` 처럼 한 글자 키로 통일
  - `Ctrl+Shift+N` 메모 탭, `Ctrl+E` 내보내기
  - `Ctrl+Z` 실행취소, `Ctrl+Shift+Z`·`Ctrl+Y` 다시실행
- [ ] `settings.py`: 기본 하이라이트 색, 메모 탭 필터 상태, 마지막 내보내기 위치, 대화 기록 저장 여부(끄기 가능)
- [ ] 상태바: 저장 상태 표시("저장됨" / "저장 중…" / "저장 실패")
- [ ] `tests/`: `store.py` 저장·로드·스키마 마이그레이션(v1→v2 자리), 원자적 쓰기, 깨진 파일 복구, `doc_id` 해시 일관성, 좌표 변환 왕복(`page.rect`↔화면, 회전 포함), 마크다운 export 스냅샷, Undo/Redo
- [ ] README·단축키 안내에 메모 기능과 `notes/` 폴더 위치 추가

**데이터 안전 메모**
- `notes/` 폴더는 사용자가 백업하기 쉽게 README 에 위치 명시
- 저장 실패 시 데이터 손실 없게: 메모리 상태 유지 + 상태바 경고 + 재시도
- PDF 내용이 바뀌면(같은 이름 다른 파일) `doc_id` 가 달라져 메모가 안 보임 → 상태바에 "이 파일에 메모 없음. 비슷한 이름의 메모 N개 있음" 안내 + 수동 연결 메뉴(후순위)

**완료 조건**
1. 텍스트 드래그 → 팝오버에서 색 클릭 → 즉시 하이라이트. 뷰어 껐다 켜도, PDF 파일을 다른 폴더로 옮겨도 유지
2. 줌·회전·보기 모드 바꿔도 하이라이트 위치 정확
3. 하이라이트에 코멘트 달고 메모 탭에서 클릭 → 해당 위치로 이동
4. AI 답변 "메모로 저장" → 메모 탭에 AI 표시로 나타남. 대화 기록이 재시작 후 복원됨
5. Ctrl+Z 로 하이라이트 삭제 되돌리기 동작
6. 내보내기 → 마크다운 파일 열어서 페이지 순으로 정리되어 있음
7. 원본 PDF 의 해시·수정시각이 변하지 않음 (`sha256sum` 전후 비교)
8. `grep -rn "json\|open(" app/widgets/` 에서 메모 파일 직접 읽는 코드 없음 (전부 `store.py` 경유)

---

## 3. 성능 체크리스트 (렉 방지)
- UI 스레드에서 `page.get_pixmap()` 호출 금지 → 반드시 `renderer.py` 경유
- 스크롤 중 렌더 요청은 디바운스(50~100ms)
- 썸네일은 별도 저해상도 캐시, 본문 캐시와 분리
- 줌 연속 변경(휠) 중엔 기존 이미지 스케일만 하고, 멈춘 뒤 고해상도 렌더
- 탭마다 `Document` 인스턴스, 비활성 탭 캐시는 축소
- 메모리 사용량을 상태바에 표시하는 디버그 옵션(개발 중만)

## 4. 수용 기준 (최종)
- 1,000페이지 텍스트 PDF: 열기 1초 이내, 페이지 이동 체감 지연 없음
- 고해상도 스캔 PDF: 스크롤 중 UI 프리즈 0회
- 모든 기능 마우스·키보드 양쪽으로 도달 가능
- 테마 전환 시 재시작 불필요
- 색·폰트 변경은 `styles/` 수정만으로 가능 (파이썬 코드 무수정)

---

## 5. CLAUDE.md 초안 (프로젝트 루트에 저장)

> 처음 계획한 초안이다. 지금 규칙은 `CLAUDE.md`가 기준이며, 다른 점: 렌더는 스레드 풀이 아니라 워커 프로세스 풀, PLAN 체크박스와 커밋은 사용자가 요청할 때만, 개발은 WSL `.venv`.

```markdown
# PDF Viewer — 프로젝트 규칙

## 스택
PySide6 + PyMuPDF. Python 3.11+. 테스트는 pytest-qt.

## 아키텍처 규칙 (디자인은 나중에 교체된다 — 반드시 지킬 것)
- app/core/ 는 Qt 위젯(QtWidgets)을 import 하지 않는다. QtCore 시그널만 허용.
- 상태(현재 페이지, 줌, 보기 모드, 검색 결과 등)는 app/viewer_state.py 만 소유한다.
  위젯은 상태를 멤버 변수로 들고 있지 않는다.
- 위젯 → 로직: viewer_state 의 메서드 호출로만. 로직 → 위젯: viewer_state 의 시그널로만.
- 위젯끼리 직접 참조 금지. (toolbar 가 page_view 를 import 하거나 호출하지 않는다.)
- 목록(썸네일·목차·검색결과)은 app/models/ 의 Qt 모델 + 위젯 측 delegate 로 분리.
- PDF 렌더는 core/renderer.py 의 스레드 풀에서만 수행. UI 스레드에서 get_pixmap 금지.
- 색·폰트·크기·간격·반지름 하드코딩 금지 → styles/tokens.json + QSS 에서만.
  코드에서 수치가 필요하면 theme.token("...") 로 조회.
- 아이콘은 icons.icon("name") 으로만 참조. 경로 직접 사용 금지.
- 새 단축키는 app/shortcuts.py 표에만 추가하고 viewer_state 메서드에 매핑.
- `import fitz` 대신 `import pymupdf` 사용.
- 새 기능은 PLAN.md 의 해당 Phase 체크박스를 완료 처리하고 커밋.

## 위젯을 새로 만들 때 체크
1. 이 위젯이 들고 있는 self.xxx 중 "상태"가 있나? → viewer_state 로 옮긴다.
2. 다른 위젯을 import 하고 있나? → viewer_state 시그널로 바꾼다.
3. 숫자나 색이 코드에 있나? → tokens.json 으로 옮긴다.

## 실행
python main.py [file.pdf]
pytest -q

## 커밋 규칙
Phase 단위 또는 기능 단위로 작게 커밋. 메시지는 한국어 가능.
```

---

## 6. Claude Code 진행 방식 (추천)
1. 빈 폴더에서 `PLAN.md`, `CLAUDE.md` 생성 후 git init.
2. `Phase 1 진행해줘. 완료되면 실행 방법 알려줘.` → 직접 실행해 확인 → 커밋.
3. 문제 있으면 증상(어느 동작에서 느린지, 에러 메시지)을 그대로 붙여서 수정 요청.
4. Phase 7(디자인)에 들어가기 전에 원하는 분위기(다크/라이트, 참고 앱, 포인트 색)를 정리해 전달.
5. 각 Phase 끝에 `PLAN.md 체크박스 업데이트하고 커밋해줘`.
