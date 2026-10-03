# Code review, round two (narrow): 261003l — the fix for F7 only

Read-only. Change no file. Discovery is closed; this checks one fix and the claims made about it.

## The candidate

Commits after your round-one snapshot `4478eee77`, up to `9f216614a`:
`git log --oneline 4478eee77..9f216614a`, and
`git diff 4478eee77 9f216614a -- . ':!evals/results'`. Most of that diff is **your own round-one
fixes** (F6, F8, F9, F10), committed as you left them; they are not under review again.

What is new and not yours:

- `src/skim.ts`: `maxCarried`, rule 8 in `validateRoute`, `overCarried` in `emptyDrops`, one
  sentence in `SKIM_SYSTEM`'s "Do not carry" bullet; `src/types.ts` § `SkimDrops.overCarried`.
- `tests/skim.test.ts`: the test named "(Sol F7)", seen red first, and two fixtures widened.
- The measurement's round three: `docs/investigations/261003e-skim-again-carried-stops-eval.md`,
  `evals/results/skim-coverage-2026-10-03T19-01-33*`, `scripts/eval/skim-again-cap.ts`.
- The claims copied from it into `docs/project/skim.md` and into the plan's Progress section and
  `[Q-carry-cap]`: `docs/plans/261003l-skim-arrows-stay-in-the-band-and-stops-shared-across-depths.md`.

## The question, with a floor

F7 was: carrying is uncapped, and can reproduce the repetition the feature was meant to avoid.
The guarantee now claimed is exactly this, and no more: **after `validateRoute`, for each of
passes 2 and 3, the number of stops carried into it is at most `ceil(own / 2)`, where `own` is the
number of kept stops first placed at that depth; the excess `again` entries are removed latest-first
in route order and counted; no stop is ever dropped by it; and the client walks only what was
stored.** Is that statement accurate of the code? And do the numbers the docs now state (26% and
20%, the 40% maximum, 12 of 12 and 8–2–2, 2 entries cut in 12 runs) match the round-three JSON?

It is not claimed that the cut order picks the useful entries (the investigation says it does not),
nor that the Gist-to-More walk Greg reported is shown to be fixed (it says it is not).

Run `npx vitest run tests/skim.test.ts` and `node scripts/typecheck.ts`.

Same severity scale as round one; number any new finding from F11. Say whether F7 is **closed**,
**still open**, or **closed with a remainder you would report to Greg**.

End with one line: `VERDICT: land` / `VERDICT: land after fixes (F…)` / `VERDICT: do not land`.
