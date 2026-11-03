---
name: campaign-review
description: Weekly ad campaign review that compares two weeks of campaign results (CTR, conversion rate, cost per purchase, ROAS) from a CSV with one row per campaign per week, checks the data for problems, and saves a Markdown report. Use this whenever the user asks to review, compare, or summarize weekly campaign or ad performance, asks how campaigns did this week vs last week, or points at a campaign history file such as week-06/data/history.csv, even if they don't name the skill.
---

# Weekly campaign review

Compare two weeks of ad campaign results and write a short report that a marketer can act on. The report points at changes worth investigating. It does not decide what to do about them.

## Input

The data is a CSV with one row per campaign per week. The expected columns are:
`week_start, campaign, impressions, clicks, attributed_purchases, ad_spend_usd, attributed_revenue_usd`
(the default file is `week-06/data/history.csv`).

- If the user names two weeks, compare those.
- If not, compare the two latest `week_start` values in the file.
- Leave all other weeks out of the calculations and the report. Extra weeks distract from the comparison.

## Step 1: Data checks

Before you calculate anything, check the whole file for:

- missing values (empty cells)
- negative values in the numeric columns
- duplicate rows, including the same campaign appearing twice in the same week

Also note it if a campaign appears in one of the compared weeks but not the other.

Report every problem you find. **Do not edit the data file.** It is the source of record, so a fix has to come from whoever owns the data. If a problem affects a row in the compared weeks, keep going, but mark the affected numbers in the report.

## Step 2: Four measures

Calculate these for each campaign in each of the two weeks:

| Measure                   | Formula                         | Format          |
|---------------------------|---------------------------------|-----------------|
| Click-through rate (CTR)  | clicks ÷ impressions            | % (2 decimals)  |
| Conversion rate           | attributed purchases ÷ clicks   | % (2 decimals)  |
| Cost per purchase         | ad spend ÷ attributed purchases | USD (2 decimals)|
| Return on ad spend (ROAS) | attributed revenue ÷ ad spend   | ratio (2 decimals)|

Compute them with a short script (Python with the `csv` module is enough) rather than by hand, so the numbers are exact. If a denominator is zero, write "n/a" and list it under data problems.

Change = second week − first week. Show it in percentage points (pp) for CTR and conversion rate, USD for cost per purchase, and as a ratio difference for ROAS.

## Step 3: Report

Save a Markdown report to `week-06/reports/<second-week-date>.md` (for example `2026-10-05.md`), unless the user gives another path. Use exactly these three sections:

```markdown
# Weekly campaign review: <week 1> vs <week 2>

## 1. Comparison table
| Campaign | Measure | <week 1> | <week 2> | Change |
(the four measures for each campaign in both weeks, and the change)

## 2. Findings
(up to three changes worth investigating, largest or most unusual first)

## 3. Data problems
(the results of the Step 1 checks; write "none" for each check that found nothing)
```

For the findings:

- Pick at most three changes. Give the numbers behind each one, such as clicks going from 900 to 480.
- Write possible causes as **questions**, not conclusions. The data shows what changed, not why it changed, and a question invites the person to check.
- **Do not recommend budget changes**, such as shifting, raising, or cutting spend. Budget decisions are outside this review.

After saving, tell the user the report path, and give the one or two biggest changes in a sentence or two.
