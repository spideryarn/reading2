# Code review (reviewer-fixer): 261003e stage 1, span highlights with a colour

You are reviewing AND fixing, in this worktree, commit 3e2d0b9a8 (diff: `git show 3e2d0b9a8`;
its parent is a6ae64d19 plus a merge of dev, so diff against `3e2d0b9a8^1`). The plan is
docs/plans/261003e-span-highlights-with-a-colour.md and your own earlier plan review is
docs/plans/261003e-span-highlights-plan-review-sol.md (findings S1–S12). Stage 1 is option A
only: colour in the two existing boxes; the floating menu (S1, S7, S8) is NOT built and is out of
scope.

Check that each of S2–S6 and S9–S11 is actually fixed in the code, not just claimed, and look for
anything new. Particular places:

- src/web/annotate.ts `commentOrder` and the ✳ (`data-mark-end`) rule; TableView.tsx `anchorKey` /
  `marksByBlock` and the mouseup click path; whether an uncoloured newer note over an older
  highlight behaves sensibly.
- src/store/pg-comments.ts insert / same-Save equality / `patchColour` (404 vs 409), routes.ts
  POST + `PATCH /api/comments/:slug/:id/colour` (ownership, validation, auth contract), the
  migration's CHECKs.
- useComments.ts `recolour` on the per-comment queue; CommentDialog's controlled swatches; the
  AnnotateDialog save path still gated on `loaded`.
- commentKind precedence, earnsMarker, Marginalia filter, CommentDialog labels, drawer dot.
- Public projection (public-reader.ts, dto.ts, public-types.ts) and rollback export.
- CSS: annotations.css highlight rules vs mark.hit search washes; tokens.css. The app is dark only.

Fix what is inside this stage, narrowly, red-first (write or adjust a test that fails, then fix).
Report, do not fix, anything wider. You can run unit tests that need nothing outside the tree
(`npx vitest run tests/annotate.test.ts tests/comment-nav.test.ts tests/highlight-marks.test.tsx
tests/recolour-write-order.test.tsx tests/marginalia-notes.test.ts tests/public-dto.test.ts`) and
`npm run typecheck`. Postgres-backed tests (tests/comment-colour.test.ts,
tests/public-visibility-pg.test.ts) need a database you do not have: say what you would want run
and I will run them.

Do not commit. Severity: P0 (data loss/security), P1 (wrong behaviour a reader will hit), P2,
P3. An ID on every finding (C1, C2, …), file:line evidence, whether you fixed it, and the test.
End with a verdict: land / land after fixes (made) / do not land.
