# Review + fix: the thinking-effort eval harness (plan 261001p, stage 1), and plan round 2

You may edit files in this worktree. **Fix what is inside this stage, narrowly, red-first where a
test can show it; report, do not fix, anything wider.** Do not commit, and run no git command that
discards work. You have no network (no database, no model calls), so you cannot run the harness
itself; you can run `npx vitest run <file>` on tests that need nothing outside the tree, and
`npm run typecheck`.

**Candidate (committed):** commit `61f78bb1d` on branch `worktree-thinking-effort-eval`.
`git show --stat 61f78bb1d` lists every path; `git show 61f78bb1d -- <path>` the diff. Start with:
- `evals/thinking-effort/run.ts`, `arms.ts`, `lineup.ts`, `tests/thinking-effort-eval.test.ts`
- `src/illustrated.ts` (the optional `effort` override) and `tests/illustrated-run.test.ts`
- `evals/structure-whole-document/{arms,model-arms,run,preflight}.ts`
- the smoke output: `evals/results/thinking-effort-smoke/runs.jsonl`, `README.md`, `order.json`
That list does not limit scope.

**The plan** is `docs/plans/261001p-thinking-effort-vs-quality-for-sketch-illustrated-hierarchy-ideas.md`,
rewritten after your round-1 review (`evals/thinking-effort/reviews/plan-review-sol-r1.md`, verdict
*reframe*). This is **round 2 on the plan**: say for each of your F1–F12 whether the rewrite
settles it, and raise anything new. The rubrics the judges will get are
`evals/thinking-effort/rubrics.md` — check them against the four mode docs in `docs/project/`.

**What the harness must guarantee** (from the plan) — attack each:
1. Base arms send **exactly** today's request (Illustrated: no `output_config` at all); low arms
   send the effort named, and the harness proves it from the wire, not from the env var.
2. Every arm of a (mode, article) sees identical inputs: same article revision, Illustrated's same
   Sketch (base-a's) and same figures, Ideas `previous: null`, no cache, standard model, no profile.
3. Recorded numbers are right: thinking tokens, output, input, cost, latency, stop reason, validity.
   A failed generator call is recorded as invalid, not skipped or retried silently.
4. Resume does not double-pay and does not mix runs from two configurations.
5. The lineups are blind: nothing in a lineup file, file name, image name or ordering reveals the
   arm (check raw fields, provenance, generator stamps, effort/usage fields, timestamps, sizes that
   correlate with effort only legitimately). The key is separate. The shuffle is per article and seeded.
6. **Concurrency**: I want to run one process per mode at once (sketch, ideas; illustrated after
   sketch's base-a draws exist) into the same `--out` directory to save hours. Is that safe given
   `runs.jsonl` appends, `order.json`, the README rewrite, and the process-global
   `SPIDERYARN_PIPELINE_EFFORT`? If not, make it safe (e.g. per-mode files) with the smallest change.

**My own doubts (after your own pass):**
- At `low` the model sometimes thinks 0–71 tokens; is anything in the validity check lenient enough
  that a degenerate low answer passes as valid?
- The Hierarchy lineup samples deep gists with an unseeded `Math.random()` (blind.ts
  `renderForJudging`). Hierarchy's full run is now cancelled (see the plan's status), so this may
  not matter.

**Severity:** P0 = the eval would give a wrong answer or waste the budget; P1 = fix before the full
run; P2 = worth changing; P3 = nit. An ID on every finding (H1, H2, … for the harness; F1… for
plan follow-ups), with evidence (file:line), and whether you fixed it (list the files you changed).
End with a verdict for the harness: run / run after fixes / do not run.
