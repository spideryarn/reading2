No P0. Revise these before building; findings refer to the plan as reviewed.

- **F1 — P1 — plan:49:** `journal` needs more than a type and column: `artifacts-pg.ts`’s `META_COLUMNS`, `metaColumns`, `readMeta`; `pg.ts`’s read policy, shared metadata projection and `metaFrom`; `pg-revisions.ts`’s carry policy; and `store/export.ts`’s metadata mapping. Missing mappings silently lose the field. Extend populated artifact, owner-read, carry and export round-trips; existing fixtures without `journal` prove nothing.

- **F2 — P1 — [pipeline.ts:2068](/home/greg/code/spideryarn2/.claude/worktrees/fbpcz6a3-metadata-date-and-journal/src/pipeline.ts:2068):** “Read this” preserves only abstract and DOI. A minimal paper’s confirmed date and journal disappear when full extraction finds no candidate or the lookup is unavailable: `metaColumns` clears them. Explicitly preserve those confirmed facts during the minimal-to-full transition and test that failure path.

- **F3 — P1 — plan:42:** Distinctive, identical titles do **not** establish DOI ownership. A cited work with the same title but different authors passes every proposed guard. This exact class is already addressed in `source-guess.ts:114–122`. Require corroboration beyond title—at least author agreement—and leave insufficient evidence unconfirmed.

- **F4 — P2 — [minimal-paper.test.ts:224](/home/greg/code/spideryarn2/.claude/worktrees/fbpcz6a3-metadata-date-and-journal/tests/minimal-paper.test.ts:224):** The suite would reach the registry network. These tests mock metadata readers, which return a DOI, then execute the real metadata step. Expose and mock the pipeline’s lookup dependency. Add tests through both real call sites; helper-only tests can pass while enrichment is never invoked.

- **F5 — P2 — plan:55:** Extend `bibliographic_records_shape`’s **both** `num_nonnulls` lists to include `published_day`. Otherwise claims and not-found rows can contain a publication date while satisfying the advertised three-shape invariant. Skipping this is not safe.

- **F6 — P2 — plan:85:** “About 5 s … at worst” is false. The existing bound is roughly **28 seconds per DOI**, including Crossref→DataCite fallback (`bibliographic.ts`’s claim-lease explanation), hence roughly 84 seconds for three sequential candidates, plus database delay. Correct the estimate and account for the step deadline/cancellation.

- **F7 — P2 — plan:49:** `venue` is not necessarily a journal. `parseDatacite` falls back to **publisher**, and the existing arXiv fixture produces `"arXiv"`. Blindly assigning it to `journal` contradicts the deferred-publisher decision. Restrict journal enrichment to suitable registry container data, or call the field “venue.”

- **F8 — P2 — plan:25:** The baseline’s blanket DOI claim is false: fully read PDFs **and HTML** can retain a minimal paper’s DOI through `keptPaperMetadata`. Also, Readability’s publication date comes from JSON-LD `datePublished` or `parsely-pub-date` as well as `article:published_time`. I found no other independent production date producer.

Ordered folded-word equality is a reasonable conservative v1, but subtitles and differing maths representations will miss valid matches. Trailing full stops are harmless with `tokens`; dropping mathematical operators can also conflate different titles. Add those cases explicitly. No existing exported helper implements exactly this rule: `registryTitleAgrees` accepts prefixes and 80% word overlap, so it is broader.

`extract` has no input stamp/hash to break. Enrichment after extraction preserves its standalone-stage contract and checkpoints; completed extraction still skips on retry, including when enrichment previously failed.

Neither scalar enters the current public SQL projection or `PublicMeta`. Timeline output can indirectly reflect the new date. Correction to my earlier update: the public Timeline projection does **not** select `publishedAt`.

Nothing changed.