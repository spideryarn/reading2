**Land 1 + 2a.** I would rather maintain 2b’s hook, but 2a’s hook-and-panel combination: it removes the flag-reset hazard without spreading a new interface through consumers whose rendering obligations remain largely unchanged. The union’s atomic transitions are a real benefit; the builder undervalues that benefit when it treats compiling wrong consumers as proof of little practical value. Nevertheless, the actual panel is less clear, and removing the projection helpers does not prevent either motivating consumer mistake. The orchestrator should make this landing decision; a wider rollout remains a recommendation to the owner.

**R1 — P3: the seven postmortems support a narrower benefit than either side initially claimed.**

Input: the postmortems and both implementations.

| Postmortem | Which change would make it less likely in practice? |
|---|---|
| **261004c — empty state hides failed recheck** | **2b modestly.** `recheck` sits beside the accepted absence, making it easier to notice. Neither the type nor `failedRead` forces the panel to display it. Stage 1’s combined empty-state/error assertion is the stronger protection. 2a contributes little here. |
| **261004f — historical 404 leaves retry loading** | **2b materially, if its transitions are adopted.** `retrying` and `failedRead` settle this sequence together without an independent historical-success flag. 2a only groups answer metadata; it does not enforce settlement. |
| **261005q — optimistic thread mistaken for deletion** | **Neither.** This needs confirmation history for individual optimistic rows. An atomic read result cannot establish what the server previously acknowledged. |
| **261005r — publication absence mistaken for sharing state** | **Neither.** The missing distinction is publication versus visibility, with ownership of writes. `known/null` can faithfully store the wrong inference. |
| **261006b — late read overwrites completed write** | **Neither.** This requires a write-generation fence. `landed` will happily accept an obsolete observation if its caller admits it. |
| **261006g — asking and failed collapse across a prop; failure has no retry trigger** | **2b modestly for the prop boundary, provided the child takes the whole read.** It makes the intended distinction explicit. It cannot prohibit a nullable projection or provide the missing retry trigger. |
| **261005i — failure inferred from message truthiness** | **2b helps opening failures:** `kind: "failed"` supplies an explicit presence discriminator. Retained-answer failures still use nullable `recheck`, so truthiness remains possible. Its panel’s `!== null` checks help independently of the union. 2a adds no protection. |

Smallest change: retain these conditional claims in the write-up. “The hook has three named transitions” is meaningful evidence, but these incidents span hooks, views, prop boundaries and reconciliation logic; their location does not make all seven read-state defects.

**R2 — P3: the compiler experiment fairly disproves outright prevention, but does not fully measure maintainability.**

Input: cases A/B and `answerOf`/`failureOf`.

B uses a helper supplied and used by the implementation itself. That is a fair test of the published interface, not an exotic escape hatch. However, saying “the same mistake compiles” understates that migration still requires choosing a projection and throwing information away.

Removing both helpers does **not** refuse A or B. These ordinary expressions remain legal:

```ts
if (read.kind === "known" && read.answer === null) {
  return emptyState; // ignores read.recheck
}

child(read.kind === "known" ? read.answer?.ideas ?? null : null);
```

I checked both against the actual types through an in-memory compiler overlay: zero diagnostics. An un-narrowed `read.answer` control produced TS2339.

I also replaced the production helper calls with local narrowing and removed their exports, entirely in memory; the client checker returned zero semantic diagnostics. So that version is buildable. Simply inlining the checks adds branching to an already complicated panel, though. Making it clearly better would require a further rendering refactor—such as isolating read notices and removing the duplicated owner-list prop—not merely deleting helpers. That refactor would still not make A/B illegal.

`failureOf` actually helps the motivating error-display case by collecting both failure locations. Value-only projections are also appropriate for several existing consumers. Their existence alone is not an argument against the union.

Smallest change: describe the experiment as a limit on compiler guarantees, not a complete verdict on the abstraction.

**R3 — P3: I found no reader-visible regression in 2a.**

Input: `git diff f36f463c7 751cab265 -- src/web/useIdeas.ts`.

The old and new stores have the same transitions:

