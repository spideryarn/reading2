Verdict: **STOP before reader integration.** The deterministic `When` path is sound, but the broader claim—“a date the article does not contain has no way into the artefact”—is false.

## 1. Can an unsupported date reach the reader?

Yes, through two confirmed routes.

- **Certain, blocker:** `label` is unrestricted model prose. It is trimmed, stored, and rendered without validation ([timeline.ts:508](/Users/greg/Dropbox/dev/experim/spideryarn2/src/timeline.ts:508), [timeline.ts:530](/Users/greg/Dropbox/dev/experim/spideryarn2/src/timeline.ts:530), [timeline.ts:1143](/Users/greg/Dropbox/dev/experim/spideryarn2/src/timeline.ts:1143)). A label such as `“06/12/19: agents escape”` reaches the reader even if that date appears nowhere in the article.

- **Certain, blocker:** `TimelineEvent.phrase` is not proved date-free or article-backed. `readWhen` returns `noDateInPhrase` before looking in the occurrence ([timeline-time.ts:698](/Users/greg/Dropbox/dev/experim/spideryarn2/src/timeline-time.ts:698)); `dateEvent` then stores the model’s string ([timeline.ts:474](/Users/greg/Dropbox/dev/experim/spideryarn2/src/timeline.ts:474)), and `line` renders it ([timeline.ts:1104](/Users/greg/Dropbox/dev/experim/spideryarn2/src/timeline.ts:1104)). I directly tested:

  ```text
  phrase: "06/12/19"
  article: "Nothing remotely temporal appears here."
  result: noDateInPhrase
  ```

  So `"06/12/19"`—plainly a date to a human—would be displayed despite being absent from the article. `"the summer of twenty nineteen"` also returns `noDateInPhrase`.

- **Certain artefact defect; reader impact depends on Stage 3:** occurrences retain the model’s quote rather than the article slice ([timeline.ts:388](/Users/greg/Dropbox/dev/experim/spideryarn2/src/timeline.ts:388), [timeline.ts:539](/Users/greg/Dropbox/dev/experim/spideryarn2/src/timeline.ts:539)). `"spaced"` still uses substring matching, so I confirmed that `"July 1"` validates inside `"July 11"` ([quote-match.ts:264](/Users/greg/Dropbox/dev/experim/spideryarn2/src/quote-match.ts:264)). This recreates the exact failure documented in the plan. It reaches the reader if an expanded row ever displays the stored quote; otherwise it still gives later anchoring code a false quote.

What is safe: `When.earliest`, `When.latest`, and `When.phrase` come from parsed block characters ([timeline-time.ts:702](/Users/greg/Dropbox/dev/experim/spideryarn2/src/timeline-time.ts:702), [timeline-time.ts:729](/Users/greg/Dropbox/dev/experim/spideryarn2/src/timeline-time.ts:729)). No fabricated model date reaches those fields.

## 2. `within` strictness

**Certain:** the implementation is less strict than its prose. `within` constrains only the parsed date atoms. Governing cues are then searched in the whole block ([timeline-time.ts:702](/Users/greg/Dropbox/dev/experim/spideryarn2/src/timeline-time.ts:702), [timeline-time.ts:715](/Users/greg/Dropbox/dev/experim/spideryarn2/src/timeline-time.ts:715)). I confirmed:

```text
block:  "By July 12, agents acted."
quote:  "July 12, agents acted."
phrase: "By July 12"
result: success, with block slice "By July 12"
```

Thus the claimed gate “phrase must sit inside the quote” can stay green when the governing words are outside it.

For two sentences in one block:

- A quote spanning both sentences succeeds.
- A quote containing only the event sentence rejects the date.
- An arbitrarily broad quote can also attach the earlier sentence’s date to the wrong event; co-location is not semantic proof.

**Judgement:** keep occurrence-level strictness rather than widening to the whole block. The current article’s `0 phraseNotInOccurrence` is encouraging but covers one article and cannot establish general recall. If real misses appear, separate “event occurrence” and “temporal evidence” spans would be safer than block-wide borrowing.

## 3. ID inheritance

- **Certain, high:** IDs do not survive re-extraction at all when the source hash changes. `idsByEvidence` is bypassed unless the complete source hash is identical ([timeline.ts:986](/Users/greg/Dropbox/dev/experim/spideryarn2/src/timeline.ts:986)). Any changed block, tree, or publication metadata remints every ID. The measured 26/27 result describes same-source regeneration, not re-extraction.

