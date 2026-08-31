## Verdict

R3 is sound. R2’s arithmetic is sound per boundary, but the implementation repairs more than the measured policy justifies. I would address these three findings before landing.

### Findings

1. **High — the structure eval silently stops measuring these faults.**  
   [`assembleTree`](/Users/greg/Dropbox/dev/experim/spideryarn2/evals/hierarchy-structure/model-arms.ts:393) calls `buildTree` without a report. One-block faults now become `outcome: "ok"` rather than `"threw"`, with no repair count. Invalid headings are removed before [`sourceHeadingValid`](/Users/greg/Dropbox/dev/experim/spideryarn2/evals/hierarchy-structure/score.ts:334), making that measure necessarily `1` or `null` for paid arms.  
   Keep the production outcome repaired, but add repairs to each eval result—or give `buildTree` an explicit strict/raw mode. The current optional report controls observation, not behavior.

2. **Medium — “one-block bounded” is local, not per answer.**  
   [`repairedChildRanges`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/hierarchy.ts:527) permits unlimited independent one-block repairs. I confirmed:

   - A sole child `[parentStart+1, parentEnd-1]` receives both `gap` and `short`, changing its range by two blocks total.
   - A five-level first-child chain cascades the same correction five times.
   - Multiple sibling gaps could collectively recover a large fraction of an article.

   All resulting trees pass `checkTree`, but this goes beyond evidence of “one slipped boundary.” I would cap distinct repaired boundary coordinates per answer—initially one. A cascade of the same boundary through nested nodes can remain allowed.

3. **Medium — malformed headings are forgiven without being counted.**  
   [`claim`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/hierarchy.ts:665) turns non-string and whitespace-only values into `undefined`; [`dropped.push`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/hierarchy.ts:675) then does not run. The new test explicitly accepts `sourceHeading: 42` without checking the report. Either reject the malformed field safely or count it as dropped. Otherwise “nothing is repaired quietly” is false.

A smaller test gap: nothing currently proves that the `BuildReport` totals reach `TocRun`, the CLI line, and the pipeline log.

## Explicit answers

1. **One-block arithmetic:** Yes, per endpoint.

   - `abs(lo - cursor) === 1` bounds a start move to one.
   - `cursor <= hi` prevents an overlap repair from making the child empty or backwards.
   - After the loop, `cursor = lastHi + 1`; therefore `cursor === parentHi` means `lastHi === parentHi - 1`, exactly one trailing block short.
   - A last child may safely receive both a start snap and an end extension, but that is two total changed blocks and two repairs—the policy caveat above.
   - Two-block displacement of any single boundary still throws. Root ends remain unrepairable and are checked exactly at [`toc.ts:768`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/hierarchy.ts:768).

2. **Cascade:** It terminates and produces a consistent tree. Parsed JSON cannot be cyclic; each proposal node is visited once. A correction can cascade through arbitrary depth, but each descendant endpoint moves at most one block. If an override makes the next discrepancy two blocks, it is not repaired and the partition check throws.

   A node can be repaired while its parent was not repaired; that is fine. Its parent’s final children are checked after recursion, and every successful tree is later checked again. No inconsistent successful case emerged.

3. **R3 strictness:** Yes—stronger than claimed. With a successful split, `body` is a contiguous prefix, so a body node’s range selects exactly the same blocks in `body` and the full array, not merely a loose subset. `appendSupplement` only extends the root at the tail. With `stranded > 0`, `body` is the full array and no supplement is appended.

   Therefore anything retained by the identical `sameHeading` predicate must pass `checkTree`. The builder can be stricter: it may drop a root claim found only in an appended supplement.

4. **Other broken red paths:** The eval is the significant one. Its throw-rate and heading-validity measures are now cleaned by the production repair without recording that fact.

   `src/validate-tree.ts`, its tests, and the publish guard remain strict because they call `checkTree` on stored trees rather than passing proposals through `buildTree`. Their deliberately corrupted `sourceHeading` tests remain red. I found no other test whose rejection vehicle was silently removed.

5. **Should repair happen?** Yes for R3, and yes for one measured R2 boundary slip. But logging individual runs is not sufficient monitoring: nothing aggregates or alerts on those fields.

   My immediate acceptance rule would be one distinct repaired boundary per answer, allowing the same coordinate to cascade through nested levels. I would not invent a rolling-rate refusal threshold from 13 calls; first persist/aggregate the rate, then alert when it departs materially from the calibration baseline. R3 need not refuse based on count because it removes only false provenance, but its rate should still alert.

6. **Anything else:** The new logs contain only counts and structural positions, not prose. R3 removes a route by which heading prose previously entered an exception. I found no new prose leak.

   Existing message nit: when a child ends beyond its parent, the partition error says it stops `-1 block(s) before` the parent. It still refuses safely, but the wording is backwards.

## Heading-tree wiring

I would build **(b), incrementally**, not ship permanent fallback-only behavior:

1. Builder, explicit marker, narrowly scoped invariant exemption, public DTO, and honest title-only UI.
2. Gate tree-dependent paid work.
3. Add the publication/refetch replacement seam.
4. Publish provisionally, then atomically replace tree and labels.

R2/R3 recover every measured structure failure, so (a) has little demonstrated remaining benefit while still requiring most of the provisional-state machinery. It also does not improve the 163-second wait. Candidate (c) should first be an eval arm; headings are already present in the model input, and salience is the unmeasured change.

Your consumer map is right, but incomplete:

- `labels.json` also records `structureHash`; a tree swap needs a matching label swap or explicit “labels arriving” state.
- `summary` and `glossary` both read the tree, but currently fingerprint only blocks. Allowing them to run before an upgrade can leave output falsely current.
- URLs/comments survive because they use block IDs, but section depth can change and move the nearest section boundary.

Unlisted costs of (a):

- It waits and pays for the failed structure call before helping.
- If the tree is truly never replaced, every gated mode remains unavailable forever: arc, ideas, sketch, similarity, and arguably summary/glossary.
- A headingless fallback is root-plus-leaves: readable prose, but no useful section bands.
- The current table renders gistless internal nodes as title-only navigation cells—not literally blank, but with no coarse reading content.
- You need a failure taxonomy. Catching every exception would disguise provider outages, configuration errors, and code bugs as successful degraded ingests.
- The ToC step would be recorded as “done” despite its model call failing unless degraded success becomes explicit.
- “Never replaced” must be enforced against ordinary reruns; otherwise the re-buy churn merely happens later.
- A permanently `provisional` tree is semantically misleading if no upgrade will ever be attempted.

For the reader, a clearly marked, prose-first fallback is better than a failed ingest: the original words remain readable, which is the product’s core promise. It becomes worse than a visible error if empty coarse levels and unavailable modes look complete. Default to prose, show title-only structure honestly, and disable or label unavailable modes rather than rendering silent holes.

Verification: the three repair suites passed serially, 59/59. Broader verification is currently obstructed by unrelated shared-tree work: `evals/toc-structure/heading-tree.ts` is staged as moved while consumers still import its old path, and other unrelated typecheck changes are present. No files were changed.