- Accepted `null` or 404 clears the list and all four flags, clears the error, and becomes `none`.
- Accepted list replaces the list and its flags together, clears the error, and becomes `ready`.
- Failure preserves the answer and flags; the unchanged functional status updater turns only `loading` into `error`.
- Try again clears the error, becomes loading only without a list, and calls the same `reload`.

Thus list → failure → retry, none → failure → failed retry, job completion, slug change and obsolete replies retain their existing presentation. Slug changes still retain previous state while the new read is outstanding; 2a neither introduces nor repairs that existing behavior.

The pinned mechanics survive:

- Failure’s status update remains functional.
- `load` still depends on `[slug, begin, landed]`, with no answer-state dependency.
- Both post-await guards and the catch guard remain.
- Every `FreshReads` call and argument remains unchanged.
- Offline copies still update the displayed answer without becoming server-confirmed freshness evidence.

The nullable projections now turn missing/null metadata flags into `false`, whereas the old setters could publish `undefined`/`null` from an incomplete response. That is a small runtime-field normalization, but I found no current rendering difference: the consumers use those fields as Boolean conditions.

Smallest change: none required in 2a.

**R4 — P3: stage 1 is useful characterization, not exhaustive protection against plausible wrong implementations.**

Input: all 49 cases in `ideas-read-states.test.tsx` and the three added stop-card cases. Expanded rows with the same limitation are grouped below.

| Characterisation cases | Plausible wrong implementation that can still pass that case |
|---|---|
| **Opening asking** | Never sends the opening request. It observes asking and releases the gate, but does not assert the resulting answer. The successful-opening cases catch this elsewhere. |
| **Opening failed** | Draws Try again with a broken click handler. This case checks its presence; later retry sequences exercise it. |
| **None via 200 null / 404** | Wires *Find the ideas* to forced regeneration. Neither case presses that button. |
| **None + failed recheck / list + failed recheck** | Briefly changes presentation during an immediate refresh, then restores the expected final state. The held-refresh cases supply the missing observation window. |
| **Clean list** | Mishandles every subsequent refresh. This is a useful positive control, not transition coverage. |
| **Six failure-clearing rows** | Clears the error prematurely while the answering refresh is outstanding. These rows chiefly check the final answer and cleared failure. |
| **List → held refresh → repeated retries** | Strong coverage of list retention, retry-time error clearing, repeated failures and newest-message replacement. It does not hold an ordinary refresh over an already-failed recheck to prove the previous error remains visible during that refresh. |
| **None → held refresh → failed retry → recovery** | Strong coverage of the accepted-absence distinction and today’s lost paid button. It does not prove the manual paid button invokes the correct verb. |
| **Flag reset; four isolated flags; three `profileHash` values** | Strong coverage of the changed storage fields, including `""`. It does not establish freshness/provenance policy; that is separate. |
| **Malformed 200 preserves flagged list** | A parser that rejects this missing-artefact shape but accepts other malformed artefacts can pass. This is deliberately bounded parser coverage. |
| **Accepted artefact with zero ideas** | Correctly distinguishes an empty stored list from no artefact. It does not establish behavior for populated lists; the positive list cases do. |
| **Four automatic-run cases** | Strong coverage of spending and automatic reread policy, including a held failed reread. They do not exercise manual paid-button wiring. |
| **Eight Skim prerequisite cases** | Strong coverage of absent/failed/stale/current/outdated/profile-changed reads and pending presses. Quotes are fixed as ready, so these do not independently prove the combined Quotes/Ideas gate. |
| **Three Marginalia cases** | The stale → current → none sequence has a useful same-case positive control. Failed-opening absence alone cannot distinguish correct exclusion from a feed that never draws ideas; the current-list cases supply that control. |
| **Rewrite hold through failure, retry and replacement** | A hold that wrongly treats offline copies or pre-job reads as confirmation can pass. The existing rewrite-hold suite covers those omitted provenance paths. |
| **Four obsolete replies; three delayed bodies** | Strong protection against obsolete state commits. They do not observe body-consumption/logging work, and therefore cannot distinguish the first guard from the later guards. |
| **Reload/refresh identity and five requests** | Strong protection against state-dependent `load` identity and duplicate opening effects. It does not promise stable `retryRead` identity, which was not the contract. |
| **Stop card: current list survives failed refresh** | A card that never updates after its opening answer could pass this case alone. Other transition cases are needed for replacement/removal. |
| **Stop card: stale list excluded** | The glossary control proves the card rendered; the current-list case proves the idea itself can appear. Good suite-level control. |
| **Stop card: failed opening excluded** | Treating failure as ordinary absence could pass this case; the hook/band failed-opening case distinguishes them elsewhere. |

