Found and fixed two issues. No commit was made.

### Findings

- **C1 — P1 — fixed.** A newer uncoloured note over an older highlight opened the older highlight and hid the note’s underline. `commentOrder` now uses the accepted total priority: newest `createdAt`, then highest `id`. Evidence: [annotate.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/annotate.ts:296).  
  Test: [annotate.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/tests/annotate.test.ts:158) and real mouseup coverage in [highlight-marks.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/tests/highlight-marks.test.tsx:185). Both were red before the fix.

- **C2 — P2 — fixed.** A coloured highlight overlapping a search hit regained the orange comment underline because a later equal-specificity rule won. The late rule now applies only to uncoloured comments. Evidence: [annotations.css](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/styles/annotations.css:791).  
  Test: computed CSS cascade coverage in [highlight-marks.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/tests/highlight-marks.test.tsx:203), red before the fix.

### Review findings checked

- S2: cache keys and resolved marks include colour, marker eligibility and creation priority.
- S3: recolouring uses the shared per-comment queue; swatches are controlled.
- S4: POST, PATCH and SQL all reject colour on whole-block bookmarks; PATCH distinguishes 404 from 409.
- S5: fixed during this review.
- S6: highlight wash wins over search wash while search stripes/rail remain; underline regression fixed.
- S9: kind precedence, marker rule, Marginalia filtering, dialog label and drawer dot agree.
- S10: insert, mapping and same-Save equality include colour.
- S11: public SQL/mapping/DTO/type and rollback export all carry colour.
- AnnotateDialog saving remains gated on `loaded`.
- Route authentication/ownership contract is present and its contract suite passed.

Checks:

- Requested unit suites: **187 passed**
- Authenticated route contract plus public DTO audit: **452 passed**
- Typecheck: the npm wrapper could not create its `tsx` IPC socket (`EPERM`), but the same script run via `node --import tsx scripts/typecheck.ts` passed all four projects and coverage.
- `git diff --check`: passed.
- Lint reported only existing baseline findings in `annotate.ts` and `annotations.css`.

Please run the database-backed checks:

```bash
npx vitest run tests/comment-colour.test.ts tests/public-visibility-pg.test.ts
```

Verdict: **land after fixes (made)**, subject to those Postgres-backed tests passing.