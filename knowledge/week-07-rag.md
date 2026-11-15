---
type: Reference
title: Week 07 RAG program and knowledge bundle
description: Where the week 07 retrieval programs and settings live, how the index is checked, and the knowledge-bundle exercise that produced this folder.
---

# Week 07 RAG program and knowledge bundle

Setup, run commands and the exercise are in [week-07/README.md](../week-07/README.md). Commands below are as documented there; they were not run when this page was written.

## Programs

Run from the lab root with the root `.venv` active ([lab-layout.md](lab-layout.md)). The README writes `python3`.

| Command | What it does |
|---|---|
| `python3 week-07/01_build_index.py` | Splits the four files in `week-07/rag-documents/` at headings, embeds them, saves `week-07/.cache/index.json` |
| `python3 week-07/02_ask.py ["question"]` | Ranks passages, prints them, waits for Enter, then asks the chat model |

`02_ask.py` options: `--top-k`, `--min-score`, `--no-context` (ask without documents), `--yes` (skip the Enter pause) ([02_ask.py](../week-07/02_ask.py), `main`).

## Where things are defined

- **Settings:** [settings.py](../week-07/settings.py) holds `CHAT_MODEL`, `EMBEDDING_MODEL`, `TOP_K = 5`, `MIN_SCORE = 0.0` and the default `MAIN_QUESTION`. Command-line options override them.
- **Retrieval:** [retrieval.py](../week-07/retrieval.py): `load_passages`, `build_index`, `read_index`, `cosine`, `rank_passages`, `retrieve`.
- **Stale index check:** `read_index` rejects the index if the embedding model or a passage fingerprint (SHA-256 of the passages) changed. Rerun `01_build_index.py` after editing a document or the embedding model.
- **Model calls:** [model_api.py](../week-07/model_api.py). `load_key` looks for `.env` in each folder above the script, so the lab-root `.env` is found. `require_free` refuses any model ID not ending in `:free` or with a nonzero catalog price; requests also send `max_price` 0.
- **Answer prompt:** `INSTRUCTIONS` and `make_messages` in [02_ask.py](../week-07/02_ask.py).

## Rules worth remembering

- `week-07/rag-documents/` is a fictional company's data for the RAG exercise only. Don't use it as a source about the lab.
- `week-07/.cache/` is ignored by [week-07/.gitignore](../week-07/.gitignore).
- [requirements.txt](../week-07/requirements.txt) has two packages: `requests`, `python-dotenv`.

## Knowledge-bundle exercise

[knowledge-bundle-exercise.md](../week-07/knowledge-bundle-exercise.md) and [knowledge-bundle-prompt.md](../week-07/knowledge-bundle-prompt.md) are how this `knowledge/` folder was first built (week 05 and 06 pages). [okf-reference.md](../week-07/okf-reference.md) summarizes the Open Knowledge Format v0.2 rules these pages follow: root `index.md` with `okf_version`, every topic page with `type` frontmatter, plain relative links to sources.

Pages are kept current by a Stop hook; see [lab-layout.md](lab-layout.md#knowledge-upkeep-hook).
