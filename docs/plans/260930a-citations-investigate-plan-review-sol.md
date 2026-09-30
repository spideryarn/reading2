Verdict: **rethink** the current streaming/verification design, not the feature itself. The product idea is sound, but the proposed wire can temporarily and permanently show quotations that code has not verified, and several provenance claims are stronger than the evidence supports.

## Findings

### P-1 — P0 — Post-hoc quote checking does not satisfy the 5G honesty rule

**File/section:** [260930a § What was read / UI / Assumptions](/home/greg/code/spideryarn2/.claude/worktrees/fb5q-citations-investigate/docs/plans/260930a-citations-investigate-one-work-on-demand.md:62)

**Problem:** The reader sees each quotation before verification. If the stream disconnects, storage fails, or they simply stop reading before the final line, an invented quotation has already been presented as source prose. The stored answer also retains a failed quotation permanently; a warning beneath it does not undo that attribution.

The check itself proves only that the same words occur somewhere in the union of collected extracts. It does not prove:

- that they occur in the source the prose attributes them to;
- that the source is the cited work;
- that the model derived them from the extract rather than memory;
- or that the quotation supports the surrounding interpretation.

An invented or remembered quotation can pass by occurring in a different result. A correct quotation can be reported missing because of the 8,000-character cap, Exa’s `[…]` joins, typography/TeX changes, curly quotation marks, or because it came from the article rather than a web extract.

**Concrete change:** Do not send unverified quotation text as SSE deltas. For v1, buffer the result and require structured `{ quote, sourceUrl }` evidence. Accept a quotation only when `sourceUrl` is an exact returned annotation and store/display the exact extract slice. Drop or downgrade the dependent claim when verification fails, as 5G already does. An even simpler v1 is quote-free investigation prose beside 5G’s existing verified assessment and quotation.

### P-2 — P1 — The evidence wire does not yet justify the proposed “what was read” claim

**File/section:** [260930a § What was read / Mechanism](/home/greg/code/spideryarn2/.claude/worktrees/fb5q-citations-investigate/docs/plans/260930a-citations-investigate-one-work-on-demand.md:51), [openrouter-stream.ts § evidence collection](/home/greg/code/spideryarn2/.claude/worktrees/fb5q-citations-investigate/src/openrouter-stream.ts:393)

**Problem:** “Search extracts, not full text” describes the intended tool, but “This is always true” is too absolute on the proposed configuration.

