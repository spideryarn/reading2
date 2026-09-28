## Findings

No P0 issue found. The design is viable, but several P1 contracts need resolving before implementation.

**F1 — P1 — established — the proposed keys do not support an extractor-version bump**

Evidence: the run table has `revision_id` as its sole primary key, while `extractor_version` is only a column; fills use `ON CONFLICT DO NOTHING`, yet a version bump is supposed to refill the same revision ([plan:153](/home/greg/code/spideryarn2/.claude/worktrees/shelf-facets/docs/plans/260928a-shelf-facet-terms.md:153), [plan:165](/home/greg/code/spideryarn2/.claude/worktrees/shelf-facets/docs/plans/260928a-shelf-facet-terms.md:165)).

Once revision R has a v1 run, a v2 insert conflicts on R and does nothing. Its phrases are also keyed without a version, so two deployments cannot safely coexist. A transaction is also required so “run exists” can never be committed without all its phrases.

Recommendation: either:

- Key both tables by `(revision_id, extractor_version)`, include both columns in the child FK, and insert the run plus phrases in one read-committed transaction; or
- Prefer the smaller one-table form below, with `candidates jsonb NOT NULL` and the same composite key.

Test same-version concurrent fills, v1/v2 concurrent fills during a rolling deployment, and a failure between the run and phrase writes.

---

**F2 — P1 — reasoned — an unbounded cold fill is too expensive for the request path**

Evidence: the only measurement is 40 articles, while extraction costs about 3 ms per 1,000 words and keeps around 200 candidates per article ([plan:61](/home/greg/code/spideryarn2/.claude/worktrees/shelf-facets/docs/plans/260928a-shelf-facet-terms.md:61), [plan:87](/home/greg/code/spideryarn2/.claude/worktrees/shelf-facets/docs/plans/260928a-shelf-facet-terms.md:87)). The measured shelf averages roughly 9,000 words per article ([plan:126](/home/greg/code/spideryarn2/.claude/worktrees/shelf-facets/docs/plans/260928a-shelf-facet-terms.md:126)).

At 1,000 similarly sized articles, extraction alone extrapolates to roughly 27–30 seconds of CPU, before reading millions of block fields and writing up to 200,000 phrase rows. Near-duplicate grouping is pairwise across articles ([run.ts:52](/home/greg/code/spideryarn2/.claude/worktrees/shelf-facets/spike/facets/run.ts:52)), so its work grows quadratically. A synthetic 1,000×200 chooser run took about 0.6 seconds locally even without grouping, database transfer, or writes.

Vercel’s configured 800-second ceiling avoids an immediate hard timeout ([vercel.json:16](/home/greg/code/spideryarn2/.claude/worktrees/shelf-facets/vercel.json:16)), but a first shelf load waiting tens of seconds or minutes is still broadly unusable.

Recommendation: do not make a GET responsible for an unbounded backfill. Use the same pure extractor through:

- A pipeline/publication path for future revisions.
- An explicit batched backfill for existing rows and version bumps.
- At most a small bounded lazy repair in GET for anomalies.

Add a 1,000-article benchmark covering block read, cache write, duplicate handling, candidate read, and selection—not only the pure chooser.

---

**F3 — P1 — established — membership and tooltip counts cannot satisfy their stated meaning**

Evidence: titles count ×3 and headings ×2 ([plan:70](/home/greg/code/spideryarn2/.claude/worktrees/shelf-facets/docs/plans/260928a-shelf-facet-terms.md:70)), but the stored phrase has only one `count` ([plan:157](/home/greg/code/spideryarn2/.claude/worktrees/shelf-facets/docs/plans/260928a-shelf-facet-terms.md:157)). Membership simultaneously says a title hit alone must not qualify ([plan:95](/home/greg/code/spideryarn2/.claude/worktrees/shelf-facets/docs/plans/260928a-shelf-facet-terms.md:95)).

