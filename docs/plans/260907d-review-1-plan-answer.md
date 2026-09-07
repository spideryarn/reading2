Verdict: **refuse the plan as written**. F1–F4 and F6 are established P1s: following the plan can produce a green stage while breaking an explicit invariant or reporting a result the eval/costing machinery did not establish.

### F1 — P1 — established: the proposed control is not fully pinned, and `v4` is not production

(a) The plan says `incumbent` becomes another name for `v4`, but the recipes differ. `v4` sets `newGists: true`, which resolves to the replacement GISTS block; `incumbent` slices production’s live GISTS block ([arms.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb1v-socratic-v4-and-the-eval/evals/summaries/arms.ts:145), [arms.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb1v-socratic-v4-and-the-eval/evals/summaries/arms.ts:237), [arms.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb1v-socratic-v4-and-the-eval/evals/summaries/arms.ts:277)). Against base `83c17c29`, those GISTS blocks are unequal: 1,034 versus 1,947 characters.

The proposed control is also not actually pinned: it uses live production GISTS and the newly changed production `questionFor`, even though the file’s contract defines an arm as GISTS + QUESTIONS + normalization rule ([arms.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb1v-socratic-v4-and-the-eval/evals/summaries/arms.ts:1)). A later GISTS or normalizer change silently changes this alleged pre-V4 control.

(b) Replace the control section with:

> After V4 lands, `incumbent` is the current production recipe: toc/6 GISTS, V4 QUESTIONS, and the V4 normalizer. The existing `v4` arm is still the historical bakeoff recipe because it carries `variants.md`’s replacement GISTS block; it is not another name for production.
>
> Add `questions-toc6` as a fully pinned snapshot of immediate pre-V4 production: shipped toc/6 GISTS, shipped toc/6 QUESTIONS, and the pre-V4 `questionFor` rule. Compare it with `incumbent` to answer whether the old production recipe was better. Do not describe `v4` as production.

Add assertions that each of those three ingredients is equal where intended and unequal where intended.

### F2 — P1 — established: byte identity is an invariant without a byte-identity gate

(a) Stage 1 requires production’s QUESTIONS block to be byte-identical to V4, but “done” only requires broad gates and a real run showing V4-shaped output ([plan](/home/greg/code/spideryarn2/.claude/worktrees/fb1v-socratic-v4-and-the-eval/docs/plans/260907d-ship-socratic-v4-repair-the-eval-gate-and-answer-q7.md:82), [plan](/home/greg/code/spideryarn2/.claude/worktrees/fb1v-socratic-v4-and-the-eval/docs/plans/260907d-ship-socratic-v4-repair-the-eval-gate-and-answer-q7.md:153)). Those all pass if one word or punctuation mark drifts while retaining the same shape.

(b) Add this explicit stage-1 gate:

```ts
it("ships exactly the V4 QUESTIONS block that was measured", () => {
  expect(productionQuestions()).toBe(readVariants().questions.get("V4"));
});
```

Also require a mutation check that changes one byte on either side and observes this exact assertion fail.

### F3 — P1 — established: the proposed anchor repair does not calibrate lookup-question rejection

(a) The evidence establishes that the judge is consistent about fabrication and answer leakage. It does not establish that it recognizes lookup questions as bad.

The rubric has fidelity, distinctiveness, triage, orientation, simplicity, leakage and shape-hint axes, but no “requires following an argument rather than retrieving a fact/list” criterion ([judge.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb1v-socratic-v4-and-the-eval/evals/summaries/judge.ts:305)). Correspondingly, the existing lookup anchor received perfect `5,5,5,5,5` scores and leakage `1`.

Replacing it with “What does this section discuss?” tests genericity and non-distinctiveness, not lookup behavior. The gate can then pass while the judge continues preferring polished lookup questions—the failure class the shipped prompt still forbids.