OpenRouter documents Exa results as page highlights sent to the model and surfaced through `url_citation.content`, while full-page retrieval is a separate tool. However, Investigate inherits Explain’s unpinned `auto` tool configuration, and `collectSearchEvidence` silently truncates at 8,000 characters even though this repo has observed a 9,858-character annotation. Thus the model and verifier can see different strings. An annotation may also have URL/title but no `content`. [OpenRouter’s web-search documentation](https://openrouter.ai/docs/guides/features/server-tools/web-search)

**Concrete change:**

- Pin the investigation to the exact engine/wire that is probed—preferably Exa.
- Set `max_characters: MAX_EVIDENCE_EXCERPT` so the model’s per-result budget and the verifier’s cap agree.
- Run a Stage 0 probe on the actual **streaming** call, confirming that annotation content is the text supplied to the model.
- Count only non-empty extracts, not every URL annotation.
- Say: “We did not obtain the paper or fetch full-page text. OpenRouter returned search-result extracts for N results, capped at …” Avoid claiming that no short page could coincidentally have been returned in full.

### P-3 — P1 — Applying 5G’s identity predicate to every evidence page weakens it

**File/section:** [260930a § What was read](/home/greg/code/spideryarn2/.claude/worktrees/fb5q-citations-investigate/docs/plans/260930a-citations-investigate-one-work-on-demand.md:58), [citation-lookup.ts § resultIsTheWork](/home/greg/code/spideryarn2/.claude/worktrees/fb5q-citations-investigate/src/citation-lookup.ts:299)

**Problem:** 5G’s identity decision is a sequence, not just `resultIsTheWork`. The model first selects one URL; `readFind` requires that returned result to name the work; only then does `resultIsTheWork` apply its stricter check.

Used independently across every evidence page, `resultIsTheWork` accepts a DOI/arXiv identifier found in the URL immediately. That can include a search/citing page carrying the DOI in a query parameter. For title-based rows it establishes only that a result’s metadata matches the work, not that the paper or its “own page” was obtained.

**Concrete change:** For v1, always state **“the paper itself was not obtained.”** If the additional identity line is retained, require the model to select an exact annotation URL, apply both 5G gates, store the matched URL and match basis, and word it only as “one returned result matched the work’s identity.” Never upgrade that to “we read the paper” or “the work’s own page.”

Add adversarial tests for a citing page with the DOI in its URL, a repository/search record, a correction/review page, and the known shared-title-prefix sibling case.

### P-4 — P1 — The staleness hash omits inputs that materially determine the answer

**File/section:** [260930a § Staleness](/home/greg/code/spideryarn2/.claude/worktrees/fb5q-citations-investigate/docs/plans/260930a-citations-investigate-one-work-on-demand.md:122)

**Problem:** The answer is derived from the whole article and contains a profile-specific “For you” paragraph, but the hash includes neither. Editing the article elsewhere can invalidate “how else it bears on this article”; editing the profile or purpose directly invalidates the personalised addendum. The statement that a profile change does not make the investigation wrong ignores that two different products have been braided into one `answer`.

The hash also omits the article-supplied link/identity anchor and configured model, despite 5G R-4 including the model.

**Concrete change:** For the simple one-row version, hash the exact rendered inputs:

- cached whole-article part;
- title/authors/year/reference/link/link source/identity anchor;
- exact capped citing passages and `why`;
- prompt and evidence-policy version;
- requested model;
- exact rendered profile, preferably also stored as `profile_hash`.

Hide the entire row on any mismatch. If preserving the generic research across profile edits matters, split `answer` and `for_you` into separate columns with separate hashes.

### P-5 — P1 — Reuse the stream machinery below `explainStream`, not by turning Explain into a parameter bag

**File/section:** [260930a § Mechanism](/home/greg/code/spideryarn2/.claude/worktrees/fb5q-citations-investigate/docs/plans/260930a-citations-investigate-one-work-on-demand.md:85), [explain.ts § buildExplainMessages/explainStream](/home/greg/code/spideryarn2/.claude/worktrees/fb5q-citations-investigate/src/explain.ts:408)

**Problem:** The proposed seam creates combinations such as a citation prompt billed as Explain, a new job using Explain’s default model, or evidence collection accidentally enabled for comments. `explainStream` also has Explain-specific logging, `blockId`, `deep`, token ceiling, ending policy, default model, and a hard-coded `openRouterStream("explain", …)` call.

The concrete risk to existing comments and glossary lookups is a one-byte change to their system/article/tool prefix, silently losing prompt-cache reuse, or a change in their model/job attribution and ending behavior. A single default-request test will not cover ordinary, deep, and profiled calls.

Also, because Investigate has a different system prompt, it cannot share Explain’s cached prefix anyway. Keeping its tool definition identical buys no cache benefit and prevents choosing a safer evidence configuration.

**Concrete change:** Keep `explainStream` as an unchanged wrapper. Extract a lower-level stream runner that owns clocks, transport, usage collection, and end classification, while `explain.ts` and a new `citation-investigate.ts` each own a complete request, job, logging context, tools, result type, and accepted endings. Snapshot the fully serialized existing Explain request for ordinary, deep, and profiled callers.

### P-6 — P1 — Search and allowance bounds are not ready to approve

**File/section:** [260930a § Limits / Stages](/home/greg/code/spideryarn2/.claude/worktrees/fb5q-citations-investigate/docs/plans/260930a-citations-investigate-one-work-on-demand.md:114)

**Problem:** One-at-a-time is right, but 10/hour and 30/day have no cost basis, and the global fuse has no number. The inherited `max_uses: 8, max_results: 5` can also expose the model to roughly forty result extracts and a very large context. This repo has measured search/result caps behaving differently from their names; current OpenRouter documentation now describes `max_total_results` as stopping further searches, so the exact current wire needs re-probing rather than trusting either account blindly.

`ExplainResult.searches` also collapses missing usage into zero. For an expensive feature, “provider did not report the count” must remain distinct from “no searches.”

**Concrete change:** Move the real-call probe before schema/UI work. Measure restrained calls for cost, search count, result count, latency, context size, and worst observed call. Then:

- choose a small total-result cap, likely 5–8;
- give the prompt an explicit restrained search plan;
- store nullable `searches` plus its provenance;
- set `leaseMs` to timeout plus margin;
- name `daily.globalFills`;
- derive the fuse from an explicit maximum acceptable daily loss.

Until then, concurrency 1 is supported; 10/hour and 30/day are guesses.

### P-7 — P2 — Storage is broadly sound, but the proposed columns and export path are incomplete

**File/section:** [260930a § Store/privacy/export](/home/greg/code/spideryarn2/.claude/worktrees/fb5q-citations-investigate/docs/plans/260930a-citations-investigate-one-work-on-demand.md:117), [article-rows.ts § export coverage](/home/greg/code/spideryarn2/.claude/worktrees/fb5q-citations-investigate/src/store/article-rows.ts:174)

**Problem:** `sources jsonb` is a justified opaque collection, following `glossary_lookups.citations`; a variable list of quote checks can also be JSON. The scalar provenance is too lossy, however:

- `work_page_host` does not identify which source matched or why;
- `quotes_checked` does not distinguish offered, verified, and missing;
- `pages_read` overclaims when an annotation has no extract;
- `searches` needs a missing state;
- `profile_hash` is absent.

The export description is also factually off: rollback is hand-written in `src/store/export.ts`; the downloadable bundle is in `src/store/export-bundle.ts`, with table inventory/read wiring in `src/store/article-rows.ts`.

**Concrete change:** Use scalar columns for status/counts/hash/model/time and JSON only for variable source/quote collections. Add database checks for non-negative counts, URL schemes, entry-id format, state consistency, and owner/article foreign keys. Register the table in `ARTICLE_TABLE_COVERAGE`, `readArticleRows`, rollback export, and bundle augmentation output. Explicitly test both exports and the public DTO/store boundary.

The custom system prompt must include `PROFILE_RULES`. Even then, keeping profile text out of model-generated search queries remains an instruction, not a technical boundary; the tooltip/privacy documentation should not claim otherwise.

### P-8 — P2 — “Clean finish” is weaker than the plan says

**File/section:** [260930a § Store / Stages](/home/greg/code/spideryarn2/.claude/worktrees/fb5q-citations-investigate/docs/plans/260930a-citations-investigate-one-work-on-demand.md:129), `src/term-lookup.ts` § `refuseUnfinished`

**Problem:** The glossary helper refuses abandoned, truncated, and filtered endings but accepts `unknown-finish-reason` and `wants-tools`. That is tolerable for an explanation; it is too permissive for a stored investigation whose evidence validation happens only at completion.

**Concrete change:** Investigate should accept only an unambiguous finished/stop ending. Test that unknown endings and surfaced tool requests produce no save and no `done`.

## Simpler version

The simplest version that preserves most of the value is:

1. Keep 5G’s existing structured, source-specific assessment as the answer to “does it back the claim?”
2. Add one buffered investigation call for “how else it bears on the article” and “For you.”
3. Pin and cap the search extracts.
4. Make broader prose quote-free, or render only exact source-bound quotations that code retained.
5. Always say that the paper/full text was not obtained; treat a matching search result as metadata provenance only.

That removes the unsafe post-hoc scanner, avoids changing Explain’s public contract, and leaves streaming as a later improvement once verified spans can be withheld or replaced before display.