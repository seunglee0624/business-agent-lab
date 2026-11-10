# PDF Viewer

PySide6 + PyMuPDF로 만든 Windows용 PDF 뷰어(읽기 전용). 다크 테마, 탭, 검색, 썸네일·목차 사이드바, 단일·연속·펼침 보기, 발표 모드.

## 개발 (WSL)

`pdfviewer/` 폴더에서:

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt   # 처음 한 번
.venv/bin/python main.py [파일.pdf ...]                               # 실행 (파일마다 탭 하나)
.venv/bin/pytest -q                                                   # 테스트
```

파일 끌어다 놓기는 WSLg에서 동작하지 않는다. Windows 빌드에서 확인한다.

### WSL에서 겪은 문제 (2026-11-09, Ubuntu 26.04 + WSLg)

**AI 채팅 키.** 키는 코드·git 에 넣지 않고 `~/.anthropic_key` 한 파일에 둔다. 앱은 켜질 때 한 번만 읽으므로 같은 터미널에서 불러온 뒤 실행한다.

```bash
nano ~/.anthropic_key            # export ANTHROPIC_API_KEY=sk-ant-...  한 줄
chmod 600 ~/.anthropic_key
source ~/.anthropic_key && .venv/bin/python main.py 파일.pdf
```

- 패널에 "ANTHROPIC_API_KEY…" 안내가 뜨면 그 터미널에서 `source` 를 안 한 것이다.
- 경로는 Windows `C:\…` 가 아니라 `/mnt/c/…`, 띄어쓰기가 있으면 따옴표로 감싼다. 실행은 `pdfviewer/` 폴더에서.

**한글 입력.** WSL 앱에는 Windows 한글 입력기가 전달되지 않는다. ibus 를 설치하고, 실행하는 터미널마다 환경변수를 넣는다.

```bash
sudo apt install -y ibus ibus-hangul      # 처음 한 번
export QT_IM_MODULE=ibus XMODIFIERS=@im=ibus GTK_IM_MODULE=ibus
ibus-daemon -drx && ibus engine hangul    # setxkbmap 경고는 무시해도 된다
```

- 앱 안에서 **Shift+Space** 로 한/영 전환 (Windows 한/영 키는 앱까지 오지 않는다. 엔진이 영문 모드로 시작한다).
- 새 터미널에서 `export` 를 빠뜨리면 다시 한글이 안 된다.
- 조합 중 Enter(마지막 글자 빠짐·두 번 전송)는 확인 결과 문제없음.

**목록·메뉴가 닫히지 않음.** 기본(Wayland) 방식으로 켜면 배율 목록 같은 팝업이 항목을 골라도 닫히지 않는다. 시도한 것:

| 실행 방식 | 커서 | 목록 닫힘 |
|---|---|---|
| 기본 (Wayland) | 보임 | 안 닫힘 |
| 한글 설정(ibus) 뺌 | 보임 | 안 닫힘 |
| `QT_WAYLAND_SHELL_INTEGRATION=wl-shell` | 보임 | 안 닫힘 |
| `QT_QPA_PLATFORM=xcb` (X11, 아래 라이브러리 필요) | **안 보임** (`XCURSOR_THEME=Adwaita` 도 효과 없음) | 확인 못 함 |

```bash
sudo apt install -y libxcb-cursor0 libxkbcommon-x11-0 libxcb-icccm4 libxcb-image0 libxcb-keysyms1 libxcb-render-util0 libxcb-shape0 libxcb-xkb1
```

- 그래서 AI 채팅의 범위 고르기는 목록 대신 버튼 세 개로 바꿨다(팝업이 없어 어디서나 동작).
- 코드 문제가 아니다: Phase 9 커밋(`47d1656`)을 그대로 실행해도 똑같이 안 닫힌다. WSLg 환경 문제.
- 목록·메뉴·우클릭 메뉴 동작은 Windows 빌드에서 확인한다.

## Windows 빌드

Windows에 Python 3이 설치돼 있어야 한다(`py` 런처). WSL에서:

```bash
./build_win.sh
```

소스를 `C:\Users\<사용자>\pdfviewer-build\`로 복사하고, 그 안에 Windows용 가상환경을 만들어(처음 한 번) PyInstaller로 빌드한다.
결과는 `C:\Users\<사용자>\pdfviewer-build\dist\PDFViewer\PDFViewer.exe`. `PDFViewer` 폴더 통째로 실행 파일이다(폴더 안의 `_internal`을 지우면 안 된다).
빌드 설정은 `pdfviewer.spec`, 앱 아이콘은 `assets/app_icon.svg`.

## PDF 더블클릭으로 열기 (연결 프로그램)

1. 탐색기에서 PDF 파일을 마우스 오른쪽 클릭 → **연결 프로그램** → **다른 앱 선택**
2. 목록 아래 **PC에서 앱 선택** → `PDFViewer.exe` 선택
3. **항상**을 누른다

다시 빌드해도 경로가 같으므로 등록은 그대로 유지된다. 되돌리려면 **설정 → 앱 → 기본 앱**에서 `.pdf`의 기본 앱을 바꾼다.

## 단축키

앱 안에서 `?` 또는 `F1`(도움말 → 단축키 목록)로도 볼 수 있다. 아래는 기본값이고, 단축키 목록에서 키 칸을 누르고 새 키를 누르면 바로 바뀐다(Esc는 입력 취소, × 지우기, "기본값으로", "전체 초기화"). 다른 기능과 겹친 키는 빨간색으로 표시되고, 겹친 동안은 두 기능 모두 그 키로 동작하지 않는다. Esc·Ctrl+C·메뉴 키(Alt+F 등)는 바꿀 수 없다. 기본값 정의는 `app/shortcuts.py`.

| 동작 | 키 |
|------|-----|
| 열기 / 탭 닫기 / 종료 | Ctrl+O / Ctrl+W / Ctrl+Q |
| 문서 속성 | Ctrl+D |
| 복사 / 찾기 | Ctrl+C / Ctrl+F |
| 선택한 글자 하이라이트 | H |
| 실행 취소 / 다시 실행 (하이라이트) | Ctrl+Z / Ctrl+Shift+Z (Ctrl+Y) |
| 이전·다음 페이지 | ← / → |
| 첫·마지막 페이지 | Home / End |
| 한 화면 위·아래 | PgUp / PgDn |
| 확대 / 축소 / 실제 크기 | Ctrl++ (Ctrl+=) / Ctrl+- / Ctrl+0 |
| 마우스 위치 기준 확대·축소 | Ctrl+휠 |
| 오른쪽으로 회전 | R |
| 사이드바 | F4 |
| 전체 화면 / 발표 모드 | F11 / F5 |
| 찾기 닫기·전체 화면 끝내기 | Esc |
| 다음·이전 탭 | Ctrl+Tab (Ctrl+PgDn) / Ctrl+Shift+Tab (Ctrl+PgUp) |
| 단축키 목록 | ? / F1 |
| 메뉴 열기 (파일·편집·보기·도움말) | Alt+F / Alt+E / Alt+V / Alt+H |

첫 화면의 최근 문서는 줄에 마우스를 올리면 나오는 ×로 목록에서 지운다(파일은 지워지지 않는다). 키보드로는 Tab으로 목록에 들어가 Delete.

## AI 채팅

오른쪽 패널(Ctrl+Shift+L)에서 지금 페이지·선택한 부분·문서 전체에 대해 묻는다. 답변의 `p.N` 을 누르면 그 페이지로 간다.
패널 위 톱니바퀴(또는 오류 카드의 "AI 설정 열기")에서 백엔드·키·모델을 바꾼다. 저장하면 다음 질문부터 바로 적용된다(재시작 필요 없음).

- **Anthropic**: 키 칸을 비워 두면 환경변수 `ANTHROPIC_API_KEY` 를 쓴다. 생각 정도는 낮음이 기본.
- **OpenAI 호환**: 주소·키·모델을 넣는다. 버튼으로 주소를 채울 수 있다(값은 각 제공자 문서로 다시 확인).

| 제공자 | 주소(base_url) | 키 |
|---|---|---|
| Gemini | `https://generativelanguage.googleapis.com/v1beta/openai` | Google AI Studio 에서 무료 발급 |
| Groq | `https://api.groq.com/openai/v1` | 필요 |
| OpenRouter | `https://openrouter.ai/api/v1` | 필요 |
| Ollama (내 PC) | `http://localhost:11434/v1` | 비워 둠 |

