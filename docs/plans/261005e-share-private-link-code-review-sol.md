No P0 bypass or automatic key leak found. Two established P1 findings are fixed. One wider disclosure error remains. **Database verification is still needed before accepting Stage 1.** No commits or migration edits were made.

1. **C1 — P1, established, fixed: misleading owner sharing marks.**  
   An owner could create a private link and still see “Only you can read this” in the [masthead](/var/tmp/spideryarn-worktrees/share-private-link/src/web/Masthead.tsx:844). Both shelf renderers also omitted the private-link badge. The owner payload now carries only `privateLinkOn`, derived in [pg.ts](/var/tmp/spideryarn-worktrees/share-private-link/src/store/pg.ts:2878). Marks read it, and creation/off/uncertain results propagate to the mounted article view. Unknown state cannot claim exclusivity.  
   Red-first tests: `masthead-sharing-mark`, `shelf-shared-badge`, `library`, `metadata-sharing-card`, and `shelf-cached-paint`. All now pass. Added database assertions remain unrun.

2. **C2 — P1, established, fixed: private-link promises ignored existing public access.**  
   Creating a link on an already-public article displayed “It is not listed anywhere” in [messages.ts](/var/tmp/spideryarn-worktrees/share-private-link/src/messages.ts:4465), while the public warning appeared only after creation. Privacy/help repeated the listing promise; the feature page unconditionally promised no chat-preview title. Public listing and metadata correctly continued working.  
   Confirmation now warns before creation, and the pages qualify promises to articles shared **only** by private link. Red-first tests: `private-link-card`, `privacy-page`, and `public-readable-sharing-page`. All now pass.

3. **C3 — P1, established, wider/pre-existing, not fixed: inaccurate image disclosure.**  
   The consent inventory says every image is fetched from the publisher in [messages.ts](/var/tmp/spideryarn-worktrees/share-private-link/src/messages.ts:4628). Visitors actually fetch stored images through Spideryarn’s public asset endpoint via [rehost.ts](/var/tmp/spideryarn-worktrees/share-private-link/src/web/rehost.ts:1036); publisher loading is fallback behavior. This reaches both sharing controls. The sentence predates this stage (`f1222bb248`); ordinary-image rehosting (`5f79493b0`) made it stale. Left unchanged as wider work.

Root causes and countermeasures are recorded in the [postmortem](/var/tmp/spideryarn-worktrees/share-private-link/docs/postmortems/261005n-adding-an-access-path-does-not-replace-the-old-one.md).

Verification: **31 targeted local files, 807 tests passed**, all four typecheck projects passed, scoped lint passed, and `git diff --check` passed. No full suite, build, or real browser run. `owner-isolation` could not run because its current test configuration invokes database setup.

The following verdicts reflect source review and available local tests; database behavior was not independently executed here.

| # | Verdict |
|---|---|
| 1 | **Not accurate literally.** Public doors authorize in SQL, but [the block query](/var/tmp/spideryarn-worktrees/share-private-link/src/store/public-reader.ts:760) uses the revision ID returned by the guarded query without comparing the key again. No unauthorized-ID caller found. |
| 2 | **Accurate.** Named projections and DTO allowlists preserve the one-article boundary and exclusions. |
| 3 | **Accurate.** Library/showcase predicates require public visibility. |
| 4 | **Accurate from source.** Off clears the pair; creation uses `randomBytes(16)` and replaces the key. Database confirmation pending. |
| 5 | **Accurate for automatic application flows reviewed.** No token serialization or logging path found outside owner share-link responses; export, feedback, monitoring and persistence boundaries exclude it. |
| 6 | **Accurate from source.** Owner predicates, rights confirmation and minimal-processing refusal are present. |
| 7 | **Accurate for the shared article.** The key grants no write or paid-work authority. |
| 8 | **Accurate.** Public access wins regardless of the key. |
| 9 | **Accurate.** Authorized private HTML gets the plain 200 shell, without article metadata. |
| 10 | **Accurate as migration/code compatibility.** Additive nullable columns and a new table; not applied here. Production execution/locking was not checked. |
| 11 | **Accurate.** Billing still follows public visibility; link-only sharing retains private pricing. |
| 12 | **Not accurate overall.** C1/C2 corrected; C3 remains. |

Files changed:

```text
docs/project/public-readable-sharing.md
docs/postmortems/261005n-adding-an-access-path-does-not-replace-the-old-one.md
src/library-scalars.ts
src/messages.ts
src/store/pg.ts
src/types.ts
src/web/Masthead.tsx
src/web/Metadata.tsx
src/web/PaperCard.tsx
src/web/PrivacyPage.tsx
src/web/PrivateLink.tsx
src/web/PublicReadableSharingPage.tsx
src/web/ShelfEntry.tsx
src/web/article/ArticlePage.tsx
src/web/help/help-topics.tsx
src/web/lib/cached-shelf.ts
src/web/library-columns.tsx
tests/library.test.ts
tests/masthead-sharing-mark.test.tsx
tests/metadata-sharing-card.test.tsx
tests/privacy-page.test.ts
tests/private-link-card.test.tsx
tests/public-readable-sharing-page.test.tsx
tests/share-link-pg.test.ts
tests/shelf-cached-paint.test.tsx
tests/shelf-shared-badge.test.tsx
```

Please run these database files individually:

- `share-link-pg`: access failures, ownership, rights/minimal refusal, rotation/revocation, audit behavior, owner boolean false→true→false, and no public boolean/token.
- `owner-isolation`: the sanctioned leaf and owner-route isolation guards.
- `public-visibility-pg` and `asset-route`: public behavior unchanged; private article/assets require the current matching key and remain uncached.
- `feedback-route`: keys absent from stored reports and email inputs.
- `store-export-bundle`: token excluded from exports.
- `store-shelf-pg`: shelf projections and public-list exclusion.
- `db-schema-drift`: migration and schema agree.