# Score PDF pages at the line breaks pdf.js did not mark

Status as of 2026-09-11: **blocked by evidence review; do not build the generic 0.7 + fused-only rule.**
The corpus run is in
[260911b-pdf-item-boundaries-evidence.md](260911b-pdf-item-boundaries-evidence.md), but a synthetic
stacked-number case shows that the proposed split can forgive a numeric omission the current scorer
catches. This plan remains the architectural sketch for a narrower predicate, if one is proved.

## What changes, in one paragraph

The proposed architecture has `pass0` keep producing `PageText.text` exactly as it does today, while
additionally recording where on
the page pdf.js joined two items across a real line change without marking it (`breaks`: offsets
into `text`). `check` in `src/pdf-score.ts` — and only `check` — reads the page with a newline
inserted at those offsets. That makes the fused folio and the fused licence URL two tokens instead of
one, so a correct transcription stops being scored as inventing them. `folioOffset`,
`defusedFolios`, `folioOf`, `FOLIO_AGREEMENT` and the `folioOffsets` cache are then deleted, once
their eight proven cases pass through the new path.

## Why only the scorer reads it

The experiment split page text for everything and measured the blast radius: 150 of 228 pages'
text changed. Page text feeds, besides the scorer:

| Reader | Where | What a text change would do |
|---|---|---|
| chunk planning (`page.words`) | `src/pdf-read.ts` § `planChunks` | +1 word per affected page can move a chunk boundary, which changes the chunk key, which re-buys a transcription |
| seam repair | `src/pdf-read.ts` § `brokeAfter`, `opensWith` (via `pageLines`) | different lines at a page's head and foot; could change which records are glued — so different blocks |
| trailing bibliography | `src/pdf-read.ts` § `bibliographyPages` (via `baselineFor`) | line-length and year-density ratios shift |
| page-presence floor | `src/pdf-integrity.ts` (via `baselineFor`) | word counts shift |
| title ladder, furniture, `isScan` | `src/pdf-read.ts` § title, `src/pdf.ts` § `repeatedLines` | furniture was unchanged on the corpus; the rest untested |
| words-of for the front-matter comparison | `src/pdf-read.ts` § `wordsOf` | token set shifts |

None of them has a known defect from the fused boundary. Under this architecture none of them moves:
the change is one reader deep. The experiment represented that scorer input by cloning the pass,
changing its page text and recomputing furniture; furniture was identical on this corpus. That is
adequate evidence for the containment claim, not for the split predicate's safety.

## The four questions the umbrella plan says this must answer

- **Extraction versions.** None needed for boundary metadata alone. `pass0` is recomputed inside each
  PDF extraction and `PageText.text` is unchanged, so the same selected readings produce the same
  extracted HTML. The scorer's verdict is not inert, however: it controls retry and which reading is
  checkpointed, so a newly accepted first attempt can change the transcript relative to what the old
  code would have obtained on a second call.
- **Cache invalidation.** None. The `pdf-chunk` checkpoint key is `rawSha256`, pages, context page,
  prompt fingerprint, reader and `MAX_TOKENS` (`src/pdf-read.ts` § `chunkKey`); none of those
  changes. Cached readings are re-scored on the next extract as they are today, and a reading that was
  failed only for a fused token can pass instead of buying a re-read. That is the intended operational
  effect, but only after the narrower predicate is shown not to forgive real faults.
- **Old artefacts.** No backfill, no re-extraction. A published article keeps its blocks. An article
  with a false quality fault changes only if it is re-extracted; content-score failures are published
  after the bounded retry today, while structural failures alone refuse the stage.
- **Block-id carry-forward.** No new consequence. Blocks come from transcribed records, which this
  does not touch; a re-extraction reuses cached readings and mints/carries ids through the existing
  machinery ([block-ids.md](../project/block-ids.md)) exactly as now. `src/pdf-read.ts` checkpoints
  only a normal reading that passes; a failed first attempt is not available for a later extraction
  to newly accept. On a new extraction without a usable checkpoint, accepting attempt one instead of
  asking for attempt two can select different model text, but the ordinary block-ID carry-forward
  path already handles changed extracted HTML.

## Stages

Do not start these stages until stage 0 is resolved. Each later stage is its own commit; Sol reviews
the code of stage 2 and stage 3 together.

0. **Prove a narrower predicate.** It must retain the observed Kuhn folio/heading and licence-URL
   fixes while rejecting a fused numeric token whose items are vertically stacked. Add adversarial
   RTL, rotated-page and display-maths item runs where pdf.js supplies realistic transforms, then
   rerun the full corpus with the mutation-confound guard. If no simple predicate survives, stop and
   keep `folioOffset`; scoring-only containment is not a reason to weaken fidelity.

1. **The metadata, with no reader.** In `pass0`'s item loop, keep the previous upright, non-empty item
   and apply the narrower predicate proved in stage 0 when the next item joins it with no whitespace
   and no end-of-line. Move that predicate into `src/pdf.ts` and import it *from* the harness, so there
   is one copy. Offsets are into `text` after the whitespace collapse and trim, so they are built while
   collapsing, not afterwards. `PageText.breaks?: number[]`, optional for the reason `sideways` is:
   hand-built fixtures. Red test first: pass0 on the committed Kuhn cut returns the three retained
   breaks, the stacked-number case returns none, and inserting a newline at each reproduces the
   harness's selected split text byte for byte.
2. **The scorer reads it.** One function in `src/pdf.ts` — `scoringLines(pass, page)` — returns
   `baselineFor`'s lines computed over the split view; `check` and `scorePage`'s `onPage` use it and
   nothing else does. Red test first: the committed Kuhn-cut reading `records-5837a306a4da-1.json` is
   told the licence URL is invented today and is not after. Keep `folioOffset` in place during this
   stage; the full harness run must show 0 verdicts changed and 0 corrupted headings lost against the
   2026-09-11 results.
3. **Delete `folioOffset`.** Convert the eight `FUSED` cases in `tests/pdf-score.test.ts` from a
   142-page vote to a page with a `breaks` entry, and keep `12.3. → 2.3.`, `43–79`, and "strips the
   folio of the page it is scoring" as adversarial cases against the new path. Then delete the
   mechanism and its comments; rewrite the `defusedFolios` paragraph of the postmortem's "Still open"
   as closed. Re-run the harness: heading evidence is now "new only" by construction, so the
   comparison becomes "11 headings recovered, 0 corrupted headings lost" against the saved results.
   Also retire the harness's `folioOf` import — it goes with the export added on 2026-09-11.

## What would stop it

- Stage 2's harness run shows a verdict moving towards *fail*, or any corrupted heading lost.
- The stacked-number case remains newly accepted. This stop condition has already fired for the 0.7
  + fused-only predicate.
- A pdf.js upgrade moves the shift/line-break gap (the harness prints it; the 0.45 / 1.86 margin is
  the thing to watch).
- A document where a genuine line break sits inside a token the model is told to join — a URL broken
  across a line without a hyphen. The split makes that token two, and `protectedOf` already joins
  adjacent tokens back into the haystack, so it should still match; stage 2 adds that case as a test
  rather than assuming it.

## Passed over

- **Split `PageText.text` itself.** Measured as the expensive option above.
- **Keep `folioOffset` as a fallback.** Two mechanisms for one fact; the experiment found nothing the
  vote catches that the position does not. Revisit only if a real document produces an `old-only`
  heading in the harness.
- **A per-item boundary array on `TextItem` instead of offsets.** More data, and every reader would
  have to re-derive the same rule; the offsets are the rule's answer.
