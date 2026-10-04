**The hook lift is sound. The main issue is that a one-shot reveal does not guarantee the row stays visible while Dig deeper runs.** Resolve F1 before building; the remaining findings tighten the implementation and proposal.

I reviewed the plan against committed code at `1c5329440230f09e42ed2caebb462931ca99fa8e`, because implementation edits appeared during the review. Code line references below use that baseline. I edited nothing and did not run tests.

1. **F1 — P1: The focused row can disappear after focus is consumed.**  
   The plan lowers the bar and consumes focus once the row is drawn (`docs/plans/261004b-citation-hover-card-offers-dig-deeper.md:69`). But `priorityOf` uses the investigation’s web influence, and the `finding` frame removes that investigation (`src/web/CitationsPanel.tsx:338`, `src/web/useCitations.ts:494`, `src/citation-effective-influence.ts:62`).

   A reachable example: relevance `0.20`, list influence `0.10`, kept web influence `0.90`, bar `0.40`. The row initially scores `0.433` and is visible, so focus is consumed. If its lookup is unassessed, the server runs `finding` (`src/citation-investigate.ts:931`); removing the investigation drops priority to `0.167`, hiding the row and its stream. A replacement answer can also lower priority.

   **Fix:** separate “scroll once” from “keep this investigation visible.” While that investigation is running in the panel, reapply `barToReveal` whenever its priority changes, including completion/failure. Preserve the chosen order and visibly lower the bar. Test both the `finding` transition and a completed answer with lower influence.

2. **F2 — P2: The focus handoff needs explicit retry and cancellation rules.**  
   Rows exist only once `ready` is true (`src/web/CitationsPanel.tsx:789`, `:896`). Calling `onBar` does not itself put the row into the current DOM; the controlled value must return through `useCitationControls` (`src/web/modes/citations/CitationsMode.tsx:92`). The planned tests do not cover either delay.

   **Fix:** specify this sequence:
   
   - Wait for a drawable list; do not consume focus while loading.
   - Calculate reveal using `effectiveOrder`, `priorityOf`, `survivesThreshold` and `floorToGateStep`.
   - After requesting a lower bar, retry on the next controlled render.
   - Consume only after finding and scrolling the actual row.
   - Acknowledge the exact `{id, n}` request, so an older acknowledgement cannot clear a newer one.
   - Cancel a request whose work has disappeared once revalidation establishes that fact.

   Scope the DOM lookup to this panel. An unscored row requires no bar change; neither does any non-prioritised effective order. Test a delayed list and delayed `onBar` update, rather than only helper arithmetic.

3. **F3 — P2: The proposed lifecycle tests miss the boundary being changed.**  
   The existing unmount test unmounts the whole harness, which contains both hooks (`tests/citations-investigate-client.test.tsx:133`, `:638`). Keeping that test and adding a read-only harness proves article unmount and standalone investigation, but does not prove that removing an already-mounted band preserves its stream and admission.

   **Fix:** add a parent containing `useCitationsRead` and a conditional child containing `useCitations`. Start through the child, remove it, send further frames, verify no abort and no second POST, then remount and verify the draft/result. Also switch articles and send late frames to prove they cannot patch the next article. Retain the held-GET regression in `tests/citations-find-late-reply.test.tsx:357`.

4. **F4 — P3: Part 2 overstates what the stored shapes establish.**  
   The C1 premise is **accurate for a paragraph join**, but insufficient for a claim-support join. A Debate claim has `blockId` and `claimQuote`; a work has `citedAt` (`src/types.ts:6014`, `:4305`). Two distinct claims can occupy the same paragraph (`src/web/debate-order.ts:245`). Joining by block would attach that paragraph’s works to both claims without proving which supports which.

   Also, the three named verdicts belong to `lookup.verdict`; `CitationInvestigation` stores a prose answer, not a structured verdict (`src/web/CitationsPanel.tsx:725`, `src/types.ts:4411`). That reading is work-level context, not an assessment against each Debate `claimQuote`.

   **Fix:** describe C1 as **“works cited in this claim’s paragraph, with their existing quick check and longer reading.”** State that a no-model join establishes co-location only. Claims also represent retained outside-source rows, not a complete claim inventory (`src/types.ts:6250`); the displayed groups are formed after filtering (`src/web/DebatePanel.tsx:934`).

5. **F5 — P3: Two other “today” statements need narrowing.**  
   “The prose’s citation marks are on for everyone” is false for visitors: Reader supplies them no works (`src/web/reader/Reader.tsx:1100`, `:1129`). “A cited work is never a Debate row” is too absolute: Debate sources come from web search, and key sources explicitly include the `origin` role (`src/types.ts:5735`, `:6277`). There is no explicit integration, but the same work can appear independently.

   **Fix:** say **“citation marks appear for owners regardless of the experimental switch”** and **“the two lists have no explicit cross-links or shared work identity.”**

On the remaining Part 1 questions:

- **Unmount and ordering:** move the controller/ref and cleanup with the state; leave `useAutoRun` and `useStepJob` in the band. Their activation ownership and polling lifecycle still need to end there. The investigation already patches the shared read, so sharing a hook introduces no new ordering mechanism. Preserve post-lookup/post-done `refresh()` and the awaited failure refresh that retains admission (`src/web/useCitations.ts:509`, `:542`, `:557`). Draft, failure and `findNote` will now survive mode changes until the next admitted investigation or article cleanup; that is an additional intentional behavior change to document.
- **Card eligibility:** the row has no stale-list refusal today; it remains enabled under the stale banner. The server likewise does not reject merely for staleness (`src/citation-investigate.ts:896`). Match that policy. Require a ready list containing the work and retain the synchronous controller guard; do not disable just because background revalidation is underway.
- **Touch:** copy TermCard’s direct button. A tap has already revealed the prose card, and `useHoverCard` deliberately leaves controls inside it alone (`src/web/ProseHoverCard.tsx:2205`, `src/web/useHoverCard.ts:669`). The row’s two-tap behavior reveals its separate explanatory tooltip. Make the paid action understandable in the prose card itself; a native `title` is insufficient on touch.
- **Visitors:** I found no exposure path if `citeActions` comes only from `owner?.citations`, is explicitly null for visitors, and gates the button. Visitors neither mount the read nor receive prose works (`src/web/reader-capability.ts:73`, `src/web/article/ArticlePage.tsx:645`).
- **Simplification:** choose one action owner. Have the card close and call `onDigWork(id)`; let Reader start the investigation, request focus and change mode. The plan currently describes Reader starting it while its card test also expects a separate `investigate` call. One callback removes that ambiguity without a new endpoint or URL parameter.

For **Part 2**, the Reception/Claims description, thread filters, and experimental distinction are accurate. A missing option is **A plus C1**: keep both modes while adding the paragraph-based connection. C1 does not require merging the modes. A smaller thread-link option could offer candidate existing threads through joined claim rows, explicitly labelled as candidates, without claiming a model has classified the citation.