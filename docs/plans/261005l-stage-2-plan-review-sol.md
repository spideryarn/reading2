The server access model is sound: with the proposed predicate, the 409 reveals only that a shared, unpublished article has a pending import. The main security gap is in the proposed client registry, which would now retain a secret key across reader changes.

This was an independent, read-only pass. No files changed. The existing public-import guard passed: 14 tests. Stage 2 is unbuilt, so findings concern the plan and the contracts it must preserve.

1. **F1 — P1: bind the private-link controller to the reader session.**  
   Location: [plan:292](/var/tmp/spideryarn-worktrees/import-permalink-and-share/docs/plans/261005l-permalink-and-share-while-an-article-is-importing.md:292), [add-share.ts:470](/var/tmp/spideryarn-worktrees/import-permalink-and-share/src/web/add-share.ts:470).

   The proposed registry is keyed only by slug, per tab. That is insufficient once its state contains a private-link key. A direct account change can preserve the mounted add page: [App.tsx:464](/var/tmp/spideryarn-worktrees/import-permalink-and-share/src/web/App.tsx:464) supplies no reader identity or reader key. Consequently, A’s successful private link could remain visible to B without a new attachment triggering revalidation. Holding the POST’s job locally also removes the protection previously supplied by the session-bound job list.

   **Change:** scope controllers and held jobs to the reader identity; retire controllers on session change and fence outstanding replies. Remounting `AddPage` by reader identity helps, but does not alone clear a module-level registry. Add tests for direct A→B switching and A’s response arriving after the switch. This is a reasoned security defect in the proposed design, not a built vulnerability.

2. **F2 — P2: explicitly include error serialization in the server work.**  
   Location: [plan:317](/var/tmp/spideryarn-worktrees/import-permalink-and-share/docs/plans/261005l-permalink-and-share-while-an-article-is-importing.md:317), [routes.ts:7720](/var/tmp/spideryarn-worktrees/import-permalink-and-share/src/routes.ts:7720).

   A new error with `status = 409` survives `public-reader`’s scrubber and reaches the outer API catch as 409. Its `code`, however, is omitted unless `declaredFields` explicitly recognizes the class. Merely declaring `StillBeingAdded.code` does not produce the planned body.

   **Change:** name the leaf error class, its numeric status, and the new `declaredFields` branch in the plan. Test the exact JSON through `handleApi`, including that an unrelated 409 does not become `still-being-added`. Keep its message fixed and article-independent.

3. **F3 — P2: the owner does not currently get checked first.**  
   Location: [plan:334](/var/tmp/spideryarn-worktrees/import-permalink-and-share/docs/plans/261005l-permalink-and-share-while-an-article-is-importing.md:334), [ArticlePage.tsx:176](/var/tmp/spideryarn-worktrees/import-permalink-and-share/src/web/article/ArticlePage.tsx:176).

   `OwnerNotShared` mounts only after access resolves to `not-shared`. `findArticle` first asks the owned article route; its unpublished 404 then falls through to the public read. Once that read returns the new result, a shared import’s owner reaches the visitor branch. They lose the job card, failure reason and Retry.

   **Change:** explicitly run the existing owner-job detection for a signed-in `still-being-added` result, with the visitor page as its fallback. Preserve the fresh-list barrier and completed-job race handling. Test owner, signed-in non-owner and signed-out visitor separately.

4. **F4 — P2: specify how the held job follows Retry.**  
   Location: [plan:267](/var/tmp/spideryarn-worktrees/import-permalink-and-share/docs/plans/261005l-permalink-and-share-while-an-article-is-importing.md:267), [AddPage.tsx:1229](/var/tmp/spideryarn-worktrees/import-permalink-and-share/src/web/AddPage.tsx:1229).

   The current Retry callback stores only the replacement’s ID. Keeping only the original add POST’s job either leaves Retry without an immediate card or, with an unguarded fallback, draws the old job and old slug until polling catches up.

   **Change:** keep the returned job in the existing source-tagged `started` record and update it from both add and Retry responses. Use it only when both source and job ID match the current request. Preserve the existing POST guard and late-response check. Test a replacement with a new ID and slug before the list contains it.

5. **F5 — P2: queued/running does not prove an import is actively progressing.**  
   Location: [plan:325](/var/tmp/spideryarn-worktrees/import-permalink-and-share/docs/plans/261005l-permalink-and-share-while-an-article-is-importing.md:325), [jobs.ts:4368](/var/tmp/spideryarn-worktrees/import-permalink-and-share/src/jobs.ts:4368).

   A dead claimant can remain `running` with an expired lease until an authenticated job-list or advance request settles it. Anonymous polling does neither. The proposed status test can therefore show “still being added” indefinitely for an abandoned worker, contradicting the stated guarantee.

   **Change:** define “pending” precisely. If expired running claims must return 404, use the existing lease predicate in this read; do not invoke the mutating sweep publicly. Queued work can still wait for the owner’s browser, so avoid claiming that queue membership guarantees progress. Add an expired-lease case.

