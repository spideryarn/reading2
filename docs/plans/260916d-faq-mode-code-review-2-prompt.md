# GPT Sol code review, stage 2 — FAQ mode (260916d)

You are reviewing AND fixing stage 2 of a planned change. You have write access to this worktree.
Nobody else is editing it while you run.

## The candidate

- Commit `0e947eb4` (parent `301101e6`). Diff: `git show 0e947eb4`; paths:
  `git show --name-only --format= 0e947eb4`. Start with `src/web/FaqPanel.tsx`,
  `src/web/useFaq.ts`, `src/web/modes/faq/FaqMode.tsx`, `src/web/reader/Reader.tsx`,
  `src/web/visitor.ts`, `src/mode-catalog.ts`, `tests/faq-panel.test.tsx`, `docs/project/faq.md`.
  That list does not limit scope.
- Stage 1 (the server half, `src/faq.ts`, `GET /api/faq/:slug`) is `b31d8b87` + your own stage-1
  review fixes `301101e6`; it is context, not the candidate.
- The plan: `docs/plans/260916d-faq-mode.md`. The mode checklist: `docs/project/new-mode.md`
  (§ The client, § The card on the button, § Before you call it finished). The precedent: Citations
  stage 2, commit `abde65f7`, and Debate's hook `src/web/useDebate.ts`.

## Evidence already run

`docs/plans/260916d-faq-mode-stage2-test-results.txt` — 19 scoped files, 580 tests, exit 0, on
`0e947eb4`; `npm run typecheck` exited 0 there too. Pure jsdom tests you may run yourself with
`node --import tsx node_modules/vitest/vitest.mjs run <file>` if the sandbox allows.

The builder says two tests were **never seen red**: `tests/faq-panel.test.tsx` (written after the
panel) and the new FAQ case in `tests/modes-that-start-themselves.test.tsx`. Mutate the code they
cover and check they notice; strengthen them if not.

## What to do

1. **An independent pass first.** Hunt for wrong behaviour a reader can reach: the band's states
   (loading, not yet generated, generating, failed read, failed job, empty `[]`, stale, outdated,
   the list) drawing the wrong thing or a dead end; a press that spends when it should not, or does
   not start the run when it should (`MODE_TARGET`, `useAutoRun`, `auto-run-targets.ts`); a visitor
   (public-readable, signed out) reaching a request or content they should not (`POLICY`, the
   owner-only `case "faq"`); the band not inside its `ModeBoundary`; the experimental gating wrong
   in either direction; a `BlockRef` jump that does not land; the card's two sentences false on any
   of the four surfaces new-mode.md names, or restating each other; accessibility (heading levels
   inside the band, blockquote semantics, labels); the foot's promise overclaiming; CSS leaking
   outside `.faq`.
2. **Write findings to `docs/plans/260916d-faq-mode-code-review-2-findings.md` FIRST**: an ID (D1,
   D2, …), severity, evidence (file:line), consequence, fix.
3. **Then fix what is inside this stage**, narrowly and red-first. Report, do not fix, anything
   wider. Do not commit.
4. Final answer: each finding *fixed* (files) / *reported only* / *not a defect after all*, the
   mutation results for the two never-red tests, and what you could not verify.

## Severity scale

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

## My own suspicions (already mine, worth less — spend most of the run elsewhere)

- The dropped-count line sums seven counters of mixed units ("questions or passages"); is that
  honest enough, or noise a reader cannot act on?
- The `how` sentence and the band's foot say nearly the same thing — does the card restate
  something already on screen (new-mode.md § The card on the button, fourth bullet)?
- Stale and outdated both true shows only the stale banner.
