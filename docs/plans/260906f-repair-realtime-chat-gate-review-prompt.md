# Bounded review of the two final gate repairs

Read-only review in this worktree. Return READY or NOT READY with concrete P0/P1 findings;
do not edit source or start a full gate.

The implementation already has a broad review and a READY follow-up:
`docs/plans/260906f-repair-realtime-chat-code-review-followup-sol.md`.
Review only these two subsequent test changes against `f0a614e4`:

1. `tests/client-imports.test.ts` registers `spoken-label.js` as a shared pure leaf.
   Inspect `src/spoken-label.ts`, its two callers (`src/routes.ts` and
   `src/web/chat/project.ts`), and the boundary test's existing purity checks.
   The helper was extracted unchanged from the server route to avoid duplicating the
   label cap when a lost-response repair matches stored spoken metadata. It imports
   nothing. Is the registration justified, preserving the server/client boundary?
2. `tests/public-network-trace.test.tsx` now awaits the URL assertion using `vi.waitFor`
   inside `act`. The draft renders immediately but nuqs throttles history writes;
   the previous six zero-delay turns asserted before the write. Does the test still
   require a new conversation on the original paragraph and reject a missing URL reset?

Both assertions failed in the full gate and again in the named-file rerun before these
changes. The boundary plus spoken controller/effect run passed 32 tests after registration.
The 60-test public-network suite passes with the wait; the implementation agent also
temporarily removes `setThread(null)` to check that the test fails, then restores it.
The root will verify that restoration and retain the mutation result before committing.

No application code is changed by these two gate repairs. The latest dev merge changed
only unrelated documentation. Full validation evidence is in
`docs/plans/260906f-repair-realtime-chat-final-validation.md`; its prior failed gate is
historical evidence, and another final run is being executed separately.