6. **F6 — P3: the comments 404 check risks proving nothing.**  
   Location: [plan:366](/var/tmp/spideryarn-worktrees/import-permalink-and-share/docs/plans/261005l-permalink-and-share-while-an-article-is-importing.md:366).

   There is no separate public comments endpoint. Comments, searches and the source guess arrive inside the article payload. A request to an invented `/api/public/comments/...` route returns 404 even for a published article.

   **Change:** assert the pending article response contains exactly the intended error fields, with no embedded metadata or adjunct payload. Give the head and asset checks published positive controls; for the asset, use a real stored manifest entry.

For **2c**, the safe query is an ownerless existence read from `articles`, with `publicAccessWhere(slug, access)` and an explicit `current_revision_id IS NULL`, plus a correlated `EXISTS` on jobs:

- `jobs.slug = articles.slug`
- `jobs.owner_id = articles.owner_id`
- the agreed pending-status predicate

Jobs have **no `articleId` column**. `draftRevisionId` is unsuitable because queued jobs may not yet have a draft. Select only a constant or boolean; no job title, URL, profile, error or progress needs to enter the result. Import the schema table directly, rather than calling the authenticated job store. `ACTIVE` is available from the ownerless `src/store/jobs.ts` leaf.

This deliberately widens the public table boundary: [tests/public-imports.test.ts:425](/var/tmp/spideryarn-worktrees/import-permalink-and-share/tests/public-imports.test.ts:425) currently excludes `jobs`. Add the narrow permission and SQL tests proving the access predicate, owner/slug correlation and null revision condition. Keep the owner and writer import prohibitions.

I checked these claims and found them true:

- **Private access fails closed:** no key, wrong key, malformed key and a revoked key cannot match a private row. Public access deliberately wins regardless of key. Another owner’s shared article is readable under those same rules; the requester’s identity grants nothing.
- **Archiving preserves direct sharing access.** It removes an article from listings, not from shared-link reads. A pending archived article returning 409 is consistent with published behavior.
- **Minimal papers cannot normally enter this branch:** both sharing writers refuse `processing = "minimal"`. The public predicate itself does not exclude minimal papers, so this relies on those write rules.
- **Published mode jobs cannot trigger it.** The current-revision read succeeds first. A broken published revision still fails its tree/block checks rather than becoming an import.
- **`openEarly` publication bypasses it:** the provisional publication sets `currentRevisionId`, and its stand-in tree is readable.
- **The head remains generic and 404 before publication.** Head and asset reads independently require a current revision. The new article arm need not expose title, owner or content.
- **Caching and reporting are compatible:** the public namespace sets `no-store` before dispatch, including errors. Public fetching bypasses the offline cache. A chosen 409 logs a query-free path and its fixed message at warning level; it does not trigger server failure reporting. There is no separate public-dispatcher catch that remaps it.
- **Timing:** inaccessible and absent rows both take the failed revision read and the additional lookup. Keeping authorization inside the same existence query avoids introducing a separate authorization-dependent request path. This is not a constant-time guarantee.
- **2b’s routes work before publication:** GET reads the owned article row; POST creates/rotates the key with exactly `{ rightsConfirmed: true }`; DELETE turns it off. None requires a published revision. No additional quota is charged; minimal processing is the substantive refusal besides missing ownership/row.
- **Existing key handling stays confined:** the owner endpoint is excluded from offline storage and uses `private, no-store`; audit rows omit keys; HTTP logs omit query strings. The key intentionally reaches the copied `/read/:slug?key=...` URL and public fetch URL. It needs no `sessionStorage` mark.
- **2a can preserve StrictMode and upload ownership:** retain the existing posting guards. The upload engine already holds its returned `Job` in `mine.phase.job`, so using that snapshot as the same guarded fallback would remove the planned upload exception without another POST.

The simpler implementation is to extend the existing source-tagged job record, share only the controller lifecycle machinery that actually matches, and keep the private link’s truth-reading behavior separate from the public switch’s marks.

“Done looks like” should also cover revoked/rotated keys, cancelled jobs, cross-owner job correlation, archived and minimal rows, `openEarly`, generic error-body shape, session changes, uncertain POST results without automatic key rotation, and polling cleanup on slug/key changes, hiding and unmounting. Visitor publication, failure and unsharing transitions need distinct tests.

**Verdict: revise before building. The 2c access design is sound; the P1 reader-session isolation gap and the P2 lifecycle gaps need closing.**