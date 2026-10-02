Verdict: **revise the research before writing a plan.** The core direction is sound, and B is stronger than it first appeared, but several load-bearing claims are wrong. Most importantly, A saves about 24 seconds in the cited run, not 75 seconds, and every option is missing the mechanism that updates an already-open reader.

I made no edits. “Code” below means directly checked in the working tree; “judgment” is my design inference.

## 1. Empty tree and the minimum valid tree

**Code:** The conclusion is right for a multi-block article, but the stated failure count is wrong.

`checkTree` decides leaf status from `children.length === 0` and requires a leaf to span one block. It also requires the root to span the whole article. But coverage marks every index in the leaf’s range, even when that leaf is invalid. Therefore:

- Root spans all 300 blocks: one “leaf spans 300 blocks” failure; no uncovered-block failures.
- Root spans one block: root-span failure plus 299 uncovered blocks.
- There is no configuration producing exactly “one failure plus 299 uncovered blocks” as written.

See [tree-invariants.ts:187](/Users/greg/Dropbox/dev/experim/spideryarn2/src/tree-invariants.ts:187), [tree-invariants.ts:218](/Users/greg/Dropbox/dev/experim/spideryarn2/src/tree-invariants.ts:218), and [tree-invariants.ts:252](/Users/greg/Dropbox/dev/experim/spideryarn2/src/tree-invariants.ts:252).

For any article with more than one block, root plus one leaf per block is indeed the smallest structurally valid tree. For a one-block article, the root itself can be the single leaf.

## 2. Explicit marker, `treatment`, and `meta.excerpt`

**Judgment:** The analogy is right; the proposed node field is not.

The existing invariant deliberately distinguishes an intentional gist exception from a missing gist caused by a bug. That precedent supports an explicit marker. But `treatment` already means “apparatus rather than argument” and brings six supplement-specific invariants with it. `treatment: "provisional"` would overload a semantic axis that has a different job. See [types.ts:112](/Users/greg/Dropbox/dev/experim/spideryarn2/src/types.ts:112) and [tree-invariants.ts:257](/Users/greg/Dropbox/dev/experim/spideryarn2/src/tree-invariants.ts:257).

Prefer a tree-level state such as `provisional: "headings"` or a similarly closed value. The whole tree is replaced atomically; there is no current hybrid where individual nodes independently become final. A node-level state only becomes useful if partial NDJSON nodes will later coexist with completed ones.

`meta.excerpt` can make the flat root-plus-leaves tree valid without changing the schema: put the excerpt into the root’s `gist`. Nothing mechanical breaks. But:

- `Meta.excerpt` is documented as Readability’s one-or-two-sentence, last-resort card blurb, while `TreeNode.gist` promises one sentence of substitutable reading content. See [types.ts:924](/Users/greg/Dropbox/dev/experim/spideryarn2/src/types.ts:924) and [types.ts:103](/Users/greg/Dropbox/dev/experim/spideryarn2/src/types.ts:103).
- It may be publisher marketing rather than the article’s claim or move.
- My read-only aggregate found a non-empty excerpt for only **5 of the 9** real articles with blocks.
- It fixes only the flat tree’s root. It cannot supply the gists required by each internal node of a heading tree.
- Without a separate provisional marker, the client cannot distinguish “publisher excerpt while structure is building” from a completed model gist.

So excerpt is a defensible fallback after an explicit product decision, not a general replacement for provisional state.

## 3. What the flat tree draws

**Code:** `buildOutline` does return one entry per root child, hence one entry per block in a flat tree. The “every band is blank” conclusion is false. See [tree.ts:402](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/tree.ts:402).

Three details change the description:

- The spine calls an unnamed top-level band `"Untitled section"`; nested ones get positional names. See [Spine.tsx:907](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/Spine.tsx:907).
- The separate Outline mode drops a row with neither title nor `navLabel`; it does not draw a blank row. See [outline.ts:118](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/outline.ts:118) and [outline.ts:202](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/outline.ts:202).
- If an explicit marker lets an internal node omit its gist, `TableView` falls through to `node.navLabel ?? node.title`; the root would show its title rather than an empty cell. See [TableView.tsx:797](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/TableView.tsx:797).

