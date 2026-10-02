# Plan review prompt: shelf filter terms (260928a)

You are reviewing a PLAN, read-only. Do not change any file.

**Candidate (live, pre-commit)**: worktree at base commit c2bb3c05, untracked files:
- docs/plans/260928a-shelf-facet-terms.md — THE PLAN (start here)
- docs/research/260928a-shelf-facet-terms-algorithms-and-ui.md — the research behind it
- docs/investigations/260928b-academic-bulk-import-without-llm-processing.md — the deferred idea (skim)
- spike/facets/extract.ts, spike/facets/choose.ts, spike/facets/run.ts, spike/facets/out3.txt — the throwaway spike whose numbers the plan quotes (not to be shipped as-is)

Context to read as needed: CLAUDE.md, docs/project/library.md (§ Shelf state, § Finding an article, § Sorting the shelf), src/web/Library.tsx (the `rows` memo; `ArchivedShelf` near the end), src/routes.ts (GET /api/library around line 7020), src/store/pg.ts (`listArticlesQuery`, `onTheShelf`), src/store/pg-shelf.ts, src/db/schema.ts (`articles`, `articleRevisions` incl. REVISION_CARRY_POLICY, `revisionBlocks`), src/store/pg-revisions.ts (publish/draft), docs/project/sql.md, docs/project/security-map.md, docs/project/tooltips.md, docs/project/url-state.md.

## What the work is for

Greg (quoted in the plan) wants deterministic, LLM-free filter terms over his own shelf: overlapping subsets, near-total coverage, rich tooltips, and an active/archived switch.

## What I want from you — an independent pass first

1. Is the design sound? Especially: (a) the storage — two tables keyed on revision_id with cascade, and a lazy fill inside a GET — versus alternatives (a pipeline step; keying on article_id + a content hash; no storage at all); is it true that a published revision's blocks never change after publish, which the revision key relies on? (b) the owner scoping — can anything let another reader's articles into this reader's terms, or leak one reader's phrases to another? (c) concurrency of the lazy fill (two tabs, a job publishing a new revision mid-fill); (d) request-time cost for a shelf of 1,000+ articles on Vercel serverless on a cold fill.
2. The algorithm: the membership rule, near-duplicate grouping, df band, greedy coverage with Jaccard skips. Anything that will produce wrong or misleading results a reader can see (e.g. live counts disagreeing with what the filter shows; a stale `?topics=` key filtering to nothing; grouping making a count say 5 while 6 cards appear)?
3. The UI: AND semantics, live counts, reusing "Show archived" by moving its state into the URL, the tooltip content, touch (a chip that both toggles on tap and opens a tooltip on tap).
4. Is there a smaller version that gets most of the value? Anything the plan should drop?
5. Stage boundaries and the test list: what's missing?

## Design questions I'd value your opinion on (my own, lower priority — spend most of the run above)

- Would you key on revision_id or on (article_id, hash of the counted text)?
- Is a GET that writes an idempotent cache acceptable here, or should the fill be a POST the client fires, or a pipeline step?
- Should near-duplicate grouping be in v1 at all?

## Output

Findings with stable IDs F1, F2, … each with severity (P0 data loss/security/charging/broadly unusable; P1 user-visible wrong behaviour or contract violated; P2 design/maintainability risk; P3 prose), whether it is established (direct evidence) or reasoned, the evidence (file:line), and a concrete recommendation. Then answers to the design questions. Then a one-line verdict: proceed / proceed with changes / rethink.
