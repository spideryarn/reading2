## Outcome

The committed candidate was not safe to run unchanged. I fixed the stage-local problems; the current worktree is ready for a live smoke/full run once its changes are retained. No commit was made, and no database or model calls were run.

### Harness findings

- **H1 — P0 — Fixed: concurrent modes could corrupt shared artifacts.** `runs.jsonl`, `order.json`, and `README.md` were shared, while corpus export could race. Each mode now owns its rows, seed, README, and config; corpus files use atomic writes and a revision/fingerprint snapshot lock. Separate processes also mean `SPIDERYARN_PIPELINE_EFFORT` is process-local. [run.ts:116](/home/greg/code/spideryarn2/.claude/worktrees/thinking-effort-eval/evals/thinking-effort/run.ts:116), [run.ts:556](/home/greg/code/spideryarn2/.claude/worktrees/thinking-effort-eval/evals/thinking-effort/run.ts:556), [run.ts:744](/home/greg/code/spideryarn2/.claude/worktrees/thinking-effort-eval/evals/thinking-effort/run.ts:744)

- **H2 — P0 — Fixed: resume could double-pay or mix configurations.** Create-only per-mode manifests now pin model, prompt version, power, arms, profile/cache choices and Illustrated inputs. A claim is written immediately before spending; an ambiguous interrupted cell stops rather than paying again. [run.ts:143](/home/greg/code/spideryarn2/.claude/worktrees/thinking-effort-eval/evals/thinking-effort/run.ts:143), [run.ts:167](/home/greg/code/spideryarn2/.claude/worktrees/thinking-effort-eval/evals/thinking-effort/run.ts:167), [run.ts:694](/home/greg/code/spideryarn2/.claude/worktrees/thinking-effort-eval/evals/thinking-effort/run.ts:694)

- **H3 — P1 — Fixed: input identity was not sufficiently proved.** Rows now record the exact article revision/fingerprint. Illustrated freezes and checks the base-a Sketch and production-loaded figure fingerprints before every paid arm. Ideas remains `previous: null`; all configs record standard power, no profile, and no article cache. [run.ts:500](/home/greg/code/spideryarn2/.claude/worktrees/thinking-effort-eval/evals/thinking-effort/run.ts:500), [run.ts:857](/home/greg/code/spideryarn2/.claude/worktrees/thinking-effort-eval/evals/thinking-effort/run.ts:857)

- **H4 — P0 — Fixed: wire proof was incomplete.** The harness now requires exactly one Messages request and checks its actual model, adaptive thinking, effort, stop reason, and ledger counterpart. Illustrated base still sends no `output_config`; low adds only its requested effort. [run.ts:1022](/home/greg/code/spideryarn2/.claude/worktrees/thinking-effort-eval/evals/thinking-effort/run.ts:1022), [illustrated.ts:1047](/home/greg/code/spideryarn2/.claude/worktrees/thinking-effort-eval/src/illustrated.ts:1047), [illustrated-run.test.ts:191](/home/greg/code/spideryarn2/.claude/worktrees/thinking-effort-eval/tests/illustrated-run.test.ts:191)

- **H5 — P0 — Fixed red-first: rejected answers could lose their accounting.** Strict token/cost/ledger checks previously ran only for `valid` outputs. A billed response that later failed parsing could therefore record null accounting. All provider attempts now require input, output, thinking, wire-thinking, provider cost, list cost, and one ledger row regardless of validity. [run.ts:207](/home/greg/code/spideryarn2/.claude/worktrees/thinking-effort-eval/evals/thinking-effort/run.ts:207), [thinking-effort-eval.test.ts:98](/home/greg/code/spideryarn2/.claude/worktrees/thinking-effort-eval/tests/thinking-effort-eval.test.ts:98)

- **H6 — P1 — Fixed: a semantically empty Illustrated brief could pass.** An answer with zero surviving plates is now invalid. Zero thinking tokens alone is deliberately not invalid: the Ideas smoke produced four anchored ideas at zero thinking, and production already throws if no idea survives validation. Structurally valid but poor output remains judge evidence rather than a harness failure. [run.ts:185](/home/greg/code/spideryarn2/.claude/worktrees/thinking-effort-eval/evals/thinking-effort/run.ts:185), [ideas.ts:484](/home/greg/code/spideryarn2/.claude/worktrees/thinking-effort-eval/src/ideas.ts:484)

- **H7 — P1 — Fixed: failed/raw model output was not always retained.** Visible SSE text is reconstructed and written as neutral `.wire.raw.txt`, including parse/validation failures. [run.ts:250](/home/greg/code/spideryarn2/.claude/worktrees/thinking-effort-eval/evals/thinking-effort/run.ts:250), [run.ts:986](/home/greg/code/spideryarn2/.claude/worktrees/thinking-effort-eval/evals/thinking-effort/run.ts:986)

- **H8 — P1 — Fixed: lineup sanitising was shallow and Hierarchy sampling was unseeded.** Provenance, model, usage, timing, cost, hashes, timestamps, and version fields are now removed recursively. Image names are neutral, keys remain separate, candidate ordering is per-article seeded, and deep-gist sampling uses that seed. Visible answer length remains exposed because it is legitimate candidate content. [lineup.ts:57](/home/greg/code/spideryarn2/.claude/worktrees/thinking-effort-eval/evals/thinking-effort/lineup.ts:57), [lineup.ts:162](/home/greg/code/spideryarn2/.claude/worktrees/thinking-effort-eval/evals/thinking-effort/lineup.ts:162), [lineup.ts:215](/home/greg/code/spideryarn2/.claude/worktrees/thinking-effort-eval/evals/thinking-effort/lineup.ts:215)

