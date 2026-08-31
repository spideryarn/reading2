# Verdict: STOP — revise before Stage 1

Do not build this contract as written. The interval is a useful resolved representation, but it is not a complete temporal model. More importantly, the phrase check is not a safety boundary: it accepts wrong dates, and its failures are invisible to the reader.

I reviewed the current 953-line plan snapshot.

## 1. The temporal model is incomplete — questions 1 and 2

Keep intervals for arithmetic and ordering. Do not use them as the only representation of what the article said.

The missing distinctions are:

- `granularity`: year, month, day, part-of-day.
- Boundary semantics: inclusive/exclusive and firm/soft, independently for each edge.
- Duration independent of placement.
- Relative offset ranges: “within a few hours” is `[0, few]`, not one approximate scalar.
- Anchor kind and edge: another event, publication, event start, or event end.
- Event certainty: “transcripts seem to show agents dying” doubts the event, not its date.
- Aggregate or series shape: “advances over six months” is not necessarily one continuous event.
- Optional `when`: an undated prediction should not need a fake `When` and fake `phrase`.
- Per-component provenance: in “July 7” the month/day are stated but the year is derived. One global `basis` cannot say that.

The [current model](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/260831i-timeline-mode.md:157) also has no field backing the hard/soft edge distinction its drawing claims to show.

### All 24 expressions

| # | Expression | Result |
|---|---|---|
| 1 | Over three months | Does not fit. Null bounds lose the duration; needs `duration`, probably aggregate/series shape. |
| 2 | During May | Resolvable to May 1–31, but needs month granularity and mixed stated/derived provenance. |
| 3 | By May 12 | Interval works only after adding an inclusive upper boundary and granularity. |
| 4 | Two weeks later, on May 26 | Needs two independently retained claims and a consistency check. “By May 12” is not a point from which May 26 can safely be derived. |
| 5 | Another month later, on June 26 | Same, plus explicit calendar-month arithmetic. |
| 6 | By July 4 | Needs inclusive upper boundary and granularity. |
| 7 | On July 7 | Fits after adding granularity and per-component provenance. |
| 8 | Within a few hours | Does not fit. Needs a ranged offset such as `[0, N]`. |
| 9 | By the night of July 8 | Loses “night”; needs part-of-day and an inclusive upper boundary. |
| 10 | Within a few hours of board creation | Needs ranged offset and a valid local anchor even when no absolute date can be resolved. |
| 11 | By July 10 | Needs inclusive upper boundary. |
| 12 | Morning of July 10 | Loses same-day ordering without part-of-day. |
| 13 | By next morning, July 11 | Needs part-of-day, upper-bound semantics, and dual absolute/relative evidence. |
| 14 | On July 11 | Fits after granularity/provenance changes. |
| 15 | Over the next day | Does not fit. Needs an anchored duration or two relative edges. |
| 16 | At some point July 12; transcripts seem to show | Date fits; uncertainty does not. “Seem” is event certainty, not a reason to widen the date. |
| 17 | By July 13 | Needs inclusive upper boundary. |
| 18 | July 13 through July 19 | Needs inclusive edges. The plan calls this six days, but the named inclusive dates cover seven calendar dates. |
| 19 | 2026-07-19 | Fits with day granularity. |
| 20 | A couple weeks ago | Excluded as content, but still not representable: needs a publication anchor and ranged approximation. |
| 21 | Six-day sprint | Does not fit. Duration exists without placement. |
| 22 | Just six months ago | Needs a publication anchor and an approximation policy. It may not describe an event at all. |
| 23 | Advances over the next six months | Needs publication anchoring, duration/horizon, and probably series rather than continuous-event shape. |
| 24 | Final warning shot | Does not fit the required `when: When`; it needs `when: null`. |

The plan also calls these “every temporal expression,” then later lists several it missed: “after July 12,” “lasted over a month,” and “last three days.” This is not yet a gold set.

### Settle partial ISO strings this way

Do not put partial ISO values such as `"2026-05"` in `earliest` or `latest`.

Use:

- Fully resolved date-only endpoints for arithmetic, e.g. `2026-05-01` through `2026-05-31`.
- Explicit `granularity: "month"` for display.
- Raw unresolved components separately when the year is unknown.
- Null resolved bounds until the reference frame exists.

That makes ordering and display simpler. “May 2026” and “around 26 June” may have similar interval widths, but the former has month granularity and hard evidence while the latter has day granularity and soft edges.

