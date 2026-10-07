# Code review: 261003o — quick search falls back to a lower floor when nothing clears it

You are the reviewer **and the fixer** for this stage. You may edit files in this worktree.

**Candidate.** Commit `2dac08de6` on branch `worktree-fbjp5nxn-quick-search-finds-too-little`; its
parent is `87da492d4`. `git show --stat 2dac08de6` lists it. The tree is clean, so any diff after
your run is yours. This prompt file is untracked and not part of the candidate.

What it is: feedback report `spya-jp5nxn` from Greg, the product owner. Quick search for "results"
on a paper returned nothing. The fix: when no block reaches `QUICK_FLOOR` (0.7), `hitsFrom` keeps
blocks at `QUICK_FALLBACK_FLOOR` (0.5) or more, best `QUICK_FALLBACK_HITS` (8).

Read, in this order:

- `docs/plans/261003o-quick-search-falls-back-to-a-lower-floor-when-nothing-clears-it.md`
- `docs/investigations/261003f-quick-search-category-words-score-under-the-floor.md`
- the code: `git show 2dac08de6 -- src/quick-search.ts tests/quick-search.test.ts docs/project/search.md`
- `src/routes.ts` § search (how a quick run's hits are stored), and the client readers of a stored
  hit's confidence (`src/web/search-hits.ts`, `src/web/SearchPanel.tsx`, `src/web/threshold.ts`)
- `docs/user-feedback/261003_1809-quick-search-still-finds-too-little.md`

Your plan review (`docs/plans/261003o-quick-search-fallback-plan-review-sol.md`) found seven
problems with the evidence. The plan's § The plan review says what was done about each. The second
measurement round was done after it and has not been reviewed by anyone.

## What to do

1. **An independent pass on the code.** Wrong behaviour, a reader misled, a stored result that
   breaks an assumption elsewhere (public reader, export, the *thorough* button, the duplicate
   guard, the `?conf=` bar, a retry), a log line carrying text. Run
   `npx vitest run tests/quick-search.test.ts` yourself.

2. **Check the conclusion, not only the code.** The claim is: *0.5 and 8, only when empty, is worth
   shipping*. The evidence is under `evals/results/quick-search-category-words-2026-10-03/`
   (scripts as `.txt`; raw scores, verdicts and summaries as `.json`; no article text) and
   `evals/results/quick-search-recall-2026-10-03/jev-raw.json`. Recompute what you can without a
   network: copy `replay-rules.mjs.txt` to a `.mjs` in a temporary folder and run it with `node`;
   recompute the 62-of-111, 50, 144-right-of-202, 36-of-50, 13 and the absent and near-miss counts
   from `abstract-raw.json`, `round2-raw.json`, `judged2.json` and `pool2-key.json`
   (`analyse2.ts.txt` and `perlist2.ts.txt` are the scripts that produced them; they read the
   same files from a `data/qeval/` folder that also exists in this worktree, gitignored).
   Say plainly if a number in the plan, the investigation, `search.md`, the note or a source
   comment does not match what the files give, or if the conclusion does not follow from them.
   I had a reason to want this to work; treat the write-up as an interested party's.

3. **Fix what is inside this stage**, narrowly, and red-first where it is code: a wrong number in a
   doc or comment, a missing test, a real bug in `hitsFrom`. **Report, do not fix**, anything
   wider (another wording, the query framing, headings, UI for a fallback list, a different rule).

You have no network, not even loopback: nothing that touches Postgres or OpenRouter will run for
you. `tests/quick-search.test.ts` and `tests/doc-links.test.ts` need neither.

## Severity scale

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

Give every finding an ID (CR-1, CR-2, …), a severity, the file and line, and whether you fixed it.
End with a one-line verdict: **land**, or **do not land** and what blocks it.

## My own suspicions (already mine, worth less; spend most of the run elsewhere)

- 13 of 50 fallback lists hold nothing right. Is "ship at 0.5" still the right call, or does the
  evidence say 0.55, or "do not ship"? Both are put to Greg as Q1; say if the built default is the
  wrong one.
- `fallback` is returned by `hitsFrom` and logged, and nothing is stored with the run. Is there a
  place that needed it?
- The judged pool for round two holds only blocks at 0.45 or more on runs where nothing cleared
  0.7. `analyse2.ts.txt` counts an unjudged block in a "bare" list as neither right nor wrong: are
  there any, and does that flatter the numbers?
- The comment in `hitsFrom` about the quote and "the wash" predates this and may be stale.