The spike adds the weight directly into `count` ([extract.ts:62](/home/greg/code/spideryarn2/.claude/worktrees/shelf-facets/spike/facets/extract.ts:62)), then admits a density member either by that weighted count or merely by being in the title ([choose.ts:47](/home/greg/code/spideryarn2/.claude/worktrees/shelf-facets/spike/facets/choose.ts:47)). Thus a single title occurrence has count 3 and passes the minimum of 2. The same weighted value would be shown in a tooltip as “how often” an article uses the phrase ([plan:204](/home/greg/code/spideryarn2/.claude/worktrees/shelf-facets/docs/plans/260928a-shelf-facet-terms.md:204)), making one literal occurrence appear as three.

Recommendation: store or retain separately:

- `raw_count` for literal occurrences and tooltip text.
- `membership_count` if membership excludes title or otherwise has special rules.
- `weighted_score` for ranking.
- The unweighted counted word total used by the density threshold.

Remove the spike’s `titleKeys` membership override and rerun the reported evaluation.

---

**F4 — P1 — established — the redundancy rule fails on the plan’s own example**

Evidence: the plan says the shared-word skip prevents “conscious AI / conscious experience / consciousness” all winning ([plan:109](/home/greg/code/spideryarn2/.claude/worktrees/shelf-facets/docs/plans/260928a-shelf-facet-terms.md:109)). The attached chosen output contains all three ([out3.txt:355](/home/greg/code/spideryarn2/.claude/worktrees/shelf-facets/spike/facets/out3.txt:355)).

`conscious` and `consciousness` are different tokens under the current light folding, while `conscious AI` and `conscious experience` evidently do not cross the 0.3 set-Jaccard threshold.

Recommendation: either add a tested normalization specifically for redundancy comparisons, or state that morphological/semantic near-synonyms remain a v1 limitation. Do not claim the current rule handles this example.

---

**F5 — P1 — established — the proposed touch interaction does not exist in the shared Tooltip**

Evidence: the plan calls the existing Tooltip “tap-first on touch” ([plan:204](/home/greg/code/spideryarn2/.claude/worktrees/shelf-facets/docs/plans/260928a-shelf-facet-terms.md:204)). In fact, `Tooltip` has hover, focus and dismiss interactions but no click interaction ([Tooltip.tsx:168](/home/greg/code/spideryarn2/.claude/worktrees/shelf-facets/src/web/Tooltip.tsx:168)). Its own contract says a tap-surviving tooltip must be controlled and that the caller must decide what the tap means ([Tooltip.tsx:100](/home/greg/code/spideryarn2/.claude/worktrees/shelf-facets/src/web/Tooltip.tsx:100)).

A chip cannot simultaneously toggle immediately and leave its tooltip open for reading on the same tap.

Recommendation: keep a chip tap as the primary filtering action. Provide an adjacent accessible details button/popover on coarse pointers, while hover/focus opens the tooltip on desktop. If using two-step reveal-then-toggle instead, make that an explicit product decision and browser-test the real touch event sequence; jsdom cannot prove it.

---

**F6 — P1 — reasoned — archived state is not yet one coherent filtered dataset**

Evidence: active rows are narrowed once in `Library.rows` ([Library.tsx:203](/home/greg/code/spideryarn2/.claude/worktrees/shelf-facets/src/web/Library.tsx:203)), but archived rows are separately fetched only after opening the local disclosure ([Library.tsx:1005](/home/greg/code/spideryarn2/.claude/worktrees/shelf-facets/src/web/Library.tsx:1005), [useShelf.ts:422](/home/greg/code/spideryarn2/.claude/worktrees/shelf-facets/src/web/useShelf.ts:422)). The entire archive control currently disappears during a search ([Library.tsx:634](/home/greg/code/spideryarn2/.claude/worktrees/shelf-facets/src/web/Library.tsx:634)), deliberately because search does not cover archived rows ([Library.tsx:1000](/home/greg/code/spideryarn2/.claude/worktrees/shelf-facets/src/web/Library.tsx:1000)).