I recommend two types:

1. A raw temporal claim: phrase, operator, partial date, duration, relative relation, anchor key.
2. A resolved interval: full endpoints and explicit boundary semantics.

`basis` should mean provenance only. It should not also mean precision, approximation, edge firmness, or event confidence.

## 2. The phrase check is not load-bearing — question 3

[`findQuote`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/quote-match.ts:62) does:

- Case folding.
- Curly-to-straight quote folding.
- En/em/minus dash to hyphen.
- Non-breaking space to ordinary space.
- One pass collapsing whitespace.
- A fallback pass removing whitespace entirely.

It does not normalize arbitrary punctuation changes, date formats, ellipses, Unicode composition, reordered words, or missing commas.

“By the next morning, July 11” will match when the only differences are case, the supported quote/dash forms, NBSP, or whitespace. It will not match if the model omits the comma or paraphrases it.

There is no defensible false-negative rate from this code. The closest repository evidence is three quote-copy failures in roughly thirty Ideas occurrences, about 10%, but that is one article and a different field. The rate must be measured in the timeline eval.

The larger problem is false positives. `findQuote` is substring-based and has no token boundary. I verified:

- `"July 1"` matches inside `"July 11"`.
- `"May 2"` matches inside `"May 20"`.
- `"By the next morning, July 1"` matches the prefix of `"By the next morning, July 11"`.

It was designed to locate substantial prose quotes, not validate short date tokens.

Even a perfect textual match proves only that the phrase appears somewhere in the block. It does not prove:

- The returned ISO date agrees with it.
- It dates this event rather than another event in the same block.
- The model did not attach a genuine nearby date to the wrong event.

The test article has May 12 and May 26 in the same block, so this is not hypothetical.

### Stronger check

The model should not supply authoritative normalized dates. Instead:

1. Validate the event occurrence quote as Ideas does.
2. Locate the temporal phrase inside that occurrence, preferably in the same clause.
3. Parse the phrase deterministically into temporal components and operators.
4. Compute resolved endpoints in code.
5. Require every displayed absolute component to come from the parsed phrase, except explicitly permitted derivations such as the year from `publishedAt`.
6. For relative phrases, require a parsed relation and a valid anchor. “Two weeks later” need not contain a calendar date; its derived date is justified by the relative phrase plus the anchor.
7. When absolute and relative evidence coexist, retain both and report disagreement rather than choosing one silently.
8. Reject dates leaking into `label`, because otherwise the ban simply relocates there.

I would remove `inferred` displayed dates from v1. They directly contradict “nothing is dated unless the article dates it.” If they remain, change that safety claim.

### Demote or drop?

Demotion is right only when the occurrence still proves the event. But validation failure must not look identical to a genuinely undated event.

Use three outcomes:

- Invalid event evidence: drop the event.
- Valid event, valid temporal evidence: date it.
- Valid event, rejected temporal evidence: preserve the event but mark the date as rejected/unverified.

Today the reader would see only an ordinary undated mark. That is not “fails visibly”; only the internal counter knows what happened.

## 3. The ordering algorithm asserts chronology the evidence does not support — question 4

Uncertain intervals form a partial order. Forcing them directly through a comparator creates invented chronology.

Examples:

- An event occurring “by July 4” may have happened before an event on July 1. Sorting it at July 4 claims otherwise.
- An event “after July 12” may happen after July 19. Sorting it at July 12 claims otherwise.
- Overlapping intervals are not chronologically comparable merely because one has an earlier `earliest`.

The undated bracketing rule is also undefined. Consider model order:

1. Dated July 10
2. Undated
3. Dated July 1

After dates “win,” which two events bracket the undated one? Several undated events with identical orders have no tie-break, and events before the first or after the last dated event are unspecified.

Rule 4 is written last but overrides all previous rules. Modality must be the primary partition, not the final tie-break.

A stable sort is insufficient because model output order is not a semantic tie-break and duplicate `order` values remain possible.

### Use a deterministic linear extension

Build definite precedence edges only where the evidence proves them—for example, `A.latest < B.earliest`, respecting inclusivity. Add valid explicit relative-order edges.

Then:

1. Partition happened versus predicted/hypothetical.
2. Topologically order each partition.
3. Among currently incomparable events, prefer model `order`.
4. Finish with source position or stable event ID.

