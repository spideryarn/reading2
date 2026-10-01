The direction is now right—strict parsing, starts-only Structure, one bounded redraw—but the plan is not ready to build. The principal gaps are the Stage 1 type boundary and Stage 3’s per-stage retry/accounting contract.

## Findings

**G1 — P1 — Stage 1 describes two incompatible wire shapes and weakens the wrong type.**

Stage 1 makes the end of `ModelNode.range` optional ([plan:110](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/docs/plans/261001s-structure-answer-writes-code-to-correct-an-id.md:110)), while Stage 2 says the answer will instead contain a distinct `"start"` field ([plan:136](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/docs/plans/261001s-structure-answer-writes-code-to-correct-an-id.md:136)). Those are not the same representation.

`ModelNode` is the normalized internal proposal type and requires a complete range ([hierarchy.ts:218](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/src/hierarchy.ts:218)). It is shared by the cascade, deepening, tests, and evals; `buildTree` immediately requires two string endpoints ([hierarchy.ts:1722](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/src/hierarchy.ts:1722)). Making that tuple optional spreads a model-wire concern through code whose ranges are already known.

Nor can `normaliseExpansion` simply be reused wholesale. Its input is already the clean `ProposedChild.start` shape ([hierarchy-cascade.ts:1205](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/src/hierarchy-cascade.ts:1205)) and it returns full-range `ModelNode`s ([hierarchy-cascade.ts:1250](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/src/hierarchy-cascade.ts:1250)). But its policy differs from whole-document normalization: it refuses an outside-parent start where `planChildRanges` clamps one ([hierarchy-cascade.ts:1324](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/src/hierarchy-cascade.ts:1324)), and refuses fewer than two children where whole-document `buildTree` collapses a restated rung ([hierarchy-cascade.ts:1344](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/src/hierarchy-cascade.ts:1344)).

Plan change: keep `ModelNode.range` as `[string, string]`. Introduce a separate starts-only answer DTO and recursively convert it at the `treeFrom` boundary: inject the body range on the root, derive every child’s complete range, then hand an ordinary `ModelNode` to `buildTree`. Extract the shared start-to-ranges kernel from `normaliseExpansion`, with explicit policy for outside-parent starts and one-child sets; do not reuse its entire scoped-call policy accidentally.

Stage 1 should build and test that converter without changing the live `toc/10` path. Stage 2 switches the wire decoder and prompt together.

---

**G2 — P1 — The revised safety claim still overstates what block-ID resolution proves.**

The plan now says nothing can let “a wrong or invented id through” ([plan:174](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/docs/plans/261001s-structure-answer-writes-code-to-correct-an-id.md:174)). Invented IDs are refused, but wrong-yet-real starts are not detectable. The algorithm deliberately believes a child’s start ([hierarchy.ts:1186](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/src/hierarchy.ts:1186)); resolving it with `index.get` proves membership, not correctness.

Plan change: narrow the invariant to: “No parser repair creates or accepts a value; invented starts refuse; wrong-but-real starts remain possible exactly as today and are controlled only by structural measurement and human review.” Update both the rationale at lines 88–93 and the Done condition.

---

**G3 — P1 — The paid before/after harness currently records none of its spend.**

The candidate’s eval calls `streamMessage` directly ([structure-parse.ts:44](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/evals/paperwork/structure-parse.ts:44)) without opening `collectSpend`. A gateway call outside a collector is explicitly dropped from every total ([ai-spend.ts:978](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/src/ai-spend.ts:978)). `runAsOwner` supplies identity; it does not open a spend collector.

That makes the planned 140 paid calls unaccounted eval spend. Production jobs do not have this problem because `runStep` opens the ambient collector around the whole stage ([jobs.ts:1124](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/src/jobs.ts:1124)).

Plan change: before any more draws, wrap each article arm in `collectSpend` with `scopeKind: "eval"`, `ownerId`, `articleSlug`, and `costStore.record`, following `evals/paperwork/run.ts`. Persist the run ID, call count, cost, and unpriced/write-failure state beside the result.

---

**G4 — P1 — Ideas and Sketch are not one-line redraw adoptions, and their returned usage would otherwise be false.**

