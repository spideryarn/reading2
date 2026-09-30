No P0s. The adaptive-path design is now viable, but two P1s should be corrected before implementation.

## Round-one findings

| Finding | Status | Assessment |
|---|---|---|
| F1 | Partly resolved | Adaptive premise disclosure replaces band hopping and preserves the verdict machinery. However, the disclosure rule does not reliably correspond to the question whose answer the premise states; see R2-1. |
| F2 | Partly resolved | Both compatibility directions are now described accurately, and all-`easy` response fields make the old ladder traverse sequentially. The one-week removal date is not a safe compatibility boundary; see R2-3. |
| F3 | Resolved | Premises remain structurally separate, Show all contains stems only, and the eval covers own-answer leakage, earlier-answer leakage, and premises disguising large steps. |
| F4 | Overrule justified, mitigation incomplete | The baseline evidence supports rejecting fail-closed validation: three of ten batches have `unanchored: 1`. But a gap can currently cause its bridging premise to be hidden; see R2-1. |
| F5 | Resolved | The proposed source pack meets the minimum requested standard: outline/gists plus every cited evidence passage. |
| F6 | Resolved | Exact slug sets, uniqueness, planned count, arm identity, and matching control hashes close the partial-comparison holes. |
| F7 | Resolved / no longer arises | Verdict generation and its historical cost category remain live. The plan also names the pipeline logging replacement. |
| F8 | Partly resolved | Future runs record output tokens and elapsed time, but existing baseline/probe files do not, and the effective budget is still not recorded with each result; see R2-5. |

## Findings

### R2-1 — P1 — The premise-disclosure key is not the premise’s dependency

The prompt permits a premise to state what any “earlier” question established, while `showPremise` hides it solely from the verdict on `questions[index - 1]` ([plan](/home/greg/code/spideryarn2/.claude/worktrees/quiz-build-up/docs/plans/260930c-quiz-questions-that-build-up-to-the-takeaways.md:100), [walk](/home/greg/code/spideryarn2/.claude/worktrees/quiz-build-up/docs/plans/260930c-quiz-questions-that-build-up-to-the-takeaways.md:153)).

That breaks in three cases:

- Q5’s premise may restate Q2, but a right answer to Q4 hides it.
- A reader jumping to Q5 may receive no premise if Q4 happened to be answered right earlier, contradicting the plan’s “skip, or a jump” example.
- Most importantly for F4, if raw Q4 is dropped, Q5 moves directly after Q3. A right verdict on Q3 then hides the Q4 premise that was supposed to bridge the gap. This invalidates the plan’s main argument for tolerating gaps.

Proposed fix: require every premise to restate only the immediately preceding raw question. Hide it only when the reader arrived by pressing Next directly from that surviving predecessor and received a right verdict. A list jump always shows it. As the smallest acceptable F4 safeguard, if `dropped.gaps > 0`, show all premises for that batch; this preserves the paid batch without adding predecessor IDs.

### R2-2 — P2 — The marker is promised hidden context it cannot safely treat as “never revealed”

The current marking request labels one string as `THE QUESTION` ([quiz-mark.ts](/home/greg/code/spideryarn2/.claude/worktrees/quiz-build-up/src/quiz-mark.ts:406)). Passing `premise + stem` through that field gives the marker no indication that the reader may not have seen the premise, and nothing in `QUIZ_MARK_SYSTEM` prevents it from restating that premise. The plan’s assertion that it is “never something it reveals” is therefore unenforced.

There is also no compatibility reason to include it: the POST body is unchanged either way, and the marker already receives the whole article, evidence, and reference answer.

Proposed fix: send only the stem to the marker. If later evidence shows that the premise materially improves marking, add it as a separately labelled field with its visibility state and an explicit non-disclosure rule.

### R2-3 — P2 — One week is not a compatibility boundary

The response-only `band: "easy", value: 3` bridge is sound. An old ladder given all-easy questions will scan the server array front-to-back. A new client walking an old quiz/4 array also degrades safely to its stored band-sorted order.

But an old tab can remain open for longer than a week. Elapsed time alone cannot establish that no old bundle remains capable of fetching a new quiz, and the compatibility fields are extremely cheap.

Proposed fix: retain the response-only fields until there is an enforceable client-version boundary or evidence that old clients cannot call the route. Add a frozen legacy-ladder regression test proving that a quiz/5 response is traversed in array order, alongside the route-shape test. Do not date removal solely from deployment.

### R2-4 — P1 — The prompt and eval do not yet protect the hidden-premise rendering

“Reads as a whole question without its premise” is directionally right but underspecified. Models commonly produce stems such as “Why does that follow?” or “What does this imply?”, which look fine in the eval because every premise is rendered, but become unreadable after a right answer when the premise is hidden.

The premise rule also permits causal compression: a premise can accurately begin with an earlier answer and then append the consequence that answers the current question. Removing premises that contain the current reference answer verbatim catches only exact copying, not paraphrased giveaways.

Proposed fix:

- Explicitly prohibit backward pointers such as “this”, “that result”, “these facts”, and “the previous answer” unless their noun is named in the stem.
- Require the premise to be only a restatement of the immediately preceding answer, with no new consequence, reason, or inference.
- Include bad/good examples for both failures.
- Render and judge both forms in the eval: premise-plus-stem for the skipped path, and stem alone for the right-answer path. Add a separate “is every stem understandable alone?” judgement.

### R2-5 — P2 — F8’s evidence remains unavailable for the existing arms

The ten baseline files and five `after-1` files do not contain `outputTokens`, elapsed time, answer allowance, or effective maximum tokens. The revision promises those fields for `after`, but still cites the probe’s approximately 7.4k-token result from transient terminal output.

Proposed fix: make those fields mandatory for future generated arms and make reporting refuse a new arm that lacks them. The static budget constants for old arms can be backfilled from their recorded source commit; unavailable historical output/timing values should remain explicitly `null`, not reconstructed. Judge the 14k headroom from the five recorded `after` runs.

## F4 overrule

The operational overrule is sound: the data really does show three whole-question losses among ten baseline batches, so unconditional fail-closed validation risks discarding about a third of paid generations. Strictly, the files do not preserve raw positions, so they do not prove every loss was internal, but they establish that whole-question validation drops are common enough to reject the proposed policy.

I would accept the smaller safeguard in R2-1: keep the batch, count `gaps`, and force premises visible whenever a batch contains a gap. That protects answerability without predecessor metadata or another paid generation. The after-eval should also name a trigger for escalation—such as any batch with multiple gaps—rather than leaving “common” undefined.

build with the listed fixes