The built code is close, but I found one high-severity silent-success path and one medium concurrency hole. I would not commit it unchanged.

## Findings

1. **High — the final check proves a library card exists, not that the article can be opened.**

The seed skips and validates articles using `listArticles()` ([db-seed-dev.ts:261](/home/greg/code/spideryarn2/scripts/db-seed-dev.ts:261), [db-seed-dev.ts:330](/home/greg/code/spideryarn2/scripts/db-seed-dev.ts:330)). That read trusts the cached `block_count` when present ([pg.ts:1592](/home/greg/code/spideryarn2/src/store/pg.ts:1592)). The article route instead reads the actual block rows and 404s when none remain ([pg.ts:1844](/home/greg/code/spideryarn2/src/store/pg.ts:1844)).

Concrete green-but-broken state:

- `current_revision_id` names a revision with a tree.
- Its cached `block_count` is positive.
- Its `revision_blocks` rows are missing.
- `listArticles()` returns the slug, so the seed skips it and exits 0.
- `/api/article/<slug>` returns 404.

There is a second version involving archives: any row with `archived_at` is skipped before readability is considered ([seed-dev-rules.ts:128](/home/greg/code/spideryarn2/scripts/seed-dev-rules.ts:128)), then deliberately omitted from `expected` ([db-seed-dev.ts:284](/home/greg/code/spideryarn2/scripts/db-seed-dev.ts:284)). An archived row with `current_revision_id = null`, no tree, or no blocks therefore also exits green while it is absent from both usable shelves.

A healthy archived article should indeed be skipped and not expected on the active shelf. The mistake is treating `archived_at` alone as proof that it is healthy.

**Cut the mutable `expected` bookkeeping.** Validate the fixed `DEV_SHELF_SLUGS` directly at the end:

- Call `pgArticleReader.loadArticle(slug)` for actual readability.
- Use active and archived `listArticles()` results only to describe where it lives.
- Reload an archived row when it is not actually readable; publishing preserves its archive state.
- Keep another-owner collisions non-zero.

The unit tests do not currently cover the composition that failed here: the archive test only checks `planSlug().action` ([seed-dev-rules.test.ts:82](/home/greg/code/spideryarn2/tests/seed-dev-rules.test.ts:82)); it never exercises the separate `expected.push` decision.

2. **Medium — `serialise: true` does not fence the complete seed against the corpus tests.**

Each load takes `RUN_LOCK`, but only around that individual load ([load-article.ts:384](/home/greg/code/spideryarn2/tests/helpers/load-article.ts:384)). The initial shelf read, skip decisions, gaps between slugs, and final postcondition are outside it.

More importantly, `store-parity` and `store-roundtrip` take the separate `CORPUS_LOCK`, then clear every current revision outside `RUN_LOCK` ([store-roundtrip.test.ts:304](/home/greg/code/spideryarn2/tests/store-roundtrip.test.ts:304), [store-roundtrip.test.ts:320](/home/greg/code/spideryarn2/tests/store-roundtrip.test.ts:320), [forget-revisions.ts:40](/home/greg/code/spideryarn2/tests/helpers/forget-revisions.ts:40)). The seed never takes that lock. This explains the observed mid-run 404 and allows both:

- the seed to interfere with the corpus suite’s “loaded from nothing” claim; and
- a corpus wipe to land after the seed’s postcondition, letting the seed exit 0 over state that has already disappeared.

Take `CORPUS_LOCK` outside `RUN_LOCK`, and hold both around the whole article decision/load/readback phase. That is the documented lock order ([run-lock.ts:178](/home/greg/code/spideryarn2/tests/helpers/run-lock.ts:178)). The three loads are short enough that holding `RUN_LOCK` for the complete phase is proportionate.

3. **Low — the blob fence is adequate for configuration, but it is not before the first write.**

Experimental Features is written at [db-seed-dev.ts:211](/home/greg/code/spideryarn2/scripts/db-seed-dev.ts:211); the fence is constructed later at [db-seed-dev.ts:245](/home/greg/code/spideryarn2/scripts/db-seed-dev.ts:245). The “before the first write” claim is therefore false. Move it before the experimental write so every preflight refusal precedes every mutation.

Constructing and discarding is sufficient for its narrow purpose: preventing filesystem fallback and rejecting a database/API project mismatch. Both the fence and the real `blobStore()` derive their choice from the same process environment ([blobs.ts:251](/home/greg/code/spideryarn2/src/store/blobs.ts:251), [blobs.ts:302](/home/greg/code/spideryarn2/src/store/blobs.ts:302)).

It does not authenticate the key or inspect the bucket. On an all-skip run, an invalid but present key can therefore pass without any Storage call. If “ready” includes opening the original source, add a final `loadSource` check for one seeded article. Otherwise, leave this as a configuration fence and correct the comment.

4. **Low — two changed docs and one code comment contradict the built behavior.**

- [supabase-local.md:283](/home/greg/code/spideryarn2/docs/project/supabase-local.md:283) says the store check “warns”; it now exits non-zero.
- [supabase-local.md:264](/home/greg/code/spideryarn2/docs/project/supabase-local.md:264) and [fixture README:149](/home/greg/code/spideryarn2/tests/fixtures/data-root/README.md:149) say both excluded fixtures exist to be refused. `noema` publishes successfully; it is excluded because it lacks an original source.
- [seed-dev-rules.ts:174](/home/greg/code/spideryarn2/scripts/seed-dev-rules.ts:174) still explains why the result is “a warning rather than a refusal.”
- [setup-local.ts:36](/home/greg/code/spideryarn2/scripts/setup-local.ts:36) still describes the old world where no committed article fixture filled the fresh-checkout gap.

`experimental-features.md` and the command-table change are accurate.

## Checked with no finding

- Exiting non-zero for the wrong store **after** durable work is correctly placed. Since this is setup’s fourth and final step, stopping there is sensible; rerunning after fixing `.env.local` is cheap.
- The `scripts/` → `tests/helpers/` import has no Vitest dependency or observed import-time side effect. After importing the production modules the seed already needs, the helper added about 128 ms here. The header note is sufficient.
- Another-owner slugs correctly set `failed` and cannot produce a successful exit.

I could not rerun Vitest in this read-only review environment because Vite attempted to write `node_modules/.vite-temp` and received `EROFS`; that is an environment limitation, not a test failure.