The outer production `collectSpend` will correctly record both calls without any helper changes; do not nest another collector. But every generator also returns hand-summed token telemetry that pipeline logs:

- Structure currently assigns one `message.usage` to `structureUsage` ([hierarchy.ts:2541](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/src/hierarchy.ts:2541)).
- Ideas returns only the final `message.usage` fields ([ideas.ts:1048](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/src/ideas.ts:1048)).
- Sketch does the same ([sketch.ts:657](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/src/sketch.ts:657)).

The plan names aggregation only for `structureUsage` ([plan:157](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/docs/plans/261001s-structure-answer-writes-code-to-correct-an-id.md:157)). Ideas and Sketch need all four token fields summed as well. Their existing call, refusal, truncation, progress, extraction, parse, and semantic-build phases are also separate ([ideas.ts:931](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/src/ideas.ts:931), [ideas.ts:1027](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/src/ideas.ts:1027), [sketch.ts:538](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/src/sketch.ts:538), [sketch.ts:597](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/src/sketch.ts:597)).

The shared helper should live in a new server-side module beside `parse-json.ts` and return `{ parsed, raw, usages, attempts }`. Its `draw` callback must already have:

- passed through the same abort signal;
- converted call errors with `anthropicCallFailed`;
- refused provider refusals;
- refused truncation;
- attached attempt-aware progress reporting.

It should catch only `MalformedJson` from the supplied parse callback. A valid JSON answer later rejected by `buildTree`, `buildIdeas`, `readSketch`, or Sketch acceptance must remain a one-call failure. On two malformed answers, rethrow the second `MalformedJson` unchanged so its `code` and today’s undeclared/retryable job-failure behavior survive.

Files needing real stage work are `src/hierarchy.ts`, `src/ideas.ts`, `src/sketch.ts`, and a new helper module; `src/jobs.ts` should require no change. Add helper unit tests plus integration tests in `tests/hierarchy-structure-checkpoint.test.ts`, `tests/glossary-ideas-baseline.test.ts`, and a Sketch generation test.

For Structure specifically, the first malformed raw must never be checkpointed; the second raw is written only after parse, normalization, `buildTree`, and `assertTreeSound`, preserving the current write barrier ([hierarchy.ts:2577](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/src/hierarchy.ts:2577)).

---

**G5 — P1 — The stated Structure-redraw cost and duration are false for the articles where the deadline matters most.**

The plan calls a second Structure draw “about $0.15 and two minutes” ([plan:99](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/docs/plans/261001s-structure-answer-writes-code-to-correct-an-id.md:99)). The live code records a measured 142-page call at roughly $2 and 508 seconds ([hierarchy.ts:2419](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/src/hierarchy.ts:2419)). A second draw can therefore cross the job lease after already spending substantially.

`generateHierarchy` receives `deadlineAt`, but its contract currently says only deepening reads it ([hierarchy.ts:2281](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/src/hierarchy.ts:2281)). Passing the abort signal prevents a runaway call, but it does not prevent starting a redraw that cannot plausibly finish.

Plan change: replace the point estimate with observed size-dependent figures, and specify Structure’s admission rule before opening attempt two. At minimum: `signal.throwIfAborted()`, then refuse to start when the remaining deadline is below a conservative measured redraw allowance. If not admitted, rethrow the original `MalformedJson`; do not convert it into an abort or call failure. Ideas and Sketch still reuse their signal on the second draw and report “drawing again” before their progress counter resets.

---

**G6 — P2 — The prompt/checkpoint/eval blast radius is larger than “parity test, hoist pin, and eval slices.”**

The named pins are real, but incomplete:

