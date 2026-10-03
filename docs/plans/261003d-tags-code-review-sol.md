No P0 findings. I fixed two P1 state races and six P2 defects/test gaps.

1. **P1 — restoring an article during a tag edit could recreate its archived overlay.** `null` was treated as “missing,” allowing the stale archived array to win. Fixed the sentinel handling in [useShelf.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbqmev0s-your-own-tags/src/web/useShelf.ts:507). Added the exact interleaving regression in [shelf-cached-paint.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbqmev0s-your-own-tags/tests/shelf-cached-paint.test.tsx:625).

2. **P1 — an in-flight Metadata read could permanently overwrite a successful tag edit.** The PATCH now arms `useOrderedRead`’s trailing refresh before updating provenance in [Metadata.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbqmev0s-your-own-tags/src/web/Metadata.tsx:918). Regression coverage is in [metadata-rerun-section.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbqmev0s-your-own-tags/tests/metadata-rerun-section.test.tsx:704).

3. **P2 — malformed UTF-16 could be accepted and stored under a different value.** Lone surrogates are now rejected before Node replaces them with U+FFFD in [tags.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbqmev0s-your-own-tags/src/tags.ts:43), with normalization and store-boundary tests.

4. **P2 — the accepted CHECK-to-400 contract was only documented.** Named `article_tags_spelling` violations are now recognized through wrapped database errors and translated to 400 in [db-errors.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbqmev0s-your-own-tags/src/store/db-errors.ts:284) and [pg-tags.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbqmev0s-your-own-tags/src/store/pg-tags.ts:40). Other CHECK failures remain untouched.

5. **P2 — legacy cached entries retained `tags: undefined`.** The cache boundary now normalizes accepted pre-tags entries to `tags: []` in [cached-shelf.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbqmev0s-your-own-tags/src/web/lib/cached-shelf.ts:165).

6. **P2 — displayed tag chips made dead areas over the card link.** Only the popover button is now lifted above the stretched link in [ShelfTags.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbqmev0s-your-own-tags/src/web/ShelfTags.tsx:30). A meaningful regression needs browser hit-testing; jsdom cannot prove stacking behavior.

7. **P2 — IME Enter could submit partially composed text.** Composition key events are ignored in [TagEditor.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbqmev0s-your-own-tags/src/web/TagEditor.tsx:165). I also corrected the listbox markup and replaced the failed-save assertion that could not detect an erroneous optimistic chip.

8. **P2 — several tests could remain green after breaking their subject.** I added or strengthened coverage for:

   - successful and failed cache invalidation;
   - shelf stale-read and archived-overlay races;
   - actual Library wiring for Tags + Topics + archived rows and equal counts;
   - public article/head/asset/listing SQL excluding `article_tags`;
   - legacy cached tags;
   - CHECK translation;
   - the cap test now observing a real lock wait through `pg_blocking_pids`, instead of treating a 400 ms delay as evidence.

Ownership/privacy otherwise looks sound: writes resolve through `ownedSlug`, vocabulary through `ownedByReader`, shelf and Metadata attach tags only to owner-scoped article IDs, export starts from the owned article, and public projections never query `article_tags`.

Checks:

- Focused Vitest: **8 files, 171 tests passed**.
- Typecheck script: all four projects passed, covering 2,789 files.
- `npm run typecheck` itself could not start because the sandbox denied `tsx`’s `/tmp` IPC socket; running the same script through `node --import tsx` passed.
- The live Postgres test could not start because this sandbox denied `127.0.0.1:54362` and Docker access.
- Focused lint completed with no errors.
- No commit made.

One wider integration issue: this HEAD is behind `origin/dev` by the recent preload work, so the current comparison shows those files as deletions. Merge current `dev` before landing.

**Verdict: yes, I would ship the tag change after merging current `dev` and running the database-only tag test where Postgres is reachable.**