---
type: Reference
title: Club Building football management game
description: Where the 축구구단 키우기 browser game's rules, work log, code layers, tests and balance tools live, and how to run them.
---

# Club Building football management game

A browser football club management sim in plain HTML/CSS/JS (ES modules, no build step), Korean UI. The player is the club's general manager; an AI manager runs matches and tactics.

| Document | What it holds |
|---|---|
| [README.md](../Club%20building/README.md) | Project summary for submission: purpose, run and usage guide per tab, process, practices, difficulties, limits, five key source files (§8) |
| [DIARY.md](../Club%20building/DIARY.md) | Part 1: current game rules and design decisions (update when rules change). Part 2: dated work log (`### YYYY-MM-DD`) |

## Running

From `Club building/` (quote the space in the path) ([README.md](../Club%20building/README.md), §2):

```bash
python3 tools/serve.py 8010        # then open http://localhost:8010
node --test tests/*.test.js        # Node 22 via nvm
```

Use `tools/serve.py`, not `npm run serve`: [package.json](../Club%20building/package.json)'s `serve` script runs plain `http.server` on 8000, which sends no no-cache headers (stale JS modules) and has no press-AI proxy ([tools/serve.py](../Club%20building/tools/serve.py), header comment).

Press-tab AI is optional: `.env` in `Club building/` with `OPENROUTER_API_KEY` and `OPENROUTER_MODEL` ([.env.example](../Club%20building/.env.example)). `serve.py` sends the request so the key never reaches the browser. This `.env` is separate from the lab-root one.

## Where things are

- **Entry point:** `js/core/game.js` (`createNewGame`, `advance`, `startNextSeason`). UI and tests call only these; `tests/layers.test.js` enforces the split between rules (`js/core/`) and screens (`js/ui/`).
- **Rules:** `js/core/` (finance, transfers, contracts, training, fans, sponsors, …), match engine in `js/core/match/`, seeded RNG in `rng.js`.
- **Data:** `js/data/` (countries and league rules, economy numbers, formations, positions).
- **Save:** `js/save/storage.js` (IndexedDB + JSON export). Bump `STATE_VERSION` when the state shape changes; small changes are fixed in `upgradeState` ([DIARY.md](../Club%20building/DIARY.md), 기본 방향).
- **Press AI client:** `js/api/press.js`.
- **Balance tools:** `tools/` (`balance.js`, `season.js`, `finance.js`, `longrun.js`, `inflation.js`, `deficit.js`, `invariants.js`, `edge-case.js`), run with `node tools/<name>.js`.
- **Evidence screenshots:** `docs/evidence/`.

## Rules worth remembering

- Game rules belong in core, not in UI code.
- Balance numbers are decided by measuring with the tools before and after a change ([README.md](../Club%20building/README.md), §3).
- New work is logged in DIARY.md part 2; rule changes also update part 1.
