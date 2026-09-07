I would not refuse the commit: I found no established P0/P1. The code repair is mostly sound, but the result write-up is too dismissive of the control’s signal. No production prompt change is licensed yet; the appropriate change is to the conclusion and the next eval design.

## Findings

### F21 — P2 — established: the conclusion ignores the registered comparator and a third V4 replicate

[`arms.ts`](/home/greg/code/spideryarn2/.claude/worktrees/fb1v-socratic-v4-and-the-eval/evals/summaries/arms.ts:303) says `questions-toc6`’s isolated comparator is `gists-toc6`. The candidate’s own test establishes that `incumbent`, `incumbent-repeat`, and `gists-toc6` are all the exact same V4 recipe ([test](/home/greg/code/spideryarn2/.claude/worktrees/fb1v-socratic-v4-and-the-eval/tests/summaries-eval.test.ts:502)).

Yet the plan compares the control only with `incumbent` and describes the recipe as appearing under two names ([plan](/home/greg/code/spideryarn2/.claude/worktrees/fb1v-socratic-v4-and-the-eval/docs/plans/260907d-ship-socratic-v4-repair-the-eval-gate-and-answer-q7.md:528)). The actual question ranks are:

- Control: `0.83`
- Three V4 samples: `1.42`, `2.08`, `3.08`
- Against the registered comparator, `questions-toc6` beats `gists-toc6` in 9/12 lineups, with a 2.25 mean-rank gap.
- It beats the other V4 samples 8/12 and 11/12.

That is not dispositive—there is only one control generation and one document—but it is directional evidence. “The nominal lead means nothing” explains away more than the run supports.

(a) Reproduce by grouping the three recipes using `promptBlocksFor`, then calculate the control’s head-to-head ordering against each across the saved `judged.json`.

(b) Change the conclusion to: “The run did not license a winner, but all three V4 generations trailed the control; confirm this signal with balanced generation replicates over more documents.” Do not change production yet.

### F22 — P2 — established: the factor-of-three comparison uses incompatible statistics

The plan compares the `0.59` difference between aggregate mean ranks with the `1.83` mean absolute distance inside individual lineups. But [`score.ts`](/home/greg/code/spideryarn2/.claude/worktrees/fb1v-socratic-v4-and-the-eval/evals/summaries/score.ts:353) explicitly says those are on different sampling scales and that `1.83` is not a separability threshold.

Therefore these claims are unsupported:

- “about a third of the model’s wobble”
- “a third repeat could not move a factor-of-three margin”
- the same comparison used for V1 in stage 4

The no-leader outcome is nevertheless robust for a simpler reason: the two completed question repeats already have different leaders, so this frozen run can never satisfy “led every repeat.”

(a) Simulate increasing independent lineups: the mean absolute paired distance remains near a constant while uncertainty in an aggregate mean shrinks approximately as \(1/\sqrt n\).

(b) Delete the factor-of-three language. Estimate generation uncertainty in aggregate-mean units using balanced independent generations, ideally bootstrapped by document/node.

### F23 — P2 — reasoned: the calibration repair is heavily coached

The rubric’s negative example is essentially anchor 2—“how many arguments are there?”—while its positive yes/no example is the core of V3’s worked example ([rubric](/home/greg/code/spideryarn2/.claude/worktrees/fb1v-socratic-v4-and-the-eval/evals/summaries/judge.ts:339)). This does protect V3 from an automatic yes/no penalty, but it also lets the judge classify both cases by surface resemblance rather than applying the general demand criterion.

Anchor 2 also scored only `2.5` on triage and `3.0` on orientation, versus roughly `4.5–5` for the real arms. Consequently, putting it below every real line does not isolate demand: it may also be rejected for providing little triage value.

(a) Run a counterfactual judging pass over the same frozen lines with unrelated-domain rubric examples and a lookup anchor that does not use “how many arguments.”

(b) Before the next official run, use examples lexically unrelated to every candidate and add at least one held-out lookup anchor with strong triage/orientation. Pre-register it before judging.

### F24 — P2 — established: a partially failed judging pass still exits successfully and may name a leader

The saved run requested three repeats, completed two, and records one failure. Copying its three JSON files to `/tmp` and running `report` returned exit code `0` while printing `1 judging call(s) failed`.

More importantly, `failures` is not passed into `separate`, so two agreeing completed repeats could name a leader despite a third requested repeat failing.

(a) Run `report` against the saved artifact in a writable temporary directory; it exits `0`.

(b) Set a nonzero exit code when judging calls fail, and pass a `judgingComplete` condition into `separate` so partial results may be shown but cannot name a leader.

### F25 — P2 — established: per-repeat ties are arbitrarily converted into leaders

In the actual gist results, repeat 3 has an exact tie:

- `questions-toc6`: `1.6667`
- `incumbent`: `1.6667`

[`perRepeatLeaders`](/home/greg/code/spideryarn2/.claude/worktrees/fb1v-socratic-v4-and-the-eval/evals/summaries/score.ts:459) takes only `[0]`, so insertion order calls `questions-toc6` the leader. The report therefore describes a leader flip where one repeat actually tied.

(a) Give one repeat two reversed lineups, producing equal mean ranks; `perRepeatLeaders` returns whichever arm was inserted first.

(b) Return the complete leader set per repeat and require the aggregate leader to be the unique leader in every repeat.

### F26 — P2 — established: the new axis is requested but not validated

A literal answer matching the schema parses correctly, and the schema example matches the axis list. However, neither `unblind` nor the gate requires `demand`, numeric bounds, or complete axes. The stub judge itself omits `demand` ([run.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb1v-socratic-v4-and-the-eval/evals/summaries/run.ts:267)).

I passed `calibrationOf` a complete ranking with no axes at all; it returned `passed: true`.

(a) Remove every `demand` field from a valid judge answer while leaving rankings intact; calibration and ranking remain usable.

(b) Validate each returned node against its lineup before accepting it: every label exactly once in each ranking, every requested numeric axis present and within 1–5, and enum axes restricted to allowed values. Update the stub accordingly.

## Checks that held

- The promoted result is byte-for-byte identical to the saved run’s generated `results.md`.
- The failed-gate exit-code additions are honestly placed in both `judge` and `report`; the targeted test passed.
- `npx vitest run tests/summaries-eval.test.ts`: 69/69 passed.
- The corpus re-pin is clean. For all ten entries, changing only the current envelope’s sanitizer from `6` back to `5` reproduces the old raw-file hash, and every new hash matches `JSON.stringify(blocks)`.
- `JSON.stringify(blocks)` is deterministic for this exporter, though not formally canonical: reordered object keys would change the hash. That is a conservative false drift, not a bypass.
- The current `demand` scores are nearly equal across real arms, so there is no evidence that it produced the control’s lead.
- Stage 4 still should not change the production prompt under its pre-registered rule. What should change is the claim: this run found no admissible winner, but it did produce a control-favouring signal worth confirming.