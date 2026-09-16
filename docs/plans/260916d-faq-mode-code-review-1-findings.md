# FAQ mode stage 1 — code review findings

Review of commit `b31d8b87` against
[the plan](260916d-faq-mode.md) and its
[plan review](260916d-faq-mode-review-sol.md). C1–C4 were recorded before any review fix. C5
surfaced in the verification lint pass and was recorded before its own fix.

## C1 — P1 — the validator accepts a statement as an FAQ question

Evidence: the product contract says a question is one sentence and the prompt requires it to end in
a question mark (`src/faq.ts:431-432`), but `toQuestions` accepts every non-empty string of at most
200 characters (`src/faq.ts:240-245`). A model response such as `{"question":"Entropy still
increases","passages":[...]}` is therefore stored and shown as an FAQ row even though it is not a
question.

Consequence: a protocol slip becomes user-visible wrong content rather than a counted malformed row.
The prompt cannot be the only enforcer for a shape the parser already claims to validate.

Fix: add a red test for a non-question string, require the trimmed question to end in `?`, count a
failure as `malformed`, and bump the FAQ version because the same model answer will now produce a
different artefact. While touching the prompt, say “at most 200” rather than “under 200” so its
boundary agrees with the plan and validator.

## C2 — P2 — malformed passage shapes are reported as anchoring failures

Evidence: `verifyPassage` treats a missing or non-string `blockId` as `unknownIds` and a missing or
non-string `quote` as `unquoted` (`src/faq.ts:186-196`). `toQuestions` silently turns a non-array
`passages` field into an empty list and later increments `unanchored` (`src/faq.ts:254-275`). All
three inputs are malformed JSON shapes, not claims that failed semantic verification.

Consequence: the stored and logged counters point prompt evaluation in the wrong direction. In
particular, `unanchored` is documented as the quality signal for a model asking about themes rather
than passages, but it also rises for an unreadable response shape.

Fix: reject missing required passage strings and non-array `passages` as `malformed` before block or
quote lookup. Add red tests that distinguish malformed structure from a well-formed unknown id and
a well-formed quote absent from its named block.

## C3 — P3 — the FAQ claimant-budget comment calls measured evidence a guess

Evidence: `src/jobs.ts:679-681` labels the 150-second row “A GUESS” and says to re-measure it from
the stage-1 runs. The review evidence gives those runs as 29–35 seconds, and the plan's Progress
section records the two articles and their outputs.

Consequence: a later maintainer cannot tell whether the generous claimant allowance is evidence-led
or an unverified placeholder, defeating the table’s explicit measured-versus-guess discipline.

Fix: describe the two measurements and retain 150 seconds as conservative headroom over two
articles, without presenting two samples as a fitted bound.

## C4 — P3 — the passage type points to a constant that does not exist

Evidence: `FaqPassage.quote` says its limit is `MAX_FAQ_QUOTE_CHARS` in `src/faq.ts`
(`src/types.ts:3815`), but the exported constant is `MAX_QUOTE_CHARS` (`src/faq.ts:90`).

Consequence: the contract’s pointer sends the next reader searching for a second or missing source
of truth.

Fix: name `MAX_QUOTE_CHARS` in the comment.

## C5 — P2 — the request-shape test dereferences an optional call unsafely

Evidence: scoped Biome reports `lint/correctness/noUnsafeOptionalChaining` at
`tests/faq.test.ts:363`. The helper optional-chains `c?.body` and immediately reads `.system` from
the possibly undefined result.

Consequence: the new test does not express its fixture precondition to either TypeScript or the
linter, and a future edit can turn a missing call into an opaque property-access exception rather
than the intended assertion failure. It also leaves a new lint error in the stage-1 file.

Fix: assert both captured calls exist with an explicit guard before reading their request bodies,
then use a non-optional helper.
