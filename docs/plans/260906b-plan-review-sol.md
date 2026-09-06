Verdict: **refuse as written** on established P1s F35, F37, F38, F40, F41, and F42. The strongest evidence is the parent contract’s explicit “two orthogonal fields,” the UI’s `Supportive`/`Critical` semantics, the plan’s exclusion of rows its own judge metric is meant to inspect, and production’s broader input fingerprint.

## Findings

### F34 — P1, reasoned: coercion can manufacture the stopping-rule result

(a) Stage C makes coercion “a scoring option,” then declares success when impossible pairs reach zero. If scoring happens after coercion, every arm obtains zero by construction. The eval would print that the prompt fixed the problem when the validator actually erased it.

(b) Replace the Stage C wording with:

> Score every arm’s raw output before any production repair. Report `rawImpossiblePairs / eligibleRows` for each arm. Apply coercion only in a separately named product-projection column, and require `valenceCoerced === rawImpossiblePairs`. The stopping rule is `rawImpossiblePairs === 0`; a post-coercion zero is never an eval result.

### F35 — P1, established: the “impossible” pairs are not impossible under the product contract

(a) The parent plan defines `relation` and `valence` as orthogonal, while the UI renders valence as **Supportive/Critical**, not **Agrees/Disagrees**. Honest examples exist:

- “The stated 10% estimate is wrong—it is at least 30%, making the warning stronger.” This can truthfully be `disputes` + `positive`.
- “The reported figure is correct, but the article’s conclusion is morally indefensible.” This can truthfully be `corroborates` + `negative`.

Mapping agreement onto a field displayed as support/criticism changes its meaning without changing its name or UI. For group one, the proposed question is also malformed: there is no “claim you quoted”; its target is the article. This contradicts the authoritative contract in the [parent plan](</home/greg/code/spideryarn2/.claude/worktrees/critiques-mode/docs/plans/260905f-debate-mode-what-the-web-says-about-this-piece.md:168>) and [`VALENCE_APPEARANCE`](</home/greg/code/spideryarn2/.claude/worktrees/critiques-mode/src/web/DebatePanel.tsx:137>).

(b) Replace “The finding that was not in the debrief” and both proposed fixes with:

> `relation` and `valence` overlap, but no cross-field pair is mechanically impossible under the shipped meanings. `relation` says what argumentative move the passage makes; `valence`, drawn as Supportive/Critical, summarizes its stance toward the row’s target. A passage may reject a detail while strengthening the target, or corroborate a fact while criticizing the argument built from it.
>
> The prompt arm therefore keeps valence’s product meaning and uses group-specific language:
>
> - group one: “Overall, is the quoted passage supportive of this article, critical of it, neither, or impossible to classify?”
> - group two: “Overall, is the quoted passage supportive of the quoted claim, critical of it, neither, or impossible to classify?”
>
> Map those answers to `positive`, `negative`, `neutral`, and `unknown`. Do not coerce or drop a row from its relation/valence pair. Judge targeting directly.
>
> If the desired product field is instead logical agreement, rename the stored field and the reader-facing chips to `agreement` / Agrees / Disagrees; do not silently put agreement into `valence`.

My answer to the coercion question is therefore: **neither coerce nor fail the row**. The premise for both actions is unsound.

### F36 — P1, reasoned: Layer 2 can compare different rows and reward omission

(a) “Stored extracts” do not by themselves freeze rows. If every arm may choose its URLs, quotations, claims, or relation, the agreement arm can return only two easy rows while the incumbent returns seven difficult ones. Its absolute inconsistency count becomes zero without improving any shared item. `incumbent-repeat` measures sampling noise, not this selection bias.

(b) Replace Layer 2 with:

> Layer 2 operates on a manifest of frozen row packets. Each packet fixes its id, pass, article identity, URL, source title, exact `sourceQuote`, target (article identity or `blockId` + `claimQuote`), exact evidence haystack, and hashes of every input. Every arm must return exactly one reading for every packet. Missing, duplicate, or foreign packet ids invalidate the run. Arms do not select URLs, claims, quotations, or rows. Every report prints packet coverage before any quality metric.

