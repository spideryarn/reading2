Reviewed base **`03144f563`**, independently reading the code before the candidate and earlier reviews. No files changed. This is a source review; I did not run Postgres or browser tests.

The core server design is substantially better than the stopped attempts: Structure owns the stand-in, publication stays fenced, and the awaiting marker makes the successor runnable. **The assumption census is still incomplete, chiefly around client state and successor ordering.**

**F1 — P1 — ESTABLISHED: Diagram’s retained node state can disable following indefinitely.**

The plan calls hover and focus harmless transient state. They have behavioural consequences.

[DiagramPanel.tsx:778](/home/greg/code/spideryarn2/.claude/worktrees/open-before-structure/src/web/DiagramPanel.tsx:778) clears hover, roving selection and focus only when the picture’s `kind` changes. Replacing its tree leaves `kind` unchanged. A removed hovered node need not fire pointer-leave; [DiagramPanel.tsx:1380](/home/greg/code/spideryarn2/.claude/worktrees/open-before-structure/src/web/DiagramPanel.tsx:1380) then suppresses following while that retained hover exists.

Both builders use positional IDs, so an ID that survives can also identify a different passage.

**Change:** clear these states on tree replacement. Reset Outline’s retained focus by the same semantic boundary, rather than relying solely on whether its ID still exists. Test replacement while hovering and while keyboard focus is inside the diagram.

**F2 — P1 — REASONED: `loaded` does not establish that the jobs snapshot is fresh enough to declare failure.**

`loaded` means “a poll has succeeded sometime,” not “this list was read after this awaiting article.” [useJobs.ts:45](/home/greg/code/spideryarn2/.claude/worktrees/open-before-structure/src/web/useJobs.ts:45).

A tab can hold an old empty snapshot, then load an awaiting article imported elsewhere. The proposed condition immediately passes; the article GET can return awaiting while Structure is actually queued or running. Calling that *“could not be built”* is premature.

With a quiet subscription, it can persist: [jobEngine.ts:938](/home/greg/code/spideryarn2/.claude/worktrees/open-before-structure/src/web/jobEngine.ts:938) deliberately does not wake on subscription, and [jobEngine.ts:571](/home/greg/code/spideryarn2/.claude/worktrees/open-before-structure/src/web/jobEngine.ts:571) stops idle polling with only quiet subscribers.

**Change:** require reconciliation after receiving the awaiting payload, and explicitly keep the engine watching while awaiting. Existing [jobEngine.ts:1014](/home/greg/code/spideryarn2/.claude/worktrees/open-before-structure/src/web/jobEngine.ts:1014) supplies an `afterFreshList` barrier, but it also needs a wake/poke. Stop buying idle polls once resolved.

**F3 — P1 — ESTABLISHED: deduplication onto a draft-bearing successor does not repair a later awaiting publication.**

The plan describes re-queuing Structure on every awaiting publication as the recovery mechanism. That mechanism has a recognised hole.

[pg-successor.ts:253](/home/greg/code/spideryarn2/.claude/worktrees/open-before-structure/src/store/pg-successor.ts:253) explicitly handles a holder with an older draft by returning `boundToOlderBase`; it neither replaces the holder nor queues fresh work. Its eventual publication is refused by [pg-revisions.ts:2271](/home/greg/code/spideryarn2/.claude/worktrees/open-before-structure/src/store/pg-revisions.ts:2271).

Thus the newer awaiting revision can retain only a successor incapable of publishing over it. The source documents the delayed-visibility and clock-skew interleaving that reaches this state.

**Change:** specify this outcome explicitly. Either arrange a fresh successor after that holder terminalises, or treat it as stalled and require the reader’s recovery action. Do not describe ordinary deduplication as guaranteed recovery.

**F4 — P1 — REASONED: FIFO does not guarantee that every mode request waits behind Structure.**

[pg-jobs.ts:804](/home/greg/code/spideryarn2/.claude/worktrees/open-before-structure/src/store/pg-jobs.ts:804) orders queued jobs by `(created_at, id)` and also respects incompatible running jobs. It does not give Structure priority.

An earlier queued mode, or a request stamped earlier by another server’s clock, can precede the publication-created successor. It then reaches the proposed awaiting gate and fails `blocked`, rather than waiting. [messages.ts:94](/home/greg/code/spideryarn2/.claude/worktrees/open-before-structure/src/messages.ts:94) makes that failure non-retryable.