- `tests/hierarchy-structure-request-parity.test.ts` pins exact system bytes.
- `tests/hierarchy-prompt-hoist.test.ts` pins both `"toc/10"` and the checkpoint digest ([hierarchy-prompt-hoist.test.ts:125](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/tests/hierarchy-prompt-hoist.test.ts:125)).
- `EXPANSION_PROMPT_STAMP` includes the whole-document `PROMPT_VERSION` ([hierarchy-expand.ts:147](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/src/hierarchy-expand.ts:147)); therefore `tests/hierarchy-expand.test.ts` must move from `toc/10+expand/7` ([hierarchy-expand.test.ts:365](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/tests/hierarchy-expand.test.ts:365)). More importantly, every existing deepening checkpoint misses even though `EXPAND_SYSTEM` itself did not change.
- The hierarchy eval parses directly into ranged `ModelNode` and calls `buildTree` ([model-arms.ts:703](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/evals/hierarchy-structure/model-arms.ts:703)); a starts-only answer will not merely alter a SYSTEM slice—it will fail.
- The same direct ranged parsing exists in `evals/paperwork/run.ts` ([run.ts:143](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/evals/paperwork/run.ts:143)) and `evals/plain-words/run.ts` ([run.ts:381](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/evals/plain-words/run.ts:381)).

For checkpoint replay: Stage 1 must preserve byte-for-byte `toc/10` behavior and prove an existing ranged checkpoint still returns the identical tree. Stage 2’s `toc/11` structure key should intentionally miss every `toc/10` row because both the request and version changed ([hierarchy.ts:2431](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/src/hierarchy.ts:2431)); add an explicit test for that transition. Name the collateral deepening-checkpoint invalidation in the plan.

Plan change: list these files explicitly and route eval parsing through the same production start-answer normalizer rather than giving each eval its own converter.

---

**G7 — P2 — The experiment can discover failure shapes, but the decision gate cannot currently decide anything.**

“Material numbers” is undefined ([plan:121](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/docs/plans/261001s-structure-answer-writes-code-to-correct-an-id.md:121)). Also, `repairedBlocks` is not comparable across arms: removing ends makes the closing and duplicate interior claims unobservable by definition ([hierarchy-cascade.ts:1370](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/src/hierarchy-cascade.ts:1370)). A lower repair count may mean less redundant telemetry, not a better tree.

Use this concrete gate:

- Offline replay denominator: every retained `toc/10` answer that parses and builds today.
- Required: zero newly unbuildable answers, zero additional dropped children, zero lost authored headings, and identical flattened `(depth, title, range)` trees for at least 99% of answers. With fewer than 100 eligible answers, that means zero unexplained changes.
- Manually inspect every non-identical tree across the whole corpus, not “every changed boundary on two articles.”
- Fresh `toc/11`: zero invented-start failures and zero dropped children in the 70-answer arm. Any occurrence stops shipping pending review.
- Report parse rates and exact confidence intervals descriptively. Fisher’s exact test is fine to include, but 70 per arm is unlikely to prove a small reduction; it is enough to detect a large regression and recurring shapes.

The 40/10/10/10 stress design is useful, provided results stay per article and the analog arm is never presented as a population rate.

---

**G8 — P3 — F1 is only partially closed in the ledger.**

The revised table correctly enumerates six expressions and identifies the one start ([plan:35](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/docs/plans/261001s-structure-answer-writes-code-to-correct-an-id.md:35)). But round 1 also requested per-event membership, derived-boundary agreement, and semantic plausibility ([round 1:12](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/docs/plans/261001s-reviews/plan-review-sol-r1.md:12)); those columns were not completed.

This is no longer safety-critical because parser repair was dropped. Either add the requested classifications or say explicitly that the remaining classification work is unnecessary to decision B, rather than claiming F1 was fully accepted and completed.

## F1–F6 disposition

| Round-1 finding | Round-2 status |
|---|---|
| F1 evidence inventory | Partly addressed; six events found, detailed classification incomplete. |
| F2 generic repair accepts arbitrary values | Fully addressed; parser repair is gone. |
| F3 wrong-real/end fallback | Dangerous repaired-end path is gone, but the new absolute wrong-ID claim repeats the overstatement. |
| F4 starts-only is the better fix | Product decision addressed; implementation seam is misread. |
| F5 parser specification | Correctly moot. |
| F6 measurement | Substantially improved, but spend is untracked, metrics are partly incomparable, and the gate is undefined. |

**Verdict: revise before building—the chosen product fix is sound, but Stage 1’s boundary and Stage 3’s redraw/accounting contract are not yet safe or complete.**