### F37 — P1, established: the plan lands the winner before running the metric that can identify it

(a) Stage C lands a prompt based on the mechanical check. Stage D then builds the judge needed to catch wrong targeting outside those alleged impossible pairs. Worse, lines 109 and 114 conflict: the table says the judge catches mis-targeting inside `qualifies`, while the next paragraph excludes `qualifies` from the interpretation score.

An arm can reach zero mechanical pairs while still targeting `qualifies`, `extends`, or `unclear` valence at the wrong subject.

(b) Replace the exclusion and Stage C/D boundary with:

> Only the mechanical cross-field diagnostic is stratified by relation. The judged targeting and engagement metrics include every frozen row, including `qualifies`, `extends`, `unclear`, `neutral`, and `unknown`, and report their denominators per relation.
>
> Stage C generates all arms but lands no prompt. Stage D judges the paired packets and applies the stopping rule. Only then may the winning prompt land and bump `PROMPT_VERSION`; if no arm passes, production remains unchanged.

### F38 — P1, established: ordering questions within one judge request does not prevent priming

(a) The plan says to ask independent questions and “then reveal” the candidate labels. In one `codexJudge` request, the judge sees the whole prompt before answering; textual order is not blinding. The summaries precedent explicitly records this limitation. The judge can simply rationalize the revealed `relation`, `valence`, and `applies`.

(b) Replace that judge bullet with:

> The judge never receives the arm’s `relation`, `valence`, or `applies`. From the target, quotation, and extract it independently returns engagement, the passage’s stance toward the target, and—when mis-targeted—the subject it appears to describe. Deterministic scoring code compares that answer with the arm output afterwards. No candidate label is revealed within the judge call.

### F39 — P1, reasoned: six of seven cannot calibrate a 1-in-20 claim

(a) Six of seven permits the judge to miss one of only three known wrong-target cases: 33% false-negative sensitivity on the defect the judge exists to find. That judge is then trusted to support a threshold of at most 5%. It also diverges from the summaries gate, where every known-bad anchor must lose.

(b) Replace the anchor gate with:

> The judge output must be structurally complete for every anchor and must classify all seven Cargo Cult anchors and every synthetic anchor correctly. Any miss reports no targeting or engagement figure. The report prints the anchor confusion matrix, including wrong-target recall, rather than only “6/7”. This is a sanity gate, not statistical evidence that the judge’s population error is below 5%.

### F40 — P1, established: the proposed “raw” capture is downstream of failures it claims to preserve

(a) `admissible` is already derived: `collectSearchEvidence` has filtered annotations and `runPass` has removed self-sources. `runPass` also throws before returning on an unreadable response, bad finish reason, or missing search count. A sink receiving text plus `admissible` therefore cannot replay those validations or preserve a paid failed pass—the exact atomic-failure case motivating capture. See [`runPass`](</home/greg/code/spideryarn2/.claude/worktrees/critiques-mode/src/debate.ts:1034>).

(b) Replace the capture specification with:

> Capture at the provider-response boundary, before `runPass` validation and before pass B begins. Write one append-safe record per attempted pass containing: pass kind; raw assistant text; raw annotations before collection or filtering; raw usage; finish reason; model; provider/search configuration; hashes of the exact system and user prompts; article `sourceHash` and identity; and success, abort, or classified error status. Failed and aborted paid passes are captured too. `admissible` is derived during replay, never treated as raw input.

### F41 — P1, established: the corpus pin omits a production input

(a) Debate’s production fingerprint covers blocks, tree, and cited metadata. Pass A and direct-row validation depend particularly on URL, title, and byline. Pinning only `blocks.json` and `tree.json` allows metadata to change while the corpus gate stays green, producing a different search and different directness decisions under the same corpus identity. [`inputFingerprint`](</home/greg/code/spideryarn2/.claude/worktrees/critiques-mode/src/debate.ts:215>) establishes the contract.

