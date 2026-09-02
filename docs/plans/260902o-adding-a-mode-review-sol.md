## Verdict

**Ready with changes; not ready to build as written.** The direction is good, but T1.1’s proposed check is ineffective, T1.7 should be deleted, T2.2 needs redesign, and several affected sites are missing.

### Evidence-ranked findings

1. **T2.1 is a reproduced live race, not a hypothesis.**

   - **(a)** The working-tree race test reproduces it: Ideas ends with `["the old idea"]` after the newer completion response landed first; the Glossary control retains the new value. [`useStepJob`](</home/greg/code/spideryarn2/.claude/worktrees/adding-a-mode/src/web/useStepJob.ts:168>) does not order the opening and completion reads. `Tweets.tsx` is an eighth consumer and has the same unguarded pattern.
   - **(b)** Promote T2.1 to reproduced/Tier 0, add Tweets to Stage D, and qualify “permanently” for Arc, which can sometimes self-repair after an absent response. Keep the extraction narrowly about request ordering: ordinary reload may join, post-write refresh must trail, and only the newest generation may commit. Parsing, 404s, state shape, and copy stay local.

2. **T0.1 is a real defect, but the inventory and fix are incomplete.**

   - **(a)** Offline copies are used only after a GET transport failure and are labelled as copies, so staleness is not a reason to exclude these routes ([api.ts](</home/greg/code/spideryarn2/.claude/worktrees/adding-a-mode/src/web/lib/api.ts:558>)). Timeline, Quiz, Sketch, and **Arc** are ordinary stored-artifact GETs; all four are absent from `CACHEABLE` ([api.ts](</home/greg/code/spideryarn2/.claude/worktrees/adding-a-mode/src/web/lib/api.ts:719>), [routes.ts](</home/greg/code/spideryarn2/.claude/worktrees/adding-a-mode/src/routes.ts:6513>)). Also, a successful stateless `POST /api/quiz/:slug/mark` currently invalidates `/api/quiz/:slug`, so merely adding Quiz still loses it offline after answering a question.
   - **(b)** Add Arc; add a GET → POST mark → failed GET regression; exempt the stateless mark POST from invalidation. Define the derived test as covering stored artefact GETs, not every syntactic GET route.

3. **T1.7’s proposed total matrix fails the deletion/YAGNI test.**

   - **(a)** The current policy has 46 columns × 13 readers: totalising it means 598 cells, including **473 explicit nulls**. [`store-revision-columns.test.ts`](</home/greg/code/spideryarn2/.claude/worktrees/adding-a-mode/tests/store-revision-columns.test.ts:1>) already compares every projection exactly with its grants and passed 37/37. Removing `quotes.quotes`, adding an unlisted projection, or querying an ungranted column is caught.
   - **(b)** Remove T1.7 from the build, recording that the historical class is now covered by the exact projection-policy test. Do not build the sparse matrix as a dense one.

4. **T2.2 is wrong as specified.**

   - **(a)** There are six passage producers, not four: Ideas, Timeline, Search, Criteria, Quotes, and the omitted Claims ([ClaimsPanel](</home/greg/code/spideryarn2/.claude/worktrees/adding-a-mode/src/web/ClaimsPanel.tsx:191>)). Only Ideas and Timeline share all five effects. Search and Criteria deliberately omit auto-open and intent-jump; Quotes and Claims have no open key. More importantly, a hook inside the bands cannot remove Reader’s five `Found[]` states or its two selection chains ([App.tsx](</home/greg/code/spideryarn2/.claude/worktrees/adding-a-mode/src/web/App.tsx:1797>)).
   - **(b)** Delete the state/ternary-reduction claim. If retained, narrow `usePassageMode` to the actual shared lifecycle: publish `found`, clear it on unmount, and—through a keyed/unkeyed discriminated union—clear invalid/open keys. Leave auto-open-first and intent-jump in Ideas and Timeline.

5. **T1.1 identifies the right problem but proposes a check that cannot work yet.**

   - **(a)** `MODES_UI` is annotated with `mode: Mode`, so its inferred element union is already `Mode` even when a row is absent ([Dock.tsx](</home/greg/code/spideryarn2/.claude/worktrees/adding-a-mode/src/web/Dock.tsx:299>)). Reversing `Exclude` cannot detect duplicates because unions discard multiplicity.
   - **(b)** Preserve literals with `as const satisfies readonly ModeUi[]`, then assert only `Exclude<Mode, ActualModes>` is `never`. Keep the existing runtime membership/pressed-buttons equality: it catches duplicates and ordering. Do not add recursive type-level uniqueness.

6. **T0.2 leaves state set, but it is not presently a reader-visible Tier 0 defect.**

   - **(a)** Criteria’s unmount cleanup clears only `onFound` ([CriteriaPanel](</home/greg/code/spideryarn2/.claude/worktrees/adding-a-mode/src/web/CriteriaPanel.tsx:299>)), so `openRefereeKey` remains in Reader. Outside Referee, dispatch ignores it; on remount Criteria initially publishes an empty list and its invalid-key effect clears the old key before ordinary results arrive. A test inspecting hidden parent state can fail, but that is a contract test rather than a demonstrated UI failure.
   - **(b)** Downgrade this to state hygiene and fold the one-line cleanup into the narrowed T2.2 lifecycle work. Remove the contradiction where Stage A fixes it and Stage E fixes it again. The large standalone behavioral test is not justified without visible behavior.