- **Certain:** a moved block ID, a changed cited-block set, or a changed bound changes the key ([timeline.ts:572](/Users/greg/Dropbox/dev/experim/spideryarn2/src/timeline.ts:572)).

- **Certain behavior, speculative frequency:** two simultaneously present events with the same block set and date safely lose inheritance on both sides. But if run A contains event X and run B contains a different event Y with that same unique key, Y inherits X’s ID. The ambiguity protection cannot detect a cross-run substitution. Undated and rejected events are especially collision-prone because all have an empty date component.

The “drop ambiguous keys” policy is correct, but the key is not strong enough to guarantee semantic identity.

## 4. Counters and silent failures

Confirmed silent cases:

- **High:** `{"events": {}}`, `{"events": null}`, or `{}` becomes a legitimate zero-event artefact with every counter at zero. Non-arrays become `[]` ([timeline.ts:501](/Users/greg/Dropbox/dev/experim/spideryarn2/src/timeline.ts:501)), and `raws` becomes zero ([timeline.ts:644](/Users/greg/Dropbox/dev/experim/spideryarn2/src/timeline.ts:644)).

- Missing, numeric, or object-valued `phrase` is silently treated as `null` through `text(...)`; no malformed counter increments ([timeline.ts:247](/Users/greg/Dropbox/dev/experim/spideryarn2/src/timeline.ts:247), [timeline.ts:527](/Users/greg/Dropbox/dev/experim/spideryarn2/src/timeline.ts:527)).

- A model assigning every event `order: 1` increments neither `unordered` nor `orderConflicts`. Stable input order quietly becomes chronology. `countOrderConflicts` uses strict `>` and is necessarily blind to ties ([timeline-time.ts:830](/Users/greg/Dropbox/dev/experim/spideryarn2/src/timeline-time.ts:830)). The counter can go red generally, but cannot detect this particular “stopped ordering” failure.

- Invalid orders become `NaN`, which `JSON.stringify` writes as `null`, contradicting the on-disk `order: number` type.

The `dateEvent` refusal loop itself is reasonable: one counter per event outcome, selecting the refusal that progressed furthest. Failures in other occurrences are intentionally suppressed once one occurrence dates the event. I would rename `worst`, but I do not see a correctness defect in the ranking.

One useless test: “shows the shape … before anything else” merely checks `toContain` ([timeline.test.ts:502](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/timeline.test.ts:502)). It cannot go red when ordering changes—and the actual request puts the article before both instructions and shape ([timeline.ts:1008](/Users/greg/Dropbox/dev/experim/spideryarn2/src/timeline.ts:1008)).

## 5. Empty case

The product split is right: an exact `events: []` may be a valid answer, while a nonempty array whose entries all fail validation should throw.

The current boundary is not reliably detected because malformed containers join the valid-empty branch. Validate the outer response shape first.

Even after that, a model mistakenly returning `[]` for a chronological article is semantically indistinguishable from a genuine empty answer. That limitation is inherent without an independent signal. It should be documented as accepted, not described as fully detectable.

## 6. Dead or contradictory prompt text

Confirmed contradictions:

- “Do not write a date anywhere… not in phrase” immediately precedes examples requiring `"By … July 11"` in `phrase` ([timeline.ts:722](/Users/greg/Dropbox/dev/experim/spideryarn2/src/timeline.ts:722)).
- “A date you write down cannot be used and will be thrown away” is false: dates in `phrase` select block dates, and dates in `label` are retained ([timeline.ts:727](/Users/greg/Dropbox/dev/experim/spideryarn2/src/timeline.ts:727)).
- “The phrase must appear … in the same words. We look for it there” is false by design: matching is by parsed value, and the `noDateInPhrase` branch performs no location check ([timeline.ts:769](/Users/greg/Dropbox/dev/experim/spideryarn2/src/timeline.ts:769)).
- With no publication frame, the prompt says the event “will show without” a date ([timeline.ts:907](/Users/greg/Dropbox/dev/experim/spideryarn2/src/timeline.ts:907)); code marks `noYearFrame` as a visible rejection.
- The old `earliest`, `latest`, `extent`, and `basis` output fields are successfully gone. I found no dead schema instruction for them.

Verification: the 100 targeted timeline tests pass with `vitest --configLoader runner`. The ordinary test command could not start because the read-only sandbox prevented Vite from writing its temporary bundled config. No files were changed.