The reported 47/48 mutations are good calibration of selected breaks. Without a retained mutation-to-assertion ledger, they do not independently substantiate “every test was watched to fail,” nor do they establish completeness.

Smallest useful additions: paired manual-button tests checking unforced `ensure` versus forced regeneration, and a held ordinary refresh over an existing recheck error. These are follow-up coverage improvements; 2a changes neither consumer path.

**R5 — P3: the first `current()` check is redundant for state commits, but is not dead code.**

Input: immediately after `apiFetch` in `useIdeasRead`.

There is **no hook state write between the two awaits**. On 404, the second check runs synchronously before the null branch. For other responses, the second check or catch guard rejects obsolete state updates.

The first check nevertheless prevents consuming an already-obsolete body. Without it, `readJson` can await a stalled body, parse it, and log malformed/error responses before the later guard discards the result. `readJson` has observable logging side effects.

Smallest change: keep the check and qualify the write-up as “redundant for state-update protection in these tests.” A late-header response with a body-read spy would distinguish its separate purpose.

**R6 — P3: both picture-hook flag leaks are confirmed; a literal nullable-answer conversion must preserve diagnostics.**

Input: [useSketch.ts:168](/var/tmp/spideryarn-worktrees/sweep7-read-type-spike/src/web/useSketch.ts:168) and [useIllustrated.ts:283](/var/tmp/spideryarn-worktrees/sweep7-read-type-spike/src/web/useIllustrated.ts:283).

Both checked-empty branches clear the picture and its identity, retain validation faults, and set `none`; neither resets `stale`, `outdated`, `profiled` or `profileChanged`. A flagged valid picture followed by a checked-empty response therefore publishes the previous picture’s flags beside no picture.

2a’s grouping is the right structural remedy. Group each usable picture with its four flags, derive default flags from no picture, and retain `faults` separately so diagnostic emptiness survives. The stored identity can join that object too. Keep status, error, ordering and freshness behavior local.

This is two small hook-local changes—tens of lines each—plus transition regressions. No consumer migration or shared union is necessary. The immediate repair is just four resets in each empty branch, eight statements total. I have not established a reader-visible regression from these retained flags through the current empty views, so I would not label them P1.

Smallest change: repair them in a separate focused follow-up; do not expand this landing silently.

**R7 — P2: finish the selected landing and its decision record accurately.**

Input: landing 1 + 2a on current `dev`.

Carry the Quotes fixture’s `fresh` field and both rows of the footer test. Keep stage 1’s original `seen()` adapter; do not bring over the union adapter.

The `IdeasPanel` changes from truthiness to explicit failure-presence checks are independently sensible, particularly given 261005i. I would keep them as a separately tested follow-up, rather than bundle them into this behavior-preserving storage change. Nothing else in 2b is necessary for this landing.

The plan still opens with “plan, not built” and early wording implying approved migration. Before landing the evidence, make its current status and authority unambiguous: the spike is complete; the orchestrator selects the retained change; wider migration requires an owner decision.

Verification: **174 tests passed** in the two requested suites. Another **49 selected transition/race/hold tests passed**; 339 cases were filtered out. Those runs exercised 2b, not a reconstructed 2a tree. No repository file was changed. The independent lint probe timed out, so the complexity figure remains the builder’s reported measurement.

I would land exactly:

1. **`f36f463c7`** — stage 1.
2. **`751cab265`** — stage 2a.
3. From **`781589b13`**, only the `fresh` fixture field and the two footer-test rows in **`tests/ideas-read-states.test.tsx`**.
4. **`153c5035a`** — the spike findings, with the status, authority and evidence qualifications above incorporated into **`docs/plans/261006n-one-type-for-a-read-spiked-on-useideas.md`**.

**Exclude the rest of `781589b13`: the shared union, consumer migration, test adapters and transition-table file.**