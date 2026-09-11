# PDF item boundaries: the evidence, and a decision

Status as of 2026-09-11: **experiment done; decision: adopt, in a scoring-only form, through a
separate plan that is written and not built** —
[260911c-score-pdf-pages-at-the-line-breaks-pdfjs-did-not-mark.md](260911c-score-pdf-pages-at-the-line-breaks-pdfjs-did-not-mark.md).
Evidence: [`evals/pdf/item-boundaries/results-2026-09-11.json`](../../evals/pdf/item-boundaries/results-2026-09-11.json),
produced by the command below; the instrument is pinned by
[`tests/pdf-item-boundaries-eval.test.ts`](../../tests/pdf-item-boundaries-eval.test.ts). No
`src/` behaviour changed: `defusedFolios` and `folioOf` in `src/pdf-score.ts` are exported so the
harness can compare against them, and that is all.

This is cluster N of
[260908f](260908f-prioritised-spideryarn-codebase-improvements.md#n--preserve-pdf-evidence-before-improving-the-heuristic),
dispatched by the Overseer after:

> deprioritise further Overseer/web dashboard stuff to the very bottom priority, and now push up the
> priority of all the Spideryarn product stuff. Keep within 5h usage limits.
>
> — Greg, 2026-09-10

## The question

`pass0` (`src/pdf.ts`) joins pdf.js text items with nothing between them unless pdf.js set
`hasEOL`. On Kuhn's *A Landscape of Consciousness* that welds the page number to the heading after it —
`649.5.10.` — and a model that correctly writes `9.5.10.` is scored as having invented it.
`folioOffset` (`src/pdf-score.ts`) repairs this by electing one page offset for the whole document
by vote and stripping exactly that number. The
[postmortem](../postmortems/260904c-a-document-refused-for-an-answer-it-never-had-to-give.md) called
the upstream fix — keep the item boundary — "the right long-term answer", untested.

The stage asked: build a free corpus comparison; keep page text unchanged; carry the minimum
boundary metadata; compare heading evidence and refusal reasons old against new; score a second
path only inside the experiment; adopt only if the corpus shows an improvement without weakening
the fidelity checks.

## What pdf.js actually does at the fused folio

Probed on file page 37: the running header, an empty end-of-line item, then `64` at **y = 31.6**
(the foot of the page), then `9.5.10.` at **y = 732.9** (the top), with no end-of-line between
them. The folio is a footer the content stream happens to emit before the body. So the boundary is
not ambiguous: the next item is 88 font sizes away. That is what the experiment keys on — no vote,
no document-wide agreement, only the two items' own positions.

## The experiment

```
npx tsx --env-file=.env.local evals/pdf/item-boundaries/compare.mts --db \
  --local <Kuhn full PDF> --local <Nagel PDF> --out evals/pdf/item-boundaries/results-2026-09-11.json
```

- [`boundaries.mts`](../../evals/pdf/item-boundaries/boundaries.mts) restates pass0's loop and
  classifies every *fused* join (no whitespace, no end-of-line) as `touching`, `gap`, `shift`
  (|Δy| > 0.15 font sizes: super/subscripts) or `line-break` (|Δy| > 0.7). The second reading adds a
  newline at `line-break` joins and changes nothing else. **It never inserts a space.**
- [`compare.mts`](../../evals/pdf/item-boundaries/compare.mts) runs both readings through the
  **unchanged** `check`, on every transcription already bought: the committed title-fixture records,
  and the `pdf-chunk` checkpoints in the local database matched by raw-file hash. Then it corrupts
  each numbered heading in each reading (`12.3.` → `2.3.`, `9.5.10.` → `5.10.`) and asks which reading
  still reports it — the "what does this now let through?" question the postmortem says a widened
  rule must be asked.
- A **negative control** arm splits at *every* fused join — the rule the stage forbids — so that
  "no verdict changed" is shown to be a result the comparison could have failed to produce.
- The harness refuses to report a document where its page text differs from pass0's on any page, and
  the test checks that against pass0 itself on the `easy` fixture.

Corpus: the 13 committed `source.pdf`s, plus two local files that may not be committed — Kuhn's full
142 pages (the committed cut is 3 pages, NC-ND) and Nagel's "What Is It Like to Be a Bat?" (genuine
page numbers on their own lines). **228 pages, 206 real transcriptions.** A third local set — the
144-page LLM survey, with 32 transcriptions — was not included: its PDF exists only in a reader's
storage, and the auto-mode classifier refused copying it out. That refusal was right and is not
worked around.

## Results

