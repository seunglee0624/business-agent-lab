# REA 설치 방법 정리

REA(Reverse Engineer Anything)는 소스 코드 없이 완성된 프로그램을 들여다보는 분석 도구입니다. Claude Code에는 **MCP 서버**(Claude가 부를 수 있는 도구 묶음)와 **스킬**(사용 설명서) 두 가지로 붙습니다.

- 공식 출처: https://github.com/morluto/rea · https://rea.tools · npm `rea-agents`
- 정리일: 2026-11-05 (설치 버전 6.8.0)

> 표시: **[해봄]** 이 컴퓨터에서 실제로 실행해 확인 · **[문서]** 공식 문서 내용, 직접 해보진 않음

---

## 0. 준비물

| 항목 | 요구 | 이 컴퓨터 |
|---|---|---|
| Node.js | 22.x (22.23.4 이상), 24.x (24.22.1 이상), 또는 26.12.1 이상 | v22.23.4 (nvm) ✅ |
| npm | 있어야 함 | 10.9.9 ✅ |
| `ps` (Linux) | procps 호환 | procps-ng 4.0.4 ✅ |

## 1. 모든 프로젝트에서 쓰기 (이 컴퓨터에 적용한 방식) [해봄]

```bash
cd ~                                          # 프로젝트 폴더 밖에서 실행 (공식 권장)
npm install --global rea-agents               # rea 명령 설치
rea setup --client claude_code --dry-run      # 무엇이 바뀌는지 미리 보기 (아무것도 안 바꿈)
rea setup --client claude_code --yes          # 실제 적용
```

그다음 **Claude Code를 재시작**합니다.

`setup`이 바꾸는 것:
- `~/.claude.json`에 MCP 서버 `rea` 등록 (원래 파일은 `~/.claude.json.rea.backup`으로 백업)
- `~/.claude/skills/reverse-engineer-anything`에 스킬 설치

참고: `--yes` 없이 `rea setup --client claude_code`로 실행하면 대화형으로 하나씩 물어봅니다.

## 2. 특정 프로젝트에서만 쓰기 [해봄]

임시 폴더에서 등록 → 그 폴더에서만 `✔ Connected`, 다른 폴더에선 안 보임 → 삭제까지 확인했습니다. (이미 1번 방식으로 `rea`가 깔려 있어서 테스트는 `rea-localtest`라는 다른 이름으로 했습니다.)

```bash
npm install --global rea-agents
cd <쓰고 싶은 프로젝트 폴더>
claude mcp add --scope local rea -- "$(which node)" "$(npm root -g)/rea-agents/scripts/rea.mjs" mcp
```

- 그 폴더에서만 REA가 보입니다.
- 스킬은 설치되지 않습니다. 필요하면 프로젝트의 `.claude/skills/`에 직접 복사합니다.
- `--scope project`는 쓰지 마세요. `.mcp.json`이 생겨 git에 올라갈 수 있습니다.
- `rea update`로는 갱신되지 않습니다. 새 버전으로 바꾸려면 지우고(`claude mcp remove --scope local rea`) 다시 등록합니다.
- nvm으로 Node 버전을 바꾸면 경로가 달라지므로 다시 등록해야 합니다.

## 3. 설치 확인 [해봄]

```bash
claude mcp list          # "rea: ... ✔ Connected" 가 보이면 성공
```

추가 점검(문제 있을 때): `rea doctor --client claude_code --skill` → `healthy: true`, 스킬 `aligned`면 정상 [해봄]

- doctor 결과에 Ghidra·IDA·JADX·Kuna가 "missing"으로 나오는 건 정상입니다. 선택 사항인 분석 엔진이 없다는 뜻입니다.

## 4. 업데이트 [문서 + 명령 존재 확인]

```bash
rea update               # 업데이트 후 화면에 나오는 setup 명령도 실행
```

REA는 업데이트가 잦으니 가끔 실행하세요.

## 5. 지우기 [문서 + 명령 존재 확인]

`claude mcp get rea`로 등록 범위가 "User config"인 것을 확인했습니다. 그래서 아래처럼 `--scope user`로 지우는 게 맞습니다. 실제로 지워보진 않았습니다.

모든 프로젝트용(1번 방식)을 Claude Code에서만 지우려면:

```bash
claude mcp remove --scope user rea
rm -rf ~/.claude/skills/reverse-engineer-anything
```

`rea uninstall`은 Claude Code 외 다른 에이전트 설정까지 정리하는 더 넓은 명령입니다.

## 6. 쓰는 법

- 설치만으로 REA가 혼자 무언가를 분석하지는 않습니다. Claude가 세션 시작 때 REA 서버에 연결만 해 두고, 분석이 필요한 요청을 받을 때만 도구를 부릅니다.
- 확실히 쓰게 하려면 "REA로 ○○ 분석해줘"라고 요청합니다.
- 특정 세션에서 끄고 싶으면 Claude Code의 `/mcp` 메뉴를 씁니다.

## 7. 추가로 필요할 수 있는 것 (선택)

| 하고 싶은 것 | 필요한 것 | 상태 |
|---|---|---|
| JS·Electron 앱, npm 번들 분석 | 없음 | 바로 가능 [해봄] |
| 웹사이트를 브라우저로 열어 분석 | WSL에 Chromium 실행 부품: `sudo apt install libnspr4 libnss3 libasound2t64` (Ubuntu 26.04 기준 패키지 이름) | 미설치. 이번에 이것 때문에 브라우저 분석 실패. 부족한 파일 5개(`libnspr4`, `libnss3`, `libnssutil3`, `libsmime3`, `libasound`)는 확인함 [해봄]. 설치 후 실행되는지는 미확인 |
| exe·ELF 같은 프로그램 내부 코드 분석 | Ghidra 12.1.x 설치 후 `GHIDRA_INSTALL_DIR` 설정 (또는 Hopper·IDA·Kuna) | 미설치 [문서] |
| Android 앱 코드 분석 | JADX headless MCP JAR + Java, `REA_JADX_MCP_JAR` 설정 | 미설치 [문서] |

## 주의

- 공식 출처(위 링크) 외에 비슷한 이름의 저장소나 패키지는 쓰지 마세요. 공식 README도 같은 경고를 합니다.
- 분석은 오픈소스나 본인 프로그램에만 하세요. 상용 프로그램은 약관에서 리버스 엔지니어링을 금지하는 경우가 많습니다.