**Change:** either establish the promised ordering for such requests, or narrow the promise and deliberately explain how the reader starts the mode again after building Structure. Test a mode already queued before publication and a running/draft-bearing holder.

**F5 — P1 — REASONED: matching block IDs alone is too weak for accepting the fetched tree.**

Normal Structure preserves semantic blocks, making the narrow swap reasonable. But the fetch reads the current revision, which might instead contain a concurrent Rebuild.

[blocks.ts:1536](/home/greg/code/spideryarn2/.claude/worktrees/open-before-structure/src/blocks.ts:1536) recomputes block classification. Stable IDs therefore do not prove unchanged kinds, roles, treatments or ordering. A tree built against changed classifications can be attached to the held older blocks.

**Change:** compare the ordered semantic block input, including fields the tree contract consumes—not merely the ID set. Normalize the fetched tree with `withChildLists`, bypass prefetch, and fence overlapping reads against superseded attempts and article identity.

**F6 — P1 — ESTABLISHED: the awaiting notice falsely attributes synthetic divisions to the author.**

The proposed sentence says *“These are the article’s own headings.”*

[heading-tree.ts:530](/home/greg/code/spideryarn2/.claude/worktrees/open-before-structure/src/heading-tree.ts:530) creates at least four windows when usable headings are absent. [heading-tree.ts:457](/home/greg/code/spideryarn2/.claude/worktrees/open-before-structure/src/heading-tree.ts:457) names them from opening words or a stock title. Even a headed document can acquire synthetic subdivisions.

**Change:** say *“This is a temporary outline while Structure is being built.”* Keep authored-heading attribution where the individual node supports it. For headingless pieces, I would hide the artificial hierarchy in Structure until generation finishes; the prose remains available.

**F7 — P1 — ESTABLISHED: the new source reason falls into an existing wrong reader-facing explanation.**

Adding `"before-structure"` to [structure.ts:2239](/home/greg/code/spideryarn2/.claude/worktrees/open-before-structure/src/structure.ts:2239) does not produce an exhaustive-switch error.

[pipeline.ts:3073](/home/greg/code/spideryarn2/.claude/worktrees/open-before-structure/src/pipeline.ts:3073) treats every headings reason other than `"answer-too-long"` as *“a section was too long to label.”* The early import would therefore report a failure that never occurred.

**Change:** add an explicit early-publication detail and make the reason handling exhaustive. Include the log/detail consumers in Stage 1’s scope.

**F8 — P2 — ESTABLISHED: swapping `arc` into the payload does not synchronize `useArc`’s held state.**

[useArc.ts:97](/home/greg/code/spideryarn2/.claude/worktrees/open-before-structure/src/web/useArc.ts:97) uses the payload only to initialize local state. A later payload arc suppresses the opening GET at [useArc.ts:149](/home/greg/code/spideryarn2/.claude/worktrees/open-before-structure/src/web/useArc.ts:149), but does not set that local arc.

**Change:** define “waits” precisely: suppress POST before recording the once-guard, then synchronize or revalidate after replacement. Passing a changed prop alone is insufficient.

**F9 — P2 — ESTABLISHED: keyboard navigation retains the stand-in’s depth.**

[keynav.ts:557](/home/greg/code/spideryarn2/.claude/worktrees/open-before-structure/src/web/keynav.ts:557) initializes the aimed depth once. Without pointer movement, [keynav.ts:585](/home/greg/code/spideryarn2/.claude/worktrees/open-before-structure/src/web/keynav.ts:585) continues returning that retained depth. Reinstalling the listener for a new tree does not reset it.

The bounded tree’s leaves are at depth three; the generated tree can be deeper.

**Change:** reset or validate the aim against the replacement navigation plan. Add a keyboard-only replacement check.

**F10 — P1 — REASONED: “Build it” needs an explicit owner-only boundary.**

Structure currently uses the same component for owners and visitors, with no job capability passed in: [Reader.tsx:2997](/home/greg/code/spideryarn2/.claude/worktrees/open-before-structure/src/web/reader/Reader.tsx:2997).

Putting `useStepJob` directly into that shared band would introduce owner-scoped subscription/actions into public reading.

**Change:** provide an owner-only controller or optional owner capability. Visitors get an informational awaiting notice and no job subscription or Build action.

For the twelve requested checks:

1. **Publication chain: holds, with F7’s source-consumer change.** `finishStructureRun` returns the existing declared tree/labels/blocks product, checks the assembled tree, and supplies the blocks hash. [structure.ts:3306](/home/greg/code/spideryarn2/.claude/worktrees/open-before-structure/src/structure.ts:3306). `checkProduct` checks ownership and completeness, not whether a model ran. [session.ts:377](/home/greg/code/spideryarn2/.claude/worktrees/open-before-structure/src/store/session.ts:377). `checkTree` accepts any truthy provisional marker; `structureCurrency` checks run status and blocks hash. [tree-invariants.ts:245](/home/greg/code/spideryarn2/.claude/worktrees/open-before-structure/src/tree-invariants.ts:245), [artifacts.ts:776](/home/greg/code/spideryarn2/.claude/worktrees/open-before-structure/src/store/artifacts.ts:776). I found no exhaustive provisional-value switch.

2. **JSON persistence: holds except Retry requires the explicit planned change.** `toJob` preserves step objects or spreads them when translating names; hand-back’s JSON transformation preserves unknown fields. [pg-jobs.ts:189](/home/greg/code/spideryarn2/.claude/worktrees/open-before-structure/src/store/pg-jobs.ts:189), [pg-jobs.ts:1003](/home/greg/code/spideryarn2/.claude/worktrees/open-before-structure/src/store/pg-jobs.ts:1003). Today Retry reduces steps to names and recreates them, losing the mark. [jobs.ts:4487](/home/greg/code/spideryarn2/.claude/worktrees/open-before-structure/src/jobs.ts:4487). The client imports the shared Job type. Minted plus no earlier published blocks is a sound eligibility restriction; it is narrower than “every never-published job,” since queue adoptions receive no mark. Failed first-import retries mint the same slug; identical two-tab adds join the holder.

3. **Successor execution: holds.** `stepIsDone` consults `isDone` after artefact existence, so the copied done receipt cannot suppress the successor once the awaiting predicate is added. [pipeline.ts:1197](/home/greg/code/spideryarn2/.claude/worktrees/open-before-structure/src/pipeline.ts:1197). A handed-back import walks Structure again and rebuilds the cheap stand-in while nothing has published; that is harmless but should be tested. [jobs.ts:2752](/home/greg/code/spideryarn2/.claude/worktrees/open-before-structure/src/jobs.ts:2752). Metadata remains a different answer: it will report current from the receipt/hash despite `isDone` answering false. [pg.ts:3079](/home/greg/code/spideryarn2/.claude/worktrees/open-before-structure/src/store/pg.ts:3079). That is the plan’s expressly accepted discrepancy.

4. **Publication triggers: ordinary recovery paths hold; universal recovery does not.** Failed Structure leaves the awaiting revision current, so card Retry or Rebuild can subsequently cause the awaiting→finished transition. Read `auto_modes_off_at` at that publication, as today. [pg-revisions.ts:2528](/home/greg/code/spideryarn2/.claude/worktrees/open-before-structure/src/store/pg-revisions.ts:2528). Combine the triggers into one predicate and call `queueMainModesIn` once. F3 covers the missing deduplicated-holder case. Also, “only assets can publish awaiting” is false: standalone `fetch`, `metadata` or `extract` jobs occur before Structure and are not covered by the proposed positional gate.

5. **Ordering: holds for ordinary newly queued requests; not universally.** Structure is exclusive. [sharing-steps.ts:77](/home/greg/code/spideryarn2/.claude/worktrees/open-before-structure/src/sharing-steps.ts:77). A later unclaimed mode opens its draft after Structure publishes. An already running/draft-bearing job does not reopen onto that new revision; lineage protection handles it. F3/F4 cover the exceptions. AddPage currently posts the late High-powered setting and navigates; it does not post an after-open mode job. [AddPage.tsx:175](/home/greg/code/spideryarn2/.claude/worktrees/open-before-structure/src/web/AddPage.tsx:175).

6. **Runner gate: appropriate policy, placement needs specifying.** Apply it inside the protected `runStep` failure path, before freshness skipping or model work, so it produces a settled `blocked` job. A throw merely inserted outside `runStep` in the walk is insufficient. [jobs.ts:1134](/home/greg/code/spideryarn2/.claude/worktrees/open-before-structure/src/jobs.ts:1134), [jobs.ts:1190](/home/greg/code/spideryarn2/.claude/worktrees/open-before-structure/src/jobs.ts:1190). Multi-step jobs can deliberately fail after completing earlier steps; reset jobs should generate the real tree first. Older labels jobs need F4’s ordering test. The sentence must explain the reader’s remedy because blocked jobs offer no Retry.

