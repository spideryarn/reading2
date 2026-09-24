# A malformed label pair kills the step without a retry

Greg's report, 2026-09-24: an imported PDF
(`entropy-26-00481-with-cover-from-taylor-beck-spya-naz564`) stopped at **Labelling the paragraphs**.
Sentry has it as
[SPIDERYARN-READING2-43](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-43): one event,
2026-09-24T03:36:42Z, release `493615a4`, tags `step=labels`, `jobId=spya-d57ur4`,
`message_withheld=True`. The whole title is `Error: Error`. The top frame is `readPairs`, called from
`parseLabels`, called from `runBatch`. The postmortem is
[260924a](../postmortems/260924a-a-malformed-label-pair-kills-the-step-without-a-retry.md).

## What the stack proves, and what it cannot

`readPairs` (src/labels.ts) throws a plain `Error` in five places: `labels` is not an array; an
entry is not a two-element array; its ordinal is not an integer; its label is empty or whitespace;
an ordinal appears twice. The top frame says it was one of those five, and not a JSON parse failure
(that would be `MalformedJson` from `parseJsonAnswer`) and not a missing paragraph (that is
`BatchIncomplete`, which is retried).

**Which of the five, we cannot say.** The message is the only thing that says, and Sentry withholds
every message not ending in a registered code — deliberately, see `authored` in
src/monitoring-scrub.ts. The Vercel runtime log has it; nobody on the box has Vercel credentials.
The likeliest is an empty label: it is the same event as the Wolfram outage in
tests/labels-shortfall.test.ts — a paragraph the prompt makes unlabellable, a lone PDF fragment
here — answered with `""` instead of by omission.

## The bug

`runBatch`'s caller retries only a `BatchIncomplete`. Everything `readPairs` throws is a plain
`Error`, so **one bad pair out of fifty kills the whole step on the first draw**, with no re-ask and
no re-draw, while the same model *omitting* that pair would have been repaired by the shortfall path
and, failing that, accepted within the drop budget.

## The change

1. **An empty label is a missing pair.** A label that is empty, whitespace or not text is the model
   declining that paragraph — the same event as omitting it. The pair is skipped, its ordinal falls
   into `missing`, and the existing machinery takes over: the re-ask names it, `acceptGap` bounds
   what may be lost, `detectShift` still votes on the merged set. No new retry path.
2. **A broken format is a re-draw.** An entry that is not a pair, an ordinal that is not an
   integer, an ordinal given twice, `labels` not a list, or an answer that will not parse become a
   `BatchIncomplete` with no shortfall. The caller already answers that with a whole-batch re-draw
   at double headroom (the truncation path), and `acceptGap` refuses to forgive it. **Revised after
   GPT Sol's plan review** (findings 1–2): the first draft skipped *every* bad pair into `missing`,
   which would have let a format fault be forgiven as "the model would not write this one", and
   let `[999, ""]` hide an answer written for another batch. Every integer ordinal, even one with
   an empty label, now counts for the out-of-range check.
3. **Sentry can tell failures apart.** Following `MalformedJson`'s precedent (a `name`, and a
   `code` from a closed set, which `SAFE_PROPS` in src/monitoring-scrub.ts forwards as a tag),
   the step's terminal errors become a `LabelsFailed` class carrying `code`: the kind of the first
   attempt's failure and the second's — e.g. `short+short`, `unparseable+truncated`,
   `truncated+ai-busy`. Each part is a `BatchFault`, a registered bracket code validated through
   `kindOfMessage`, or the literal `other`, so it is authored by construction and carries no model
   text. The `BatchIncomplete` message also names the pair faults by count and kind (never the label
   text), so the log line says why a paragraph was re-asked.

## Passed over

- **Re-draw on every `readPairs` fault, empty labels included** (a one-word change per site). It
  gets a retry, but for the likeliest case the wrong one: it re-buys fifty good labels to fix one,
  and an empty label for an unlabellable fragment comes back empty again — the Wolfram outage
  failed byte-identically three times this way. Only the empty label has the shortfall path's
  meaning, so only it takes that path.
- **Make the diagnostic "authored" so Sentry forwards the sentence.** `stageFailure({ authored })`
  exists, but the terminal message embeds the first attempt's message, which embeds
  `parseJsonAnswer`'s diagnosis; proving all of that is ours is a bigger claim than a closed enum.
- **Fix every withheld message in the pipeline.** The class is wider than this step (postmortem
  § the class); this change does labels and records the sweep for Greg.

## Tests

In tests/labels-shortfall.test.ts, driven through `generateLabels` with the scripted transport:
empty label, whitespace label, duplicate ordinal, string ordinal and a three-element entry each get
a re-ask naming the paragraph and end with a full set; `labels` not an array, and unparseable text,
each get a whole re-draw; a batch that fails twice throws `LabelsFailed` whose `code` names both
kinds and whose `sanitise` output (src/monitoring-scrub.ts) carries that code and the name. Red
first, against the unfixed code.

## Production

Re-running the step on Greg's article is his call: it would re-buy the label batches (a few pence to
tens of pence at the step's usual size) and, with this fix deployed, most likely finish. Without the
fix deployed, a re-run samples again and may or may not hit the same pair.
