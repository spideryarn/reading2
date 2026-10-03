I would not approve the plan as written. There are no P0 findings, but several P1s need resolving before implementation.

1. **P1 — The one-table design cannot guarantee case-insensitive identity across articles under concurrency.**

   The unique index is only `(article_id, lower(tag))`. Two first-time requests can concurrently add `AI` to article A and `ai` to article B; both commit, despite the promise that the reader has one spelling everywhere. Grouping the vocabulary by raw `tag` then produces duplicates, and merging both under the same client key can lose membership. See [the proposed invariant and schema](/home/greg/code/spideryarn2/.claude/worktrees/fbqmev0s-your-own-tags/docs/plans/261003d-your-own-tags-on-articles-on-the-shelf-and-the-metadata-page.md:32) and the repository’s warning about absent-row concurrency in [sql.md](/home/greg/code/spideryarn2/.claude/worktrees/fbqmev0s-your-own-tags/docs/project/sql.md:38).

   Concrete fix: either:

   - For the smallest v1, store every tag in one canonical lowercase spelling and drop case preservation.
   - If preserving `AI` matters, use `reader_tags(id, owner_id, label)` with a unique owner-scoped case-insensitive key, plus an article/tag assignment table. Insert the vocabulary row with targeted `ON CONFLICT DO NOTHING`, then read back the winning spelling. Ensure the assignment cannot connect an article to another owner’s vocabulary, ideally with owner-bearing composite foreign keys.

2. **P1 — The 30-tag cap races, and the request itself is uncapped.**

   `READ COMMITTED` alone does not protect “count, then insert.” Two requests seeing 29 tags can both insert and leave 31. The unique index only helps when they add the same tag. A caller can also submit an arbitrarily large `add` or `remove` array even though the cap is described as protection against a script.

   Concrete fix: lock the owned article row with `FOR UPDATE`, then normalize/deduplicate, remove, add, and verify the final count inside that transaction. Reject over-large arrays before entering the transaction. Add a deterministic concurrency test with two writes starting from 29 tags.

   Also correct the claim that add and remove “commute” in [the API section](/home/greg/code/spideryarn2/.claude/worktrees/fbqmev0s-your-own-tags/docs/plans/261003d-your-own-tags-on-articles-on-the-shelf-and-the-metadata-page.md:62): concurrent add/remove of the same tag do not commute. Define ordering, and reject a body that contains the same normalized key in both arrays.

3. **P1 — Optimistic editing can wrongly prune the selected tag from the URL.**

   `useChosenTopics` removes any missing key as soon as `settled` is true ([current effect](/home/greg/code/spideryarn2/.claude/worktrees/fbqmev0s-your-own-tags/src/web/useShelfTerms.ts:191)). If the last matching tag is optimistically removed, the term disappears immediately and the URL is rewritten before the PATCH succeeds. A failed PATCH can restore the tag but cannot restore the reader’s filter.

   A second race comes from stale IndexedDB entries: old cached shelf rows are accepted without tags ([cache validator](/home/greg/code/spideryarn2/.claude/worktrees/fbqmev0s-your-own-tags/src/web/lib/cached-shelf.ts:192)), while the server topic request can already become settled.

   Concrete fix: prune a `tag:` selection only when the active shelf is confirmed live, the archived listing is loaded when in scope, and there is no pending tag mutation. Prefer keeping optimistic state inside the editor and publishing it to the shared shelf/facet state only after success. Test both a failed removal of the last use and a direct visit with an old cached shelf.

4. **P1 — `ShelfTerms` is not generic enough for tags to be prepended unchanged.**

   The plan says tags can simply be merged before the automatic terms, but `ShelfTerms` assumes everything is a model-selected topic. All terms participate in semantic hue calculation, “All N topics,” More detail, paper-card topic lists, and copy such as “phrases your articles use” ([rendering assumptions](/home/greg/code/spideryarn2/.claude/worktrees/fbqmev0s-your-own-tags/src/web/ShelfTerms.tsx:247), [documented topic semantics](/home/greg/code/spideryarn2/.claude/worktrees/fbqmev0s-your-own-tags/docs/project/shelf-terms.md:175)). Private tags would therefore change automatic-topic colours and appear as if the topic chooser produced them.

   Concrete fix: for v1, render a small separate **Tags** pill row above **Topics**. Feed both rows’ selected member sets into the existing AND narrowing, counts, and shared Clear action. That gets almost all the value with substantially less branching. If one visual row is required, introduce a discriminated facet type and exclude tags from hue calculation, More detail, topic tooltips, and automatic-topic counts.

