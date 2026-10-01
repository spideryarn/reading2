# Code review: bulk import, Stage 4 — the browser (261001m)

You are reviewing, and you may fix what you find. The plan:
`docs/plans/261001m-bulk-import-of-many-papers-a-stepping-stone.md` § Greg's answers (point 6:
opening a minimal paper shows it with *Read this* one click away and never starts the import by
itself; and the 19:55 addition: a batch takes a mix of PDFs and HTML), § The build → *The batch,
in the browser*, § *What Sol's plan review changed* items 4 and 7, § Stages item 4. Stages 1–3 (the
server) are committed. Their contract is in `docs/project/ingest-queue.md` § *A minimal upload,
and Read this*.

`docs/plans/261001m-bulk-import-stage4.diff` is the uncommitted Stage 4 diff, and only that:

- new: `src/web/{batchUpload.ts,BatchPanel.tsx,ReadThis.tsx,read-this.ts}` and
  `src/web/article/UnreadPaperPage.tsx`;
- changed: `jobEngine.ts`, `upload.ts`, `useJobs.ts`, `UploadPicker.tsx`, `AddArticle.tsx`,
  `Library.tsx`, `ShelfEntry.tsx`, `library-columns.tsx`, `article/access.ts`, `ArticlePage.tsx`;
- tests: `tests/{job-engine-terminal,batch-upload}.test.ts` and `tests/minimal-paper-ui.test.tsx`;
- docs: `ingest-queue.md` § Many at once, and `library.md`.

Read `docs/project/ingest-queue.md` § *The browser is the worker* (the three-place session fence,
the completion cursor, the 401 pause) and `docs/project/web-client.md` first.

Check above all:
1. **`watchTerminal`.**
   - Is it fed by both `/advance` and list reconciliation?
   - Is "vanished" only after a post-registration authoritative list?
   - Is it fenced on the session in every callback?
   - Can a pending watcher leak a poll loop for ever, or keep polling after sign-out?
2. **The batch engine.**
   - Is concurrency held at 3 until the terminal state?
   - Is each file hashed once, one at a time, and never the whole drop in memory?
   - Is a file deduplicated within the drop?
   - Do a duplicate 409, a quota 402 (the queue stops and nothing is half-sent), an error or a
     cancel all keep the queue moving?
   - Stop, Retry, and the sign-out fence.
   - Does a 401 pause it the way the job engine pauses?
   - Can one bad file stall the rest?
3. **No silent spend.**
   - Does anything start *Read this* without the reader pressing it?
   - Does a batch ever send a non-minimal upload?
   - Does a single file still take today's path, unchanged?
   - Is the *Generate the main modes* tick box honoured only after *Read this* completes, never on a
     minimal job?
4. **The minimal card and page.**
   - The marker, the abstract disclosure, the DOI link (validated), the source link (PDF only), and
     that Rebuild, sharing and High-powered controls are hidden.
   - The 409 `unread` state in `access.ts`: does any other 409 still render as an error?
   - Is there a cross-owner leak?
5. **Copy.** Plain, and in line with `docs/project/copy.md`. The builder notes that
   `quotaRefusalCode` in `src/messages.ts` does not know `[pay-minimal]`, so `QuotaNotice` draws
   no link for it, and that BatchPanel links `/pricing` itself. Fix that properly on the server
   side if it is small: teach `quotaRefusalCode` / `QUOTA_CODES` about `[pay-minimal]` (and
   `[pay-reading]` if it belongs there), and have the panel use `QuotaNotice`.
6. **Narrow windows** (`docs/project/narrow-windows.md`): the batch panel's rows and the minimal
   card at 390px, read from the CSS and markup.
7. **The client copy of `isMinimalJob`** (in `read-this.ts`): it must agree with the server's in
   `src/minimal-paper.ts`, which since your Stage 3 review requires exactly `["fetch","metadata"]`.
   Is there a test that would go red if the two drift?
8. The tests: would they catch the obvious mistakes?

No git commands that change the index or discard work; no commits. Run `npm run typecheck` (or
`node --import tsx scripts/typecheck.ts`) and
`npx vitest run tests/job-engine-terminal.test.ts tests/batch-upload.test.ts tests/minimal-paper-ui.test.tsx tests/client-imports.test.ts tests/eager-client-graph.test.ts tests/messages.test.ts`
plus whatever you change.

Report: numbered findings (P0/P1/P2) with file:line and what you changed for each, the test
results, anything wider left unfixed, and a one-line verdict.
