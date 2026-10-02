# Review: plan 261001p — thinking effort vs quality for four modes

You are reviewing a **plan**, read-only. Do not change any file.

**Candidate (live, uncommitted):** `docs/plans/261001p-thinking-effort-vs-quality-for-sketch-illustrated-hierarchy-ideas.md`
in this worktree (an untracked file). Base commit: `git log -1 --format=%H`.

**What it is for:** an eval that decides whether Sketch, Illustrated, Ideas (Sonnet 5, adaptive
thinking at `high`) and Hierarchy (already `low`) can think less without getting worse, judged
blind, so their effort can be lowered to save ~9–10% of a normal article's cost. Background numbers:
`docs/investigations/261001b-cost-per-article-and-the-cross-mode-article-cache/README.md`. Greg's words
and leanings are quoted in the plan.

**Read to check the plan against the code** (start here; it does not limit scope):
- `src/models.ts` § `STAGE_EFFORT`, `effortFor`, `ArticleStage`, `ARTICLE_RENDERER`
- `src/illustrated.ts` (the brief call around line 1030), `src/sketch.ts` § generateSketch,
  `src/ideas.ts` § generateIdeas
- `src/structure-prompt.ts` § EFFORT, `src/structure.ts` § wholeDocumentRequest,
  `src/structure-expand.ts` § EXPAND_EFFORT
- `evals/structure-whole-document/` (arms.ts, model-arms.ts, run.ts, score.ts, blind.ts) — the existing harness
- `evals/sketch/run.ts`, `evals/illustrated/run.ts`, `evals/results/effort-vs-quality.md` (the prior effort eval)
- `src/pipeline.ts` § sharesArticleCache, `tests/article-cache-group.test.ts`
- `docs/project/{sketch,illustrated,ideas,hierarchy}.md`

**Attack it first, independently:** can the method detect a real quality loss at this sample size?
Is the control pair (base vs base-repeat) a sound noise floor? Is the decision rule coherent and
pre-registered enough to stop me rationalising? What confounds are left (cache, Ideas' `previous`,
Illustrated's fixed Sketch input, figures, the env-var effort being process-global, the Hierarchy
expand calls)? Is the cost estimate right? Is anything in the "What each mode runs at today" table
false? Is there a simpler design that answers the same question?

**My own doubts (look after your own pass):**
1. Five articles × one run per lower arm may be too few to see anything but large losses.
2. Hierarchy "off" — thinking disabled on Sonnet 5 — may behave differently on the Messages wire
   through OpenRouter (tag leakage, JSON breakage).
3. Opus's absolute 1–10 scores may be too coarse to resolve differences the pairwise judge sees.
4. Whether sending `output_config.effort: "high"` explicitly from Illustrated behaves the same as
   omitting it.

**Severity scale:** P0 = the plan would produce a wrong decision or waste the budget; P1 = a real
flaw to fix before building; P2 = worth changing; P3 = nit. Give every finding an ID (F1, F2, …),
its severity, the evidence (file:line), and the fix. End with a verdict: proceed / proceed with
changes / reframe.
