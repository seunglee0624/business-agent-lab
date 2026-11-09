---
type: Reference
title: Week 05 tool-calling assistant
description: Where the week 05 programs and tools live, how to run them, and how a tool is added.
---

# Week 05 tool-calling assistant

Setup, run commands, the exercise and troubleshooting are in [week-05/README.md](../week-05/README.md). Commands below are as documented there; they were not run when this page was written.

## Programs

Run from the lab root with the root `.venv` active ([lab-layout.md](lab-layout.md)):

| Command | What it does |
|---|---|
| `python week-05/01_model_request.py` | One raw request, written out in full ([01_model_request.py](../week-05/01_model_request.py)) |
| `python week-05/02_calculator_call.py` | The model requests one calculator call; press Enter to run it ([02_calculator_call.py](../week-05/02_calculator_call.py)) |
| `python week-05/03_assistant.py` | Interactive assistant with all tools; type `exit` or `quit` to stop ([03_assistant.py](../week-05/03_assistant.py)) |

All three need `OPENROUTER_API_KEY` and call the API; free models allow a limited number of requests per day ([week-05/README.md](../week-05/README.md)).

## Where things are defined

- **Model requests:** `request_model()` in [model_api.py](../week-05/model_api.py). It sets the endpoint, the default model (`DEFAULT_MODEL`, overridable with `OPENROUTER_MODEL` in `.env`), and up to three tries on HTTP 429.
- **Tools:** each tool is a definition dict (such as `CALCULATOR`) plus a function (such as `calculator`) in [tools.py](../week-05/tools.py). Current tools: `calculator`, `read_schedule`, `search_wikipedia`, `save_note`, `convert_currency`, `get_stock_price`.
- **Registration:** `TOOLS` (definitions sent to the model) and `FUNCTIONS` (name → function the program may run) in [03_assistant.py](../week-05/03_assistant.py). `MAX_ROUNDS = 5` caps tool rounds per message; `SYSTEM_PROMPT` sets the assistant's rules.
- **Files tools touch:** `read_schedule` reads `week-05/data/schedule.json`; `save_note` writes to `week-05/notes/` and never overwrites ([tools.py](../week-05/tools.py)).

## Adding a tool

A new tool needs three parts: the function in `tools.py`, its definition in `tools.py` with a `"name"` matching the function, and entries in both `TOOLS` and `FUNCTIONS` in `03_assistant.py` ([week-05/README.md](../week-05/README.md), "If you finish early").

## State and gaps (2026-11-05)

- The currency exercise is done in code: `convert_currency` and `CONVERT_CURRENCY` exist and are registered. The comment above them in `tools.py` still says "Add two things here".
- `get_stock_price` is an extra tool (Korea Exchange prices via `FinanceDataReader`) that the README does not mention.
- The README says to "install the two packages", but [requirements.txt](../week-05/requirements.txt) lists three: `requests`, `python-dotenv`, `finance-datareader`. The third is needed because `tools.py` imports it at load time.
