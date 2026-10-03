# Plan review: 261003o — quick search falls back to a lower floor when nothing clears it

You are reviewing a **plan**, read-only. Change no file.

**Candidate (live, pre-commit).** Base `87da492d4` on branch
`worktree-fbjp5nxn-quick-search-finds-too-little`. Untracked files are the whole candidate:

- `docs/plans/261003o-quick-search-falls-back-to-a-lower-floor-when-nothing-clears-it.md`
- `docs/plans/261003o-quick-search-fallback-plan-review-prompt.md` (this file)

Evidence the plan rests on, in a gitignored folder you can read (`data/qeval/`):

- `replay-rules.mjs` — replays selection rules over `evals/results/quick-search-recall-2026-10-03/jev-raw.json`.
  **Run it yourself** (`node data/qeval/replay-rules.mjs`, no network needed) and check the plan's
  claims about it: "0 of 150 runs change", and the right/wrong counts for the passed-over rules.
- `abstract-run.ts` (the 26 queries) and `abstract-raw.json` (their scores, three runs each).
- `repro-jp5nxn.ts` and `out-repro-jp5nxn.json` (the reproduction, with and without headings).
- `bfrbaj.json` — the article and Greg's saved searches, read from production. It holds a real
  reader's article text: do not quote it in your answer beyond a few words.

Read the plan, then:

- `src/quick-search.ts` (all of it; `hitsFrom`, `QUICK_FLOOR`)
- `tests/quick-search.test.ts`
- `docs/project/search.md` § Quick search
- `docs/investigations/261003c-quick-search-recall-eval-jev-wording-floor-and-small-llm.md`
  (this morning's eval, whose floor conclusions this plan partly reopens)
- `docs/plans/261003i-quick-search-eval-thorough-replaces-quick-colour-key-and-no-wash.md`
- wherever a stored hit's confidence is read on the client (`src/web/search-hits.ts`,
  `src/web/SearchPanel.tsx`, `src/web/threshold.ts`) — does anything assume a quick hit is at
  least 70?

## What to do

Make an independent pass first. Attack the plan: where will it produce wrong behaviour, mislead a
reader, or cost more than a simpler version that gets most of the value? Where does it describe the
existing code or the earlier eval wrongly? Is "category word" the right name for the class, or is
the evidence consistent with a different cause the plan has not ruled out? Greg wants the simplest
version that gets most of the value, so "this should be smaller" and "this should not be built" are
welcome findings.

For Stage A, say whether the design can answer "is a fallback list good enough to show, and at
which floor and cap" — what arm, control or measurement is missing, and what would make its numbers
misleading. In particular: the judging design, and whether the reference (one thorough search) is a
fair yardstick for this query shape.

## Severity scale

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

Give every finding an ID (F1, F2, …), a severity, the file and line it rests on, and the change you
would make to the plan. End with a one-line verdict: ready to build, or not, and what blocks it.

## My own suspicions (already mine, worth less; spend most of the run elsewhere)

- The discontinuity at 0.7: a best score that wobbles between 0.69 and 0.71 across runs flips the
  list between eight results and one. Is "empty" the right trigger, or should it be smoother?
- Whether the reading of Greg's report is right: the linked run is a thorough row, and I inferred
  the quick search it replaced.
- The 21 queries are mine, and I wrote them knowing the hypothesis.
- Whether the thing to change is the question's wording after all.
