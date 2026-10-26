No P0, but four P1s. I would not build this plan unchanged.

### P1 — The browser can replay a stale pie

[`cached-shelf.ts:34`](</var/tmp/spideryarn-worktrees/fbe5477u-shelf-pie/src/web/lib/cached-shelf.ts:34>) deliberately paints yesterday’s `/api/library` response while fetching today’s, and [`cached-shelf.ts:169`](</var/tmp/spideryarn-worktrees/fbe5477u-shelf-pie/src/web/lib/cached-shelf.ts:169>) preserves optional fields such as the proposed `readBand`. The offline path also replays the cached response at [`api.ts:898`](</var/tmp/spideryarn-worktrees/fbe5477u-shelf-pie/src/web/lib/api.ts:898>).

Therefore a reader can read more, rename/rebuild the article, then see an old pie until the live response arrives—or indefinitely offline. The server-side basis cannot protect this copy.

Concrete fix: treat `readBand` as ephemeral. Strip it before writing `/api/library` to IndexedDB and strip it from legacy cached bodies in both the stale-first and offline paths. Add tests proving cached shelves never draw a pie, while the live response does.

### P1 — The basis fingerprints data, but not the code interpreting it

The proposed basis at [`261025l…md:47`](</var/tmp/spideryarn-worktrees/fbe5477u-shelf-pie/docs/plans/261025l-shelf-cards-show-the-how-much-read-pie.md:47>) covers the current stored inputs, but a deployment can change the denominator without changing any of them:

- accepted matter versions and validation: [`matter-current.ts:49`](</var/tmp/spideryarn-worktrees/fbe5477u-shelf-pie/src/matter-current.ts:49>)
- fallback byline heuristics: [`front-matter.ts:333`](</var/tmp/spideryarn-worktrees/fbe5477u-shelf-pie/src/web/front-matter.ts:333>)
- title-echo rules: [`masthead-echo.ts:84`](</var/tmp/spideryarn-worktrees/fbe5477u-shelf-pie/src/web/masthead-echo.ts:84>)
- body-counting policy: [`block-policy.ts:184`](</var/tmp/spideryarn-worktrees/fbe5477u-shelf-pie/src/block-policy.ts:184>)
- read-time sanitisation, which always runs under the current code: [`pg.ts:1741`](</var/tmp/spideryarn-worktrees/fbe5477u-shelf-pie/src/store/pg.ts:1741>)

That would leave an old cache “fresh” while the masthead computes under new rules—the exact silent disagreement this basis is meant to prevent.

Concrete fix: include an explicit `READ_SO_FAR_RECIPE` version, plus the sanitizer version where appropriate, in a canonical basis encoding such as a hashed `jsonb_build_array(...)`. Avoid delimiter concatenation, which can conflate null, empty strings, and delimiter-containing values. Test that a row carrying the previous recipe is withheld.

With that addition, I found no missing stored data input: revision ID, matter, title/byline/authors, override, and slug cover what today’s effective article reads.

### P1 — Shelf refresh is synchronous, per-card work, and anonymously triggerable

The refresh at [`261025l…md:61`](</var/tmp/spideryarn-worktrees/fbe5477u-shelf-pie/docs/plans/261025l-shelf-cards-show-the-how-much-read-pie.md:61>) puts up to five `loadArticle` calls, sanitisation passes, source-guess reads, and upserts inside `listArticles`. That contradicts the cold-path version of “one query per shelf load” and can substantially delay the first shelf response.

More seriously, `listArticles` is not owner-route-only:

- the public, unauthenticated health endpoint calls it at [`vercel-health.ts:862`](</var/tmp/spideryarn-worktrees/fbe5477u-shelf-pie/src/vercel-health.ts:862>)
- health is dispatched before the authenticated request scope at [`vercel.ts:296`](</var/tmp/spideryarn-worktrees/fbe5477u-shelf-pie/src/vercel.ts:296>)
- shelf mutations also call it to rebuild one returned card at [`pg-shelf.ts:623`](</var/tmp/spideryarn-worktrees/fbe5477u-shelf-pie/src/store/pg-shelf.ts:623>)

