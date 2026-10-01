# Code review, stage 2 of 261001p — Citations' *Investigate* becomes *Dig deeper*

You are reviewing AND fixing, in this worktree (branch `worktree-go-deeper`). The candidate is commit
`5aeb86b17`; see `git show --stat 5aeb86b17` and `git show 5aeb86b17 -- <path>`. Start with
`src/citation-investigate.ts`, `src/citation-find.ts`, `src/citation-investigate-context.ts`,
`src/store/pg.ts` (the investigation read side), `src/web/CitationInvestigation.tsx`,
`src/web/useCitations.ts`, and the tests `tests/citation-investigate*.test.ts`,
`tests/citations-panel.test.tsx`, `tests/glossary-lookup-stream.test.tsx`. Not a limit on scope.
**Do not edit anything under `docs/project/`** — another agent is rewriting those docs right now.

The plan is `docs/plans/261001p-dig-deeper-one-action-always-searches-bigger-model.md` (Stage 2 and
how Stage 1 landed). Stage 1's shared module is `src/dig-deeper.ts`, reviewed by you already
(`docs/plans/261001p-dig-deeper-stage1-review-sol.md`). Your plan review's F2, F3, F6 and F8 apply
here: check they are satisfied by the code.

## Brief

- Fix what is inside this stage, narrowly and red-first; don't commit; list your changes.
- Report, don't fix, anything wider.
- No network or Postgres in your sandbox. Unit tests run, e.g.
  `npx vitest run tests/citation-investigate.test.ts tests/citation-investigate-context.test.ts tests/citations-panel.test.tsx tests/citations-investigate-client.test.tsx tests/glossary-lookup-stream.test.tsx tests/dig-deeper.test.ts`
  and `npm run typecheck`. I ran the Postgres suites `tests/citation-investigate-route.test.ts`
  (10/10) and `tests/citation-find-route.test.ts` (7/7); say if you change code they cover.

## Attack in particular

1. Is the search forced on every press, run once, and does a failed search stop the press with no
   paid call after it, no save, and the lease freed?
2. Is every reader-visible call on `DIG_DEEPER_MODEL` regardless of env overrides and article power,
   and do write and read sides agree on the context hash, so a dug answer reattaches on reload and an
   old (version 6, Sonnet) one does not? `generationKey`/`sameGenerator` in `src/models.ts`.
3. The standalone *Find it* route: unchanged model, unchanged behaviour? A lookup made inside a
   press and read back by Find (or vice versa) — consistent?
4. Provenance: the forced search's pages are merged into the answer's evidence and counted as read.
   Is the stored *sources* claim still true? Does anything now call a page "cited" or "read" that
   the answer only received?
5. Budget and lease: `INVESTIGATE_PRESS_BUDGET_USD` 0.80 and `globalFills` 25, and the lease sum.
   One measured cold press was ~$0.42 (the comment's arithmetic). Sound?
6. The cached prefix: first part byte-identical to before; findings fenced after the breakpoint.
7. Copy and the new `searching` stage on the client, including an older client's handling.

## My own suspicions (worth less)

- `ANSWER_TOKENS` stays at 3,000 with Opus reasoning on; a long answer could be cut off.
- Putting the search before *Look it up* changes the stage order a client may have assumed.

## Format

Verdict line first. Findings with IDs continuing from F15, severity P0–P3 as before (P0 data loss /
exploitable security / incorrect charging / service broadly unusable; P1 user-visible wrong
behaviour or authoritative contract violated; P2 design risk; P3 prose), file:line, evidence, and
FIXED (with the red-first test) or REPORTING. End with the files you changed.
