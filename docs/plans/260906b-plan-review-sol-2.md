Verdict: **refuse as written**. The rewrite fixes most of F34–F46, but several established P1s remain. The decisive one is F47: the stopping rule still names a causal error—wrong targeting—that the proposed judge cannot observe.

### F47 — P1, established: the judge cannot measure “wrong-target valence”

(a) Each arm exposes only a categorical `valence`; it exposes neither the subject it evaluated nor its reasoning. The blinded judge independently labels stance toward the correct target. Therefore:

- An arm can evaluate the wrong subject but coincidentally return the same valence as the correct target. It is counted correct.
- An arm can evaluate the correct target but misread its stance. It is counted as wrong-target.

As specified, this measures disagreement with a reference stance, not targeting. The judge’s guess at “the subject it appears to describe instead” cannot recover which subject produced the arm’s hidden label. [`DebateRowBase`](/home/greg/code/spideryarn2/.claude/worktrees/critiques-mode/src/types.ts:3370) establishes that the arm supplies no observable target rationale.

(b) Replace the interpretation row, Stage D comparison, and stopping rule 1 with:

> **Interpretation — valence agreement.** The blinded judge labels the cited passage’s stance toward the packet’s explicit target. Deterministic code compares that label with each arm’s raw `valence`.
>
> This detects the observed wrong labels, but it does not identify their cause. A categorical answer does not reveal which subject the arm evaluated: a wrong target can yield the right label, and a disagreement can be an ordinary stance error. Any “other apparent subject” returned by the judge is qualitative diagnosis only and is not included in a rate.
>
> 1. **Valence disagreement with the blinded judge ≤ 1/20**, over at least 20 distinct, non-anchor packet ids.

### F48 — P1, established: Layer 2 engagement cannot distinguish the arms

(a) Layer 2 freezes the target, `sourceQuote`, and evidence haystack. The judge sees those fixed fields and none of the arm output. Its engagement answer is therefore identical for every arm. Printing engagement per arm—or using it to choose a prompt—duplicates a corpus property under several arm names.

(b) Replace the Layer 2 engagement rule with:

> In Layer 2, engagement is a property of the frozen packet, not of an arm: the target, quotation and haystack are identical across arms, and the judge sees no arm output. Judge it once and print it once as a corpus audit. It may reject a bad packet corpus, but it cannot rank prompt arms. An arm’s effect on engagement is measured only on rows that arm selects on the live production path.

### F49 — P1, established: the plan still lands before its promised live confirmation

(a) Layer 2 says its winner is confirmed live before landing. Stage D lands it; Stage E performs the first live sweep afterwards. Moreover, Stage C’s manifest contains only Stage A/Cargo Cult material, while stopping rule 2 requires an obscure-article judgment. Stage E explicitly performs no judging. That clause cannot be measured before Stage D lands.

(b) Replace the Stage D/E boundary with:

> Stage D judges the frozen-packet arms and selects a **provisional** arm. It lands nothing.
>
> Stage E runs only that provisional arm through the live production path over the five-article sweep, judges every kept live group-two row, and applies the complete stopping rule, including the obscure-article requirement. Only after those live results pass may the prompt land and `PROMPT_VERSION` bump. If live judging is incomplete, the denominator is insufficient, or the obscure case is `not exercised`, production remains unchanged.

### F50 — P1, established: “structurally valid” can recreate omission bias

(a) The plan invalidates missing arm ids, but the stopping denominator is “structurally valid judged packets.” An arm can return malformed readings for difficult packets and have them omitted from the denominator. A judge can likewise omit difficult ids. With seven packet ids repeated across three arms, an implementation could even call 21 arm-packet cells “20 judged packets” although only seven evidence cases were tested.

(b) Replace the coverage and denominator wording with:

> Before any quality figure is computed, each arm output and the judge output must be an exact permutation of the expected packet ids: every id exactly once, with no missing, duplicate, foreign or malformed entry. An invalid arm cannot qualify; an invalid judge run reports no judged metric. `unknown` and `unclear` are valid answers and remain in the denominator.
>
> Every arm’s denominator is the full set of distinct, non-anchor manifest packet ids. Repeats and other arms are reported separately and never pooled to inflate sample size.

### F51 — P1, reasoned: the anchor rows are also the prompt’s evaluation rows

(a) The seven Cargo Cult rows motivated the targeted wording, seed the frozen manifest, and then become judge anchors. The plan does not exclude them from the stopping denominator. That lets known, prompt-shaping examples count as evidence that the prompt generalises; synthetic anchors are also not enumerated or cardinality-checked.

(b) Replace the anchor bullet with:

> Anchors live in a separate pinned manifest containing exact ids, input hashes and expected judgments. The loader asserts its exact cardinality and every expected anchor must be returned exactly once. Anchors are a judge precondition only: they are excluded from every arm metric, denominator and winner decision.
>
> The seven inspected Cargo Cult rows and all synthetics are not holdout evidence. The ≥20 stopping denominator consists only of separately frozen, non-anchor packets that were not used to devise the targeted arm or label the anchors.

### F52 — P1, established: the capture still promises records it cannot produce

(a) A record written “immediately after the provider answers” cannot represent an abort before any answer, and it cannot survive process death. It also cannot know the later classified validation status while remaining a single immutable record. The current gateway discards a non-JSON response body from its return value and throws on non-2xx responses; its spend machinery explicitly says process death loses pending calls. [`openRouterJson`](/home/greg/code/spideryarn2/.claude/worktrees/critiques-mode/src/ai-call.ts:1327), [`PendingCall`](/home/greg/code/spideryarn2/.claude/worktrees/critiques-mode/src/ai-spend.ts:203).