7. **Billing: holds; no new double-charge path established.** Successful settlement charges the import’s reservation; a successor has no reservation, so settlement does nothing financially. [pg-session.ts:604](/home/greg/code/spideryarn2/.claude/worktrees/open-before-structure/src/store/pg-session.ts:604), [pg-billing.ts:1688](/home/greg/code/spideryarn2/.claude/worktrees/open-before-structure/src/store/pg-billing.ts:1688). Structure failure subsequently does not refund the already successful import—consistent with the plan’s chosen charge point. Shelf/public/sharing can expose the temporary tree and its derived counts. I found no additional first-publication welcome hook that would fire twice.

8. **Level check: computable, but freshness is missing.** The ordinary AddPage path is safe: it navigates from the polled import-done row, and successor insertion and job completion commit together. The jobs list is one SELECT, so that snapshot also contains an active successor. [AddPage.tsx:677](/home/greg/code/spideryarn2/.claude/worktrees/open-before-structure/src/web/AddPage.tsx:677), [pg-jobs.ts:1094](/home/greg/code/spideryarn2/.claude/worktrees/open-before-structure/src/store/pg-jobs.ts:1094). Retention does not defeat a check restricted to queued/running jobs. Hidden tabs reconcile on visibility. F2 covers stale snapshots and sleeping quiet subscriptions. Fetch directly: the access loader otherwise tries `takePreloaded` first. [access.ts:513](/home/greg/code/spideryarn2/.claude/worktrees/open-before-structure/src/web/article/access.ts:513).

9. **Narrow payload replacement: reasonable, incomplete state census.** Structure rewrites block HTML through `blocksArtefact`; it preserves semantic blocks. [structure.ts:3355](/home/greg/code/spideryarn2/.claude/worktrees/open-before-structure/src/structure.ts:3355). Keeping already rendered blocks/images therefore avoids the neighbouring plan’s image-resource problems. Geometry, outline, sections and quiz section mappings rebuild. [Reader.tsx:325](/home/greg/code/spideryarn2/.claude/worktrees/open-before-structure/src/web/reader/Reader.tsx:325), [Reader.tsx:753](/home/greg/code/spideryarn2/.claude/worktrees/open-before-structure/src/web/reader/Reader.tsx:753). F1/F5/F8/F9 are omissions. Changed sections rewrite `?at=` to the new section boundary; that is not inherently a scroll jump. Keep tree identity out of `layoutKey`, whose change explicitly restores the section start. [useReadingPosition.ts:131](/home/greg/code/spideryarn2/.claude/worktrees/open-before-structure/src/web/reader/useReadingPosition.ts:131). Paragraph labels remain reload-only unless separately addressed.

10. **What readers see:** good headings produce useful authored divisions mixed with generated windows; headingless pieces produce opening-word/stock-title windows without gists; PDFs follow the same builder after extraction and figure recovery. Paragraph rows are withheld while labels are pending. [StructureMode.tsx:222](/home/greg/code/spideryarn2/.claude/worktrees/open-before-structure/src/web/modes/structure/StructureMode.tsx:222). Earlier prose is valuable; invented hierarchy is not necessarily valuable. Use F6’s honest wording, and preferably hide synthetic rows for headingless pieces.

11. **“No more complex than reload”: unsupported.** Live replacement avoids draft loss and interrupted streams, so I still prefer it. It nevertheless requires snapshot reconciliation, request fencing, input validation and retained-state invalidation. Reload needs its own safety guards. The 80-line comparison omits substantial obligations on both sides.

12. **Passed-over designs:** keeping a non-null tree and keeping Structure as its owner remain the better choices. Deferring every refresh/reset would reopen old failures. Unconditional reload is not a better default. **Draft prose on the add page is the credible simpler alternative** if avoiding this publication/client protocol matters more than entering the full reading view immediately; its parallel spike deserves a concrete comparison before claiming this route is cheapest.

**Verdict: build with changes.** Resolve F1–F7 in the plan, specify the owner boundary and `useArc` transition, and add tests for stale jobs snapshots, draft-bearing deduplication, and an open Diagram during replacement.