(b) Replace the two-hash paragraph with:

> Each corpus entry pins Debate’s production `inputFingerprint(blocks, tree, meta)`—the blocks, tree, and cited head—not merely the two file hashes. The loader recomputes that fingerprint and records/refuses drift before generation or replay. Every capture records the same `sourceHash`.

### F42 — P1, established: two stopping clauses can pass over nothing

(a) Empty output is explicitly valid, including on the obscure article. Therefore “zero no on the obscure article” can mean zero judged rows, not zero fabricated rows. Likewise “≤1 in 20 rows” has no rule requiring 20 eligible judgments after exclusions or malformed judge output.

(b) Replace stopping rules 1–2 with:

> 1. Every rate prints `numerator / denominator`; a zero or undersized denominator is `not measured` and cannot satisfy a gate. The wrong-target gate requires at least 20 structurally valid, judged frozen packets.
> 2. Group-two engagement is at least 80% over its printed denominator. The obscure-article check requires at least one kept and judged row and zero `no` judgments; if it returns no rows, report `not exercised`, not `zero no`.

### F43 — P1, reasoned: the runner has no specified source for per-run cost

(a) `generateDebate` returns searches and elapsed time, not cost. The captured `Usage` interface contains token/search counts but no cost, while `withLedger` prints an aggregate and does not return its report. A naïve runner could treat absent cost as zero or divide the overall eval ledger—including judge calls—into debate runs. The plan nevertheless promises median and worst per-run dollars.

(b) Add to Stages A and E:

> Each live debate run has its own spend identity. The runner derives its cost from the spend collector’s `SpendRecord`s through `totalSpend`, records the contributing call ids and `unpriced` count, and asserts that a completed debate run contains exactly its two search calls. It never derives dollars from token `Usage`. Median and worst cost are reported only when every included call is priced; otherwise they are `not measured`, with the unpriced count shown.

### F44 — P0, reasoned: Stage F removes prompt injection but does not yet specify a safe network path

(a) The prompt-injection argument is correct: bytes read only by a matcher cannot instruct a model. But the URL is still untrusted network input. A public result can redirect to loopback, link-local, or private space, return an unbounded body, or hold connections open. The plan also says “≤12 URLs,” while the production caps are 12 **per pass**, hence up to 24 per debate.

(b) Replace Stage F with:

> Fetch at most 12 unique reported URLs per pass and 24 per debate run through `fetchDocument`, never bare `fetch`. Retain its HTTP(S)-only rule, private-address and DNS pinning checks on every redirect, redirect cap, byte cap, type sniff, and deadline; add an explicit whole-run concurrency, byte, and elapsed budget. Fetched text is used only as a verification haystack and never enters a model prompt. Capture the final URL, content hash, fetch/parse outcome, and exact bounded verification haystack so Layer 1 remains network-free.

### F45 — P2, established: one “no-model” adversarial test requires semantic judgment

(a) The plan correctly says engagement is the one relationship code cannot check, but Layer 0 then says a same-topic page answering no claim is a deterministic shape “group two must refuse.” Current validation can prove both quotations exist; it cannot prove they bear on each other. Neither planned fix adds such a checker.

(b) Replace that Layer 0 item with:

> Layer 0 contains deterministic parser and validator cases only: third-party valence targeting, directness, and extract/full-page quotation verification. The same-topic-but-non-engaging packet is a hand-labelled item for the judged Layer 2/Stage D corpus, not a unit test claiming production can deterministically refuse it.

### F46 — P3, established: the candidate inventory is incomplete

(a) `git status --short` also reports untracked `.tmp-debate-fixture.mts`, contrary to “Nothing else has changed.”

(b) Replace the candidate inventory with:

> Also present but outside the candidate: `.tmp-debate-fixture.mts` — an existing untracked browser fixture; do not review or commit it.

The scoped test passed: `npx vitest run tests/debate.test.ts` — **54/54 tests**. No files were changed.