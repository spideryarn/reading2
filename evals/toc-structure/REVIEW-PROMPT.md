# Review request: an eval for the ToC structure pass, before it spends money

You are reviewing an **eval design at the end of its free phase**, in the Spideryarn repo (an
AI-assisted reading app). Phase 1 (deterministic scoring + a free "author's headings" arm) is built
and committed as `a5305a5`. Phase 2 (the arms that call models, ~$10 and ~1 hour) is **not built and
has not spent anything**. This review is the gate before it does.

You have read-only access. **Read the code rather than trusting this summary**, and say which
findings you read code for and which you inferred.

## What to read

- `evals/README.md` — the conventions an eval here follows. Note especially that an eval is not a
  test, and that its results are committed so the next change is compared against a number.
- `evals/toc-structure/score.ts` — the deterministic scorer, `(blocks, tree) -> measures`, plus
  `compareTrees` for cut-point agreement.
- `src/heading-tree.ts` — **arm zero**, the free denominator.
- `evals/toc-structure/arms.ts` — all nine arms declared as data.
- `evals/toc-structure/run.ts` — the runner.
- `tests/toc-structure-eval.test.ts` — 21 tests over the scorer.
- `evals/results/toc-structure-headings+incumbent-disk-2026-08-30-07-58-02.json` — the committed
  free run.
- `src/toc.ts` — the stage under evaluation. Its structure call is 163–320s and ~88% of the ingest
  wait. `evals/toc-labels.ts` judges only the *second* pass; nothing judged this one until now.
- `docs/research/opening-an-article-before-the-toc.md` — the decisions this feeds, and your own
  earlier review of it (`-sol.md` beside it).

## Context that matters

The decisions queued against this eval are: whether to open articles on a free tree built from the
author's headings; whether to generate the tree in **progressive waves** (L1, then L2, then L3 —
wanted partly for book-length texts needing more than three levels); whether to feed the author's
headings to the model explicitly; and what model and effort to use. Greg's framing: *"we're trying
to balance capability, cost-efficiency, latency, and simplicity."*

**Arm zero's result so far:** the free heading tree reproduces the shipped model tree's depth-one
carving exactly on 4 of 7 distinct documents. (The corpus contains one document three times —
`source`, `source-2` and `revistes-ub-30977` are three extractions of the same 3,106-word article —
so every denominator is 7, not 9. That dedupe is being applied now.)

## What I most want checked

1. **Is the scorer measuring the right things, and is anything it measures actually a proxy for
   something else?** The measures are: `checkTree` validity (split into gist problems vs other, so
   the free arm is not scored as broken for a gap it structurally cannot fill); balance of L1 part
   sizes in words; depth uniformity measured per *block* rather than per branch; two-sided heading
   agreement; vocabulary retention via `contentWords` with copied headings excluded; fanout against
   the prompt's 5–9; title word-count compliance; gist coverage and opening-bigram repetition.
   **Which of these can be gamed by an arm that is worse?**

2. **The noise floor.** The design is: run the incumbent twice unchanged, report per-article deltas
   on every scalar plus `compareTrees` between the two runs, and print that *before* any arm
   comparison. A third run on the two long articles is approved to get a variance rather than a
   range. **Is 2–3 runs over 7 documents enough to establish a floor that the arm comparisons can
   then be read against, and if not, what is the cheapest design that is?** `evals/toc-labels.ts`
   saw ~4-point run-to-run vocabulary variance, so a non-trivial floor is expected.

3. **The heading rule in `src/heading-tree.ts`.** It is two rules: section level = shallowest heading
   level with ≥3 occurrences (else ≥2, else flat); then any segment under 20 words merges into its
   neighbour. The thresholds (3, 20) were chosen to fix specific observed failures — a title-only
   part on the constitution, "Appendix"/"Backlinks"/"Bibliography" furniture parts on
   scaling-hypothesis. **Is that fitting the rule to the corpus?** If so, how would you separate the
   rule's real skill from its memorisation, given the corpus is 7 documents.

4. **Arm zero as the denominator.** My instruction was that the free heading tree must be an arm,
   because scoring model arms against nothing credits the model for work the headings did for free.
   **Is the comparison it enables actually valid** — the heading tree has no gists at all, so on any
   gist-dependent measure it cannot compete, and on structure it may be measuring a different thing.
   What is the honest claim a reader of the results file may draw from an arm-zero comparison?

5. **The phase-2 executor.** The env levers do not reach this stage: `MODEL_ENV_VAR.toc` is null,
   `effortFor` covers only arc/tweets/glossary/ideas, and `EFFORT` is hardcoded in `src/toc.ts`. So
   the eval will make the structure calls itself, on both wires (one candidate model speaks only
   chat/completions), routed through the existing `evals/declared-spend.ts` DECLARATIONS so the
   no-undeclared-spend test still holds. **What does an eval that re-implements the call risk
   getting wrong relative to the real stage** — prompt, budget, effort, thinking mode, wire
   differences — such that we would measure something the pipeline does not actually do?

6. **The arms themselves**, listed in `arms.ts`: headings (free), incumbent, incumbent-repeat,
   cheap-with-more-thinking, capable-with-less-thinking, headings-seeded, progressive waves, and
   cheap-proposes-then-capable-revises. **Is any arm confounded** — varying more than one thing at
   once, such that a win cannot be attributed? The cheap arm in particular varies model, wire and
   thinking mode together, which `arms.ts` acknowledges but does not solve.

7. **Corpus adequacy.** Seven distinct documents, four of them long-form essays, one legal-ish
   document, one 19-block fragment. **Is expanding the corpus the thing we should spend on first,
   before running any arm?** If so, what would you select for, and how many.

8. Anything that would make the results file misleading to someone reading it in three months — and
   anything in the framing above you think is simply wrong.

## What I would like back

Numbered findings: the claim, whether you agree, file/line evidence, and what to change. Be explicit
where you are inferring. **Say plainly whether phase 2 should run as designed, run with changes, or
not run yet** — money has not been spent and holding is cheap.
