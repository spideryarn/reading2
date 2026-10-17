The separate stored `figures` list is defensible and preferable to changing the public DTO, but the plan has two user-visible correctness holes, an underspecified anchoring/trim contract, and an eval that is not yet strong enough.

1. **High — visitors can receive an intro describing figures that their route does not contain.**

   The plan deliberately excludes `figures` from `PublicSkim` while allowing an intro to mention a figure ([plan:101](/var/tmp/spideryarn-worktrees/fbj5-figures-in-skim-route/docs/plans/261017d-figures-as-stops-of-their-own-in-the-skim-route.md:101), [plan:175](/var/tmp/spideryarn-worktrees/fbj5-figures-in-skim-route/docs/plans/261017d-figures-as-stops-of-their-own-in-the-skim-route.md:175)). Today `publicSkim` forwards `intros` while rebuilding only quote stops ([src/public/dto.ts:556](/var/tmp/spideryarn-worktrees/fbj5-figures-in-skim-route/src/public/dto.ts:556)), and the visitor renders that intro directly ([src/web/SkimPanel.tsx:980](/var/tmp/spideryarn-worktrees/fbj5-figures-in-skim-route/src/web/SkimPanel.tsx:980)).

   Change: because `src/public/dto.ts` is out of scope, require intros to describe only the quote spine and explicitly forbid naming figures. Alternatively, visitors must receive figure stops, but that would require the separate security decision the plan defers. Add a visitor test using an owner route containing figures.

2. **Medium — the merged walk is not threaded through `useSkimParts`, so Figures-view counts and pass switching will remain quote-only.**

   The plan only says `useSkimMode` walks `walkOf(...)` ([plan:136](/var/tmp/spideryarn-worktrees/fbj5-figures-in-skim-route/docs/plans/261017d-figures-as-stops-of-their-own-in-the-skim-route.md:136)). But the outer controller computes depth counts and the destination when switching back from the separate Figures walk from `stops` alone ([src/web/modes/skim/SkimMode.tsx:362](/var/tmp/spideryarn-worktrees/fbj5-figures-in-skim-route/src/web/modes/skim/SkimMode.tsx:362)). The owner currently passes only `owner.skim.stops` there ([SkimMode.tsx:295](/var/tmp/spideryarn-worktrees/fbj5-figures-in-skim-route/src/web/modes/skim/SkimMode.tsx:295)).

   Consequences:

   - While the separate Figures walk is open, Gist/More/Most chips show quote-only counts.
   - Switching to a pass whose first walked stop is a figure lands on the first quote instead.
   - A figure before the first quote does not behave as stop 1 across both walks.

   Change: construct the owner’s merged walk once and pass it to both `useSkimParts` and `useSkimMode`. Keep the visitor’s merged walk quote-only. Test switching from Figures into a pass beginning with a figure.

   Also generalise `SkimRow.quoteId` and every associated UI state map to `key`; merely adding a `figure` field leaves quote-specific identity throughout the panel ([src/web/SkimPanel.tsx:107](/var/tmp/spideryarn-worktrees/fbj5-figures-in-skim-route/src/web/SkimPanel.tsx:107), [src/web/SkimPanel.tsx:782](/var/tmp/spideryarn-worktrees/fbj5-figures-in-skim-route/src/web/SkimPanel.tsx:782), [src/web/SkimPanel.tsx:1037](/var/tmp/spideryarn-worktrees/fbj5-figures-in-skim-route/src/web/SkimPanel.tsx:1037)). Include pips, follow-scroll, tooltip state, arrival, and row keys in the tests.

