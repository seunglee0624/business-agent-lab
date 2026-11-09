---
type: Reference
title: Lab layout and conventions
description: How the business-agent-lab folders fit together and the rules every week's material assumes.
---

# Lab layout and conventions

## Structure

| Path | What it is | Source |
|---|---|---|
| `week-05/` | Python programs that call a model through OpenRouter and run tools | [week-05/README.md](../week-05/README.md) |
| `week-06/` | Campaign review method, prompts, synthetic data, reports | [week-06/README.md](../week-06/README.md) |
| `.claude/skills/` | Project skills; `campaign-review` is saved here in week 06 | [week-06/README.md](../week-06/README.md), [SKILL.md](../.claude/skills/campaign-review/SKILL.md) |
| `.env` | API key file at the lab root (never commit, never read it) | [week-05/README.md](../week-05/README.md) |
| `.venv/` | Python environment at the lab root | [week-05/README.md](../week-05/README.md) |

## Conventions

- **Work from the lab root.** Commands and Claude Code sessions start in `business-agent-lab/`, not inside a week folder ([week-05/README.md](../week-05/README.md), [week-06/prompts.md](../week-06/prompts.md)).
- **One `.env` at the root.** Week 05 code loads `.env` from one folder above the script, so it works from any current directory ([week-05/model_api.py](../week-05/model_api.py), `ENV_FILE`). The key name is `OPENROUTER_API_KEY` ([week-05/env.example](../week-05/env.example)). Code never prints the key.
- **Keep secrets and environments out of Git.** The root [.gitignore](../.gitignore) ignores `.env`, `.venv` and `__pycache__/`. Week 05's setup asks you to confirm this with `git check-ignore .env`.
- **Activate the environment in each new terminal:** `source .venv/bin/activate` ([week-05/README.md](../week-05/README.md)).
- **Data files are read-only.** The week 06 method says to report data problems and never edit the data file ([week-06/analysis-method.md](../week-06/analysis-method.md)).
- **Check results yourself.** Both weeks ask the student to check output against a hand calculation: amount × rate in week 05, cost per purchase in week 06 ([week-05/README.md](../week-05/README.md), [week-06/README.md](../week-06/README.md)).

Setup steps are in [week-05/README.md](../week-05/README.md) (Setup section); this page does not repeat them.
