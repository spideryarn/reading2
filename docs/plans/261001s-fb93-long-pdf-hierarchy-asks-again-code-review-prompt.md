You are reviewing code before it is pushed, and you may fix what you find.

The plan, with what your own plan review changed: docs/plans/261001s-fb93-long-pdf-hierarchy-asks-again.md
(read it first, and docs/plans/261001s-fb93-long-pdf-hierarchy-asks-again-plan-review-sol.md).

The change is commit 7779e5245 — `git show 7779e5245`. The substance is in src/hierarchy.ts:
`planChildRanges` (`spanOf` now throws for an invented id or a malformed range, and returns "none"
for an absent/null range), `recordBoundaryFaults` (measures only the claims made),
`collapseRestatedRungs` (counts rangeless children from every sibling set), `generateHierarchy`
(`askForStructure`, the once-only re-ask, `reaskReserveMs`, `structureCalls`), and the logging in
src/pipeline.ts. Tests: tests/hierarchy-repairs.test.ts (§ "a child that states no range"),
tests/hierarchy-structure-reask.test.ts.

What to check, most important first:

1. Correctness of the derivation with rangeless children: any input where a tree that does not tile,
   a crash, a mis-measured repair, or a silently wrong range comes out. Any old behaviour changed by
   moving the invented-id/malformed throw from `buildTree`'s visit into `planChildRanges` — an
   answer that used to build and now throws, or a message that changed.
2. The re-ask: can it make more than two calls, re-ask after truncation/refusal/transport/abort,
   checkpoint a bad answer, misreport tokens or `structureCalls`, or start a call the deadline will
   kill? Is `reaskReserveMs` applied to the right clock?
3. Whether the tests would go red if the behaviour they name broke (a test that cannot fail is not
   evidence).
4. Anything else wrong that you can see.

Fix what is inside this change and clearly right; for anything wider or arguable, report it rather
than fix it. Run `npx vitest run tests/hierarchy-repairs.test.ts tests/hierarchy-structure-reask.test.ts`
and `npm run typecheck` after any fix. Do not commit. Finish with a numbered list of findings
(severity P0–P3, file:line, scenario, and whether you fixed it), and say plainly if you found nothing.