| Measure | Old (pass0 + `folioOffset`) | New (split at line breaks) |
|---|---:|---:|
| Instrument matches pass0's text | 228 of 228 pages | — |
| Fused joins: `touching` / `gap` / `shift` / `line-break` | 15,846 / 0 / 185 / 150 | same joins |
| Largest `shift`; nearest `line-break` (font sizes) | 0.45; 1.86 | nothing between 0.5 and 1.0 |
| Kuhn headings recovered | 11 (by vote) | 11 (by position): 0 old-only, 0 new-only |
| What `folioOffset` still adds under the split | — | 0 entries on any page |
| Transcriptions failing the gate | 34 of 206 | 34 of 206 |
| Verdicts changed | — | **0** |
| Failure reasons changed | — | **2, both withdrawn, none added** |
| Corrupted headings caught (Kuhn, lattice) | 425 of 435 | 425 of 435, the same 425 |
| Control arm (split everywhere): verdicts / failure lists changed | — | 15 / 26 |
| Pages whose text changes; furniture set changes | — | 150; 0 |

What each line means:

- **The threshold is not tuned, it is a gap.** 179 of 185 shifts sit at 0.3–0.5 font sizes; the two
  smallest line breaks are 1.86 (ACL's small print); the other 148 are over 2. Nothing lands between.
  `gap` is zero everywhere: pdf.js already emits a space wherever the page shows one, which is why
  inserting spaces would only ever break words.
- **The 150 line breaks:** Kuhn full, one per page — every one the folio; Kuhn cut 3; ACL 3; arXiv
  ARNN 2. Nagel's page numbers already carry `hasEOL`, so it has none.
- **Heading evidence is identical**, and it includes all eight cases `tests/pdf-score.test.ts` pins
  (plus `2`, `11.10`, `12` on pages 4, 67 and 70). Under the split, `folioOffset` recovers nothing
  that is not already a token, so for this corpus it is dead weight.
- **The two withdrawn reasons are the improvement, and they are a class `folioOffset` cannot
  reach.** Kuhn page 1 prints the licence URL `http://creativecommons.org/licenses/by-nc-nd/4.0/).`,
  and the text layer welds it to the first word of the next line, 42 font sizes lower. Two of the six
  committed readings transcribed the URL exactly and were told it is *"on none of these pages"*.
  `folioOffset` only ever strips a number off a heading; a URL is out of its reach, and so is every
  other token that happens to end a line pdf.js did not close. Both readings still fail, for reasons
  that are not this, so no verdict flips.
- **Nothing is let through.** The corrupted-heading arm catches the same 425 in both readings; the 10
  missed by both are single-digit truncations (`3`, `1`, `2`) that match other numbers on the same page
  — an existing blind spot of `protect`, unchanged.
- **The comparison can see a difference**: the control arm moves 15 verdicts.

Two limits to state plainly. Requested pages are inferred from the pages each reading's records
claim, not from the chunk plan that bought it — identical for both arms, so it cannot manufacture a
difference, but a context page a model echoed is scored as requested. And the corpus holds **no**
document where `folioOffset` fails to elect — fewer than three pages, folios that restart, roman front
matter — so the split's value there is a hypothesis this corpus cannot test.

## Decision

The stage's rule was *adopt only if the corpus demonstrates an improvement without weakening the
fidelity checks*. It does, narrowly: one false-fault class withdrawn that the current repair cannot
reach, the heading evidence reproduced without a vote, no verdict and no corrupted heading lost. Each
false `invented` fault is a paid re-read (`src/pdf-read.ts`, the attempt loop around `checkChunk`), so
the gain is money and a refusal a reader might have seen, not just tidiness.

**Adopt in the scoring-only form**, because the experiment shows what the text change costs everywhere
else: 150 of 228 pages' text would change, and page text feeds chunk planning (word counts, so chunk
keys and paid re-reads), seam repair, the title ladder and furniture. None of those needs the split.
The implementation plan keeps `PageText.text` byte-for-byte, carries the break positions beside it,
and lets only `check` read the split view — so there is no extraction version, no cache invalidation,
no old artefact to touch and no block-id consequence.

**Not built here.** Removing `folioOffset` is in that plan, conditional on its proven cases passing
through the new path first — which this experiment shows they do on Kuhn.

### Passed over

- **No change, record the evidence.** Legitimate, and nearly the answer: zero verdicts move. It loses
  to adoption only because the scoring-only form costs almost nothing downstream and deletes a
  vote-based inference in exchange for a positional fact.
- **Change `pass0`'s text itself.** Simplest to write, and the most expensive: every consumer of page
  text shifts, and the chunk plan with it.
- **Widen `folioOffset` to URLs.** A second inference for a second shape of the same lost fact.