Moving `open` into `?archived=1` alone does not answer:

- Whether archived rows participate in `q` and Unread.
- How counts work while archived rows are still loading or failed.
- Whether the switch remains available during search.
- How stale active-only and active+archived requests are aborted.
- How terms refresh after archive, restore, ingest, or re-publication.

Recommendation: define one pure shelf-narrowing function and its order of operations for both arrays. Keep the archived control operable during search, or explicitly clear `archived` when search begins. Tie term refetching to shelf revision/archive changes and abort responses from the previous scope. Add direct-URL, Back/Forward, search+archive+topic, archive error, and active/all race tests.

---

**F7 — P1 — reasoned — “deterministic” needs order-independent tie-breaking**

Evidence: the plan promises that the same shelf gives the same topics ([plan:39](/home/greg/code/spideryarn2/.claude/worktrees/shelf-facets/docs/plans/260928a-shelf-facet-terms.md:39)), but only proposes testing identical input twice ([plan:239](/home/greg/code/spideryarn2/.claude/worktrees/shelf-facets/docs/plans/260928a-shelf-facet-terms.md:239)).

The spike chooses the first candidate encountered on an equal gain ([choose.ts:85](/home/greg/code/spideryarn2/.claude/worktrees/shelf-facets/spike/facets/choose.ts:85)), and surface-form sorting has no tie-break after frequency ([choose.ts:79](/home/greg/code/spideryarn2/.claude/worktrees/shelf-facets/spike/facets/choose.ts:79)). Those encounter orders ultimately come from database/article order and map insertion. A tie around K=30 or before a Jaccard skip can change which URL keys survive.

Recommendation: specify total tie-breaks everywhere—normally score, then key; surface frequency, then lowercase preference, then code-point label. Test many permutations of articles and candidate arrays, not just repeat execution.

---

**F8 — P2 — established — revision IDs are safe, but the lifecycle and cascade claims are incomplete**

Published revision blocks are immutable through the application’s normal writers. The schema states that published revisions are immutable in text and that the only in-place exception changes the glossary column, not blocks ([schema.ts:410](/home/greg/code/spideryarn2/.claude/worktrees/shelf-facets/src/db/schema.ts:410)). Block replacement writes into a job-owned draft ([artifacts-pg.ts:1207](/home/greg/code/spideryarn2/.claude/worktrees/shelf-facets/src/store/artifacts-pg.ts:1207)).

However:

- Every pipeline job creates and publishes a new draft, including jobs whose blocks are merely copied unchanged ([schema.ts:420](/home/greg/code/spideryarn2/.claude/worktrees/shelf-facets/src/db/schema.ts:420), [pg-revisions.ts:1035](/home/greg/code/spideryarn2/.claude/worktrees/shelf-facets/src/store/pg-revisions.ts:1035)). Revision-keying therefore recomputes after non-text mode jobs.
- Old published revisions are deliberately retained and never swept ([pg-revisions.ts:2590](/home/greg/code/spideryarn2/.claude/worktrees/shelf-facets/src/store/pg-revisions.ts:2590)). Their phrase rows do not “cascade away” merely because a new revision publishes, contrary to [plan:160](/home/greg/code/spideryarn2/.claude/worktrees/shelf-facets/docs/plans/260928a-shelf-facet-terms.md:160).

Recommendation: revision-keying is the safer v1 identity, but document the retained-history cost and add a retention strategy or bounded accounting. Do not base correctness on old published revisions being deleted.

---

**F9 — P2 — reasoned — near-duplicate similarity is not a sound equivalence relation**

“Jaccard ≥ 0.6” is pairwise similarity, not transitive identity. If A≈B and B≈C but A≉C, connected-component grouping treats all three as one work; any alternative can make B belong to two groups. Short articles and common templates make top-150-set Jaccard especially unstable.

