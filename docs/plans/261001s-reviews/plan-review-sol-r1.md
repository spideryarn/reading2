## Findings

**F1 — P1 — The evidence inventory is incomplete, invalidating the safety argument.**

The plan discusses three expressions and says repaired starts were “not observed” ([plan:30](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/docs/plans/261001s-structure-answer-writes-code-to-correct-an-id.md:30), [plan:123](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/docs/plans/261001s-structure-answer-writes-code-to-correct-an-id.md:123)). There are actually six known expressions across four failed answers:

- `toc10 #0` contains three replacements, including a no-op and two omitted from the table ([raw:6](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/evals/results/paperwork/structure-parse/toc10-analog-cognition-and-consciousness-4-28-26-spya-f03kqf-0.raw.txt:6), [raw:17](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/evals/results/paperwork/structure-parse/toc10-analog-cognition-and-consciousness-4-28-26-spya-f03kqf-0.raw.txt:17), [raw:21](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/evals/results/paperwork/structure-parse/toc10-analog-cognition-and-consciousness-4-28-26-spya-f03kqf-0.raw.txt:21)).
- The ledger-linked ball-lightning failure repairs a **start**, not an end ([raw:21](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/evals/results/paperwork/after-2/source-spya-f550ta.structure-raw.txt:21)).

The real-to-real replacement at `toc10 #0:17` also looks like reconsidering a boundary, not merely repairing a mistyped token. Thus “the model mistypes an ID prefix” is only one manifestation; the stronger root cause is in-band revision of streamed structured output.

Change the plan: enumerate all six events, resolve every receiver and result, and classify field, membership, no-op/miss, derived-boundary agreement, and semantic plausibility. Remove “starts not observed.” A no-op must remain malformed.

---

**F2 — P1 — A default shared repair accepts arbitrary reader-visible values without semantic validation.**

Option A changes the default parser for every caller ([plan:81](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/docs/plans/261001s-structure-answer-writes-code-to-correct-an-id.md:81)), while `parseJsonAnswer` returns only `T`, with no repair provenance ([parse-json.ts:569](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/src/parse-json.ts:569)).

Tweets are a concrete counterexample:

- They use `parseJsonAnswer` ([tweets.ts:394](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/src/tweets.ts:394)).
- Any string `text` is accepted ([tweets.ts:418](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/src/tweets.ts:418)).
- That text enters the stored artifact ([tweets.ts:498](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/src/tweets.ts:498), [pipeline.ts:3198](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/src/pipeline.ts:3198)).
- It is rendered verbatim to the reader ([Tweets.tsx:340](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/src/web/Tweets.tsx:340)).

For example, a previously rejected answer containing:

```json
{"tweets":[{"text":"accurate".replace("accurate","invented"),"blocks":[]}]}
```

would become accepted and displayed, with no article-block resolution involved.

Change the plan: do not add this behavior to default `parseJsonAnswer`. If retained at all, introduce an opt-in API returning repair provenance and require the opting caller to define the allowed field and validation. The caller audit must gate shipping; “fixed or reported” ([plan:110](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/docs/plans/261001s-structure-answer-writes-code-to-correct-an-id.md:110)) is insufficient under the hard constraint.

---

**F3 — P1 — “Wrong-but-real is made loud” is false, and a wrong repaired end can affect the tree.**

`noteJsonRepair` is only a warning log ([json-repair-log.ts:82](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/src/json-repair-log.ts:82)); hierarchy repair figures are likewise ordinary information logs ([pipeline.ts:2595](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/src/pipeline.ts:2595)). There is no alert, threshold, retry, refusal, or reader-visible signal.

More importantly, ends are not always redundant. When a later child’s start does not advance, `planChildRanges` uses the previous child’s real, forward end as a fallback split point ([hierarchy.ts:1329](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/src/hierarchy.ts:1329), [hierarchy.ts:1367](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/src/hierarchy.ts:1367)). `recordBoundaryFaults` measures the resulting discrepancy but does not prevent it ([hierarchy.ts:1425](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/src/hierarchy.ts:1425)). Because the parser discards repair provenance, hierarchy cannot distinguish that suspect end from an ordinary typed end.

