# Code review: 261003l — Skim arrows stay in the band; stops shared across depths

You are the stage's **reviewer and fixer**, write-capable in this worktree. Fix what is inside this
change, narrowly and red-first (a failing test before each fix). **Report, do not fix**, anything
wider you notice. Run no git command that changes anything; leave your edits uncommitted for me to
read as a diff.

## The candidate

- Commits, in order: `6236d0957` (stage 1) and `4478eee77` (stage 2), on top of the plan commits
  `df200c954` and `28422eeeb`. Diff: `git diff df200c954 4478eee77 -- . ':!evals/results'`.
  The working tree is clean at `4478eee77` when you start.
- Changed paths (the complete list is `git diff --stat df200c954 4478eee77`). Start with:
  `src/skim.ts`, `src/types.ts` § `SkimStop`/`SkimDrops`, `src/public/dto.ts` § `publicSkim`,
  `src/web/skim-route.ts`, `src/web/modes/skim/SkimMode.tsx`, `src/web/SkimPanel.tsx`,
  `src/web/styles/skim.css`, `src/web/reader/Reader.tsx` (one new effect), `src/web/flash.ts`
  (comment), `src/web/params.ts` (comments), `src/web/help/help-modes.tsx`; tests
  `tests/skim.test.ts`, `tests/skim-route.test.ts`, `tests/skim-panel.test.tsx`,
  `tests/public-dto.test.ts`; docs `docs/project/skim.md`, `url-state.md`, `keyboard.md`,
  `touch.md`; the eval scripts under `scripts/eval/skim-*.ts`. That list does not limit scope.
- The plan, with Greg's two reports quoted in full, your plan review's ledger (F1–F5) and the
  Progress notes: `docs/plans/261003l-skim-arrows-stay-in-the-band-and-stops-shared-across-depths.md`.
  Your plan review: `docs/plans/261003l-skim-plan-review-sol.md`.
- The measurement: `docs/investigations/261003e-skim-again-carried-stops-eval.md`, the script
  `scripts/eval/skim-coverage-eval.ts` and `scripts/eval/skim-again-pairs.ts`, and the raw results
  `evals/results/skim-coverage-2026-10-03T18-10-38*` (round one) and `…T18-18-47*` (round two).

## What to do

1. An independent pass over the code: correctness against the plan and against the callers.
   Anything else that reads a stop's `depth` to decide which pass it is in and was missed
   (owner band, visitor band, export, chat tools, stop card, keyboard, the spine, tests' fixtures).
2. Check each plan-review finding by id — F1 (a carried stop never makes a pass: server drop and
   client ignore), F3 (pips not interactive, nothing collides, words reachable), F4 (the visitor's
   DTO), F5 (the four URL cases and a same-stop depth change) — and say for each: fixed / not.
3. The new effect in `src/web/reader/Reader.tsx` that drops a held flash on a change of mode while
   a band covers has **no test** (there is no Reader-level harness). Is it right, is it needed, and
   can it be pinned cheaply? If it is wrong or unneeded, say so.
4. The prompt (`SKIM_SYSTEM` § 2 and RULES in `src/skim.ts`) against
   `docs/project/prompting-guide.md`: is anything in it contradictory, or at odds with the schema
   or with `validateRoute`?
5. **Check the conclusion, not only the code**: does the investigation doc claim only what its
   results files show? Recompute at least the carry shares and the blind-read splits from the
   JSON. The claims copied into `docs/project/skim.md` and the plan's Progress section must match.
6. Docs changed in this stage: is each new sentence true of the code?

You have no network and no Postgres. Run the tests that need neither:
`npx vitest run tests/skim.test.ts tests/skim-route.test.ts tests/skim-panel.test.tsx tests/public-dto.test.ts tests/doc-links.test.ts tests/help-page.test.tsx`
and `npm run typecheck`. Raw results already seen by me at `4478eee77`: those files plus
`tests/skim-purpose-line.test.tsx`, 323 tests passed; typecheck clean. The full suite and the
browser check are mine and are not in this snapshot.

## Severity, and what a refusal takes

P0 data loss, exploitable security, incorrect charging, service broadly unusable ·
P1 user-visible wrong behaviour, or an authoritative contract violated ·
P2 design or maintainability risk with no wrong behaviour today ·
P3 non-behavioural prose or comment defect.

Grade by consequence; say **established** or **reasoned** for each. Number new findings from F6
(F1–F5 are the plan review's). For each: file and line, what you did about it (fixed, with the
test that was red; or reported), and what is left for me.

End with one line: `VERDICT: land` / `VERDICT: land after fixes (F…)` / `VERDICT: do not land`.

## My own suspicions (already mine, worth less; spend most of the run elsewhere)

- `locate` when the asked depth is not offered at all but the stop is named.
- `position` and the sparkline's "done" dots when a carried stop is current in the deeper pass.
- The stop card's "also at stop k" on a pass with carried stops.
- Whether `again` should be dropped when the stop's own cap-surviving depth changes nothing but a
  later cap drop removes the only first-placed stop at the named depth (order of the F1 check).
- The amount carried is uncapped; the investigation says it varies from none to all of Gist.