The implementation is also quadratic in the shelf size ([run.ts:56](/home/greg/code/spideryarn2/.claude/worktrees/shelf-facets/spike/facets/run.ts:56)).

Recommendation: omit near-duplicate grouping from v1, or group only exact counted-text/content hashes. Add near-duplicate grouping later with chain-case tests and a precision evaluation. This removes both a correctness ambiguity and the largest warm-request scaling term.

---

**F10 — P2 — reasoned — owner isolation is sound only if the scoped revision set is the sole read authority**

The existing shelf query correctly filters by the ambient owner ([pg.ts:1996](/home/greg/code/spideryarn2/.claude/worktrees/shelf-facets/src/store/pg.ts:1996)). The proposed approach is safe if it first resolves the owner’s current revision IDs and every phrase read and fill is restricted to that closed set.

The planned `article_id` on `revision_phrase_runs` is not described as part of a composite FK ([plan:153](/home/greg/code/spideryarn2/.claude/worktrees/shelf-facets/docs/plans/260928a-shelf-facet-terms.md:153)). The existing block schema prevents a revision/article mismatch with `(article_id, revision_id) → article_revisions` ([schema.ts:1251](/home/greg/code/spideryarn2/.claude/worktrees/shelf-facets/src/db/schema.ts:1251)); the cache should do the same or omit redundant `article_id`.

Recommendation:

- Start every operation from one owner-scoped current-revision query.
- Use a composite FK if retaining `article_id`.
- Test that an A request creates no B run rows, returns no B slug, and exposes no distinctive B phrase—not merely that B “does not change” A’s final topic list.
- Set `Cache-Control: private, no-store`; the ordinary JSON sender adds no cache policy itself ([routes.ts:512](/home/greg/code/spideryarn2/.claude/worktrees/shelf-facets/src/routes.ts:512)).

I found no inherent cross-reader leak if those conditions are followed.

---

**F11 — P2 — reasoned — “live count” needs one exact formula**

The chip count is described as live after search, Unread and other topics, while the tooltip gives the global “In 7 of 38 articles” count ([plan:199](/home/greg/code/spideryarn2/.claude/worktrees/shelf-facets/docs/plans/260928a-shelf-facet-terms.md:199)). A chip can therefore say 2 while its tooltip says 7 without explaining that the denominators differ.

Recommendation:

- Define `visible = scope ∩ query ∩ unread ∩ all selected topics`.
- For every chip, show `|visible ∩ chip-members|`; selected chips therefore equal the visible result count.
- In the tooltip say both: “2 match this view; 7 of 38 across this shelf.”
- Count physical article slugs, not grouped works, so six duplicate cards always produce a count of six.
- Only disable an unselected zero-result chip. A selected chip must remain removable even when its current count is zero.

Add an invariant test that the displayed result count equals the cards/table/archive rows rendered.

---

**F12 — P2 — reasoned — the extractor is implicitly English-only**

The design relies on an English generic-word list and English verb/suffix rules ([plan:70](/home/greg/code/spideryarn2/.claude/worktrees/shelf-facets/docs/plans/260928a-shelf-facet-terms.md:70)); the spike’s stoplist is English ([extract.ts:8](/home/greg/code/spideryarn2/.claude/worktrees/shelf-facets/spike/facets/extract.ts:8)). A shelf containing several French, Spanish, or German pieces will promote function words as topics.

Recommendation: explicitly scope v1 to English revisions, using the stored language where reliable, and report how many articles were excluded. Alternatively supply stoplists per supported language. Do not silently mix unsupported languages into the same DF calculation.

---

**F13 — P2 — reasoned — Stage 1 is too large and the test list misses the risky seams**