Change the plan: a repaired start must be refused; a repaired end must be treated as absent and must never participate in fallback. A missing search, no-op step, or unchanged total result must remain malformed. Logging may remain diagnostic, but it is not a correctness control.

---

**F4 — P1 — Option B is the better primary fix and is materially cheaper than the plan claims.**

Five of the six observed replacements are hierarchy range ends—the redundant, difficult field. Removing that field addresses the dominant observed cause instead of teaching every JSON caller to execute in-band edits.

The plan says B requires changing both hierarchy and hierarchy-expand ([plan:82](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/docs/plans/261001s-structure-answer-writes-code-to-correct-an-id.md:82)). But hierarchy-expand already has exactly the proposed wire protocol:

> Give each child the id of the block it STARTS at. Do not give an end.

([hierarchy-expand.ts:278](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/src/hierarchy-expand.ts:278))

Its normalizer already documents and implements the precise tradeoff: derive ends, and drop a colliding child because there is no end fallback ([hierarchy-cascade.ts:1282](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/src/hierarchy-cascade.ts:1282), [hierarchy-cascade.ts:1302](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/src/hierarchy-cascade.ts:1302)).

Change the plan: make B the implementation, adapting the established starts-only normalization to the whole-document tree and preserving sparse block IDs. Measure the loss of the fallback before deciding whether it matters. The one known repaired start should continue failing loudly. Consider an opt-in parser repair later only if verified cross-stage evidence remains after field-level fixes.

---

**F5 — P2 — The parser specification lacks the cases needed to implement it safely.**

The real corpus already contains both combinations the proposed tests omit:

- `.replace(...)` plus a trailing comma ([toc9 raw:29](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/evals/results/paperwork/structure-parse/toc9-analog-cognition-and-consciousness-4-28-26-spya-f03kqf-4.raw.txt:29)).
- Three replacement expressions in one document.

If an opt-in repair remains, the plan should specify:

- Perform the existing whole-answer strict parse and single-document/array-root ambiguity gate before repair.
- Repair only the extracted span.
- Decode each JSON string literal with JSON semantics, then implement first-occurrence replacement via `indexOf` and slicing.
- Refuse a missing needle, any no-op step, or an unchanged final receiver.
- Compose trailing-comma and string repairs in one deterministic pass before the final parse; report their counts separately with the final outcome.
- Preserve rejection of array-rooted malformed answers, multiple documents, unsupported suffixes, and replacement-like text in strings or wrappers.

Add tests for the real combined and multi-expression answers, escaped quotes/backslashes, Unicode escapes and surrogate pairs, empty needles, chains, unsupported chained methods, preamble text, array roots, and second documents. The tweet example in F2 is the required “correctly failing becomes wrongly accepted” regression test for the generic API.

---

**F6 — P2 — The measurement is paired correctly for parser delta, but cannot choose between A and B or establish correctness.**

Rescoring identical answers is sound for measuring “old parser versus new parser.” However:

- `buildTree` succeeding is not evidence that repaired boundaries are right; it intentionally derives, clamps, drops, and records faults.
- Fresh calls on `toc/10` do not measure a starts-only prompt.
- Reproducing the base behavior as “plain `JSON.parse` + comma repair” risks omitting extraction and ambiguity behavior in `parseJsonAnswer` ([parse-json.ts:483](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/src/parse-json.ts:483)).
- Only the four failures from the existing 48 answers have raw responses, so the plan should not imply all 48 can be freely rescored.
- Sixty draws on one article is a useful stress arm, not a representative overall rate.

Change the plan:

1. Preserve the exact base parser or record its verdicts before changing code.
2. On every retained answer, compare current range normalization with starts-only normalization, including fallback usage, dropped children, repair sizes, and agreement with the boundary derived from the next start.
3. Run a fresh starts-only prompt arm, balanced across articles, alongside the current prompt.
4. Manually inspect every repaired or dropped case; call boundaries “agrees with start-derived boundary / backwards / other,” not “right” without semantic review.
5. Report per-article rates and uncertainty. About 120 calls is adequate for discovering recurring shapes, but cannot prove the no-leak invariant; that must come from the API design and tests.

**Verdict: rethink.**