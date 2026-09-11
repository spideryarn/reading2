# Score PDF pages at the line breaks pdf.js did not mark

Status as of 2026-09-11: **written, not built, not yet reviewed by GPT Sol as a plan.** The evidence
that justifies it is [260911b-pdf-item-boundaries-evidence.md](260911b-pdf-item-boundaries-evidence.md);
read its Results table first. Nothing here is urgent — no verdict changed on the corpus — so it waits
for Greg to schedule it.

## What changes, in one paragraph

`pass0` keeps producing `PageText.text` exactly as it does today, and additionally records where on
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

None of them has a known defect from the fused boundary. So none of them moves: the change is one
reader deep, and the experiment's second arm — which split the text for `check` and left everything
else to recompute — is what was measured. (The experiment also recomputed furniture from the split
text; it came out identical on every document, so scoring over pass0's own furniture is the same
thing on this corpus. Step 3 re-checks that.)

## The four questions the umbrella plan says this must answer

- **Extraction versions.** None needed. `pass0` is not persisted anywhere — every extract recomputes
  it — and `text` is unchanged, so every artefact downstream of it is byte-identical for the same
  readings. Only `check`'s verdict can move, and on the corpus it moves only by withdrawing false
  `invented` faults.
- **Cache invalidation.** None. The `pdf-chunk` checkpoint key is `rawSha256`, pages, context page,
  prompt fingerprint, reader and `MAX_TOKENS` (`src/pdf-read.ts` § `chunkKey`); none of those
  changes. Cached readings are re-scored on the next extract as they are today, and a reading that was
  refused only for a fused token now passes instead of buying a re-read.
- **Old artefacts.** No backfill, no re-extraction. A published article keeps its blocks. An article
  that was refused for this reason can succeed on the reader's next Retry, which is the ordinary path.
- **Block-id carry-forward.** No new consequence. Blocks come from transcribed records, which this
  does not touch; a re-extraction reuses cached readings and mints/carries ids through the existing
  machinery ([block-ids.md](../project/block-ids.md)) exactly as now. The one case to watch: a chunk
  that *used* to fail and was re-read on its second attempt could, on a future re-extraction, accept
  its first cached reading instead — but the second-attempt reading is the one checkpointed, so the
  cached reading that is found is the same one. Step 2 confirms that against `src/pdf-read.ts`'s
  attempt loop before relying on it.

## Stages

Each is its own commit; Sol reviews the code of stage 2 and stage 3 together.

1. **The metadata, with no reader.** In `pass0`'s item loop, keep the previous upright, non-empty item
   and, when the next item joins it with no whitespace and no end-of-line, record a break if
   `|Δy| > 0.7 × max(font size)` — the rule and constant in
   `evals/pdf/item-boundaries/boundaries.mts`, moved into `src/pdf.ts` and imported *by* the harness,
   so there is one copy. Offsets are into `text` after the whitespace collapse and trim, so they are
   built while collapsing, not afterwards. `PageText.breaks?: number[]`, optional for the reason
   `sideways` is: hand-built fixtures. Red test first: pass0 on the committed Kuhn cut returns three
   breaks, ACL three, ARNN two, `easy` none, and inserting a newline at each reproduces the harness's
   split text byte for byte.
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