모델 이름은 제공자 문서의 이름을 그대로 쓴다. "연결 테스트" 로 저장 전에 확인한다. OpenAI 호환 쪽은 프롬프트 캐싱·토큰 표시가 제공자마다 다르다.

## 하이라이트

글자를 드래그하면 바로 아래에 막대가 뜬다: 복사 · AI에게 질문 · 색 4개 · 메모. 색을 누르면 하이라이트, "메모"는 하이라이트하고 코멘트 칸을 연다(Ctrl+Enter 저장, Esc 취소).
하이라이트를 누르면 색 바꾸기 · 코멘트 · AI에게 질문 · 삭제. 코멘트는 하이라이트에 마우스를 올리면 보인다. 마지막으로 고른 색이 `H` 의 색이 된다.

PDF 파일은 고치지 않는다. 하이라이트는 문서마다 따로 저장되고, 파일 **내용** 으로 찾으므로 PDF 를 옮기거나 이름을 바꿔도 그대로 나온다(내용이 바뀐 PDF 는 다른 문서로 본다).

- 저장 위치: Windows `%APPDATA%\pdfviewer\pdfviewer\notes\`, WSL `~/.local/share/pdfviewer/pdfviewer/notes/`. 백업은 이 폴더를 복사하면 된다.
- 깨진 메모 파일은 `.json.bak` 으로 옮겨 두고 새로 시작한다(상태바에 안내).

## 설정과 로그

- 설정(창 크기, 최근 파일, 파일별 페이지·확대, 바꾼 단축키, AI 설정): Windows 레지스트리 `HKCU\Software\pdfviewer\pdfviewer`. AI 설정 창에 넣은 API 키도 여기에 **암호화 없이** 저장된다(개인 PC 용).
- 로그: `%APPDATA%\pdfviewer\pdfviewer\pdfviewer.log` (1MB씩 최대 3개). 오류가 나면 이 파일을 확인한다.

## 진행 상황 (2026-11-10 기준)

| Phase | 내용 | 상태 |
|---|---|---|
| 1–4 | 렌더링, 페이지 이동, 보기 모드, 사이드바 | 완료 (`1bfe703`) |
| 5–7 | 검색, 탭, 설정, 다크 테마 | 완료 (`b70db02`) |
| 8 | 단축키, 툴팁, 오류 안내, 로그 | 완료 (`48ed21c`) |
| 9 | Windows exe, 앱 아이콘 | 완료 (`4466705`, 화면 다듬기 `0bf6d0f`) |
| 9.5 | 단축키 직접 지정 | 완료 (`78e008c`) |
| 10a | AI 채팅 패널 (Anthropic, 스트리밍) | 완료 (`5a595dc`) |
| 10b | 질문 범위 버튼, 문서 전체 질문(캐시), 빠른 질문 편집, 답변 속 p.N 링크 | 완료 (`0224bbb`) |
| 10c | AI 설정 창, OpenAI 호환 백엔드(Gemini 등), 연결 테스트 | 완료 (`c1fa852`), Gemini 로 실제 확인 |
| 11a | 하이라이트 저장·복원, 드래그 후 막대, 코멘트, 실행 취소 | 완료, WSL 창에서 실제 확인 |
| 11b | 페이지 메모·북마크·사이드바 메모 탭·문서 노트·저장 상태 표시 | 다음 |
| 11c | AI 답변 메모로 저장, 대화 기록 저장, 마크다운 내보내기 | 예정 |

PLAN.md 체크박스는 Phase 9 까지 표시돼 있다(9.5 이후는 아직).

### Phase 11a 변경사항
- 새 파일
  - `app/core/annotations/store.py`: 문서별 메모 JSON. 내용 해시로 문서를 찾고, 임시 파일 → 바꿔치기로 저장한다. 깨진 파일은 `.bak` 으로 옮기고, 새 버전 파일은 덮어쓰지 않는다.
  - `app/annotation_state.py`: 메모 상태 담당. 내용 해시는 백그라운드에서 계산하고, 문서별 되돌리기 기록을 따로 둔다. 0.5초 모아서 저장한다.
- 바뀐 파일
  - `page_view.py`: 하이라이트 그리기, 하이라이트 클릭, 드래그 후 막대(창 안 위젯), 코멘트 칸·툴팁.
  - `main_window.py`, `shortcuts.py`: 하이라이트(H)·실행 취소·다시 실행 메뉴와 단축키, 종료 때 저장, 상태바 경고.
  - `settings.py`: 파일별 내용 해시 캐시, 마지막 하이라이트 색.
  - `tokens.json`, `base.qss`: 하이라이트 색 4개·투명도, 막대 스타일.
- 코드 리뷰 뒤 고친 것 (2026-11-10)
  - 코멘트 작성 상태를 `annotation_state` 로 옮겼다. 탭을 바꾸거나 하이라이트가 화면 밖으로 나가면 쓰던 코멘트를 저장하고 창을 닫는다. 쓰는 중에는 다른 하이라이트를 클릭해도 대상이 바뀌지 않는다.
  - 막대 버튼 사이 클릭이 페이지 클릭으로 새지 않는다.
  - PDF·메모 파일을 못 읽으면 상태바에 알린다. 모양이 틀린 메모 파일도 `.bak` 으로 옮긴다.
  - 디스크에서 바뀐 파일은 다시 해시하고, 닫은 탭의 메모는 저장 후 메모리에서 내린다.
  - 되돌리기는 수정 시각도 되돌린다. 스크롤 때 막대는 위치만 옮긴다.
- 테스트: `tests/test_notes.py` 29개 (전체 175개 통과). 테스트는 메모를 임시 폴더에 쓴다.

### 남은 일
- 11b → 11c 를 진행한다.
- 그다음 exe 빌드, 그리고 9.5~11 화면을 한꺼번에 다듬는다(사용자 결정).
- 확인 필요: 코멘트 툴팁이 WSLg 에서 잘 닫히는지.

## 구조

설계와 진행 상황은 [PLAN.md](PLAN.md), 코드 규칙은 [CLAUDE.md](CLAUDE.md), 작업 방식은 [WORKFLOW.md](WORKFLOW.md).
