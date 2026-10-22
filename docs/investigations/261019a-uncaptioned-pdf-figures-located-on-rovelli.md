# Uncaptioned PDF figures, located by their neighbours, on Rovelli's *The Order of Time*

The measurement behind [261019j](../plans/261019j-uncaptioned-pdf-figures-located-by-their-neighbours.md),
2026-10-19: does asking the figure locator by the prose either side of an uncaptioned figure
recover the right pictures, and does it fit the step's 180 s clock?

## Method

The book as production read it, without production writes: the PDF and the article's 33 stored
`pdf-chunk` transcriptions were read from production (read-only); the records were rendered with
this branch's `renderHtml` and split with `splitIntoBlocks`; then `collectPdfFigures` ran with
`pdfFigureCaptionsIn`, `pdfFigureNeighboursIn` and the **real** `openRouterFigureLocator`
(`google/gemini-3-flash-preview`), storing into memory. Every stored picture was written out and
compared by eye with a render of its page and the next (a Sonnet subagent, then the photographs
re-checked by hand).

Three chunks of the production transcription (pages 19–24, 85–90, 103–108) have no checkpoint
under any key, so their pages are not in this run, and running the whole pipeline locally would
have meant buying them. The run therefore covers **28 of the book's uncaptioned figures**, not all
of them; the 5 captioned figures it holds were all stored by the bitmap route before and after.
The scratch script is not in the repo: it needs the downloaded PDF and checkpoints beside it.

## Results

| run | code | uncaptioned recovered | calls | wall clock |
| --- | --- | --- | --- | --- |
| 0 | locator off (Stage A as shipped) | 0 / 28 | 0 | 4 s |
| 1 | located route, each window read and rendered afresh | 23 / 28 | 28 | **156 s** |
| 2 | + each page read and rendered once while windows overlap | 23 / 28 | 28 | 79 s |
| 3 | + the order veto ignores text set beside the picture | **25 / 28** | 28 | 76 s |

**Every recovered picture is the right one** — 25 of 25, none a neighbouring diagram, none a
duplicate. That includes both two-diagram pages (36, 37), the two figures sharing p56 and p57,
p56's second figure whose picture is printed at the top of p57, and p37's second figure whose
"before" text is a paragraph that ran round the figure.

**Run 1 nearly ran out of time.** 156 s of the 180 s budget, almost all of it re-reading and
re-rendering three-page windows that overlap by two pages. Caching each page while windows hold it
halved it (run 2); model calls are ~2 s each and now most of the time.

**Run 2's two refusals were the veto's fault.** p18 (Clausius) and p25 (Boltzmann's tomb) are
photographs set into the text with the paragraph wrapped round them. The model pointed at the right
picture and `judgeLocatedBox` chose it; `judgeNeighbourOrder` then refused it, because the "after"
passage starts on a line *beside* the photograph, which it read as above the photograph's bottom.
Text beside a picture says nothing about order, so the veto now uses an anchor only when its line
overlaps the picture left to right (run 3).

**The three still refused are the transcript's, and refused safely.** On p67–68 the transcript has
three uncaptioned records whose neighbours do not match the three pictures on the page (two stacked
at the top of p67, one at the top of p68). The model answered p68's picture for all three; three
markers choosing one picture keep none of it. That is the conflict rule doing its job, and the
three keep *"We couldn't recover this figure"*.

**One figure the run cannot see.** The top of p34 has a diagram the transcript gave no record to,
so there is no marker to recover. Nothing in this route can find a figure the transcript missed.

## Cost

28 calls a run for this book. The calls ran outside a metered job and are not in the local ledger;
260924e measured ~$0.002 a call for the same model and the same three-page window, so about six
cents for the book — against a transcription of the whole PDF that costs dollars.

## Decided

- Ship the located route for uncaptioned figures, with the order veto (narrowed as above) and the
  run-order check, from a separate allowance of 40 calls, asked after captioned figures.
- Keep the page cache: without it a book this size reaches the clock.
- Not done: an uncaptioned vector figure (the composite route needs a printed caption), and a figure
  the transcript never recorded.
