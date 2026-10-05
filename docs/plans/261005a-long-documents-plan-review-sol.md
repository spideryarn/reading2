**Verdict: do not build the plan unchanged.** F1 and F2 establish violations of the stated invariant using the real consumers and budget functions. D remains a sensible first stage; E’s slice primitive works, but its claimed simplicity is unproved.

Reviewed commit `d2529885382bae73852c36de0493adf332767c3b`. No repository files changed.

1. **F1 — P1, established: windows break section navigation on mixed-depth trees.**

   **(a)** A 3,144-block fixture with chapters, subsections, and one long subsection passes `checkTree` after windowing. Its maximum leaf depth becomes 4. [sectionDepth](/home/greg/code/spideryarn2/.claude/worktrees/long-documents-d-then-e/src/web/position.ts:64) consequently selects depth 3 everywhere—even where depth 3 contains paragraphs.

   The real consumers then produce an empty-titled “section” for a short-section paragraph and a numbered breadcrumb containing that paragraph’s label. This contradicts [breadcrumbs’ “never a paragraph” contract](/home/greg/code/spideryarn2/.claude/worktrees/long-documents-d-then-e/src/web/crumbs.ts:5). [Structure’s arrow navigation](/home/greg/code/spideryarn2/.claude/worktrees/long-documents-d-then-e/src/web/reader/Reader.tsx:1644) uses the same depth.

   **(b) Add:**

   > D also changes section navigation and heading breadcrumbs to select the deepest internal node on each branch, never a paragraph leaf. Test a tree where only one depth-two section receives windows, after labels are merged. A global `leafDepth - 1` is insufficient.

2. **F2 — P1, established: the catch leaves another length-dependent labels refusal reachable.**

   **(a)** A headingless 2,500-block body fits `wholeDocumentRequest` with `maxTokens: 119450`, so D’s proposed catch never runs. A schema-compatible answer containing two sections of 2,200 and 300 blocks builds successfully and passes `checkTree`.

   `planBatches` preserves those sibling sets. The first labels request then throws `TooLongForOnePass`: [runBatch](/home/greg/code/spideryarn2/.claude/worktrees/long-documents-d-then-e/src/labels.ts:1879) asks for `200 + 2200 × 55 + 16000 = 137200` tokens.

   E can likewise produce a sound stitched tree with an oversized lowest-level section. Tree validity does not establish labels safety.

   **(b) Add:**

   > Before accepting any model-produced tree, including E’s stitched tree, run `planBatches` over the complete article. If coverage fails or any body sibling set exceeds `MAX_BATCH`, return D’s bounded tree. Test this with a valid 2,500-block model tree containing a 2,200-block section.

3. **F3 — P1, reasoned: sixty blocks do not bound a labels request’s input.**

   **(a)** The harness constructed a document below the byte cap—12.93 MB—with one very long paragraph. After windowing, its largest relevant batch contained only 60 blocks but rendered **10.84 million characters**, approximately **2.71 million tokens** using the repository’s estimate.

   [Labels renders the complete block text](/home/greg/code/spideryarn2/.claude/worktrees/long-documents-d-then-e/src/labels.ts:961). Structure’s fallback decision similarly [budgets the answer](/home/greg/code/spideryarn2/.claude/worktrees/long-documents-d-then-e/src/structure.ts:708), rather than checking whether the input fits. Provider refusal was not exercised; the unbounded requests were measured.

   **(b) Add:**

   > Structure selects D when either its input or its answer cannot fit. Labels bounds the entire rendered request, including outline and context, against the selected model’s input allowance. An individual oversized block or outline uses deterministic excerpts for labelling, retaining the original block id and leaving the article text unchanged. Test long individual paragraphs and long heading text.

