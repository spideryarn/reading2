**APPROVE WITH CHANGES.** The separate cheap call is justified; a new table or pipeline step would add unnecessary machinery. The plan needs a firmer rule tying the rating to the text being served, explicit handling of every metadata writer, and more cautious claims about the coefficients.

1. **F1 — `extract` can rate different text from the text the reader sees.**

   [pg-revisions.ts:1129](/home/greg/code/spideryarn2/.claude/worktrees/reading-time-difficulty/src/store/pg-revisions.ts:1129) explicitly supports an `extract`-only revision by carrying the old blocks. Publication derives the shelf’s word count from those blocks at [pg-revisions.ts:2345](/home/greg/code/spideryarn2/.claude/worktrees/reading-time-difficulty/src/store/pg-revisions.ts:2345). The proposed call would instead rate the newly extracted HTML. A forced standalone extraction could therefore publish old prose with new difficulty.

   **My preferred safer shape:** make the call at the end of `blocks`, using the blocks just produced. Store its five columns through a small dedicated artefact, and assemble the rating into `Meta` on reads. This needs neither another table nor another pipeline step; it gives the rating its own write lifecycle and avoids making every `meta` write own it.

   Keeping the call inside `extract` is reasonable for ordinary imports, but then the plan needs a mechanical publication/freshness rule preventing a new rating from being shown beside carried old blocks. A comment is insufficient.

2. **F2 — adding the rating to `META_COLUMNS` would clear a valid rating on a standalone `metadata` run.**

   [artifacts-pg.ts:840](/home/greg/code/spideryarn2/.claude/worktrees/reading-time-difficulty/src/store/artifacts-pg.ts:840) replaces every owned metadata column, clearing absent fields. An administrator may run `metadata` alone against a slug: [jobs.ts:3310](/home/greg/code/spideryarn2/.claude/worktrees/reading-time-difficulty/src/jobs.ts:3310). That step constructs fresh `paperMeta`, without the rating, while carrying the article’s existing blocks and HTML.

   The writer audit is:

   | Path | Effect under the proposed `META_COLUMNS` design |
   |---|---|
   | Initial `metadata` import | Clears/omits the rating correctly: the full piece has not been read. |
   | Administrator’s standalone `metadata` on a full article | **Clears a rating it should preserve**, because the served body remains unchanged. |
   | HTML `extract` | Builds fresh metadata at [pipeline.ts:2477](/home/greg/code/spideryarn2/.claude/worktrees/reading-time-difficulty/src/pipeline.ts:2477). Replaces the rating on success and clears it on rating failure, as planned. |
   | PDF `extract` | Same behaviour at [pipeline.ts:2593](/home/greg/code/spideryarn2/.claude/worktrees/reading-time-difficulty/src/pipeline.ts:2593). |
   | `keptPaperMetadata` | Preserves selected bibliographic fields, **not** difficulty; its fresh-object policy is explicit at [pipeline.ts:2083](/home/greg/code/spideryarn2/.claude/worktrees/reading-time-difficulty/src/pipeline.ts:2083). Do not accidentally spread the old rating into a new extraction. |
   | Registry enrichment | Preserves unrelated fields through `...rest`: [article-registry.ts:231](/home/greg/code/spideryarn2/.claude/worktrees/reading-time-difficulty/src/article-registry.ts:231). It is part of the preceding write, not another later artefact write. |
   | Rename | Updates `articles.titleOverride`, not `meta`: [pg-shelf.ts:364](/home/greg/code/spideryarn2/.claude/worktrees/reading-time-difficulty/src/store/pg-shelf.ts:364). Preserves the rating correctly. |
   | *Read this* | Forces full extraction over the stored source: [routes.ts:6343](/home/greg/code/spideryarn2/.claude/worktrees/reading-time-difficulty/src/routes.ts:6343). Should produce a new full-text rating, not preserve an abstract-only rating. |
   | Registry backfill | Writes selected bibliographic columns only: [backfill-registry-facts.ts:267](/home/greg/code/spideryarn2/.claude/worktrees/reading-time-difficulty/src/backfill-registry-facts.ts:267). Does not clear difficulty. |

   I found no other production writer of the `meta` artefact.

   **`carry` is right** for revisions that preserve the body, including mode generation. Carry the original `ratedAt` too; creating a revision is not rating the piece again. If retaining the proposed metadata ownership, explicitly preserve difficulty in standalone `metadata` and test that path.

