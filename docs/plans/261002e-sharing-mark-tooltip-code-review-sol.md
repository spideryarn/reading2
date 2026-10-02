Found and fixed five issues. No P0s and no unresolved or wider findings remain.

1. **P1 — [src/web/Masthead.tsx:812](/home/greg/code/spideryarn2/.claude/worktrees/fbd886ah-share-tooltip-and-ui-text/src/web/Masthead.tsx:812)**  
   A shared article with unknown archive state incorrectly claimed it was listed publicly. Added a truthful unknown-state message at [src/messages.ts:3678](/home/greg/code/spideryarn2/.claude/worktrees/fbd886ah-share-tooltip-and-ui-text/src/messages.ts:3678) and tri-state handling. The regression test was observed failing before the fix.

2. **P1 — [src/web/Masthead.tsx:896](/home/greg/code/spideryarn2/.claude/worktrees/fbd886ah-share-tooltip-and-ui-text/src/web/Masthead.tsx:896)**  
   `ArchiveMark` collapsed unknown visibility into private and could falsely say “Nothing else changes.” It now accepts `boolean | undefined` and explicitly says the public-list effect could not be confirmed. Both archived and unarchived regression cases were observed failing before the fix.

3. **P2 — [tests/masthead-sharing-mark.test.tsx:258](/home/greg/code/spideryarn2/.claude/worktrees/fbd886ah-share-tooltip-and-ui-text/tests/masthead-sharing-mark.test.tsx:258)**  
   The tests did not independently protect several factual claims because they largely compared rendered text with imported constants. Added semantic assertions for the private/public explanations and press destinations, exact ArchiveMark coverage for all four state combinations, and a same-controller archive/put-back test at [tests/masthead-archive-mark.test.tsx:193](/home/greg/code/spideryarn2/.claude/worktrees/fbd886ah-share-tooltip-and-ui-text/tests/masthead-archive-mark.test.tsx:193).

4. **P3 — [tests/annotation-cost.test.ts:431](/home/greg/code/spideryarn2/.claude/worktrees/fbd886ah-share-tooltip-and-ui-text/tests/annotation-cost.test.ts:431)**  
   Four direct `TableView` test fixtures omitted the new required `notesBy` prop while using casts that hid the error. They would silently exercise visitor wording. Added `notesBy: "you"` there and in `annotation-reuse`, `prose-not-rebuilt`, and `short-selection-in-a-mark`.

5. **P3 — [src/messages.ts:3513](/home/greg/code/spideryarn2/.claude/worktrees/fbd886ah-share-tooltip-and-ui-text/src/messages.ts:3513)**  
   Corrected stale implementation commentary, removed Search from the “never shared” comment, changed leftover `go` terminology to `press`, and fixed JSX spacing at [src/web/Tooltip.tsx:451](/home/greg/code/spideryarn2/.claude/worktrees/fbd886ah-share-tooltip-and-ui-text/src/web/Tooltip.tsx:451).

The factual audit now checks out:

- Stopping sharing makes visibility private, removing both public-list eligibility and stranger access.
- Archiving removes a public article from the list but leaves its public link working.
- Putting it back clears `archivedAt`, so an otherwise-readable shared article is listed again.
- Both marks receive the same archive controller and update immediately after archive/put-back.
- `notesBy` is wired through every production `TableView`/`BlockGutter` path.
- `.tip-soon p.tip-soon-press` outranks `.tip-soon p`; its semantic colour tokens work with the dark theme.

Checks:

- Focused Vitest command: **150 tests passed across 4 files**.
- `npm run typecheck`: the `tsx` launcher was blocked by sandbox IPC permissions (`EPERM` on its `/tmp` socket). Running the identical checker as `node --import tsx scripts/typecheck.ts` passed all 2,702 files.
- Biome lint and `git diff --check`: passed.
- No commit, push, staging, or unrelated-file changes were made.