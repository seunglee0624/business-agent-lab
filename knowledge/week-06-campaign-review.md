---
type: Reference
title: Week 06 campaign-review skill
description: Where the weekly campaign review method, prompts, skill and reports live, and which exercise steps have saved outputs.
---

# Week 06 campaign-review skill

Week 06 turns a written review method into a Claude Code skill. It needs no API key; the calculation script step needs Python 3 ([week-06/README.md](../week-06/README.md)). The exercise steps are in that README; the exact prompts are in [week-06/prompts.md](../week-06/prompts.md).

## Files

| File | Role |
|---|---|
| [analysis-method.md](../week-06/analysis-method.md) | The method: compare two weeks, data checks, four measures, three-section report, no budget advice |
| [prompts.md](../week-06/prompts.md) | Five prompts, run in order from the lab root |
| `week-06/data/history.csv` | Synthetic campaign data, one row per campaign per week ([README](../week-06/README.md)) |
| `week-06/reports/` | Reports Claude Code writes, named by the second week's date |
| [.claude/skills/campaign-review/SKILL.md](../.claude/skills/campaign-review/SKILL.md) | The saved skill built from the method |

## Rules worth remembering

- Four measures: CTR, conversion rate, cost per purchase, ROAS. Formulas are in [analysis-method.md](../week-06/analysis-method.md); don't redefine them elsewhere.
- Compare the two weeks the user names, else the two latest; leave other weeks out.
- Report data problems; never edit the data file.
- "A skill does not make the result correct": check reports against a hand calculation ([week-06/README.md](../week-06/README.md)).

## State (2026-11-05)

Saved outputs present: the first report [reports/2026-10-05.md](../week-06/reports/2026-10-05.md) (prompt 1) and the skill's `SKILL.md` (prompt 2). Not present: `.claude/skills/campaign-review/scripts/analyze_campaigns.py` (prompt 3) and the fresh-session reports `2026-10-19.md` and `2026-10-19-auto.md` (prompts 4 and 5). `SKILL.md` currently tells the agent to write its own short Python script for the measures instead of pointing to a saved one.