The “judge is extremely stable” conclusion is also unsupported: identical ranks for several fixed anchors in one lineup do not measure stability over the real arms. The code’s actual stability measure is `judgeInstability`, over repeated real-arm rankings ([score.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb1v-socratic-v4-and-the-eval/evals/summaries/score.ts:327)); the durable result preserves neither that statistic nor the raw judgements.

(b) Replace the diagnosis and repair with:

> The previous run establishes consistent rejection of fabrication and answer leakage. It does not establish validity or stability for ranking the real arms, and its treatment of lookup questions remains an open hypothesis.
>
> Before the next run, add an explicit argument-demand criterion to the judge rubric and an anchor that is faithful, distinctive, simple and low-leakage but answerable by retrieving one fact—for example: `Computational functionalism — how many arguments does the section give?` Pre-register that it must rank below every real line. Report `judgeInstability` over the real arms separately.
>
> If lookup questions are instead being reclassified as acceptable, that is a product decision and must be made before shipping V4’s contradictory “not a fact to look up” rule.

### F4 — P1 — established: stage 2 can finish without fixing the visible gap

(a) Its acceptance condition is “has a question, **or a logged omission**” ([plan](/home/greg/code/spideryarn2/.claude/worktrees/fb1v-socratic-v4-and-the-eval/docs/plans/260907d-ship-socratic-v4-repair-the-eval-gate-and-answer-q7.md:68)). Thus every requested question may be omitted, the new logger may work perfectly, and the stage is green with the reader-visible inconsistency unchanged.

The implementation seam also needs more specificity. `TargetBriefing.ancestors` can identify a root target—its list is empty—but `readExpansion` receives only `ExpansionTarget`, which carries no depth ([hierarchy-expand.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb1v-socratic-v4-and-the-eval/src/hierarchy-expand.ts:317), [hierarchy-deepen.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb1v-socratic-v4-and-the-eval/src/hierarchy-deepen.ts:455)). The real child depth is currently recovered later from `Candidate.depth` ([hierarchy-deepen.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb1v-socratic-v4-and-the-eval/src/hierarchy-deepen.ts:2085)). Without stating that seam, a convenient inferred depth can disagree in a mixed-depth batch.

(b) Replace stage 2’s ending with:

> The request marks each target independently as `ASK QUESTION ON CHILDREN` or `OMIT QUESTION`, derived from its ancestor chain, so batches remain correct when targets have different depths. The parser preserves an optional returned question; attachment applies `questionFor` using `candidate.depth + 1`.
>
> Tests must show: a mixed-depth batch carries the correct per-target policy; a returned root-child question survives into the final tree; a deeper one is dropped; and an omitted root-child question is recorded without throwing or retrying.
>
> A live root-expansion run in which every question is omitted is a successful ingest but **not completion of this stage**. Keep the stage open and revise the prompt; do not make a second production call.

### F5 — P2 — established: the expansion-stamp explanation is wrong and permits a provenance-only bump

(a) `EXPANSION_PROMPT_STAMP` is derived from both prompt versions ([hierarchy-expand.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb1v-socratic-v4-and-the-eval/src/hierarchy-expand.ts:101), [hierarchy-expand.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb1v-socratic-v4-and-the-eval/src/hierarchy-expand.ts:114)). Stage 1 therefore moves it to `toc/7+expand/3` before stage 2 begins. Saying merely “the stamp moves” can be satisfied without changing `EXPAND_PROMPT_VERSION`.

Stale replay would not actually occur for the reason the plan gives: the checkpoint key includes the exact wire request, including `EXPAND_SYSTEM` and the target briefing ([hierarchy-deepen.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb1v-socratic-v4-and-the-eval/src/hierarchy-deepen.ts:290)). The remaining defect is inaccurate prompt-version provenance.

(b) Use:

> Stage 2 explicitly bumps `EXPAND_PROMPT_VERSION` from `expand/3` to `expand/4`; do not count stage 1’s `PROMPT_VERSION` bump as this change. The changed wire request already guarantees a checkpoint miss. The explicit expansion-version bump identifies the semantic protocol correctly in checkpoints and records.
>
> Assert the stage-1 stamp is `toc/7+expand/3` and the stage-2 stamp is `toc/7+expand/4`.

### F6 — P1 — established: stage 5 can truthfully report a cached zero, then price it by the wrong authority

(a) `--force` reruns the stage but reuses structure and label checkpoints; two consecutive forced hierarchy runs can buy zero calls while both report success ([stage.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb1v-socratic-v4-and-the-eval/scripts/stage.ts:67)). “One real local ingest” therefore does not establish a cold tree cost.

The plan then says to convert token counts using current rates. The pricing contract says OpenRouter’s settled `usage.cost` is authoritative; manual token pricing is only a cross-check, partly because OpenRouter and Anthropic token fields require opposite cache arithmetic ([pricing.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb1v-socratic-v4-and-the-eval/src/pricing.ts:18), [pricing.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb1v-socratic-v4-and-the-eval/src/pricing.ts:61)).

(b) Replace stage 5’s measurement bullets with:

> Use a newly minted article/slug and require `structureResumed: false` and `labelCalls > 0`; otherwise the run is cached and cannot answer cold tree cost. Record whether deepening was enabled and its paid/resumed call counts.
>
> Take dollars from the ingest’s stored AI-spend rows and provider-reported OpenRouter cost. Use hierarchy/labels token counts only to explain and cross-check that total. Report hierarchy + deepening + labels separately, then the whole ingest.
>
> Record the article’s word/block count, date, model, cache state and command. Describe one article as a dated example, not a representative universal price.

### F7 — P2 — reasoned: stage 4’s evidence rule is unfalsifiable

(a) “Something solid” and a written “nothing solid” have no mechanical distinction ([plan](/home/greg/code/spideryarn2/.claude/worktrees/fb1v-socratic-v4-and-the-eval/docs/plans/260907d-ship-socratic-v4-repair-the-eval-gate-and-answer-q7.md:282)). In particular, no planned arm is a “shorter V4,” so stage 3 cannot establish that a shorter V4 “scores as well.” A hand-written shortening in stage 4 would again ship unmeasured wording.

(b) Add:

> Stage 4 may ship only exact prompt text that appeared as an arm in stage 3 and whose run passed coverage, calibration and separability. A shortened V4 requires adding that exact arm before the paid run. Otherwise stage 4 makes no prompt/code change and records the gated results that prevented one.

### F8 — P2 — established: stage 5 conflicts with the important-doc and open-question contracts

(a) `open-questions.md` is one of the seven important entry-point docs, so substantive edits require an explicit before/after and approval ([edit-important-docs.md](/home/greg/code/spideryarn2/.claude/worktrees/fb1v-socratic-v4-and-the-eval/docs/reusable/edit-important-docs.md:13)). The plan simultaneously says Greg is unavailable.

It also proposes leaving the resolved table in Q7. The documentation contract says resolved knowledge moves into its owning doc and the open question is deleted or reduced to an anchor-preserving stub ([documentation-policy.md](/home/greg/code/spideryarn2/.claude/worktrees/fb1v-socratic-v4-and-the-eval/docs/reusable/documentation-policy.md:81)).

(b) Replace the documentation step with:

> Put the dated measurement and costing method in the owning AI-gateway/cost documentation. Show Greg the exact before/after for `open-questions.md` and obtain approval; then collapse Q7 to an anchor-preserving resolved stub linking to that answer. If approval is unavailable, stage 5 is blocked rather than “green and committed.”

I ran the permitted test file, but discarded its result as candidate evidence: while the review was running, concurrent stage-1 implementation edits appeared in the shared worktree, and the test then reported 8 failures against that moving state. The findings above are based on base `83c17c29` and the plan. I changed no repository file.