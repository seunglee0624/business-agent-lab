---
type: Reference
title: PDF viewer
description: Where the PySide6 + PyMuPDF viewer's rules, plan and code live, how to run and test it, and where the docs lag the code.
---

# PDF viewer

A read-only Windows PDF viewer (dark theme, tabs, search, notes, AI chat) built with PySide6 + PyMuPDF. Its own docs are detailed; this page points into them.

| Document | What it holds |
|---|---|
| [pdfviewer/CLAUDE.md](../pdfviewer/CLAUDE.md) | Architecture rules. Read before changing code |
| [pdfviewer/README.md](../pdfviewer/README.md) | Usage, shortcuts, AI chat, notes storage, WSL problems, Windows build, progress table and per-phase change log |
| [pdfviewer/PLAN.md](../pdfviewer/PLAN.md) | The phase plan with checkboxes |
| [pdfviewer/WORKFLOW.md](../pdfviewer/WORKFLOW.md) | How the user runs each phase: plan → try it → feedback → next |

## Running

From `pdfviewer/`, with its own `pdfviewer/.venv` (not the lab-root `.venv`) ([CLAUDE.md](../pdfviewer/CLAUDE.md), 실행):

```bash
.venv/bin/python main.py [file.pdf ...]
.venv/bin/pytest -q
```

Tests run offscreen (`tests/conftest.py`). The Windows `.exe` is built from WSL with `./build_win.sh` into `C:\Users\<user>\pdfviewer-build\dist\PDFViewer\` ([README.md](../pdfviewer/README.md), Windows 빌드). Popups and drag-and-drop don't work in WSLg, so those are checked in the `.exe`.

## Where things are

- **State owners:** `app/viewer_state.py` (page, zoom, view mode, search), `app/annotation_state.py` (highlights, notes, bookmarks), `app/chat_state.py` (chat). Widgets talk to them only through methods and signals.
- **Core (no QtWidgets):** `app/core/`: `document.py`, `renderer.py` + `render_worker.py` (process pool for all heavy PyMuPDF work), `settings.py` (QSettings, keyring for API keys), `annotations/store.py` (sidecar JSON, the only reader/writer of notes files), `llm/` (`LLMBackend` in `base.py`, Anthropic and OpenAI-compatible backends, `worker.py` QThread).
- **Look:** `styles/tokens.json` + `styles/base.qss`, read with `theme.token(...)`; icons via `icons.icon(name)` from `assets/icons/`.
- **Shortcuts:** defaults table in `app/shortcuts.py`; user changes stored by `core/settings.py`.
- **Architecture test:** `tests/test_architecture.py` enforces the layer rules.

## Rules worth remembering

- Never modify the PDF file; notes are sidecar JSON found by content hash ([CLAUDE.md](../pdfviewer/CLAUDE.md)).
- No hard-coded colors or sizes; no `import fitz` (use `pymupdf`).
- API keys only through the in-app AI settings dialog; `ANTHROPIC_API_KEY` is not read ([README.md](../pdfviewer/README.md), AI 채팅).
- PLAN.md checkboxes, commits and pushes only when the user asks ([CLAUDE.md](../pdfviewer/CLAUDE.md), [WORKFLOW.md](../pdfviewer/WORKFLOW.md)). This page is not covered by that rule and is updated with code changes.

## State and gaps (2026-11-14)

- Latest commit on branch `pdfviewer`: `8978a90` (AI model menu, security cleanup, AI answers saved as page notes).
- The README progress table (dated 2026-11-13) still says the model menu, security cleanup and answer-saving change are "커밋 전" (not yet committed), and its 남은 일 list includes committing them. `8978a90` did that.
- PLAN.md checkboxes are ticked only through Phase 9 ([README.md](../pdfviewer/README.md), 진행 상황).