The quoted Spine docstring is accurate but selectively applied. It discusses blank **child rows inside a depth-2 band card**, not the root children that become top-level bands in a flat tree. Those empty child rows are now filtered. See [Spine.tsx:865](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/Spine.tsx:865) and [Spine.tsx:938](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/Spine.tsx:938).

The usability objection survives in a narrower form: a 300-paragraph article gets 300 tiny, semantically indistinguishable spine targets. But it is not a blank rail plus an empty column.

## 4. NDJSON arithmetic and timing

**Code:** `reasoningTokens` is a subset of output tokens. The repo says so directly, and Anthropic documents `thinking_tokens <= output_tokens`. See [ai-call.ts:275](/Users/greg/Dropbox/dev/experim/spideryarn2/src/ai-call.ts:275), [token-budget.ts:13](/Users/greg/Dropbox/dev/experim/spideryarn2/src/token-budget.ts:13), and [Anthropic’s thinking documentation](https://platform.claude.com/docs/en/build-with-claude/thinking).

The arithmetic is correct:

- 18,369 − 13,716 = 4,653; thinking share 74.67%.
- 34,175 − 28,800 = 5,375; thinking share 84.27%.

The source rows are [data/_ai-calls.jsonl:26](/Users/greg/Dropbox/dev/experim/spideryarn2/data/_ai-calls.jsonl:26) and [data/_ai-calls.jsonl:47](/Users/greg/Dropbox/dev/experim/spideryarn2/data/_ai-calls.jsonl:47).

Two qualifications:

- Anthropic calls the subtraction an approximation of non-reasoning output, not an exact JSON-token count.
- The 122s and 270s figures are not measured. They assume reasoning and answer tokens take equal time, then omit the time needed to complete the first usable NDJSON record.

Anthropic confirms that thinking precedes text, but adaptive thinking varies per request and effort is only soft guidance. It recommends measuring representative traffic rather than predicting latency from token counts. [Anthropic’s adaptive-thinking guidance](https://platform.claude.com/docs/en/build-with-claude/thinking-steering-and-cost).

There is no reliable retrospective first-text timestamp in the local ledger. OpenRouter’s generation endpoint can be queried using the stored generation IDs and exposes timing metadata, but it does not clearly promise “first Anthropic text block” rather than the first streamed event. [OpenRouter generation metadata](https://openrouter.ai/docs/api/api-reference/generations/get-request-&-usage-metadata-for-a-generation). I would inspect that first, then timestamp `onText` on the next naturally occurring ToC call rather than buy a dedicated call.

## 5. The NDJSON objections

They are directionally useful but too absolute.

1. **“Validation cannot go early” — false.** Syntax, record shape, known block IDs, valid ranges, parent existence, monotonic order, and duplicate IDs can all be checked incrementally. Complete coverage and the final sibling partition cannot be accepted until the end. Nested JSON does not give partition correctness “for free”; the current implementation explicitly validates it.

2. **“A partial tree always fails `checkTree`” — usually, not always.** Until the records cover all blocks, it fails coverage or tiling. Once every needed node has arrived, the tree may pass even before an END record arrives. A completed top-level subtree can also be validated locally before the whole tree can.

3. **“Truncation stops being loud” — true only for a weak protocol.** A header declaring the article range and expected count, plus an explicit END record carrying counts or a hash, keeps truncation loud.

4. **Missed objection: there is no browser delivery path.** The model stream exposes text deltas, but pipeline `report` accepts a short string held only in memory. It does not carry partial structured data to an open article. See [pipeline.ts:283](/Users/greg/Dropbox/dev/experim/spideryarn2/src/pipeline.ts:283) and [jobs.ts:317](/Users/greg/Dropbox/dev/experim/spideryarn2/src/jobs.ts:317). NDJSON therefore needs an application stream or another incremental artefact channel.

Flat parent-pointer NDJSON does add a real mechanical failure surface, but I would not call it an inherent semantic-quality risk. Avoid it by streaming one **nested top-level subtree per line**, with a header and terminator. That preserves the representation the model already handles while allowing each completed part to be checked.

Also expect repeated geometry changes, column reflow, scroll-anchor movement, duplicate/resume handling, and changing positional node IDs while records arrive.

## 6. The no-tree gates

The fixture-prose claim is correct. `candidateDirs` tries `data/<slug>` and then `example`, and `loadArticle` continues whenever either blocks or tree is absent. A mid-ingest filesystem article can therefore serve the fixture’s blocks and prose. See [api.ts:123](/Users/greg/Dropbox/dev/experim/spideryarn2/src/api.ts:123) and [api.ts:151](/Users/greg/Dropbox/dev/experim/spideryarn2/src/api.ts:151).

The five rows break down as follows:

- Filesystem `loadArticle`: correct.
- `describeDir`: correct.
- `articleDir`: the table’s outcome is wrong. It also falls through to `example`, so with the fixture present it returns the fixture directory rather than `null`; metadata will describe the fixture rather than 404. See [api.ts:604](/Users/greg/Dropbox/dev/experim/spideryarn2/src/api.ts:604).
- Postgres owner `loadArticle`: correct.
- Postgres library: correct.

Missed gates:

- Public Postgres reading independently requires both tree and blocks. See [public-reader.ts:411](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/public-reader.ts:411).
- `publishRevision` requires not just a valid tree, but a completed `toc` run whose input hash matches the blocks. A new placeholder stage will not publish through that gate without an explicit policy change. See [pg-revisions.ts:1115](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/pg-revisions.ts:1115).

I would fix the non-`example` fixture fallback independently, before any feature work. Serving the wrong article is worse than returning a visible “still building” response.

## 7. Priority order

I would not retain A → B → C as currently justified.

The cited label calls ran concurrently. All three began at approximately 14:53:15 and the last finished at 14:53:38. Their durations sum to 65.2 seconds, but their wall-clock contribution is about **23.2 seconds**. The ToC job step finished about 24.2 seconds after the structure call. See [data/_ai-calls.jsonl:26](/Users/greg/Dropbox/dev/experim/spideryarn2/data/_ai-calls.jsonl:26) through [data/_ai-calls.jsonl:29](/Users/greg/Dropbox/dev/experim/spideryarn2/data/_ai-calls.jsonl:29); the concurrency is intentional in [labels.ts:1355](/Users/greg/Dropbox/dev/experim/spideryarn2/src/labels.ts:1355).

Therefore A is roughly a **13% cut to the measured ToC phase**, not a 31% cut to a 238-second wait. The 238-second baseline also includes arc, which is no longer in the default ingest.

A is also not as small as stated:

- `labels` is not currently a `StepName`. See [types.ts:1651](/Users/greg/Dropbox/dev/experim/spideryarn2/src/types.ts:1651).
- Labels affect three rendering paths: Spine cards, `TableView`’s outline leaf column, and the separate Outline mode.
- The browser fetches an article once and does not refetch it when a ToC-related job finishes. See [App.tsx:405](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/App.tsx:405).
- The add page navigates only when the whole job is done. See [AddPage.tsx:174](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/AddPage.tsx:174).

My ordering would be:

1. A small safety/readiness slice: remove the fixture fallback for non-fixture slugs; define what “safe to open” means; establish one article-refetch/tree-replacement seam.
2. B, because it is the only option that answers the original ask and the heading evidence supports it.
3. Fold A into the same upgrade state machine: provisional heading tree → real unlabelled tree → labelled tree.
4. C only after actual first-text timing.

A genuine fourth product option is: **keep a usable heading tree as the final geometry when headings are good, and let the model fill gists/labels without re-cutting it.** That avoids tree-swap invalidation entirely. Articles with poor headings can still request model structure. The trade-off is giving up model-discovered section boundaries on otherwise well-headed articles.

## 8. Optional stages against a provisional tree

For the 80/20 version, refuse all four until the final structure exists.

The research overstates their common representation:

- Arc and summaries store exact node ranges.
- Ideas anchor occurrences to block IDs and already fingerprint blocks plus tree. See [ideas.ts:108](/Users/greg/Dropbox/dev/experim/spideryarn2/src/ideas.ts:108).
- Glossary occurrences are derived as block IDs and its freshness hash currently covers only blocks. See [glossary.ts:699](/Users/greg/Dropbox/dev/experim/spideryarn2/src/glossary.ts:699).
- Summaries also hash only blocks, despite reading and targeting the tree. See [summarise.ts:790](/Users/greg/Dropbox/dev/experim/spideryarn2/src/summarise.ts:790).
- Arc already fingerprints blocks, tree and metadata. See [arc.ts:248](/Users/greg/Dropbox/dev/experim/spideryarn2/src/arc.ts:248).

So “allow and stamp stale” is already safe for arc and ideas, but would require freshness changes for summary and glossary.

Refusal is expressible as a server or stage precondition, but there is no first-class “waiting for final tree” job state. While the ingest job is active, the one-active-job-per-slug rule already returns 409 for separate glossary/summary work. Afterwards, the queue accepts those named steps normally. See [jobs.ts:1293](/Users/greg/Dropbox/dev/experim/spideryarn2/src/jobs.ts:1293).

Arc is the sharpest case: opening an owner’s article automatically starts the arc job when it is absent. A provisional marker must gate that hook or it will immediately spend against the placeholder tree. See [useArc.ts:19](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/useArc.ts:19) and [useArc.ts:133](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/useArc.ts:133).

## 9. Measurements before building

The heading count in the doc is now real; I reproduced **8/10 with at least three headings** and the listed model-L1/source-heading counts.

Cheaper measurements that could change the design further:

- Measure **maximum prose run without a heading**, not only heading count. In the current corpus, the largest runs include 61 blocks in `fowler-phrenology`, 42 in `scaling-hypothesis`, and 38 in `constitution`. That better predicts whether a heading tree gives usable bands.
- Record paste-to-blocks, blocks-to-provisional, provisional-to-real-tree, and assets-complete separately. The one complete historical job reached the end of blocks in about eight seconds, but one sample is not a budget.
- Count excerpt availability and suitability. Availability is only 5/9 now.
- Count external-image incidence and asset duration on a broader corpus.
- Timestamp first text and first complete structural record on the next natural ToC run.
- Exercise a tree replacement in the real UI and observe column count, scroll position, selected mode, spine hit targets, and offline cache replacement.

## 10. Other missed risks

Three are plan-changing:

- **Image privacy:** `assets` is in the default precisely to stop the reader’s browser disclosing its IP to publisher CDNs. Opening after blocks or structure but before assets either reintroduces that leak or requires suppressing external images until the manifest arrives. See [pipeline.ts:166](/Users/greg/Dropbox/dev/experim/spideryarn2/src/pipeline.ts:166) and [pipeline.ts:1378](/Users/greg/Dropbox/dev/experim/spideryarn2/src/pipeline.ts:1378).

- **Stage 3 does not publish reader blocks:** it writes `output/<slug>.blocks.json`; the ToC stage copies the matching blocks into `data/<slug>/blocks.json`. A placeholder “at stage 3” must publish both blocks and tree, probably as a separate stage or publication boundary. See [pipeline.ts:1160](/Users/greg/Dropbox/dev/experim/spideryarn2/src/pipeline.ts:1160) and [toc.ts:826](/Users/greg/Dropbox/dev/experim/spideryarn2/src/hierarchy.ts:826).

- **No live tree replacement:** an open article holds the fetched `Article` in component state. Neither the completion of structure nor labels currently replaces that payload. This affects A, B, and C, not just polish.

The research is worth continuing, but its current priority table should not survive into a plan unchanged.