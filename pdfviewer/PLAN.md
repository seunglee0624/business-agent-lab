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
│  │  └─ settings.py        # QSettings 래퍼
│  ├─ viewer_state.py       # ── ViewModel: 현재 페이지·줌·보기 모드·검색 결과 등 "상태"의 유일한 소유자.
│  │                        #    위젯은 여기의 메서드만 호출하고, 여기의 시그널만 구독한다.
│  ├─ models/               # ── Qt Model/View 데이터 모델 (그리는 방식과 분리)
│  │  ├─ thumbnail_model.py # QAbstractListModel
│  │  ├─ outline_model.py   # QAbstractItemModel (목차 트리)
│  │  └─ search_result_model.py
│  ├─ widgets/              # ── View: 그리기와 입력 전달만. 상태 소유 금지
│  │  ├─ toolbar.py         # 상단 툴바
│  │  ├─ page_view.py       # 중앙 문서 영역 (QGraphicsView 기반, 연속/단일/펼침)
│  │  ├─ sidebar.py         # 썸네일 / 목차 / 검색 결과 탭
│  │  ├─ thumbnail_delegate.py
│  │  ├─ search_bar.py      # 검색 바
│  │  ├─ status_bar.py      # 하단 상태바
│  │  ├─ empty_state.py     # 파일 없을 때 화면
│  │  └─ tab_bar.py         # 다중 파일 탭
│  ├─ dialogs/
│  │  ├─ password_dialog.py
│  │  └─ properties_dialog.py
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