Thus a stranger polling health could trigger cache writes and repeated failure logging against the environment owner every 30 seconds.

Concrete fix: keep `listArticles` read-only. Populate the cache when `loadArticle` already has the full blocks, and run a one-time bounded backfill for existing articles with reading time. The shelf’s third statement should only consume fresh rows and omit missing ones. If request-path refresh is retained, it must be explicitly enabled only by the authenticated `/api/library` handler, never by health or mutation reads, and failures need `allSettled`, a latency budget, and cross-request retry/backoff.

### P1 — The guarded upsert needs a stronger race contract

The plan says to guard with the basis read before loading at [`261025l…md:64`](</var/tmp/spideryarn-worktrees/fbe5477u-shelf-pie/docs/plans/261025l-shelf-cards-show-the-how-much-read-pie.md:64>). That permits an ABA race:

1. shelf reads basis A;
2. inputs change to B;
3. `loadArticle` computes B;
4. inputs return to A;
5. guard A succeeds and stores B under A.

There is also a common SQL trap: putting the predicate only on `ON CONFLICT DO UPDATE … WHERE` leaves the initial insert completely unguarded. The earlier owner check in `loadArticle` also does not protect a later insert from an ownership transfer.

Concrete fix:

- Capture the basis alongside the mutable fields that `loadArticle` actually loaded, and guard using that loaded basis—not the earlier shelf snapshot.
- Use `INSERT … SELECT … FROM articles … WHERE owner_id = currentOwner AND readSoFarBasis = loadedBasis`.
- Repeat the predicate on the conflict-update arm.
- Return a band only when `RETURNING` proves one row was written.
- Test both a missing cache row and an existing conflicting row, plus A→B→A and ownership transfer between load and write.

### P2 — This cache is simpler as article-derived data, not reader state

The proposed table contains the denominator, not reading seconds or reader activity. Transfer already clears `title_override` at [`pg-article-transfer.ts:595`](</var/tmp/spideryarn-worktrees/fbe5477u-shelf-pie/src/store/pg-article-transfer.ts:595>), so the basis invalidates a genuinely owner-specific cached result.

Classifying it as reader state would require adding it to all three registries at [`pg-article-transfer.ts:132`](</var/tmp/spideryarn-worktrees/fbe5477u-shelf-pie/src/store/pg-article-transfer.ts:132>), [`pg-article-transfer.ts:208`](</var/tmp/spideryarn-worktrees/fbe5477u-shelf-pie/src/store/pg-article-transfer.ts:208>), and [`admin-articles.ts:85`](</var/tmp/spideryarn-worktrees/fbe5477u-shelf-pie/src/admin-articles.ts:85>), and would make a derived cache appear in transfer previews.

Concrete fix: classify it as `moves`, while marking it omitted from both exports in [`article-rows.ts:134`](</var/tmp/spideryarn-worktrees/fbe5477u-shelf-pie/src/store/article-rows.ts:134>). Drop `computed_at` unless it has a stated operational use; when populated by a shelf GET it becomes unnecessary durable activity metadata.

### P2 — The plan needs cache/privacy documentation and runtime public checks

[`library.md:1023`](</var/tmp/spideryarn-worktrees/fbe5477u-shelf-pie/docs/project/library.md:1023>) owns what a card says and [`privacy.md:468`](</var/tmp/spideryarn-worktrees/fbe5477u-shelf-pie/docs/project/privacy.md:468>) owns reading-time storage, but the plan names no documentation changes. Its public-shelf check is type-only, although the public response is assembled through a spread at [`public-library.ts:397`](</var/tmp/spideryarn-worktrees/fbe5477u-shelf-pie/src/store/public-library.ts:397>).

Concrete fix: document the mark and the “cached shelf never paints it” rule in `library.md`; record in `privacy.md` that only the article-derived denominator is cached, never seconds or the band. Add a runtime public-library test seeded with reading time and a cache row, asserting the wire contains no `readBand` and the public query never names either private table.

The separate public DTO/query design is otherwise sound, and using the real `loadArticle` transformation is the right way to avoid fresh-row differences from title fallback, author decoding, validated matter, or sanitised blocks. No files were edited.