3. **F3 — the proposed public object conflicts with the shared reading-view type.**

   The plan requires owner `Meta.readingDifficulty` to contain five fields, but publishes only three: [plan:105](/home/greg/code/spideryarn2/.claude/worktrees/reading-time-difficulty/docs/plans/261005j-reading-time-knows-difficulty-a-model-rates-language-and-ideas-at-import.md:105). Today `PublicArticle` reaches the shared view by being structurally assignable to `Article`: [access.ts:45](/home/greg/code/spideryarn2/.claude/worktrees/reading-time-difficulty/src/web/article/access.ts:45). A present public rating missing required `model` and `ratedAt` breaks that property.

   Define a shared display rating `{language, ideas, reason}` and an owner/stored type containing required provenance. Preserve the distinction at the type boundary; do not invent public provenance or repair assignability with a cast. Explicitly add the three public columns to the SQL projection and construct the DTO field by field.

4. **F4 — the numbers are reasonable provisional choices, but they do not follow directly from the evidence.**

   [plan:38](/home/greg/code/spideryarn2/.claude/worktrees/reading-time-difficulty/docs/plans/261005j-reading-time-knows-difficulty-a-model-rates-language-and-ideas-at-import.md:38) compresses several different comparisons:

   - Against 238, Carver’s 320–200 wpm corresponds to **0.744–1.19× time**, not 0.85–1.20.
   - Brysbaert’s word-length predictions of 261 and 203 correspond to **0.912 and 1.172×**.
   - Neither source establishes five model-rating levels or their intermediate coefficients.
   - Britton’s residual 203/182 ≈ **1.115** is unexplained slowdown after that prediction; it is not an isolated measurement of conceptual load.
   - Carver’s residual slowdown is relative to particular readers. Wake Forest’s figures are teaching estimates.

   Multiplication is defensible **as a modelling assumption** if “ideas” means an additional effect after language has been accounted for. The evidence does not establish that a model’s two judgements achieve that separation. Correlation alone does not prohibit multiplication, but overlapping judgements can double-count difficulty.

   The bounds do not solve that problem: the largest valid product is already **1.68**, below the 1.70 ceiling, and the smallest is 0.85. The clamp changes none of the 25 valid combinations.

   Keep the tables if desired, but label them as provisional product coefficients informed by the studies. Define the reference reader and neutral joint case explicitly. The filtered twelve-article sample cannot justify the 1.40 cap, establish reader expertise, or show that reader effects matter “as much” as text effects.

5. **F5 — the card must distinguish the research baseline from the adjusted estimate.**

   [ReadTimeCard.tsx:45](/home/greg/code/spideryarn2/.claude/worktrees/reading-time-difficulty/src/web/ReadTimeCard.tsx:45) currently explains the headline directly as words at 238 wpm; line 56 converts the population’s 175–300 wpm range into minutes. Once multiplied, those sentences no longer explain the displayed arithmetic without qualification.

   Say that 238 is the **starting rate**, then explain the model’s provisional adjustment from sampled passages. The multiplied range is an illustrative range under the same adjustment, not a measured range for this piece. “A model estimated its difficulty from sampled passages” is more accurate than implying the system now knows how hard the whole piece is.

6. **F6 — sampling inside `extract` is possible, but “body only” needs an explicit implementation contract.**

   The premise that `extract` cannot recognise notes is too strong. Both extractors already produce trusted note-container stamps; [blocks.ts:447](/home/greg/code/spideryarn2/.claude/worktrees/reading-time-difficulty/src/blocks.ts:447) explains how the splitter reads them. A sampler can exclude paragraphs with a notes-container **ancestor**, rather than excluding only individually stamped elements.

   Nevertheless, [plan:76](/home/greg/code/spideryarn2/.claude/worktrees/reading-time-difficulty/docs/plans/261005j-reading-time-knows-difficulty-a-model-rates-language-and-ideas-at-import.md:76) leaves material choices unspecified: spacing by words or paragraph count, overlapping runs, non-paragraph prose, and paragraphs longer than the entire budget. “Whole paragraphs”, “within budget” and “reaches the last tenth” cannot all be guaranteed for every document.

   Sampling the actual body blocks after `blocks` avoids a second interpretation of the document. It adds the same paid call and latency, plus artefact plumbing. The start of `structure` also has blocks, but couples rating to structure retries/skips and makes backfill less natural.

   I agree with **not piggybacking on structure’s model call**: sliced documents, fallback trees and backfill would require aggregation or another generation path. The plan’s explanation at [plan:65](/home/greg/code/spideryarn2/.claude/worktrees/reading-time-difficulty/docs/plans/261005j-reading-time-knows-difficulty-a-model-rates-language-and-ideas-at-import.md:65) is sufficient.