This produces a total display order without pretending every pair was temporally comparable. Count an `orderConflict` only when a definite temporal relationship contradicts model order.

For relative resolution, use a dependency graph and strongly connected components or three-colour DFS. “Fixed point with a visited set” is too vague. Demote every member of a cyclic component; leave its dependants unresolved. Do not discard an independently stated absolute date merely because optional relative evidence participates in a cycle.

Missing tests include:

- Identical dates and identical model orders.
- Open-lower and open-upper intervals against points on either side.
- Overlapping and contained intervals.
- Several undated events in one gap, before the first date, and after the last.
- Reversed model brackets.
- Self-cycle, three-node cycle, missing anchor, and a chain leading into a cycle.
- Absolute and relative evidence agreeing or disagreeing.
- Duplicate temporary IDs and duplicate/invalid `order`.
- Anchor start versus anchor end for extended events.
- Jan 31 plus one month, leap days, and year boundaries.
- Inclusive “through,” exclusive “before,” and “not until.”
- Same-day morning/night ordering.
- Predictions with yearless future dates.

The proposed “most recent instance at or before publication” rule is also wrong for predictions. A January article saying “in December we expect…” may mean the following December.

## 4. Run an eval before freezing types or building the panel — question 6

The plan is repeating the exact sequencing mistake that [Ideas corrected](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/260826ac-ideas-mode.md:830).

A hand-written fixture proves the arithmetic and panel can display the answer Greg wrote. It says nothing about whether the model can produce that answer.

The cheapest first stage is:

1. Preserve a publication date.
2. Write a temporary raw-output schema and prompt.
3. Run it on the Dwarkesh article plus a small varied set.
4. Score the raw evidence before designing the durable artifact.

Score:

- Event precision and recall.
- Duplicate and wrongly merged events.
- Excluded piece-metadata events.
- Correct occurrence and temporal phrase.
- Correct operator: by/before/after/during.
- Modality and event-certainty accuracy.
- Relative anchor accuracy.
- Date leakage into labels.
- Percentage that the deterministic parser can resolve.
- Behaviour on nonchronological and date-dense articles.

If that fails, no arithmetic or UI work has been sunk.

### Publication date is a blocker for this eval

The revised plan correctly found that [`Meta`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/types.ts:1069) lacks the field, but “not a blocker” is rationalisation. Nineteen undated rows cannot validate a feature chosen specifically for half-specified dates.

Readability already exposes `publishedTime`, and parsing the saved test page returns `2026-08-29T22:47:53+00:00`. [`extract.ts`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/extract.ts:350) currently discards it. Preserve that existing result as validated `publishedAt`; do not add a second JSON-LD/meta-tag scraper unless evidence shows Readability misses required cases.

Also, current metadata fingerprints include title/byline/site/url, not `publishedAt`. Merely saying “metadata is in the hash” does not make the publication date part of it. Add it explicitly to the timeline freshness input.

A better cut is:

- Stage 0: preserve `publishedAt`; re-extract the target.
- Stage 1: prompt spike and scored eval.
- Stage 2: freeze raw evidence and resolved interval contracts; implement deterministic compiler.
- Stage 3: real generator and pipeline.
- Stage 4: UI.

Stages 2 and 3 in the current plan are technically parallel by file ownership. That parallelism is economically wrong: the UI would be built against a semantic contract the eval has not validated.

## 5. The model will fail in ways the negative examples do not cover — question 5

On this article I expect it to:

- Emit duplicate events because the same three-month story is retold from several civilisations’ perspectives.
- Merge distinct same-day incidents into “Hugging Face was compromised.”
- Promote containers and topics—“the first civilisation,” “the rise of the agents”—into events.
- Treat “seem to show” and “I doubt it” as fuzzy dates instead of doubt about whether the event occurred.
- Include the interview, report-writing sprint, and “last three days” because those are the cleanest temporal expressions despite the ban.
- Attribute Ajeya’s or Ryan’s prediction to the article as fact.
- Turn “human-subjective-week” and rhetorical counterfactuals into dates.
- Default `extent`, `basis`, or anchors merely to satisfy the schema.
- Put real dates in labels after the date fields are rejected.
- Attach a real phrase from the right block to the wrong event.
- Produce relative references to event IDs that do not exist yet.

That last point is a contract bug: the model cannot return a minted `TimelineEventId` before ID minting and inheritance happen. Raw output needs temporary local keys; stable IDs are assigned later.

