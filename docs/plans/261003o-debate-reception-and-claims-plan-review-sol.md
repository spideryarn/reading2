The client-only split is a reasonable v1: both searches and the claim grouping already exist. Deferring steering and a citation index is sensible. The plan needs corrections before building, especially around empty states, thresholds and visitors. I changed no files.

1. **F1 — P1, established: “no rows” does not mean “no reception found.”**  
   Step 6 replaces several distinct outcomes with one sentence. Today, `emptyGroupNote` distinguishes no returned pages from returned pages whose quotations could not be verified. `sharedLeadNote` also distinguishes an empty search from rows withheld by the public boundary. A threshold or thread can independently empty the visible list.

   Evidence: [DebatePanel.tsx:682](/home/greg/code/spideryarn2/.claude/worktrees/fbcaue42-debate-claims-and-reception/src/web/ReceptionAndClaimsPanel.tsx:682), `sharedLeadNote` at line 533, and `tests/debate-panel.test.tsx:293–424`.

   **Fix:** preserve those distinctions separately in each sub-mode. Show the negative search finding only when the stored search warrants it; otherwise explain verification failure, withholding or filtering. Add owner and visitor tests for each case.

2. **F2 — P1, established: equal levels do not make a threshold useless.**  
   Step 3’s “all rows at one level” suppression rule is wrong. Three `named` rows can all be hidden by `quoted`; three `partly` rows can all be hidden by `directly`. With an existing `?name=quoted` or `?bears=directly`, hiding that bar also removes its reset and leaves the reader stranded.

   Evidence: `visibleDirect` in `src/web/debate-levels.ts:135`, `visibleClaims` in `src/web/debate-order.ts`, and `StopBar`’s reset in `src/web/DebatePanel.tsx`.

   **Fix:** suppress a bar only when no supported threshold can change its list **and** no active setting needs explaining or resetting. Test homogeneous weak rows with both untouched and restrictive URLs.

3. **F3 — P1, established: visitors already have both judgments.**  
   Step 9 is factually wrong. The public DTO sends `identifies`, and `publicDebateRowBase` sends validated `bears`. `VisitorDebateBand` wires both bars today. Implementing the stated visitor exception removes existing functionality.

   Evidence: [dto.ts:722](/home/greg/code/spideryarn2/.claude/worktrees/fbcaue42-debate-claims-and-reception/src/public/dto.ts:722), `dto.ts:901–929`, `src/public-types.ts:678–695`, and `src/web/modes/debate/DebateMode.tsx:130–157`.

   **Fix:** use the same data-dependent bar rules for owners and visitors. Test a real public payload carrying both fields; older fixtures without them are insufficient.

4. **F4 — P1, reasoned: importing the proposed Scholar helper into the panel crosses the server boundary.**  
   Step 2 points directly to `scholarUrl` in `src/citations.ts`. That module imports server pipeline machinery, including `jsdom-lazy.ts`, whose module initialization calls Node’s `createRequire`. It also imports `source-hash.ts`, which uses `node:crypto`. A direct client import risks a build failure or browser failure. Marginalia imports `rowWork` from `DebatePanel`, so the exposure extends beyond opening Debate.

   Evidence: `src/citations.ts:40–70`, `src/jsdom-lazy.ts:47–62`, `src/source-hash.ts:17`, `src/web/marginalia/MarginaliaColumn.tsx:32`.

   **Fix:** move the pure Scholar URL helper into a shared browser-safe module and have both callers import it. Include the client build in validation.

