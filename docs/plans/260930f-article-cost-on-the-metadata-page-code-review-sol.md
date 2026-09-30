# GPT Sol code review — 260930f

Recovered from the run's activity log (lines 33351–33381 of
`260930f-article-cost-on-the-metadata-page-code-review-sol.md.activity.log`, not committed): the codex
wrapper overwrote this answer file with its closing summary. The run exited 0.

1. **P2 — The zero-row UI hid the very coverage evidence that makes the estimate honest.** `src/web/ArticleCost.tsx:92` returned before the coverage list whenever `lines` was empty. A connected live session with no usage row therefore rendered only “No model calls are recorded”, and even an ordinary empty result lost the fixed warning about failed ledger writes and historical unattributed calls. The amount was also written as “$… over N calls — at least”, putting the qualifier after the thing it qualifies. **FIXED:** the empty state now stays inside the cost card and always reaches the coverage list, a silent-only response is shown, and an unpriced total reads “At least $…”. `tests/article-cost-section.test.tsx:134-160` was observed red before the fix and now pins all three cases.

2. **P3 — Three promised boundaries had no test that would fail when their subject broke.** `tests/article-cost-section.test.tsx:181`, `tests/link-summary-stream-lifetime.test.ts:126`, and `tests/ai-calls-spend-pg.test.ts:428` respectively left the Metadata admin-only mount, the exact `/api/link-summary` route's hand-written attribution, and `silentLiveSessionsForArticle`'s connected/no-usage predicate uncovered. The existing component tests mount `ArticleCostBody` directly, the link-summary harness stubbed below `recordSpend`, and the Postgres fixtures never inserted a realtime session. **FIXED:** added a source contract for the cosmetic admin mount, made the existing real-stream harness emit and capture one synthetic ledger row (so removing the wrapper loses its slug), and added Postgres fixtures for one silent session, one reported session, and one unconnected session. The latter two private-Postgres tests typecheck but could not run here because the sandbox cannot reach the local Docker/Postgres service.

3. **P3 — The fallback comment claimed it recovered a case its predicate deliberately excludes.** `src/store/ai-calls-spend-pg.ts:500-513` said a call made before the article row existed could be recovered, but `started_at >= article.created_at` at line 526 excludes exactly that call; including it would make a recreated slug inherit its predecessor's rows. **FIXED:** the comment now says the null-ID fallback covers a failed lookup for the current article and explicitly says pre-creation calls are excluded because they cannot be distinguished safely from a predecessor.

4. **P2 — The new cost-tracking rules do not match the code they are meant to govern.** `docs/project/cost-tracking.md:15-17` says every paid call writes a row although unscoped calls and write failures do not; lines 60-66 repeat the impossible pre-creation fallback and say the page reports “by how much” it is short although the missing dollar amount is unknown; lines 80-83 describe only pattern rows and only `"first-capture" | "none"`, omitting the required exact rows and `"handler"`; and `docs/project/new-mode.md:281-284` says a step name gets its own line in `npm run cost`, whose ordinary report groups by job/category rather than pipeline step. **NOT FIXED:** these are normative instructions, so `docs/reusable/edit-important-docs.md` requires Greg to approve the wording before edit. Proposed one related set:

   - `cost-tracking.md` before: “Every paid call writes one row…” After: “Every gateway call made inside a collector attempts to write one row…”, followed by the existing explicit unscoped/write-failure caveat.
   - Before: a null ID can mean “the call came before the article row existed”. After: it can mean the lookup failed while the current article existed; calls before the current article are deliberately excluded because they cannot be separated safely from a deleted predecessor.
   - Before: “It is a floor, and the page says by how much.” After: “It is a floor, and the page names the gaps it can observe,” followed by the counts of unpriced calls and silent sessions.
   - Before: “Every pattern route…” with two values. After: every exact and pattern row declares `article`; pattern rows may use `first-capture`, `handler`, or `none`, exact rows may use `handler` or `none`, and only `first-capture` is wrapped by the dispatcher.
   - `new-mode.md` before: the step name becomes a line in Metadata “and in `npm run cost`.” After: the `(step, job)` pair becomes the Metadata line; `npm run cost` tracks the same calls by job and category.

Verification:

- `node --import tsx scripts/typecheck.ts` — passed all four projects; all 2,419 source files covered. (`npm run typecheck` itself could not create `tsx`'s IPC socket in this sandbox, so the same script was loaded without that helper.)
- Unit portion of the allowed focused run — 5 files, 381 tests passed.
- The full allowed Vitest command — blocked before discovery because Docker/Postgres is unreachable from this sandbox; no private-Postgres test was treated as skipped or green.
- `npm run test:paid` was not run; no provider was called.

Files edited:

- `src/store/ai-calls-spend-pg.ts`
- `src/web/ArticleCost.tsx`
- `tests/ai-calls-spend-pg.test.ts`
- `tests/article-cost-section.test.tsx`
- `tests/link-summary-stream-lifetime.test.ts`
- `docs/plans/260930f-article-cost-on-the-metadata-page-code-review-sol.md`

DO NOT SHIP — approve and apply finding 4's small normative-doc correction first; the reviewed runtime code is otherwise ready after the fixes above.