One call is not necessarily too much. The wrong part is asking one call for both evidence and normalized arithmetic.

Use one model call for:

- Event selection.
- Short near-verbatim handle.
- Occurrence quote.
- Temporal phrase.
- Raw relation/operator.
- Local anchor key.
- Modality and occurrence hedge.
- Narrative order.

Then compile deterministically. Do not add a second paid model pass merely as a verifier; the same model is not an independent safety check. Add a global selection/deduplication pass only if the eval shows that one-pass extraction cannot handle the article’s repeated narratives.

## 6. The awkward section is candid, but its defence is partly rationalisation — question 7

The opening is honest. The three answers do not remove the anti-goal:

- A short pointer can still be a summary. Selection plus chronology is most of a plot; label length is not the decisive variable.
- Chronological order is genuinely different from prose, but every good summary is also a different artefact. Straightening the narrative can erase repetition, perspective, and ambiguity, and can imply causality.
- Uncertainty could be the feature’s strongest justification, but the current schema cannot faithfully represent it. It conflates temporal uncertainty, derivation, precision, and doubt that the event occurred.

The honest claim is:

> This is a summary-shaped evidence-navigation tool. It earns its place only when it sends readers back to the prose and makes the article’s temporal claims and uncertainty more inspectable.

Change “when did all this happen?” to “when does the piece say these things happened?” Prefer near-verbatim handles over synthesized headlines. Evaluate whether a reader can reconstruct the plot from the panel alone; if so, admit the feature is an explicit exception rather than repeatedly shortening labels.

## 7. The implementation stages contain smaller contradictions — question 6

These are not the reason to stop, but they should be repaired:

- The plan recommends a converted transactional stage, then Stage 2 says `timeline.ts` directly writes `timeline.json`. Stage 3b would have to refactor the supposedly finished generator.
- ID inheritance by label is unsafe. Use a signature derived from validated occurrence and temporal evidence; mint a new ID when ambiguous.
- “Owners-only” should remove or explicitly define the proposed visitor band and public DTO behaviour.
- As of this review, `tests/db-step-constraint.test.ts` already fails because `quotes` is in `STEP_ORDER` but missing from the latest migration constraint. It cannot provide a meaningful new red for timeline until the baseline is green.
- The heading calls Timeline the ninth mode while the file survey says the current nine become ten.

## 8. Operational requirements missing from the plan — question 8

Before launch:

- Accessibility: make glyphs `aria-hidden`; give every row a complete spoken explanation such as “article says at or before 4 July; year derived from publication.” The legend alone is insufficient. Prefer CSS/SVG marks over font-dependent Unicode.
- Dark mode: test edge weights and contrast in both themes, including selected/focus states without relying on colour.
- i18n: either declare English-only parsing for v1 or provide locale-aware temporal parsing. Use `Intl` for display and date-only arithmetic that cannot shift a day through time zones.
- Dense articles: establish `MAX_TIMELINE_EVENTS`, output-token limits, and selection semantics. With a cap, call it a selected timeline rather than implying completeness. Test a 200-date article before committing to one whole-article call.
- Cost: measure prompt/output tokens and actual cost in the eval; set a hard output budget and retain the existing paid-call ledger.
- Security: model output is untrusted. Bound all strings and arrays, validate IDs and anchors, render only as React text, and do not expose model-generated URLs or HTML.
- Logging/privacy: log counters and timing only. Do not log phrases, labels, occurrence quotes, raw model output, validation errors containing values, or article prose.
- Prompt injection: treat article instructions as content; deterministic evidence validation must remain authoritative.
- Failure states: distinguish genuinely undated, unresolved due to missing publication date, rejected date evidence, parser limitation, and stale occurrence.

## The questions aimed at the wrong thing

- Question 1 understates the problem as possibly “one missing field.” Several independent axes are missing.
- Question 3 asks for a realistic false-negative rate from static code. That requires an eval; code inspection instead reveals the more serious false-positive and entailment failures.
- Question 4 asks for a total temporal precedence rule. The evidence only defines a partial order; the UI needs a deterministic linear extension.
- Question 6 focuses on file-level parallelism. That parallelism is real, but validating the model before freezing the contract is much more important.

The minimum gate before implementation is: preserve `publishedAt`, run the extraction eval, split raw evidence from resolved time, replace phrase-presence validation with deterministic semantic compilation, and define ordering as a linear extension of proven temporal relationships.