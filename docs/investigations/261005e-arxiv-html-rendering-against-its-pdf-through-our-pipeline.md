# arXiv's HTML rendering against its PDF, through our pipeline

Run 2026-10-05, for report `spya-ayettj` and plan
[261005l](../plans/261005l-an-arxiv-link-of-any-shape-imports-the-paper-and-a-source-resolver-other-sources-can-join.md).

> run evals to figure out whether html or pdf is better. Then even if someone gives us a link like
> this, automatically download the actual paper (either html or pdf as you decide).
>
> — Greg, 2026-10-05

## The answer

**Prefer arXiv's HTML, and fall back to the PDF when arXiv has no HTML for the paper.** The HTML
path is free and takes seconds where the PDF path costs about ten cents and two minutes, and on
four of the five papers judged it was also the more correct article: real tables with their header
rows, real figure images, the full reference list, and maths taken from the author's own TeX.

**But the HTML path is only the better one after four fixes to our own web extractor**, which the
eval found and the plan builds. Without them it loses content a reader would miss: aligned
equations arrive in fragments, plots embedded as SVG objects arrive as captions with no picture,
code listings arrive one line per paragraph, and small tables inside list items vanish.

One loss is arXiv's and not ours to fix: its converter sometimes drops a figure (one of the 18
figures in the five papers). Nothing in the HTML says so.

## What was asked

