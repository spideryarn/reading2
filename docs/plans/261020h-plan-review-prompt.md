You are reviewing a plan, read-only, in the Spideryarn repo (this working tree). Do not edit files.

The plan: docs/plans/261020h-pdf-table-cells-split-on-tabs-and-the-prompt-names-the-separator.md

The code it changes: src/pdf-read.ts — `tableRows`, `tableHtml`, `renderHtml`'s tabledata loop, the SYSTEM prompt's rule 7, `PROMPT_VERSION`, `promptFingerprint`. Tests: tests/pdf-tables.test.ts. Related docs: docs/project/prompting-guide.md § Measuring a prompt change, docs/plans/261001q-pdf-tables-and-composite-figures.md.

Evidence the plan rests on (from production, read-only):
- 421 `tabledata` records across 9 PDF articles; 44 records in 4 articles separate cells with tabs and no `|` (and no record mixes tabs and pipes); 318 records in 2 articles separate cells with runs of spaces.
- On the reported article, Table 2's records are e.g. "Criterion 1\tCriterion 2\t…\tCriterion 8" then "Octopods (Octopoda)\tVH\tVH\tH\t…"; Table 1's are "Criterion 1 | … | Criterion 8" then "Octopods (Octopoda) | VH | …" (header one cell short).

Please answer:
1. Is each Stage 1 rule correct and narrow enough? Find inputs where it would make a table worse (e.g. tabs used inside a cell, a first row that is legitimately shorter, tables split across pages/records via continuation, `rows` accumulated across several records, tables with an uncertain flag). Is `tableHtml` the right place for the header padding given rows accumulate across records?
2. Does anything else read `tabledata` text or the rendered table cells (integrity scoring in src/pdf-score.ts / CHECKED, block splitting, block ids, skim/figure walks, crossrefs) such that changing the cell split changes ids, scores, or caches for existing articles?
3. Stage 2: is the proposed prompt sentence well placed, and are there risks (e.g. `|` appearing inside cell text, LaTeX with `|`, the model now emitting markdown separator rows `---|---`, which tableRows already skips?). Is bumping PROMPT_VERSION right given promptFingerprint already hashes the prompt? Is the measurement design adequate and is anything missing?
4. Anything the plan gets wrong or misses, and a simpler route if there is one.

Write your findings as a numbered list, each with severity (blocker / should-fix / nit), the file:line, and a concrete suggested change. End with a one-line verdict: APPROVE, APPROVE WITH CHANGES, or REWORK.