5. **P1 — Putting the private tag text in `?topics=tag:<lower(tag)>` weakens the privacy claim.**

   The tag becomes visible in browser history, copied links, and hosting request logs after a reload or direct visit. The app’s no-referrer policy prevents outbound referrer leakage, but not those channels. That does not match “private: only the owner sees them” in [the plan](/home/greg/code/spideryarn2/.claude/worktrees/fbqmev0s-your-own-tags/docs/plans/261003d-your-own-tags-on-articles-on-the-shelf-and-the-metadata-page.md:26).

   Concrete fix: use an opaque tag ID in URL state, which fits naturally with a `reader_tags` vocabulary table. For the smaller one-table v1, keep tag selection out of the URL and document that limitation. If literal labels remain in the URL, the plan must explicitly weaken the privacy promise and audit URL capture in logs, monitoring, and feedback.

   `GET /api/library/tags` should also explicitly send `Cache-Control: private, no-store`, matching the existing private topic response at [routes.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbqmev0s-your-own-tags/src/routes.ts:7920).

6. **P1 — Export is mandatory work, not “if the export test demands it.”**

   The test derives article-scoped tables from the schema and will require both projections to answer for the new table ([coverage guard](/home/greg/code/spideryarn2/.claude/worktrees/fbqmev0s-your-own-tags/tests/store-export-covers-tables.test.ts:243)). The shared snapshot also needs the rows added to `ArticleRows` and its repeatable-read walk ([article-rows.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbqmev0s-your-own-tags/src/store/article-rows.ts:546)).

   Concrete fix: commit in the plan to deterministic tag ordering and to:

   - adding every new tag table to `ARTICLE_TABLE_COVERAGE`;
   - reading it in `readArticleRows`;
   - exporting it in the reader bundle, with sentinel and column-coverage fixtures;
   - either preserving it in the rollback export or recording a specific justified omission;
   - updating the bundle README/file notes and `docs/project/export.md`.

7. **P1 — The shelf’s actual mutation and cache ownership are missing.**

   A local `useArticleTags(slug, initial)` cannot by itself update both the card and table, facet membership, active and archived arrays, archived overlays, or the stale-read barrier. Those responsibilities currently live centrally in `useShelf`; rename updates both arrays and supersedes older reads ([useShelf.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbqmev0s-your-own-tags/src/web/useShelf.ts:474)).

   The generic cache invalidation also maps `/api/library/:slug/tags` to a per-slug library prefix. It does not invalidate the cached `/api/library` response or `/api/metadata/:slug`, even though both now carry tags ([api.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbqmev0s-your-own-tags/src/web/lib/api.ts:722)).

   Concrete fix: add a tag mutation/controller to `useShelf` that applies the authoritative response to both arrays, records archived overlays, and supersedes earlier reads. Explicitly invalidate the shelf and metadata cached resources after a successful tag write. Update `cached-shelf.ts` to validate `tags`, or expose that legacy rows lack authoritative tag data.

8. **P2 — The database CHECK and “case-insensitive key” are underspecified.**

   `<the spelling rules above>` is not enough to verify that PostgreSQL and `normaliseTag` agree on NFC, Unicode whitespace, control characters, and what “40 characters” means. PostgreSQL `lower(tag)` and JavaScript lowercasing are also not guaranteed to produce the same Unicode identity key.

   Concrete fix: write the exact CHECK expression in the plan and test direct database inserts for leading/trailing whitespace, repeated whitespace, tabs/newlines, C0/C1 controls, decomposed accents, commas, and astral characters. Define length as Unicode code points and implement it consistently. Do not have the client reconstruct a database identity key; return a stable key or ID from the server.

9. **P2 — The plan understates the command-bar seam and omits files required by its own UI claims.**

   The additive PATCH is a good future command API. However, the current command system still needs a serialisable descriptor, argument schema, dispatcher, and confirmation gate, exactly as [the command vision says](/home/greg/code/spideryarn2/.claude/worktrees/fbqmev0s-your-own-tags/docs/project/chat-llm-help-commands-vision.md:62). A UI-specific hook is not the reusable controller.

   Concrete fix: put the HTTP operation and normalization in a pure `editArticleTags(slug, change)` client function; let both `TagEditor` and the later confirmed command call it. Keep the future command as a proposed write, never an immediately executed model action.

   Also add the currently omitted implementation surfaces to the plan: the table title is rendered in [library-columns.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbqmev0s-your-own-tags/src/web/library-columns.tsx:283), not `ShelfEntry.tsx`; cache validation and invalidation need the files above; export requires `article-rows.ts`, `export-bundle.ts`, and its coverage tests.

The cleanest smaller v1 is: canonical lowercase tags in the one article-tag table, a separate Tags facet row, no tag filter in the URL yet, serialized owner/article writes with a real cap, and the same additive PATCH. If preserving display case and URL-persisted filters are required now, the vocabulary table with opaque IDs is the simpler correct design overall because it resolves concurrency, privacy, and future rename/command-bar identity together.