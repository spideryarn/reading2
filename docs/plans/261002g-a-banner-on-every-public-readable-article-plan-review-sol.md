No P0 findings. The public predicate and URL policy are fundamentally sound, but the plan needs several corrections before implementation.

## P1

1. **The proposed public shape cannot use `GuessedSourceLink` as claimed.**

   The plan says:

   > “No `matchedBy`…” and “the tip wording keys on `kind`.”  
   > — [plan:56](</home/greg/code/spideryarn2/.claude/worktrees/fbger3a3-public-readable-banner/docs/plans/261002g-a-banner-on-every-public-readable-article.md:56>)

   That is false. A found `SourceGuess` requires `matchedBy` ([types.ts:1862](</home/greg/code/spideryarn2/.claude/worktrees/fbger3a3-public-readable-banner/src/types.ts:1862>)), and `guessTip` explicitly distinguishes DOI from arXiv using it ([Masthead.tsx:586](</home/greg/code/spideryarn2/.claude/worktrees/fbger3a3-public-readable-banner/src/web/Masthead.tsx:586>)). `GuessedSourceLink` accepts that full type ([Masthead.tsx:637](</home/greg/code/spideryarn2/.claude/worktrees/fbger3a3-public-readable-banner/src/web/Masthead.tsx:637>)).

   Simplest correction: publish `matchedBy` too. It is not private. Otherwise this needs a separate public guess type, tooltip, and renderer rather than “the same component.”

2. **“First published at” is not established by either source path.**

   The plan proposes:

   > “First published at…” / “Probably first published at…”  
   > — [plan:50](</home/greg/code/spideryarn2/.claude/worktrees/fbger3a3-public-readable-banner/docs/plans/261002g-a-banner-on-every-public-readable-article.md:50>), [plan:68](</home/greg/code/spideryarn2/.claude/worktrees/fbger3a3-public-readable-banner/docs/plans/261002g-a-banner-on-every-public-readable-article.md:68>)

   The ordinary URL is only Stage 1’s post-redirect `final_url` ([dto.ts:155](</home/greg/code/spideryarn2/.claude/worktrees/fbger3a3-public-readable-banner/src/public/dto.ts:155>)); it may be a syndicated copy. A guessed canonical is a verified DOI/arXiv address, while a matching guess is merely a page containing the same paper ([260929g:102](</home/greg/code/spideryarn2/.claude/worktrees/fbger3a3-public-readable-banner/docs/plans/260929g-canonical-link-for-an-uploaded-paper.md:102>)). Neither proves chronology.

   Use “Source:”, “Read it at”, or “This copy came from”; retain “Probably the original” for canonical guesses.

3. **The plan omits mandatory security-guard changes, so the planned implementation will fail existing tests.**

   Importing `uploadSourceGuesses` into the public graph fails the explicit table allowlist, which currently permits six tables and says a seventh requires the same security justification ([public-imports.test.ts:295](</home/greg/code/spideryarn2/.claude/worktrees/fbger3a3-public-readable-banner/tests/public-imports.test.ts:295>), [public-imports.test.ts:349](</home/greg/code/spideryarn2/.claude/worktrees/fbger3a3-public-readable-banner/tests/public-imports.test.ts:349>), [public-imports.test.ts:385](</home/greg/code/spideryarn2/.claude/worktrees/fbger3a3-public-readable-banner/tests/public-imports.test.ts:385>)).

   A new query joining `articles` must also be named in the ownerless-query inventory ([owner-isolation.test.ts:526](</home/greg/code/spideryarn2/.claude/worktrees/fbger3a3-public-readable-banner/tests/owner-isolation.test.ts:526>), [owner-isolation.test.ts:553](</home/greg/code/spideryarn2/.claude/worktrees/fbger3a3-public-readable-banner/tests/owner-isolation.test.ts:553>)). It should join the SQL-level assertions used for comments and searches too ([public-reads.test.ts:376](</home/greg/code/spideryarn2/.claude/worktrees/fbger3a3-public-readable-banner/tests/public-reads.test.ts:376>)).

   The plan’s test list only names a Postgres behaviour test ([plan:148](</home/greg/code/spideryarn2/.claude/worktrees/fbger3a3-public-readable-banner/docs/plans/261002g-a-banner-on-every-public-readable-article.md:148>)).

4. **Moving the origin line leaves the second `SharedNotice` call site and the sharing page inconsistent.**

   `SharedNotice` also appears on the visitor metadata page, immediately after that page’s separate `SourceRow` ([PublicPages.tsx:118](</home/greg/code/spideryarn2/.claude/worktrees/fbger3a3-public-readable-banner/src/web/PublicPages.tsx:118>), [PublicPages.tsx:135](</home/greg/code/spideryarn2/.claude/worktrees/fbger3a3-public-readable-banner/src/web/PublicPages.tsx:135>)). Giving `SharedNotice` a source there either duplicates `SourceRow`, or the banner differs between the two views. The plan discusses neither.

   More importantly, the public sharing page promises that the source is “directly beneath” the title ([PublicReadableSharingPage.tsx:240](</home/greg/code/spideryarn2/.claude/worktrees/fbger3a3-public-readable-banner/src/web/PublicReadableSharingPage.tsx:240>)); moving it below the masthead and notice copy makes that false. The project doc likewise says `OriginLine` is beneath the title ([public-readable-sharing.md:46](</home/greg/code/spideryarn2/.claude/worktrees/fbger3a3-public-readable-banner/docs/project/public-readable-sharing.md:46>)).

   The plan should either keep the masthead line or explicitly cover both call sites, `SourceRow`, the sharing page, its project doc, and their tests.

## P2