Stage 1 currently combines algorithm stabilization, schema, transactions, route, report and large-shelf behavior ([plan:227](/home/greg/code/spideryarn2/.claude/worktrees/shelf-facets/docs/plans/260928a-shelf-facet-terms.md:227)).

Recommendation: split it into:

1. Pure extractor/chooser plus reproducible fixtures and evaluation.
2. Schema/cache lifecycle, concurrency and backfill.
3. Owner-scoped route and load/performance test.
4. UI.

Missing tests include:

- Atomic failure between run and candidates.
- Same-version and cross-version concurrent fill.
- Publication during fill, with the request anchored to one exact `(article, revision)` set.
- Shuffled-input determinism.
- Duplicate chains and exact threshold boundaries.
- Title-only versus raw/weighted counts.
- 1,000-article cold and warm paths.
- Ingest/archive/restore invalidating terms.
- Stale URL behavior without a transient empty shelf.
- Search+archived behavior.
- Real touch, keyboard, `aria-pressed`, selected-zero removal and disabled-chip tooltip behavior.
- Non-English input.
- Route authentication and `private, no-store`.

---

**F14 — P3 — established — the attached report does not reproduce the plan’s quoted corpus**

The plan says 38 active articles, 30 works and roughly 357k words ([plan:126](/home/greg/code/spideryarn2/.claude/worktrees/shelf-facets/docs/plans/260928a-shelf-facet-terms.md:126)); the attached output says 38 articles, 29 works and 350,823 words ([out3.txt:4](/home/greg/code/spideryarn2/.claude/worktrees/shelf-facets/spike/facets/out3.txt:4)).

Recommendation: regenerate the report from the final algorithm or mark the plan’s numbers as an earlier run. Record the algorithm configuration and corpus identity so “within reason” does not conceal a regression.

## Smaller version

The smallest version retaining most of the value is:

- Keep AND semantics, K=30 and the archived scope; K=20 materially lost coverage in the spike.
- Drop fuzzy near-duplicate grouping; use exact text-hash duplicates only, or none.
- Store one opaque candidate artefact per `(revision_id, extractor_version)`:

  `revision_phrase_runs(revision_id, article_id, extractor_version, words, candidates jsonb, computed_at)`

  The candidate array is always read as a whole and never filtered, joined or constrained inside Postgres, so it fits the project’s documented JSON exception ([sql.md:110](/home/greg/code/spideryarn2/.claude/worktrees/shelf-facets/docs/project/sql.md:110)). This removes the partial two-table state and turns concurrency into one targeted insert.
- Omit `stats` from the production response; keep metrics in the report/evaluation code.
- Use hover/focus tooltips plus a distinct touch details affordance.
- Populate future data outside shelf GETs, with a batched backfill for existing data.

## Design questions

**Revision ID or `(article_id, counted-text hash)`?**

Use revision ID for v1. It is a correct content epoch because published blocks are immutable through normal application writers. A content hash would reduce recomputation for copied non-text revisions, but only if it hashes the extractor’s exact input—including block kind, heading level, role, back-matter boundaries and text. The existing general `hashBlocks` does not cover all of those fields, and computing a new hash at browse time requires reading the blocks the cache was meant to avoid.

Use `(revision_id, extractor_version)`, then measure whether redundant copied revisions justify a purpose-built extractor-input hash later.

**Is a writing GET acceptable?**

Yes for a small, bounded, deterministic repair cache, with an atomic transaction and `private, no-store`. No for the proposed unbounded first-use backfill.

Changing it to a client-fired POST does not solve the cost, concurrency or atomicity; it only changes the verb and complicates loading. Prefer a pipeline/publication path plus an explicit backfill. Retain GET repair only as a safety net.

**Should near-duplicate grouping be in v1?**

No. It introduces non-transitive grouping, quadratic work, count semantics and false-merger risk. Exact duplicates by a trustworthy content hash are enough for v1. Add fuzzy grouping only after measuring false positives on a larger corpus.

**Verdict: proceed with changes.**