3. **Medium — the proposed anchor cannot be derived correctly while leaving `validateRoute` unchanged.**

   The plan says a figure anchors after the nearest preceding quote occurrence that survived validation ([plan:109](/var/tmp/spideryarn-worktrees/fbj5-figures-in-skim-route/docs/plans/261017d-figures-as-stops-of-their-own-in-the-skim-route.md:109)), but `validateRoute` returns only the final `SkimStop[]`. It discards the winning raw occurrence’s index after choosing the shallowest duplicate/same-block candidate ([src/skim.ts:843](/var/tmp/spideryarn-worktrees/fbj5-figures-in-skim-route/src/skim.ts:843), [src/skim.ts:878](/var/tmp/spideryarn-worktrees/fbj5-figures-in-skim-route/src/skim.ts:878)) and after route-order caps ([src/skim.ts:895](/var/tmp/spideryarn-worktrees/fbj5-figures-in-skim-route/src/skim.ts:895)).

   Concrete failure: `Q1 depth 3, F1, Q1 depth 1`. The later Q1 wins. A membership-based implementation may treat the earlier occurrence as “surviving,” then store `after: Q1`, which places F1 after the later Q1 and reverses the model’s order.

   Change: either return the kept raw indices from quote validation, or preferably make the output mirror storage:

   ```json
   {
     "stops": [{ "quote": "Q1", "...": "..." }],
     "figures": [{ "figure": "F1", "depth": 1, "cue": "...", "after": "Q1" }]
   }
   ```

   `after` should be required and nullable. If its quote does not survive, drop the optional figure rather than silently changing its intended placement. This keeps `stops` quote-only, avoids `anyOf`, preserves the public DTO boundary, and still lets the model choose placement.

   `after: null` is sound for figures before every quote. A quote moved by `growPasses` retains its global position, but may disappear from the figure’s pass; document that `after` preserves global order, not guaranteed visible adjacency, and invalidate the intro if repair changes the figure’s visible neighbours.

4. **Medium — `trimFigures` can be correct, but not with the guarantee currently stated; trimmed figures must invalidate intros.**

   Conditional answer: if the quote-only route already passes `growthFailure`, repeatedly removing a figure from the earlier member of a violating pair must terminate within the number of figures, and removing all figures recovers the passing base route.

   The missing conditions are:

   - `growPasses` does not guarantee a passing quote route; it can return an unrepaired route for the later final check ([src/skim.ts:1056](/var/tmp/spideryarn-worktrees/fbj5-figures-in-skim-route/src/skim.ts:1056), [src/skim.ts:1069](/var/tmp/spideryarn-worktrees/fbj5-figures-in-skim-route/src/skim.ts:1069)).
   - With eight or more offered quotes, equality is a violation, not merely “too long” ([src/skim.ts:1008](/var/tmp/spideryarn-worktrees/fbj5-figures-in-skim-route/src/skim.ts:1008)).
   - With fewer quotes or a missing middle pass, comparison is between consecutive offered passes; `growthFailure` explicitly filters zero-sized passes ([src/skim.ts:1004](/var/tmp/spideryarn-worktrees/fbj5-figures-in-skim-route/src/skim.ts:1004)).

   Change: fail the quote-only route immediately if `growPasses` did not repair it; then run a bounded trim over consecutive offered depths and assert the combined route passes afterward. Add exhaustive count-level tests for all figure counts within `FIGURE_CAPS`, including Gist+Most with no More.

   `introsOf` does need to know. It currently nulls an intro only when quote depths move ([src/skim.ts:1203](/var/tmp/spideryarn-worktrees/fbj5-figures-in-skim-route/src/skim.ts:1203)); yet the plan explicitly permits an intro to name a figure. A trimmed, capped, invalid, or re-anchored figure can leave a false map. Conservatively null the affected pass’s intro whenever its final figure membership/order differs from the model answer, using `movedIntro` or a better-named new count.

5. **Low — the pass-length prose contradicts the chosen arithmetic.**

   The plan says quote targets stay unchanged and figures are added on top ([plan:39](/var/tmp/spideryarn-worktrees/fbj5-figures-in-skim-route/docs/plans/261017d-figures-as-stops-of-their-own-in-the-skim-route.md:39)), but later says “Gist is three to five stops” ([plan:62](/var/tmp/spideryarn-worktrees/fbj5-figures-in-skim-route/docs/plans/261017d-figures-as-stops-of-their-own-in-the-skim-route.md:62)). `targetsFor` can already target five quote stops ([src/skim.ts:322](/var/tmp/spideryarn-worktrees/fbj5-figures-in-skim-route/src/skim.ts:322)); adding a figure makes six.

   Change: say “three to five quote stops, plus at most one figure,” or impose a combined Gist cap if five total stops is the real product constraint. Measure total walked lengths, not only quote counts.

