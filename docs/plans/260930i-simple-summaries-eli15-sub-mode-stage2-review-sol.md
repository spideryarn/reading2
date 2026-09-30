No P0 findings. Four findings, all fixed in the worktree; no commit made.

1. **S2-1 — P1: sharing could advertise a Simple that visitors could not see.**  
   The public DTO rejects malformed Simple paragraphs, but `shareableArtefacts` previously treated any non-null value—including `paragraphs: []`—as shared. The owner could therefore be told a public link included Simple while the link omitted it. I applied the shared validator at [src/store/pg.ts:2545](/home/greg/code/spideryarn2/.claude/worktrees/fb6e-simple-summaries/src/store/pg.ts:2545) and added valid/invalid controls at [tests/shared-inventory.test.ts:532](/home/greg/code/spideryarn2/.claude/worktrees/fb6e-simple-summaries/tests/shared-inventory.test.ts:532).

2. **S2-2 — P2: documentation still said Summary had no prompt or on-demand generation.**  
   That became false when Simple landed. I narrowed those claims to the Gists view in [summaries.md:292](/home/greg/code/spideryarn2/.claude/worktrees/fb6e-simple-summaries/docs/project/summaries.md:292), [SummaryPanel.tsx:72](/home/greg/code/spideryarn2/.claude/worktrees/fb6e-simple-summaries/src/web/SummaryPanel.tsx:72), and [params.ts:956](/home/greg/code/spideryarn2/.claude/worktrees/fb6e-simple-summaries/src/web/params.ts:956). The `url-state.md` Simple row was already consistent.

3. **S2-3 — P2: sharing-wire tests could miss a cross-wired Simple flag.**  
   The one-hot and missing-key tables skipped `simpleSummary` and several older keys, so `simpleSummary: row.faq` could pass. Both tests now sweep the exhaustive `ARTEFACT_KEYS` at [tests/shared-inventory.test.ts:423](/home/greg/code/spideryarn2/.claude/worktrees/fb6e-simple-summaries/tests/shared-inventory.test.ts:423). Mutation-checking the production validator produced the intended failure.

4. **S2-4 — P2: several required client claims lacked direct tests.**  
   Existing tests checked passage attributes but not their preview, and did not directly pin keyboard focus, labelling, or Depth restoration. Added coverage for the correct passage card at [simple-panel.test.tsx:200](/home/greg/code/spideryarn2/.claude/worktrees/fb6e-simple-summaries/tests/simple-panel.test.tsx:200), Depth state at [simple-panel.test.tsx:394](/home/greg/code/spideryarn2/.claude/worktrees/fb6e-simple-summaries/tests/simple-panel.test.tsx:394), and accessible switch semantics at [pressing-a-chip-arms-it.test.tsx:262](/home/greg/code/spideryarn2/.claude/worktrees/fb6e-simple-summaries/tests/pressing-a-chip-arms-it.test.tsx:262).

I found no further defects in arrival/Back/restore spending, arm-before-check recovery, ModeBoundary token retirement, visitor zero-request composition, stale versus outdated display, plain-text rendering, or Simple/Gists Depth behavior.

Tests:

- Scoped Vitest command across all 16 non-Postgres stage test files plus `public-dto` and `url-state`: **18 files, 658 tests passed**.
- `npx vitest run tests/doc-links.test.ts`: **1 file, 14 tests passed**.
- Mutation run of `tests/shared-inventory.test.ts`: **1 intended failure, 63 passes**; it specifically caught the removed Simple validator.
- `npm run typecheck`: **exit 1 before TypeScript ran**, because `tsx` could not create its IPC socket (`EPERM`).
- `node --import tsx scripts/typecheck.ts`: **exit 0**, all four projects passed; **2,451 source files covered**.
- `npx vitest run --project private-postgres tests/public-visibility-pg.test.ts`: **exit 1, zero tests collected**; Postgres was unreachable from the sandbox (`EPERM` to `127.0.0.1:54362`), so this is not a pass.
- Scoped Biome check: **no errors**; one pre-existing warning and one informational complexity notice in unrelated `pg.ts` lines.
- `git diff --check`: **exit 0**.