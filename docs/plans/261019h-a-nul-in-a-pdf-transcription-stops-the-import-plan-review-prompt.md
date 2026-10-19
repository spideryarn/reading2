Review the plan in docs/plans/261019h-a-nul-in-a-pdf-transcription-stops-the-import.md (repo at the current directory). Read-only: do not edit files.

Context: a production PDF import failed with Postgres 22021 when writing article_revisions.extracted_html; an earlier checkpoint write for the same chunks failed with 22P05 and was swallowed by keepChunk (src/pdf-read.ts). The plan strips C0 controls (except \t \n \r) at two entry seams: parseRecords' NOISE (src/pdf-read.ts ~line 1440) and a new itemText helper used by pass0/firstPagesText/frontPagesWithStamps in src/pdf.ts.

Please check, against the code:
1. Is there any other path by which foreign text (model output or pdf.js text, PDF metadata) reaches a Postgres text/jsonb column during the extract step of a PDF (src/pipeline.ts STEPS.extract, src/pdf-read.ts runPdfExtract, the front-matter/authors passes, titleTidier, paper metadata/Crossref, quality notes in src/pdf-score.ts) that this plan leaves open to a NUL?
2. Will stripping these characters from pdf.js text change scoring in a way that could flip a page from pass to fail (src/pdf-score.ts tokenisation), or break page/item geometry anywhere items are used?
3. Is the cached-chunk path (validateChunkReading) reasoning correct?
4. Is keeping the failure kind as `bug` right?
5. Anything simpler or better.

Give findings first, numbered, each with severity (high/medium/low) and file:line evidence, then a one-line verdict: APPROVE, APPROVE WITH CHANGES, or REJECT.