4. **F4 — P1, reasoned: bounded calls can still exhaust labels’ total time allowance.**

   **(a)** A 4.80 MB web document containing 120,000 short paragraphs produces **2,000** bounded label batches. [Labels runs four concurrently](/home/greg/code/spideryarn2/.claude/worktrees/long-documents-d-then-e/src/labels.ts:429), while [the job permits only two requeues](/home/greg/code/spideryarn2/.claude/worktrees/long-documents-d-then-e/src/jobs.ts:405)—three 740-second windows.

   Even ten seconds per batch requires about 5,000 seconds, versus 2,220 available, before warm-up and retries. The counts and scheduling limits are established; the live duration is reasoned. The 250-page fixtures do not establish the unrestricted web-document guarantee.

   **(b) Add:**

   > Labels checkpoints and yields between bounded groups of batches. Resumptions that make durable progress are not exhausted by the fixed three-claim interruption allowance; resumptions without progress remain bounded. Add a deterministic scheduling test requiring more than three claims.

5. **F5 — P2, established: E cannot group an oversized top-level chapter.**

   **(a)** The harness produced a sound D tree with top-level parts spanning 3,000 and six blocks. Windowing bounded the first chapter’s leaves but preserved its chapter range. `wholeDocumentRequest` still refused that chapter.

   Therefore, “every group fits” and “boundaries are always D’s top-level boundaries” cannot both hold. D fallback preserves the article, but E never enhances this class.

   **(b) Add:**

   > When a top-level part exceeds a call’s input or answer budget, descend to its bounded child boundaries and structure those slices within the existing authored parent. Preserve that parent and compose its gist from its children. Repeat upwards.

   This adds parent-level stitching and gist composition beyond the proposed single root call.

6. **F6 — P2, established: the promised labels batch bound is inaccurate.**

   **(a)** A windowed document with section lengths **3,000, 12, 60, 12** passes `checkTree` and has no sibling set above 60, yet `planBatches` produces an **84-block batch**.

   The [minimum-size packing rule](/home/greg/code/spideryarn2/.claude/worktrees/long-documents-d-then-e/src/labels.ts:753) combines 12 and 60; the [tail merge](/home/greg/code/spideryarn2/.claude/worktrees/long-documents-d-then-e/src/labels.ts:777) then adds another 12. This exceeds “the bound plus headings.”

   Also, the bound must exclude supplement nodes: their invariant requires [only leaves beneath them](/home/greg/code/spideryarn2/.claude/worktrees/long-documents-d-then-e/src/tree-invariants.ts:410), and a supplement may legitimately contain hundreds.

   **(b) Replace the batching acceptance wording with:**

   > Window body leaf runs before appending supplements. Every body sibling set is at most `MAX_BATCH`; planned batches retain the planner’s minimum and tail exceptions, currently allowing up to 84 structural blocks. Tests check sibling-set and batch bounds separately. Supplements remain flat and excluded from labelling.

7. **F7 — P2, established: the cascade comparison requires stronger guarantees from the rejected route.**

   **(a)** The cascade already [checkpoints successful calls](/home/greg/code/spideryarn2/.claude/worktrees/long-documents-d-then-e/src/structure-deepen.ts:1557) and [withholds an incomplete wave while retaining its checkpoints](/home/greg/code/spideryarn2/.claude/worktrees/long-documents-d-then-e/src/structure-deepen.ts:2737).

   Under E’s own “return D on deadline” semantics, per-wave publication or automatic requeue is not necessary. Those mechanisms become necessary for eventual completion across claims, which recommended E does not promise either. D’s windows also remove the cascade’s unbounded block-count targets. Missing seed-node gists remain a real problem.

   **(b) Replace the comparative paragraph with:**

   > A recursive cascade adds frontier iteration and gist composition for seed nodes. Existing per-call checkpoints and deadline fallback remain usable; publication or requeue across claims is a separate decision for either route. Slice stitching adds group planning, slice-scoped validation and checkpoints, stitching, and gist composition for oversized authored parents. The E spike compares both routes under the same deadline and D-fallback guarantees before choosing.

The other central claims held up: no maximum-depth or required-question invariant was found; no downstream executable branch treats `provisional: "headings"` as unfinished; and missing gists receive the explicit provisional exemption. Window excerpts should leave `sourceHeading` unset. Slice parsing and building work when validated against the slice itself.

Validation: the four existing `stated-limits` tests passed, including their current **KNOWN GAP** characterization. The scratch harness exercised real builders, planners, invariants, and client projections with simulated windowing. Postgres, provider calls, and browser checks were not run.