Found three regressions and fixed all three red-first. No commits, docs edits, or quotation changes.

- **F20 — P1, established, fixed:** Give `useShelf.restore` a successful `{ entry: null, purpose: null }` response. It inserted null into the active list, crashing rendering with “Cannot read properties of null.” Archive and Undo could similarly insert null; rename dereferenced it. Previously the 404 reached their error handlers. The shared PATCH helper now checks for null before changing any list and explains that the change was saved but could not be shown.

- **F21 — P1, established, fixed:** Give `useArticleRename` the same response. It displayed “Couldn't rename it: Cannot read properties of null,” although the title was saved. It now handles null explicitly, preserves the displayed heading, and asks the reader to refresh to confirm the saved title.

- **F22 — P1, established contract violation, fixed:** `pgShelfStore.patch("missing-article", {})` resolved null instead of rejecting with not-found. The empty-change branch skipped the existence check; it also queried the wrong shelf half for archived articles. It now reads the owned row first and uses its actual archive state. The HTTP route already rejects empty changes, so this defect did not affect the add page.

The caller audit found one production `shelfStore.patch` caller: `routes.ts`’s `patchShelf`. The endpoint’s clients are `useShelf`, `useArchive`, `useArticleRename` in `TitleEditor.tsx`, and `savePurpose`/`leavePurpose` in `purpose.ts`. The universal null-handling statement was false because of F20 and F21. `patchShelf` passes null through; `savePurpose` reads only `purpose`; `leavePurpose` consumes no response body. `useArchive` already checks for null and rereads metadata to establish archive state.

No second write followed by a publication-filtered response read was found in the purpose flow. Both PATCH’s follow-up purpose read and `GET /api/reader?slug=` use `shelfStore.read`, which selects directly from the owned `articles` row. An unpublished row therefore reads successfully. Before the row exists, the reader endpoint reports `purposeFailed: true`. The keepalive PATCH uses the same corrected route.

Failure or cancellation leaves the article row and its purpose intact; it fails the draft rather than deleting the article. An ordinary retry reuses that row and retains its purpose. A fresh add after a failed first import mints another slug. If a retry adopts another already-published article for that URL, it uses that article’s own purpose—the abandoned row’s purpose is not copied.

The round-1 changes remain compatible. The add-page tests now explicitly return `entry: null`, including their handoff and suspended-render cases. The previously accepted F1 keepalive write-ordering limitation remains.

**Validation:** 181 tests passed across six files, run individually without network or Postgres. Typechecking, touched-file lint, and `git diff --check` passed. Typechecking used `node --import tsx scripts/typecheck.ts` because the npm wrapper hit the sandbox IPC restriction.

Changed files:

- [pg-shelf.ts](/home/greg/code/spideryarn2/.claude/worktrees/purpose-autosave/src/store/pg-shelf.ts), [contracts.ts](/home/greg/code/spideryarn2/.claude/worktrees/purpose-autosave/src/store/contracts.ts), [useShelf.ts](/home/greg/code/spideryarn2/.claude/worktrees/purpose-autosave/src/web/useShelf.ts), [TitleEditor.tsx](/home/greg/code/spideryarn2/.claude/worktrees/purpose-autosave/src/web/TitleEditor.tsx)
- [shelf-patch-empty.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/purpose-autosave/tests/shelf-patch-empty.test.ts), [shelf-cached-paint.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/purpose-autosave/tests/shelf-cached-paint.test.tsx), [article-rename.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/purpose-autosave/tests/article-rename.test.tsx), [add-page-purpose.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/purpose-autosave/tests/add-page-purpose.test.tsx)

SHIP WITH CHANGES