1. **Do not publish the stored `host` column unchanged.**

   `host` is independent free text; no database constraint ties it to `url` ([schema.ts:4026](</home/greg/code/spideryarn2/.claude/worktrees/fbger3a3-public-readable-banner/src/db/schema.ts:4026>), [schema.ts:4065](</home/greg/code/spideryarn2/.claude/worktrees/fbger3a3-public-readable-banner/src/db/schema.ts:4065>)). Today `GuessedSourceLink` normally recomputes the visible host from the parsed URL, using the stored field only as fallback ([Masthead.tsx:644](</home/greg/code/spideryarn2/.claude/worktrees/fbger3a3-public-readable-banner/src/web/Masthead.tsx:644>)).

   Sanitize `url` first, then derive `host` from that sanitized value in the public DTO. Better still, omit `host` from the database projection.

2. **The guess is article-scoped, not revision- or source-scoped.**

   `upload_source_guesses` is keyed only by `article_id` ([schema.ts:4022](</home/greg/code/spideryarn2/.claude/worktrees/fbger3a3-public-readable-banner/src/db/schema.ts:4022>)), and `sourceGuessFor` reads only by article id ([source-guess-row.ts:42](</home/greg/code/spideryarn2/.claude/worktrees/fbger3a3-public-readable-banner/src/store/source-guess-row.ts:42>)).

   Normal re-extraction carries the same raw source hash/reference forward ([pg-revisions.ts:225](</home/greg/code/spideryarn2/.claude/worktrees/fbger3a3-public-readable-banner/src/store/pg-revisions.ts:225>)), so this is not presently a demonstrated leak. But nothing prevents a future source-replacement path from publishing a previous document’s guess. The plan should state and test the current invariant, or bind the guess to `raw_source_sha256`.

3. **Two plan inventory statements are false.**

   The plan says takedown is “only on the article’s details page” ([plan:24](</home/greg/code/spideryarn2/.claude/worktrees/fbger3a3-public-readable-banner/docs/plans/261002g-a-banner-on-every-public-readable-article.md:24>)), but it is already prominent at the top of the public shelf ([PublicLibraryPage.tsx:157](</home/greg/code/spideryarn2/.claude/worktrees/fbger3a3-public-readable-banner/src/web/PublicLibraryPage.tsx:157>)).

   It also says the `<h1>` remains a way to the original ([plan:48](</home/greg/code/spideryarn2/.claude/worktrees/fbger3a3-public-readable-banner/docs/plans/261002g-a-banner-on-every-public-readable-article.md:48>)). That is true only when `meta.url` exists; an upload’s guessed source does not make the `<h1>` a link ([Masthead.tsx:171](</home/greg/code/spideryarn2/.claude/worktrees/fbger3a3-public-readable-banner/src/web/Masthead.tsx:171>)).

## Security verdict

The proposed own query is the right boundary if it:

- selects named columns;
- joins back to `articles`;
- has `publicSlug(slug)` and `status = 'found'` in its own SQL `WHERE`;
- runs `url` through `publicSourceUrl`;
- derives the displayed host from that accepted URL.

`publicSlug` enforces slug plus public visibility ([public-slug.ts:40](</home/greg/code/spideryarn2/.claude/worktrees/fbger3a3-public-readable-banner/src/store/public-slug.ts:40>)). `publicSourceUrl` rejects credentials, queries, IP literals, short intranet names, and private-looking suffixes ([urls.ts:163](</home/greg/code/spideryarn2/.claude/worktrees/fbger3a3-public-readable-banner/src/urls.ts:163>), [urls.ts:240](</home/greg/code/spideryarn2/.claude/worktrees/fbger3a3-public-readable-banner/src/urls.ts:240>)). It cannot detect a public DNS name resolving inward ([urls.ts:281](</home/greg/code/spideryarn2/.claude/worktrees/fbger3a3-public-readable-banner/src/urls.ts:281>)), but guessed matching pages were already fetched through the DNS/private-address guard ([paper-text.ts:17](</home/greg/code/spideryarn2/.claude/worktrees/fbger3a3-public-readable-banner/src/paper-text.ts:17>)). I see no direct private-article leak in that design.

## Copy verdict

The no-training sentence is correctly hedged and matches both public authorities: `/privacy` ([PrivacyPage.tsx:353](</home/greg/code/spideryarn2/.claude/worktrees/fbger3a3-public-readable-banner/src/web/PrivacyPage.tsx:353>)) and the sharing page ([PublicReadableSharingPage.tsx:328](</home/greg/code/spideryarn2/.claude/worktrees/fbger3a3-public-readable-banner/src/web/PublicReadableSharingPage.tsx:328>)).

The takedown sentence is also supportable because it links to the qualification: making the article private, days rather than hours, and erasure only when requested ([PrivacyPage.tsx:740](</home/greg/code/spideryarn2/.claude/worktrees/fbger3a3-public-readable-banner/src/web/PrivacyPage.tsx:740>)). “What that involves” is load-bearing and should remain.

## Layout verdict and simpler option

The CSS is safe: masthead and notice use identical hiding conditions ([narrow-window.css:349](</home/greg/code/spideryarn2/.claude/worktrees/fbger3a3-public-readable-banner/src/web/styles/narrow-window.css:349>), [narrow-window.css:360](</home/greg/code/spideryarn2/.claude/worktrees/fbger3a3-public-readable-banner/src/web/styles/narrow-window.css:360>)). There is no state where this rule hides the banner but leaves the masthead visible.

The simpler v1 is to leave `OriginLine` in the masthead and repeat the source inside the banner. That avoids conditional masthead behaviour, preserves the sharing page’s current promise, and treats the duplication as deliberate provenance emphasis. For the public guess, include `matchedBy`, derive `host` from the sanitized URL, and use the existing renderer. No files were edited.