(b) Replace the capture lifecycle with:

> Capture is a two-event append-only journal keyed by an attempt id. Write `attempt-started` before dispatch, containing the pass, configuration, prompt hashes and article identity. At the gateway boundary, after response bytes arrive but before status, JSON or debate validation, append `provider-response` with the available raw response fields. In `catch`/`finally`, append the classified terminal outcome.
>
> An abort with no response has metadata and an abort outcome but no invented response fields. An unmatched start means the process died or the outcome is unknown. Reports reconcile starts, responses, terminal outcomes and spend records and never describe an unmatched attempt as captured successfully.

### F53 — P1, established: `fetchDocument` does not itself produce the promised verification haystack

(a) `fetchDocument` returns decoded HTML markup for HTML and `text: null` for PDFs; it does not return extracted page prose. Matching raw HTML can miss visible quotations split by tags or accept words from scripts/metadata, while PDFs cannot be matched at all. [`FetchedDocument`](/home/greg/code/spideryarn2/.claude/worktrees/critiques-mode/src/fetch.ts:53), [`fetchDocument`](/home/greg/code/spideryarn2/.claude/worktrees/critiques-mode/src/fetch.ts:1529).

The “two-curl” experiment also cannot decide Stage F unless it exercises the exact fetch → extraction → matching path Stage F will ship.

(b) Replace Stage F’s verification description with:

> Verify against the provider extract first. Only a quotation that misses there invokes the full-page fallback; a fetch or extraction failure never removes a row already verified from the provider extract.
>
> Stage A and Stage F use the identical production path: `fetchDocument` → bounded HTML-to-visible-text extraction → `findQuote`. Raw HTML is never the verification haystack. PDFs are either converted through an existing bounded PDF-text path or recorded as `unsupported`; `text: null` is never treated as an empty page.
>
> The experiment reports only “recovered X/Y observed failures.” One recovery establishes that the fallback can fix the observed class; zero recoveries defers Stage F and does not establish that full-page fetching can never help.

### F54 — P1, established: passage-scoped `relation` changes an authoritative contract

(a) The proposed prompt change is internally coherent and does not break group membership or directness validation. But it changes the meaning documented in `DebateRelation`: currently it is what the outside **page** does. Landing only the prompt would make newly stored rows passage-scoped while the type and parent plan still define them as page-scoped. [`DebateRelation`](/home/greg/code/spideryarn2/.claude/worktrees/critiques-mode/src/types.ts:3312), [parent §4](/home/greg/code/spideryarn2/.claude/worktrees/critiques-mode/docs/plans/260905f-debate-mode-what-the-web-says-about-this-piece.md:168).

(b) Add this exact landing requirement:

> The targeted relation instruction is exactly:
>
> `relation  what the QUOTED PASSAGE does to this row's target:`
>
> If that arm lands, the same commit changes the authoritative `DebateRelation` docblock, the parent plan’s §4 wording, and the Debate panel’s explanatory prose from page-scoped to passage-scoped. Group-one eligibility and `articleReferenceQuote` remain page-level; only `relation` and `valence` become passage-level. `applies` and `limits` retain their existing outside-piece meaning.

### F55 — P2, reasoned: the screen can still make abstention look like improvement

(a) An arm returning `unclear`/`unknown` everywhere produces no opposite pairs. Because every packet is now judged, the screen does not actually route anything; calling it a score or comparative flag rate still visually rewards abstention.

(b) Replace the screen description with:

> Every packet is judged regardless of the screen. The report prints the opposite-pair count `N / all packets` beside the full relation × valence contingency table, including `unclear` and `unknown`. It never orders, colours or selects arms by this count. Its only purpose is to mark rows worth inspecting.

The demotion is right. There is no stronger free semantic signal hiding here; an explicit copied target field would prove only that the model copied the target, not that it reasoned about it.

### F56 — P2, reasoned: “winning prompt” has no declared selection rule

(a) The plan declares qualification thresholds but not what happens if incumbent and targeted both pass, or if `incumbent-repeat` disagrees with incumbent. That leaves the winner selectable after seeing results.

(b) Add before Stage C runs:

> `incumbent-repeat` is a variance control, never a candidate for landing. `targeted` replaces `incumbent` only if `targeted` passes every gate and `incumbent` fails at least one. If both pass, keep the incumbent; if targeted fails, production remains unchanged. This decision is recorded before generation and is not revised after seeing the tables.

### F57 — P3, established: the candidate has already landed

(a) The four files are tracked in commit `43e9fc41`, whose parent is the stated base `538e5191`. Current HEAD is merge `bafebbc3`; only `.tmp-debate-fixture.mts` is untracked.

(b) Replace the candidate-state paragraph with:

> Candidate landed as `43e9fc41` from base `538e5191`; this review inspected it through merge HEAD `bafebbc3`. `.tmp-debate-fixture.mts` remains outside the candidate.

The strict zero-miss anchor gate is fine as a conservative sanity gate; its problem is dual use as evaluation data, not strictness. Stage C also should not land anything—its frozen comparison is necessary evidence, not a disposable stage.

Verification: `npx vitest run tests/debate.test.ts` passed, **54/54**. No files were changed.