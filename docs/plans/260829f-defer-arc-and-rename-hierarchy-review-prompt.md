# Review request: defer the arc step, and rename the Contents mode to Hierarchy

You are reviewing a **plan, before it is built**, in the Spideryarn repo (an AI-assisted reading
app). You have read-only access to the working tree — please read the files rather than trusting my
summaries of them. Where I quote a docstring, check I have not quoted it selectively.

**The plan is `docs/plans/260829f-defer-arc-and-rename-hierarchy.md`.** Read it first, in full.

## Background you need

The ingest pipeline is stages 1–6, defined in `src/pipeline.ts`. `DEFAULT_INGEST_STEPS` (what "add
this URL" runs) is currently `["fetch", "extract", "blocks", "toc", "arc"]`. Steps `tweets`,
`glossary`, `summary` and `ideas` are in `STEP_ORDER` but deliberately *not* in the defaults — they
run on demand when a reader asks for them, via the client hook `src/web/useStepJob.ts`.

Greg's ask, verbatim (2026-08-29):

> Right now, we build the Table of Contents and Arc as part of the initial queue when we add an
> article. They're slow, so this adds a lot of latency when adding a new article before we can read
> it. How complex would it be if we didn't run those automatically as part of the initial queue?
> - Then we could open the article more immediately before they've finished running. I think it
>   makes sense for the article to open initially to the "Contents" view, which would immediately
>   trigger the various LLM calls, and in the meantime the "Contents" mode would be in a "Loading"
>   state (with a spinner etc).
> - Can we run Table of Contents and Arc in parallel?
>
> One more thing - I'd like to rename the "Contents" mode to "Hierarchy". Make sure to rename all the
> variables, docs, references, etc.

I put three options to Greg for how far to go, and **he chose the smallest: defer `arc` only, keep
`toc` in the queue.** He also chose to rename the on-screen label *and* the internal mode id
`"toc"` → `"hierarchy"`, but not the pipeline step. Those are settled decisions — please review the
plan for *executing them*, not re-litigate them, though do say so if you think one is actively
unsafe.

## The specific claims I most want checked

These are the load-bearing ones. If any is wrong, the plan is wrong.

1. **"Arc is already optional everywhere, so the Hierarchy view degrades on its own today."** I rest
   this on `arc?: Arc` in `src/types.ts` and `src/public-types.ts`, and on `buildArcColumn` in
   `src/web/tree.ts` returning `null` when `arc` is undefined. Is that actually true *everywhere* —
   including the spine, `src/web/App.tsx`, `src/web/stats.ts`, the metadata page, the public/visitor
   read path in `src/store/public-reader.ts`, and anything that reads `has.arc`? Is there a code
   path that assumes an arc exists once the article is servable?

2. **"Taking `arc` out of `DEFAULT_INGEST_STEPS` introduces a silent-staleness bug unless it first
   gets a freshness check."** My reasoning: `arc` has no stamp, `stepIsDone` only asks whether the
   artefact exists, and today its *position* in the default steps is what gets it swept by
   `cascadeForce` in `src/jobs.ts` when an earlier step is forced. Remove the position and a
   re-ingest yields a new tree with a stale `arc.json` beside it — and because `buildArcColumn`
   joins by exact block-range pair, non-matching entries are dropped from the view **without a
   word**. Is that chain correct? Check `cascadeForce` and `stepIsDone` yourself; I may have
   mis-read how force propagates, and specifically whether a job containing only `["toc"]` can
   invalidate `arc` by some route I have not found.

3. **"The freshness check must hash the blocks *and* the tree, following `ideas`, not the blocks
   alone like `tweets`/`glossary`."** Because a tree can be recut without any block changing. Agree?
   And is hashing the tree sufficient, or does a tree that is recut into *identical ranges* still
   need a re-run for some reason (gist text feeding the arc prompt, say)?

4. **"The rename is safe for existing shared links."** Because `toc` is the default mode so never
   appears in a URL, and `modeParam.parse` returns null → default for unknown values, so an old
   `?mode=toc` degrades to the same view. Check `src/web/params.ts` and confirm. Is there any
   *persisted* reader state — database, localStorage, the reader profile, saved positions — that
   stores the mode string and would break? That is the thing I am most worried about having missed,
   because I searched the client but not the schema.

5. **The mode/step split in § 3.3 of the plan.** `"toc"` is both the mode id and the pipeline step
   name. I classified every occurrence in `src/` as one or the other. Please check that table
   against the tree and tell me any I got backwards — especially `src/web/Metadata.tsx:678`, which
   is a *step* reference living in a client file among mode code.

## Also worth your view

6. Once the arc is generated in the background, the client has to read it. There is no
   `GET /api/arc/:slug`; the arc arrives inside the `/api/article/:slug` payload. Refetch the whole
   payload, or add a narrow route? I lean towards the narrow route because
   `docs/plans/260827am-glossary-read-latency.md` records a very similar refetch being expensive on the
   Postgres store. Your call.

7. **The visitor hole.** The arc job must be started from `OwnedReader` (`src/web/App.tsx`), not
   `Reader`, because the acceptance test for public reading is that a signed-out browser issues no
   POST at all. So a publicly-shared article whose arc never ran would show a visitor no arc, for
   ever, with nothing to trigger one. Today that cannot happen because every article gets an arc at
   ingest. How would you close this — accept it, keep `arc` in the queue but stop *blocking* on it,
   or generate lazily server-side on read?

8. **Is "defer arc only" even worth it?** `toc` is two model passes (tree + `labels.json`) and `arc`
   is one, so this removes roughly one call in three from the wait and leaves the larger one. The
   plan says to measure before/after and not to claim the win otherwise. Is there a cheap way to get
   more of the win that I have missed — e.g. is any part of `toc` itself deferrable, or could `arc`
   start on the tree before `labels.json` lands?

9. Anything in the plan's § 4 ordering that would leave the tree in a broken or unsafe intermediate
   state if the work were split across commits.

## What I would like back

Numbered findings, each with: the claim, whether you agree, the file/line evidence, and what to
change. Please be explicit where you are inferring rather than checking — I will verify each
finding myself, and I would rather know which ones you did not read the code for. If a claim is
simply right, say so briefly; I do not need it restated.
