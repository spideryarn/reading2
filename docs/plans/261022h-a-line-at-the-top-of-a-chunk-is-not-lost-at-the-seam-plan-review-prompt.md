# Plan review: a line at the top of a chunk is not lost at the seam

You are reviewing a plan, read-only, before it is built. Repo: Spideryarn (TypeScript, ESM).

Read:
- docs/plans/261022h-a-line-at-the-top-of-a-chunk-is-not-lost-at-the-seam.md (the plan)
- src/pdf-score.ts — `check`, `scorePage`, `alignedMask`, `spansOf`, `contentFailures`, `thinPages`, `MIN_SPAN`, `LOST_WORDS`
- src/pdf-read.ts — `instructionFor`, `planChunks`, `withoutRepeats`, `checkChunk`, `checkEmitted`, the check-retry loop in `runPdfExtract` (around "One retry of a chunk that fails its check"), `continuationTargets`, `reaches`, `ENDS_A_SENTENCE`
- src/pdf.ts — `baselineFor`, `pageLines`, `Pass0`
- docs/project/content-extraction.md § the seam paragraphs ("A paragraph cut by a figure…", "A word broken by a page break…")

Evidence the plan rests on (scratch, in data/fbrg5kk6-prod-read/, uncommitted): the real PDF;
`chunk-run{1,2,3}.json` (the 42|43–48 chunk read three times: the line is always emitted);
`all-*.json` (every chunk of five PDFs read with the production model); `scenarios.mts` (the gate
passes both the "omitted" and "labelled page 42" shapes); `replay.mts` (the real stage over saved
readings).

Questions:
1. Is the diagnosis right? Is there a code path between the model and the stored block, other than
   the two shapes named, that could have dropped the line, and that this fix would miss?
2. Is the rule right: conditions 1–3, "at least one lost word", and using the whole chunk's
   alignment (the `overall` score) versus page 43's own records? Construct inputs where it fires
   falsely (costing a second call and a quality note) or misses the target.
3. Interactions: phase 2 (`checkEmitted` on the published, deduped records), the structural /
   recovery path, a scan (no text layer), a context page whose text layer ends in a footnote or a
   folio, two-column pages, a chunk whose first page is blank or a figure.
4. Is the option passed over (prompt change; filling from the text layer; relabelling
   context-labelled records) the right call?

Write findings as a numbered list, each with severity (high / medium / low), the concrete input
that breaks it, and the change you'd make. End with a one-line verdict: BUILD AS IS, BUILD WITH
CHANGES, or RETHINK.