- **H9 — P1 — Fixed: Hierarchy “off” treated a missing thinking count as zero.** It now requires an explicit zero, no thinking blocks, and `end_turn`. [model-arms.ts:346](/home/greg/code/spideryarn2/.claude/worktrees/thinking-effort-eval/evals/hierarchy-structure/model-arms.ts:346)

- **H10 — P2 — Fixed: subset/resume runs changed recorded order slots.** Slots now come from the complete seeded arm order and remain stable when only unfinished arms are selected. The old smoke artifact remains historical and is labelled accordingly. [run.ts:120](/home/greg/code/spideryarn2/.claude/worktrees/thinking-effort-eval/evals/thinking-effort/run.ts:120), [smoke README:3](/home/greg/code/spideryarn2/.claude/worktrees/thinking-effort-eval/evals/results/thinking-effort-smoke/README.md:3)

- **W1 — P3 — Reported, not fixed:** the old standalone Hierarchy `blind.ts` CLI still shuffles whole candidates with `Math.random()`. It is not used by this eval’s lineup builder, and the full Hierarchy run is cancelled. [blind.ts:171](/home/greg/code/spideryarn2/.claude/worktrees/thinking-effort-eval/evals/hierarchy-structure/blind.ts:171)

## Plan round 2

- **F1 — P0 — Settled.** Explicitly reframed as a screen for visible loss, not evidence of equivalence.
- **F2 — P1 — Settled.** Two base and two candidate draws replace the single-repeat noise-floor claim.
- **F3 — P1 — Settled after edits.** U, ties, thresholds, disagreement, hard gates, incomplete judge responses, and savings aggregation are now preregistered.
- **F4 — P1 — Settled.** Illustrated base omits `output_config`; the production seam and regression test prove it.
- **F5 — P1 — Settled.** “Off” is a discriminated wire recipe with response-side proof; expansion is excluded. Hierarchy then failed its JSON smoke gate and was cancelled.
- **F6 — P1 — Settled.** Figures use the production loader and are fingerprinted/frozen across arms.
- **F7 — P1 — Settled for this run by cancellation.** The plan retains class-based counterfactual structural gates. Reopening Hierarchy would require implementing those comparisons.
- **F8 — P1 — Settled.** One four-way anonymous lineup, behavioural anchors, ties, and conservative judge disagreement.
- **F9 — P1 — Settled.** Illustrated is judged on briefs; plates are only a write-up sample.
- **F10 — P1 — Settled after edits.** Savings is calculated per article, then medianed across the seven under 100k characters; missing counts fail.
- **F11 — P2 — Settled after edits.** Remaining budget is 96 text calls plus sampled plates; cancelled Hierarchy calls are no longer included.
- **F12 — P2 — Settled.** Seeded per-article order, stable subset slots, restored overrides, and wire-recorded effort/upstream.

New plan findings:

- **F13 — P0 — Fixed:** concurrency and crash-safe resume guarantees were absent from the rewrite; the plan now names per-mode ownership, manifests, claims, and corpus snapshots. [plan:119](/home/greg/code/spideryarn2/.claude/worktrees/thinking-effort-eval/docs/plans/261001p-thinking-effort-vs-quality-for-sketch-illustrated-hierarchy-ideas.md:119)
- **F14 — P1 — Fixed:** incomplete judge responses and the exact savings formula were unspecified. [plan:166](/home/greg/code/spideryarn2/.claude/worktrees/thinking-effort-eval/docs/plans/261001p-thinking-effort-vs-quality-for-sketch-illustrated-hierarchy-ideas.md:166)
- **F15 — P2 — Fixed:** stale text still budgeted a full Hierarchy panel and incorrectly claimed judges would not know candidate count. [plan:110](/home/greg/code/spideryarn2/.claude/worktrees/thinking-effort-eval/docs/plans/261001p-thinking-effort-vs-quality-for-sketch-illustrated-hierarchy-ideas.md:110)
- **F16 — P2 — Fixed:** Sketch’s rubric omitted its documented navigation/door accuracy; Hierarchy title and gist constraints were also tightened to match its mode doc. [rubrics.md:32](/home/greg/code/spideryarn2/.claude/worktrees/thinking-effort-eval/evals/thinking-effort/rubrics.md:32), [rubrics.md:97](/home/greg/code/spideryarn2/.claude/worktrees/thinking-effort-eval/evals/thinking-effort/rubrics.md:97)

## Changed files

Changed during this review:

- Plan, rubrics, harness `run.ts`, arms, and lineup builder.
- Hierarchy `blind.ts`, `model-arms.ts`, and their tests.
- Thinking-effort tests.
- Smoke README and the deterministically regenerated Hierarchy lineup.

I did not alter the pre-existing untracked `evals/thinking-effort/reviews/harness-review-prompt.md`.

## Verification

- Focused suite: **118 tests passed**.
- Documentation links: **16 tests passed**.
- `npx tsc --noEmit`: passed.
- Focused Biome check: exit 0; four advisory infos only.
- Repository typecheck wrapper: source, web, fleet, and root projects pass; the tests project has one unrelated existing error at `tests/chat-empty-reads-from-the-top.test.tsx:126`.
- No database, harness, or model calls were made.

**Verdict: run after fixes** — use the current reviewed worktree, not commit `61f78bb1d` unchanged.