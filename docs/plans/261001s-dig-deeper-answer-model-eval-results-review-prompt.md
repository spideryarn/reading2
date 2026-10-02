# Review (round 2): 261001s — the numbers, the conclusion, and the code changed since your review

You are reviewing **and fixing** (workspace-write) in the worktree you are in. **Spend nothing**:
no model calls, no network, no database writes, no commits. I will read your diff and commit it.

## The candidate

- **Code since your round-1 review**: `git diff 38d783ea4 fc9e83e67` — the third judge moved from
  Kimi K3 to Grok 4.7 in a new `evals/dig-deeper/judges.ts`, and imports moved to it. Your round-1
  fixes are commit `38d783ea4`; you reviewed them as your own.
- **The plan's new sections**: `docs/plans/261001s-dig-deeper-answer-model-eval.md` § What running
  changed and § Result (uncommitted edits — `git diff -- docs/plans/261001s-dig-deeper-answer-model-eval.md`).
- **The run** (gitignored, readable): `output/dig-deeper-runs/main/` — `report.md` (the eval's own
  report), `manifest.json` (note `trimmed`, and the `.before-grok-judge` / `.before-trim` copies),
  `budget.json`, `cells/` (216 `ans__*` and 120 `jdg__*`; nine `*.busy429` set aside), captures.
- **A per-judge breakdown I computed by hand** for the conclusion, not in the eval's code:
  `/tmp/claude-1000/-home-greg-code-spideryarn2/3f220dca-20c5-4b94-aa0c-4cbe4ee0ff08/scratchpad/perjudge.py`
  (it reads `cells/jdg__main__*.json` and prints each arm's mean overall minus the Opus anchor, per
  judge and per example). Run it: `python3 <that path>`.

## What happened during the run (also in § What running changed)

Kimi K3 delivered 3/18 answers (429 on every 255k-token Kuhn request across two sessions; two-minute
timeouts elsewhere); nine 429 cells were renamed `*.busy429` and re-bought once. Kimi was replaced
as judge by Grok 4.7 by editing `manifest.json` (selection and slot names), since no judge cell
existed yet. Grok does not cache, so judging cost far more than estimated; I trimmed the judging
matrix in `manifest.json` (Grok off `kuhn-sapolsky`; re-judge only on two examples) and raised the
run's cap by hand in `budget.json` three times ($37 → $38.60 → $38.70). The production-shaped
finalist run was not run. Total spend $38.74; Greg's hard ceiling for the whole eval is now $50.

## The attack

1. **Do the numbers in § Result say what the report and the cells say?** Recompute what you can from
   the cells: delivered counts, acceptable counts, quality vs Opus, the per-judge figures, words,
   repeat and first press cost (I added the $0.024 shared cost to the report's per-arm figures by
   hand), the wait times.
2. **Is the conclusion fair to the evidence?** In particular: Sol "the only arm acceptable on every
   judged press"; "Opus is the best"; "Luna + Opus check saves nothing"; the use of Grok as "the
   neutral judge"; the treatment of each family's self-preference; anything I have overstated or
   left out that Greg should know before choosing.
3. **Did my mid-run changes break anything?** The manifest edits (judge rename, trim), the busy429
   set-aside and re-buy, the hand-raised caps: could any of them make the report count something
   twice, miss something, mix stale and current cells, or call a partial run "Complete"? Did the
   trim leave an arm or example with fewer judges in a way the report's acceptable rule mishandles
   (`kuhn-sapolsky` has two judges)?
4. **The code change**: `judges.ts` and its imports, and `arms.ts` keeping a now-unused `JUDGES`.

Fix what is inside this eval (`evals/dig-deeper/`, the test, the plan's § Result and § What running
changed) narrowly; if a number in § Result is wrong, correct it and say so. Report, do not fix,
anything wider.

Severity: P0 incorrect charging / data loss · P1 a number or claim Greg would read that is wrong or
misleading · P2 design risk · P3 prose. IDs continue from round 1: **start at F22**. For each:
severity, claim, evidence, what you changed. End with: **conclusion stands / stands after my fixes /
does not stand**, and one paragraph on how you would put the choice to Greg.