7. **F7 — the listed tests can pass with the feature disabled or silently disconnected.**

   [plan:128](/home/greg/code/spideryarn2/.claude/worktrees/reading-time-difficulty/docs/plans/261005j-reading-time-knows-difficulty-a-model-rates-language-and-ideas-at-import.md:128) needs stronger positive controls:

   - An always-`1` multiplier passes bounds, unrated equality and nondecreasing monotonicity. Pin literal table results independently.
   - Shelf, masthead and Metadata can agree because all three ignore difficulty. Assert an independently calculated, changed number.
   - Every failure test passes if the call always returns unrated. Add a valid-answer success test through storage and rendering.
   - A DTO unit test passes while SQL never selects the fields. Exercise the actual public reader.
   - One round-trip does not test preservation, clearing or carrying. Add the writer transitions in F2, including all five columns clearing together.
   - A sample test using hand-picked clean paragraphs misses real extracted HTML. Use HTML and PDF fixtures with nested notes and assert that the gateway receives body text.
   - Test the actual pipeline paths with a stubbed gateway; removing either invocation must fail a test.

   Apply the multiplier **before rounding and the one-minute floor**. For example, 500 words at `(5,5)` should round to 4 minutes; multiplying the already-rounded flat estimate yields 3. Add short-piece and range-boundary cases.

   Also test malformed JSON, fractional/string levels, truncated completion, blank/oversized reasons, cancellation during an in-flight request, and script write refusal/zero affected rows.

8. **F8 — stages 1–2 can land safely, but stage 3’s mechanical wiring need not wait for paid evidence.**

   The split at [plan:114](/home/greg/code/spideryarn2/.claude/worktrees/reading-time-difficulty/docs/plans/261005j-reading-time-knows-difficulty-a-model-rates-language-and-ideas-at-import.md:114) is safe provided imports make no rating calls, absent ratings preserve today’s minutes, and the card honestly says unrated. A stubbed gateway can verify all storage, projection, calculation, failure and pipeline wiring behaviour.

   What remains unverifiable without paid calls is provider compatibility in practice, latency under the 20-second deadline, actual cost, rating quality and repeatability. Two runs on fifteen articles test repeatability and plausibility; they **do not calibrate reading-time coefficients**. Set acceptance criteria before running that check.

   Stage 2 also introduces a callable `--write` script. That is a manual path around the held validation, so the plan should explicitly say when it becomes available for production backfill.

9. **F9 — the backfill needs revision and draft safeguards, not just `--write`.**

   [plan:86](/home/greg/code/spideryarn2/.claude/worktrees/reading-time-difficulty/docs/plans/261005j-reading-time-knows-difficulty-a-model-rates-language-and-ideas-at-import.md:86) does not specify how the rating is attached after the model answers. The current revision could change meanwhile. An existing draft could also later publish its carried unrated state over an in-place backfill.

   Reuse the safeguards already documented at [backfill-registry-facts.ts:18](/home/greg/code/spideryarn2/.claude/worktrees/reading-time-difficulty/src/backfill-registry-facts.ts:18): capture the rated revision, lock/check the current pointer, handle unfinished drafts, and update only the intended columns atomically. Do not write a stale full `Meta` assembled before the call.

10. **F10 — make privacy, cost attribution, export and cache behaviour explicit stage deliverables.**

   - **Privacy:** [PrivacyPage.tsx:489](/home/greg/code/spideryarn2/.claude/worktrees/reading-time-difficulty/src/web/PrivacyPage.tsx:489) describes DeepSeek reading two PDF pages for bibliographic metadata. Add sampled full-article difficulty rating before enabling imports. The existing model-name inventory test cannot detect a wrong description of an already-listed model.
   - **Costs:** pipeline attribution is already inherited from [jobs.ts:1204](/home/greg/code/spideryarn2/.claude/worktrees/reading-time-difficulty/src/jobs.ts:1204). Add the job’s wire, route, reasoning decision, model inventory and cost disposition. The standalone script needs its own collector and article attribution; gateway use alone is insufficient. Do not assume metadata extraction’s measured `effort: none` validates difficulty judgement.
   - **Export:** [export.ts:370](/home/greg/code/spideryarn2/.claude/worktrees/reading-time-difficulty/src/store/export.ts:370) manually reconstructs `meta.json` and needs the rating. The reader’s bundle exports the revision row at [export-bundle.ts:431](/home/greg/code/spideryarn2/.claude/worktrees/reading-time-difficulty/src/store/export-bundle.ts:431), so the new columns should already cross; verify both formats with a rated fixture.
   - **Cached shelf:** [cached-shelf.ts:204](/home/greg/code/spideryarn2/.claude/worktrees/reading-time-difficulty/src/web/lib/cached-shelf.ts:204) accepts stored numeric `minutes`, without recomputing them. An old cached shelf may temporarily show flat minutes beside a freshly loaded rated article. Existing live revalidation can resolve that; document and test it. No database cache-version change is required merely because the server now derives minutes differently.

I changed no files and made no paid or database calls. I used the supplied source quotations, not a fresh literature fetch. `src/reading-time.ts` changed externally during this review; this verdict concerns the plan and traced storage paths, not that emerging implementation.