7. **T1.9 is only partly correct.**

   - **(a)** Quotes is the mutable outlier among the six mode artefacts that expose `inputFingerprint`; across generators generally, Glossary and Tweets also take mutable arrays. Adding `glossary.inputFingerprint` deletes no special case: the pipeline hash is shared with Tweets, and Postgres freshness compares the full stamp rather than only that fingerprint.
   - **(b)** Keep the one-word Quotes `readonly` cleanup and describe its peer set accurately. Delete the Glossary export/special-case work.

8. **T1.2 undercounts the label copies.**

   - **(a)** `COSTS` repeats six labels in addition to `MODE_LABEL`, Dock, and the raw controls-bar id ([visitor.ts](</home/greg/code/spideryarn2/.claude/worktrees/adding-a-mode/src/web/visitor.ts:134>)). Renaming Referee in the sites named by the plan would leave visitor copy stale.
   - **(b)** Have owner-only visitor policies carry no display string; derive `feature` from `MODE_LABEL[mode]`. Then Dock and controls also use `MODE_LABEL`.

9. **T0.3 is broader than a number change.**

   - **(a)** The overview says “two of ten” and its preceding band list omits Outline, Timeline, Referee, and Remember.
   - **(b)** Say thirteen modes, eleven band-opening modes, and update the list/links too.

10. **T1.3 is correct and worth doing.**

    - **(a)** The two `Partial` tables plus four free-mode branches and a fall-through allow omission; Referee already demonstrated that failure class. A total record makes Timeline’s “stated rather than defaulted” distinction stronger because its explicit row is required.
    - **(b)** Use three behavioral variants, not four: `available`, `owners-only`, and `artefact(key)`. Derive the owner-facing name from `MODE_LABEL`. Delete the fallback and its fallback-only assertion, retaining semantic visitor tests.

11. **T1.4 is worth doing, but define whether “one family” includes Chat.**

    - **(a)** Five duplicated CSS families serve nine headers; `.chat-head` is a sixth near-copy with the same long-title ellipsis requirement. Summary’s `flex:none` and Diagram’s ellipsis are differences, not yet proven defects.
    - **(b)** Prefer one family including Chat: 10 header sites and 9 decorative-icon sites; keep `.chat-icon` for action buttons. Apply `flex:none` and ellipsis centrally, with the browser comparison as the veto. Remove the inaccurate “eleven renames” count.

12. **T1.5 is correct, with a cheaper total shape.**

    - **(a)** Missing `STAMP_SOURCE[step]` becomes `null`, making a stamped step perpetually non-current and repeatedly chargeable.
    - **(b)** Use `Record<StepName, ArtifactKind | null>` with explicit nulls for Fetch, Extract, and Blocks. This is clearer than deriving another subset type.

13. **T1.6 is correct; the `Pick` is no longer load-bearing.**

    - **(a)** `pgArticleReader` manually lists all twelve `ArticleReader` methods, while no supported adapter may legitimately omit one ([pg.ts](</home/greg/code/spideryarn2/.claude/worktrees/adding-a-mode/src/store/pg.ts:1875>)). The cast in [index.ts](</home/greg/code/spideryarn2/.claude/worktrees/adding-a-mode/src/store/index.ts:206>) suppresses the useful check.
    - **(b)** Use `satisfies ArticleReader`, remove the `Pick` and cast, and update the stale seam-test comment.

14. **T1.8 is correct and worth its few lines.**

    - **(a)** `STEP_ORDER: StepName[]` widens away membership, although the runtime jobs test currently catches missing rows and ordering.
    - **(b)** Preserve the tuple literals and add the missing-member `Exclude` assertion. Keep the runtime equality test for order and duplicates.

### Other missing sites

The audit also missed the stored Referee GETs: `/api/referee/criteria/:slug` and `/api/referee/claims/:slug`. They fit the paid/stored offline promise, but nested routes expose another issue: `slugOf()` currently reads path segment 3, which would record `"criteria"` or `"claims"` as the article slug. Add an explicit decision: either cache them with route-aware slug extraction and mutation tests, or document why they are deliberately excluded. Do not let the artefact-derived test silently define them out of scope.

### Stages and T3.1

A‖B and C‖D are source-file-disjoint after the revisions, but every stage also says it updates the same plan document. Give those updates to the orchestrator after each parallel wave.

T2.1 should now be promoted and scheduled with the first wave because its risk veto has already gone red. I would start revised **A and D**, with revised **B** alongside if capacity permits; then C after A.

Do **not** start E as written. Either narrow it to the six-producer lifecycle helper above and re-review that boundary, or give it its own plan. It depends on C through `App.tsx`, not on D.

T3.1 does not survive. `plain` and `hierarchy` would both be `null`, yet Plain has `inMode=true` and empty columns while Hierarchy has `inMode=false` and keeps columns. T2.2 also cannot remove the broad Reader state/prop surface, so an extracted `BandSpec` renderer remains `<ModeBands>` under another name. The cheapest future option is an inline exhaustive `switch(mode)` or local `Record<Mode, ReactNode>` that closes over Reader’s locals; layout would still require an explicit `hierarchy | plain | band` distinction.

I made no edits and left the existing peer/worktree changes untouched.