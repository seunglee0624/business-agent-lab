# PDF Viewer

PySide6 + PyMuPDF로 만든 Windows용 PDF 뷰어(읽기 전용). 다크 테마, 탭, 검색, 썸네일·목차 사이드바, 단일·연속·펼침 보기, 발표 모드.

## 개발 (WSL)

`pdfviewer/` 폴더에서:

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt   # 처음 한 번
.venv/bin/python main.py [파일.pdf ...]                               # 실행 (파일마다 탭 하나)
.venv/bin/pytest -q                                                   # 테스트
```

WSLg에서 창이 뜨지만 클릭이 안 먹으면 X11 방식으로 실행한다.

```bash
sudo apt install -y libxcb-cursor0 libxkbcommon-x11-0 libxcb-icccm4 libxcb-image0 libxcb-keysyms1 libxcb-render-util0 libxcb-shape0 libxcb-xkb1
QT_QPA_PLATFORM=xcb .venv/bin/python main.py
```

파일 끌어다 놓기는 WSLg에서 동작하지 않는다. Windows 빌드에서 확인한다.

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

앱 안에서 `?` 또는 `F1`(도움말 → 단축키 목록)로도 볼 수 있다. 정의는 `app/shortcuts.py`.

| 동작 | 키 |
|------|-----|
| 열기 / 탭 닫기 / 종료 | Ctrl+O / Ctrl+W / Ctrl+Q |
| 문서 속성 | Ctrl+D |
| 복사 / 찾기 | Ctrl+C / Ctrl+F |
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

## 설정과 로그

- 설정(창 크기, 최근 파일, 파일별 페이지·확대): Windows 레지스트리 `HKCU\Software\pdfviewer\pdfviewer`
- 로그: `%APPDATA%\pdfviewer\pdfviewer\pdfviewer.log` (1MB씩 최대 3개). 오류가 나면 이 파일을 확인한다.

## 구조

설계와 진행 상황은 [PLAN.md](PLAN.md), 코드 규칙은 [CLAUDE.md](CLAUDE.md), 작업 방식은 [WORKFLOW.md](WORKFLOW.md).
