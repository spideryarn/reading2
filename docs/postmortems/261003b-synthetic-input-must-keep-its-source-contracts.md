# Synthetic input must keep its source contracts

Stage 3 review of [GPT-Live](../plans/261003a-gpt-live-alongside-realtime-for-live-conversation.md)
found typed questions stored with missing spaces, missing literal brackets, or after their answers.
No reader impact was established; these were caught during review.

`say()` represented complete typed text as an audio transcript delta. That asserted three things
which were not true: the source supplied token separators, brackets described sounds, and an
inferred wall-clock timestamp belonged to the provider's timeline. That timeline can freeze for
26 seconds ([measurement](../investigations/261002r-gpt-live-spike.md)).

`fd8ab7e62` introduced synthetic fragments and inferred timestamps; `6063750a0` added acoustic
filtering to typed text too. The existing test had one ordinary question and an advancing timeline.
The new flow regressions went red with `Explain here.And there.` in place of literal bracketed
questions, and with an empty-question answer followed by an empty-answer question.

The class is **synthetic input inheriting measured-stream semantics**. The lasting fix is a distinct
`typed` segmenter event: explicit spacing, literal text, and placement at the observed provider
timeline edge. Typed stall timing uses its own wall-clock arrival, rather than inventing speech time.
An explicit boundary after companion speech also prevents a quick typed follow-up being merged into
the question answered earlier. Delegation debt still uses speech time, so delayed filler cannot pay
for a final backend answer it preceded.

Countermeasures, ranked by effort against value:

1. The red-first hook regressions in `tests/gpt-live-session-flow.test.tsx` cross the input-source
   boundary; ordinary transcript tests did not.
2. The distinct event variant keeps provenance available to the reducer. Implemented here.
3. A new clock framework or conversation storage redesign is rejected for this fix: neither is
   needed to preserve typed text or stop advancing an unobserved timeline.

Matching fields do not imply matching evidence. Inspect the source contracts before reusing a
stream event shape for a different kind of input.
