# One measure borrows another measure's coverage

Stage 2 review of [261006b](../plans/261006b-count-ai-calls-that-die-part-way-and-transport-retries.md)
found that an unnumbered failure with a recorded `before_answer` phase displayed its zero part-way
deaths as *not measured*. The mistake reached the page and both reports through their shared fold.
It was caught in review; this review made no production writes, and deployment exposure was not
checked.

## What happened

Commit `3950ac5a51da43fa673edc8be7cc871172041b77` introduced
[`failureCountsOf`](../../src/cost-cube.ts). Retry measurement needs an attempt number, but failure
phase measurement does not: the PDF reader opts out of the gateway's retry numbering while its
failed requests still record a phase. See [`ordinal`](../../src/ai-call.ts) and the call in
[`pdf-read.ts`](../../src/pdf-read.ts).

The fold recognised unnumbered phase measurement only when a death actually occurred:

```ts
diedPartWay: measured || diedPartWay > 0 ? diedPartWay : null
```

An unnumbered `error` / `before_answer` row therefore returned `diedPartWay: null`, despite recording
where it failed. Its expected figures were `retries: null`, `gaveUp: null`, `diedPartWay: 0`.

## The class: one measure borrows another measure's coverage

A shared section encouraged one coverage predicate for measures recorded independently. A positive
event supplied an exception, hiding the missing zero case. The sibling was the shared note claiming
that only numbered attempts were counted: true for retries and give-ups, false for phase counts.
This is also a silent-success shape: all surfaces reused the same mistaken predicate.

## Why nothing went red

The existing tests covered historical rows, numbered quiet rows and unnumbered positive deaths.
They never crossed *unnumbered* with *recorded phase and zero deaths*. The terminal renderer also
assumed every measured quiet day had numbered attempts.

The reviewer added tests before fixing either assumption. Assertions failed across four files:
the fold expected `0` and received `null`; page and HTML cells expected `0` and received *not
measured*; a terminal fixture with the correct fold result omitted that day and claimed
`1 other day had counted attempts`.

## What would have caught it, ranked by ease against value

1. **Cross measurement evidence with zero and positive events.** Done in
   [`cost-cube.test.ts`](../../tests/cost-cube.test.ts), with page and report assertions. This is a
   small fixture addition that distinguishes absence of events from absence of observation.
2. **Give renderers independently supplied valid results.** Done in
   [`cost-analysis-cli.test.ts`](../../tests/cost-analysis-cli.test.ts). This exposed an assumption
   that an end-to-end fixture using the original fold concealed.
3. **Add a separate persisted coverage column for every measure.** Rejected for this fix: recorded
   failure phases already prove coverage here. More columns would not prevent a fold from borrowing
   the wrong predicate.

## The fix that is right for the long term

Earn coverage separately for independently recorded measures. The fold now accepts a numbered
attempt or an error with a recorded phase as evidence for part-way-death measurement, while retries
and give-ups still require numbering. The terminal report lists phase-only zero days separately
from quiet numbered days. Older unnumbered rows with no phase remain *not measured*; the fix makes
no claim of complete historical coverage or a denominator for rates.

On a future review I would ask what proves observation for each figure before checking how many
events it adds. A positive event can conceal a coverage error; the observed zero is the decisive
case.

Up: [Postmortems](../project/postmortems.md)