6. **Medium — the schema is valid, but mixing figures into `stops` makes an already dense low-effort task harder than necessary.**

   `anyOf` with fully required object variants is allowed by the prompting contract ([docs/project/prompting-guide.md:159](/var/tmp/spideryarn-worktrees/fbj5-figures-in-skim-route/docs/project/prompting-guide.md:159)). The concern is task quality, not schema validity: the same low-effort call ([src/skim.ts:254](/var/tmp/spideryarn-worktrees/fbj5-figures-in-skim-route/src/skim.ts:254)) must now juggle up to 30 captions while preserving quote ordering, depths, carrying, cues, and intros. The current prompt also explicitly says every stop is a quote ([src/skim.ts:1316](/var/tmp/spideryarn-worktrees/fbj5-figures-in-skim-route/src/skim.ts:1316)); all such quote-only statements need an audit, not just an added section.

   Change: retain the same model call, but emit quote `stops` first and a separate explicit `figures` array afterward. That matches storage, avoids positional reconstruction, and lets the model finish today’s quote task before selecting figures.

   For “named beside,” specify and test boundary-safe aliases: `Figure 2`/`Fig. 2`, `Figure 2a`, `Table S1`, supplementary/extended-data forms, and ensure `Figure 2` does not match `Figure 20`. The prompt should call this “named in Q4’s paragraph,” not “beside Q4.”

7. **Low — quote IDs and figure block IDs are not guaranteed to be disjoint.**

   Both use the same `spya-…` format. Fresh quote IDs are checked only against other quote IDs ([src/quotes.ts:1113](/var/tmp/spideryarn-worktrees/fbj5-figures-in-skim-route/src/quotes.ts:1113)), while the proposed figure key is its block ID ([plan:120](/var/tmp/spideryarn-worktrees/fbj5-figures-in-skim-route/docs/plans/261017d-figures-as-stops-of-their-own-in-the-skim-route.md:120)). A collision is unlikely but would make `locate`, React keys, and `?stop=` ambiguous.

   Change: during `walkOf`, reject/drop a figure whose block ID equals any route quote ID, with a counted drop and a test. Internally, retain the discriminated `{kind, key}` identity even where the URL carries only the raw key.

8. **Medium — the eval is a useful screen, but not enough to call the prompt change measured.**

   The plan uses two runs per arm, which is good, but “a few,” “most,” “rarely,” and “if the read is not clear-cut” are not predeclared criteria ([plan:178](/var/tmp/spideryarn-worktrees/fbj5-figures-in-skim-route/docs/plans/261017d-figures-as-stops-of-their-own-in-the-skim-route.md:178)). One no-figure article cannot establish that the substantially changed prompt leaves quote routing alone. The prompting guide requires blind paired judging and comparison against old-vs-old spread ([docs/project/prompting-guide.md:204](/var/tmp/spideryarn-worktrees/fbj5-figures-in-skim-route/docs/project/prompting-guide.md:204), [prompting-guide.md:208](/var/tmp/spideryarn-worktrees/fbj5-figures-in-skim-route/docs/project/prompting-guide.md:208)).

   Change:

   - Fix the corpus and thresholds before running: several no-figure articles, several ordinary figure papers, and cases with tables/media, missing captions, more than 30 figures, and few quotes.
   - Blind-compare quote order/coherence, carrying, quote cues, and intros—not just pass sizes, Idea coverage, and long-stop counts.
   - Judge figure appropriateness, omission, placement, and cue fidelity; “most routes contain a figure” rewards needless inclusion.
   - Record failure rate, every drop/trim count, input/output tokens, cost, latency, and reasoning-token presence at low effort.
   - Add automated cases for old routes, figure deep links with and without `depth`, stale/missing figures, first-stop figures, carried quotes around figures, pips, arrival/flash behavior, and the visitor route.

The freshness proposal itself is sound: `loadSkim` already gates hash comparison on the current prompt version ([src/store/pg.ts:4178](/var/tmp/spideryarn-worktrees/fbj5-figures-in-skim-route/src/store/pg.ts:4178)), so extending `skimInputHash` makes `/14` stale when figures change while `/13` remains merely outdated.

SHIP-WITH-CHANGES