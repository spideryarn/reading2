# A PDF table's cell separator, named in the prompt: measured

The measurement behind Stage 2 of
[261020h](../plans/261020h-pdf-table-cells-split-on-tabs-and-the-prompt-names-the-separator.md),
2026-10-20: does rule 7 asking for **one tab between cells** (prompt `pdf-v5`) make the transcriber's
tables parse, and does it cost anything elsewhere on the page?

## Method

Production's own reader — `openRouterReader()` (`openai/gpt-6-luna`), `instructionFor`, and
`openPdfCuts(...).cut` on the chunk's pages plus its context page — on seven table-bearing chunks
from six production PDFs (bytes read from production's bucket, read only):

| case | PDF, pages | why |
|---|---|---|
| sentience-t2, sentience-t5 | the report's own PDF, pp 22–25 and 80–82 | production stored these tab-separated |
| entropy | Levin et al., *Entropy* 26, pp 11–13 | production stored it tab-separated |
| conscious-artifact | arXiv 2105.10461, pp 2–4 | production stored it space-separated |
| ai-econ | an economics paper, pp 37–38 | space-separated, two tables with spanning headers |
| arxiv-s3 | arXiv 2512…, pp 21–23 | 105 rows, space-separated in production |
| tcr | a temporal-context paper, pp 3–5 | a control: production stored it with bars |

Old prompt twice (`before1`, `before2`, fingerprint `4036738814c9`), new prompt twice (`after1`,
`after2`, `dfe78cf909e1`), each arm run in its own process and never overwritten. 28 calls.

Ground truth: every table on those pages written out cell by cell by a Sonnet subagent from the page
images and the pdf.js text layer, with the blank corner as an empty cell and a spanning header as one
cell. Each reading was rendered with this tree's `renderHtml`, and its rows compared with the truth's
(cells NFKC-normalised, whitespace collapsed). For the old prompt the old parser's view, bars only,
is also shown: that is what production drew. The scripts (`sepeval.ts`, `sepscore.ts`) stayed in the
session's scratch directory with the PDFs they need.

## Results

Rows rendered exactly as printed, of the truth's rows. "One cell" counts rows drawn as a single cell
where the table has several columns.

| case (rows) | before1, old parser | before2, old parser | before1 / before2, new parser | after1 | after2 |
|---|---|---|---|---|---|
| sentience-t2 (5) | 4 | 4 | 4 / 4 | **5** | **5** |
| sentience-t5 (11) | 10 | 10 | 10 / 10 | **11** | **11** |
| entropy (15) | **0, 15 one-cell** | 14 | 14 / 14 | 14 | 13 |
| conscious-artifact (14) | 14 | **0, 14 one-cell** | 14 / **0, 14 one-cell** | 14 | 14 |
| ai-econ (16) | **0, 16 one-cell** | **0, 16 one-cell** | 9 / 9 | 9 | 9 |
| arxiv-s3 (105) | 105 | 105 | 105 / 105 | 105 | 105 |
| tcr (5) | 3 | 3 | 3 / 3 | **5** | **5** |

- **The old prompt's separator is a coin toss per call.** Of its 14 readings, 9 used bars, 4 tabs and
  1 runs of spaces — and the same chunk came back with bars in one run and spaces in the next
  (conscious-artifact). The old parser drew a column of one-cell rows on 4 of the 14.
- **The new prompt used tabs in all 14 readings**, with no collapsed row anywhere, and wrote the
  blank corner over the row labels each time: the sentience grids go from 4/5 and 10/11 to every row.
- **The rows still short of exact are spelling, not structure.** ai-econ's labels are TeX in every
  arm (`\(r_t - \delta\)` against the printed 𝑟𝑡 − 𝛿) and its spanning headers come out padded with
  empty cells — aligned, which is better than the truth's convention. entropy's misses are a
  superscript footnote marker (`Hologram 44`, `⁴⁴ Hologram`). tcr's old misses were `behavior /
  causal` for a line-wrapped `behavior causal`, which the new prompt's "a cell whose text wraps is
  one cell, its lines joined by a space" corrected.
- **Prose did not move.** Characters of non-table records per chunk were within 1% between arms on
  six of seven cases. The seventh, tcr `after2`, has 40% more — it is the one reading of the four
  that transcribed all of page 5, where the other three, old prompt included, dropped most of it.
  That is the existing completeness problem the check exists for, not this change.
- Tokens per call were unchanged (input +1%, output within run-to-run spread).

## Decided

Ship `pdf-v5`: rule 7 names a tab, and `tableRows` splits on tabs when a line has one and on `|`
otherwise, for chunks read before. The cost is the fingerprint: a re-extraction of an existing PDF
re-reads every chunk rather than replaying its cache.