5. **F5 — P1, established: the new default restores a known false reception result.**  
   Sorting cannot protect the constitution decoy: its surviving direct row is the `named` Lawfare result about the other document. With no stronger row, that wrong result becomes the first reception result. The chip was already present when the previous evaluation rejected this default.

   The suggested title-and-byline distinction also fails this particular counterexample: both versions have Anthropic as their byline. That limitation is explicitly recorded in `260906b`, under “What is built, and what is cut.”

   Evidence: [debate-levels.ts:79](/home/greg/code/spideryarn2/.claude/worktrees/fbcaue42-debate-claims-and-reception/src/web/reception-levels.ts:79), `260906b`’s Stage P table and identification decision, and `tests/debate-panel.test.tsx:989`.

   **Fix:** test both the newly measured genuine reply and the existing decoy before choosing the rule. Either retain `quoted`, or visibly separate title-only candidates from confirmed reception. The new positive example justifies revisiting the decision; it does not establish that the replacement is safe.

6. **F6 — P1, reasoned: the integration sweep misses the machinery that owns new sub-modes.**  
   Grepping existing `debateby` and `name` references will not find two necessary changes:

   - `src/web/last-view.ts:70–104` needs `debate` in `REMEMBERED`; otherwise Claims restores as Reception. `tests/last-view.test.ts` explicitly guards this inventory.
   - `src/web/sub-modes.ts` needs Debate’s vocabulary, navigation parameters and command words. `CommandBar.tsx` obtains sub-mode commands through `subModesOf`, not through existing Debate order references. Activation handling and the generated command catalogue need corresponding updates.

   **Fix:** name these integrations and their tests explicitly. Preserve the existing single-search activation behaviour when entering either sub-mode.

7. **F7 — P2, reasoned: legacy order precedence is underspecified.**  
   Mapping `debateby=claim` to Claims deliberately removes reception from an old mixed-list link. More seriously, the plan does not say what wins for `debate=claims&debateby=date`, or how pressing Reception clears a lingering `debateby=claim`. Since Reception is represented by an absent parameter, a legacy fallback could immediately reopen Claims.

   Existing tests also establish that explicit `debateby=claim` ignores `bears`; the proposed Claims bar changes that combination’s meaning.

   Evidence: `src/web/params.ts:1395`, `tests/debate-panel.test.tsx:1747`, and `src/web/sub-modes.ts:266`.

   **Fix:** define explicit sub-mode precedence, legacy fallback and atomic switch updates. Test conflicting parameters, both switch directions, reload and Back. Document the intentional old-link change.

8. **F8 — P1, established: the permanent sub-mode descriptions contradict the current interface rule.**  
   Steps 1 and 7 add a sentence under the controls explaining the mode. `docs/project/mode.md:163–177` explicitly prohibits description lines there and directs them to control tooltips or the band’s `(i)`. Greg’s request for a clearer panel does not explicitly reverse that rule.

   **Fix:** put these explanations in the segmented control’s tooltips or `(i)`. Keep actionable empty-state handoffs on the panel.

9. **F9 — P2, reasoned: the new tallies need provenance and legacy handling.**  
   “2 against” in a claim heading promotes a model judgment into an apparently authoritative result. Existing rows explicitly mark `lean` as AI interpretation. Also, older stored owner rows have `valence`, not `lean`; tallying the field directly will disagree with their correctly rendered rows.

   Evidence: `src/web/DebatePanel.tsx:Row`, `src/types.ts:readStoredLean`, and `tests/debate-legacy-lean.test.tsx`.

   **Fix:** label the tally as AI judgments and calculate it through `readStoredLean` over the displayed rows. Define whether “sources” counts rows or distinct URLs: one page can answer multiple claims.

The smaller version I would build keeps the split, claim headings and passage jumps, scoped bars, and accurate empty-state handoffs. Leave claims expanded initially and omit the tallies; those additions are not necessary to solve the reported confusion. Reception as the default is defensible with a prominent Claims handoff when empty—the plan supplies no corpus-wide evidence for a smarter default.

For threads, distinguish **no stored membership in this sub-mode** from **membership hidden by its bar**. Ignore selection only in the first case; retain today’s disabled-button and selected-thread explanation in the second.

VERDICT: build with the P0/P1 fixes — the split fits the request, but the current plan would misreport empty results, remove visitor controls, strand filtered lists and restore a measured false reception match.