arXiv serves a paper as an abstract page, a PDF, and, when its converter (LaTeXML) can handle the
TeX source, an HTML rendering at `arxiv.org/html/<id>`. We already have an extractor for each
format ([content-extraction.md § Two extractors, one artefact](../project/content-extraction.md#two-extractors-one-artefact)):
a web page goes through Readability, with no model; a PDF is read by a model page by page. Which
gives the reader the more correct article, and what does each cost?

## What was run

`evals/arxiv-html-vs-pdf/run.ts` fetches both addresses through `fetchDocument` (stage 1's own
fetcher), runs each through the extractor stage 2 would use (`runExtract`, `runPdfExtract`), splits
both into blocks with stage 3's `splitIntoBlocks`, and counts what came out. Both arms are also
compared word for word with the PDF's free text layer, which neither arm produced. The numbers are
in [`evals/results/arxiv-html-vs-pdf-261005/results.json`](../../evals/results/arxiv-html-vs-pdf-261005/results.json);
the extracted pages are in `output/arxiv-eval/` (gitignored: the papers' prose, regenerable with
the command below).

```
npx tsx evals/arxiv-html-vs-pdf/run.ts 2608.13566 2605.20355v1 2610.01658v1 2610.03261v1 2610.01988v1 2609.28681v1
```

Six papers, chosen for what they stress:

| Paper | Why it is here | Pages |
|---|---|---|
| `2608.13566` | the link in Greg's report; seven tables, code listings | 22 |
| `2605.20355v1` | already on Greg's shelf; aligned equations, an algorithm, a 14 MB PDF | 9 |
| `2610.01658v1` | maths-heavy (probability: about 1,000 formulas, theorems and proofs) | 27 |
| `2610.03261v1` | figure-heavy (seven figures, 107 panel images) | 21 |
| `2610.01988v1` | table-heavy physics (six tables, SVG plots, Feynman diagrams) | 16 |
| `2609.28681v1` | no HTML version: arXiv answers 404 | 51 |

Then each paper's two arms were judged against the paper itself by a Sonnet subagent with a fixed
rubric (six sampled paragraphs, up to twelve displayed equations, every figure, every table with
cells compared, sampled reference entries). The judges read the PDF's text layer, not its page
images, so none of them looked at a picture. I checked each surprising claim against the files
before recording it here.

**How often is there no HTML?** A probe of 36 recent papers across `econ.GN`, `q-bio.NC` and
`cs.CY` found 4 with none (about one in nine). Old papers have it too: `1706.03762` and
`hep-th/9901001` both answer 200.

## Cost and time

Measured 2026-10-05 on the box. Cost is the spend ledger's figure for the extraction step alone;
everything after extraction (structure, labels, the modes) costs about the same for either arm.

| Paper | HTML: fetch + extract | HTML cost | PDF: fetch + extract | PDF cost |
|---|---|---|---|---|
| `2608.13566` | 0.1 s + 10 s | $0 | 0.2 s + 92 s | $0.088 |
| `2605.20355v1` | 0.1 s + 3 s | $0 | 7.3 s + 136 s | $0.088 |
| `2610.01658v1` | 0.1 s + 41 s | $0 | 0.1 s + 153 s | $0.127 |
| `2610.03261v1` | 0.1 s + 13 s | $0 | 0.1 s + 164 s | $0.089 |
| `2610.01988v1` | 0.1 s + 16 s | $0 | 0.1 s + 144 s | $0.133 |
| `2609.28681v1` | no HTML (404 in 0.07 s) | | 0.1 s + 97 s | $0.093 |

The HTML arm's 41 seconds on the maths paper is our own check that each of its thousand formulas
will draw. **The eval spent $0.62**, all of it on the six PDF arms.

## Correctness, paper by paper

Scores are the judges', 0 to 5. "n/a" is a dimension the paper does not have.

| Paper | Arm | Text | Maths | Figures | Tables | References | Structure | Judge would read |
|---|---|---|---|---|---|---|---|---|
| `2608.13566` | HTML | 4 | 5 | 5 | 5 | 4 | 2 | **HTML** |
| | PDF | 4 | 4 | 4 | 3 | 3 | 3 | |
| `2605.20355v1` | HTML | 4 | 3 | 3 | n/a | 4 | 3 | |
| | PDF | 4 | 4 | 5 | n/a | 4 | 4 | **PDF** |
| `2610.01658v1` | HTML | 4 | 4 | n/a | (lost) | 5 | 3 | **HTML** |
| | PDF | 4 | 3 | n/a | (flattened) | 1 | 3 | |
| `2610.03261v1` | HTML | 4 | 5 | 5 | 5 | 5 | 4 | **HTML** |
| | PDF | 5 | 4 | 3 | 3 | n/a | 3 | |
| `2610.01988v1` | *(judgement pending when this was first written; see below)* | | | | | | | |

**Text** is a draw. Every sampled paragraph was present, complete and in order in both arms of
every paper, with nothing invented. Against the PDF's text layer the HTML arm held 89–96% of the
words and the PDF arm 75–91% (the PDF arm does not print the reference list, which is most of the
gap).

**Maths.** The HTML arm copies the author's TeX, so its symbols are right: on the maths paper every
inline expression checked was correct, where the PDF arm wrote `⟦n⟧` as `JnK` in 74 places and
turned a superscript into a subscript. The HTML arm's fault is layout, and it is ours: see fix 1.

**Tables.** The HTML arm's tables are the author's, with header rows and full-precision cells. The
PDF arm dropped the column headers of the two main results tables in Greg's paper, put several
tables in the wrong section, and wrote one table as a single cell per row.

**Figures.** The HTML arm has real `<img>` elements at absolute `arxiv.org` addresses, multi-panel
figures kept together (107 images in seven figures). The PDF arm has a caption and a marker for a
later stage to fill from the PDF ([article-images.md](../project/article-images.md)); that stage
was not run here, so how many pictures it would recover for these papers is not measured.

**References.** The HTML arm prints every entry (33, 36, 6, 35 and 68), and the sampled ones match
the paper. The PDF arm prints the heading only, by design: Citations reads them another way.

## What the HTML arm gets wrong, and whose fault it is

**Ours, and built in the plan** (each seen in the files, not only reported by a judge):

1. **Aligned and multi-line equations arrive in fragments.** LaTeXML lays a numbered multi-line
   equation out as a table (`table.ltx_equationgroup`), one inline formula per cell. Each cell
   becomes its own inline span and the number lands in the middle: equation (1) of
   `2605.20355v1` reads `π_shared ≜ α π_expert (1) + (1−α) π_student`. Single-line equations are
   fine: they are already one display formula.
2. **A plot embedded as `<object type="image/svg+xml" data="…svg">` loses its picture.** Five of the
   six figures in `2610.01988v1`: the caption survives over nothing.
3. **A code listing arrives one line per paragraph.** Appendix F of `2608.13566` is sixty one-line
   blocks. The PDF arm has them as code blocks.
4. **A small table inside a list item is deleted.** The four summary tables in the introduction of
   `2610.01658v1` are in arXiv's HTML and absent from our article: Readability's clean-up removes
   them. Tables inside a `<figure>` survive.

**Ours, cosmetic, not built here:** the author block arrives as one long paragraph of names and
affiliations; theorem and proof labels become one-word headings; each reference entry carries
arXiv's "Cited by: §…" back-link text; a boxed passage drawn as SVG (`tcolorbox`) loses its 58
words in `2608.13566`.

**arXiv's:** Figure 1 of `2605.20355v1` is not in arXiv's HTML at all (its figures are numbered
2, 3, 4). Nothing marks the gap.

## What the PDF arm gets wrong

Not fixed here; recorded because the comparison turned them up. Table header rows dropped and
tables misplaced; sentences split around a figure; proofs fused with their statements and
proposition statements swallowed into headings; a notation misread throughout one paper
(`⟦n⟧` as `JnK`); steps missing from an algorithm; a stray empty figure.

## What was decided

- **HTML first, PDF when there is no HTML** — built in plan 261005l, with the four extractor fixes.
- **No completeness cross-check against the PDF yet.** Fetching the PDF as well and comparing its
  figure count or word count with the HTML would catch the arXiv-dropped figure. It would cost a
  second download and a PDF parse on every arXiv import to catch one figure in 18, and what to do
  on a mismatch (pay for the PDF read and lose the better tables?) has no clear answer. Named, not
  built.

## What was ruled out

- **ar5iv** (`ar5iv.labs.arxiv.org`) as a third source for papers with no arXiv HTML. It is a
  separate service and the brief for this work allows no new one.
- **The abstract page's own PDF link** (`citation_pdf_url`) as the way to find the paper. It needs
  the abstract page fetched first, and the address is derivable from the id.
