# Front and back matter: can it be found without folding the article's own prose?

Up: [investigations.md](../project/investigations.md) · for
[261018a](../plans/261018a-front-and-back-matter-marked-at-import-and-folded-by-default.md) ·
area: [front-and-back-matter.md](../project/front-and-back-matter.md)

> it may be worth trying to create a little eval of articles that have stuff in various
> places/formats that we might want to default-collapse/de-emphasise/ignore.
>
> — Greg, 2026-10-17 (`spya-k7gm2b`)

## The answer

**Yes, on 52 articles in three sets, with nothing of the piece's own prose folded by any method in
the final code, and the union of a free label rule and one Haiku call finding most of the rest.**

| set | articles | union: prose folded | union: matter blocks found | label rule alone | model alone | today's rule (261007d) |
|---|---|---|---|---|---|---|
| development | 33 | **0** | 79% | 71% | 62% | 1% |
| held-out 1 | 10 | **0** | 96% | 85% | 94% | 4% |
| held-out 2 | 9 | **0** | 67% | 67% | 45% | 0% |

Matter here means front and back matter: the title block, authors and affiliations, the abstract,
keywords, the piece's own table of contents, publication details, acknowledgements, funding,
declarations, and the reference list. "Found" counts blocks, over three draws of the model; the
label rule is deterministic. A miss leaves the block showing, as today; a fold of prose hides the
author's words, which is the error the design is built to avoid. Cost: about **$0.0013 a
call**, median 5.5–5.8 s, 17 s at worst; no call failed in about 200.

The two methods find different things, which is why the product runs both: the model finds title
blocks, author lists and publication details that have no label (the reported article's are bare
paragraphs); the label rule finds reference lists and contents, which run past what the model is
shown.

## The corpus

Every article was imported on the local database from a public page by
`npm run ingest -- <url>`; nothing came from production. Each set was labelled before the code
was run on it.

- **Development (33):** arXiv HTML (the reported paper, 2308.08708; BERT; Attention; 2608.13566;
  2610.08790), arXiv PDF (1409, ViT), journal PDFs (MDPI *Entropy*, an NIH manuscript, *JCO*, a
  humanities journal), journal HTML (PLOS ONE ×2, PLOS Biology, PLOS Medicine, *Nature
  Communications*, *Scientific Reports*, *Frontiers*), bioRxiv, Wikipedia ×2, essays and blogs
  (Paul Graham ×4, Wolfram, Feynman's *Cargo Cult*), magazines (Noema, Asterisk), a long report
  (Claude's constitution), a book PDF, two classic or scanned PDFs (Nagel, a phrenology lecture).
- **Held-out 1 (10):** Clark & Chalmers (PDF), Astral Codex Ten, a Guardian long read, distill.pub,
  an ACL Anthology PDF, the Stanford Encyclopedia of Philosophy, NIST AI 100-1 (PDF), *Simulators*
  (via GreaterWrong), an NBER working paper, the JMLR Dropout paper.
- **Held-out 2 (9):** Karpathy's PhD thesis (PDF), Llama 2 (arXiv HTML), SimCLR (PMLR PDF), two
  technical blogs (Lilian Weng, colah), The Verge, a Cambridge Core open-access article, two
  personal essays.

Ten articles across the sets have nothing to fold, or only a one-line thanks; they are the
negatives. Sites that refused the fetch (eLife, PMC, PeerJ, MDPI HTML, PNAS, Springer, ACM, Cell)
are absent; that is a gap in the corpus, not a finding.

## How it was scored

**Gold labels** were written by Opus subagents from every block of each article, against
[the label guide](261018b-front-and-back-matter-eval/label-guide.md), which says what is matter and,
more importantly, what is not: appendices, glossaries, footnotes, a standfirst, a *Significance* or
*Key points* box, an executive summary, an essay's own opening. Boundaries were spot-checked by
hand (*Frontiers*, the reported paper). Three scoring rules, decided before the held-out runs:

- the masthead's echo (the title heading and the old `· ~N min read` line, already hidden by
  261007b) is subtracted from gold and from every method;
- a gold stretch of one block under 40 words (an essay's closing *"Thanks to…"*, a lone
  *References* heading whose entries the PDF reader dropped) is optional: folding it is not an
  error, missing it is not a miss. The product drops such a stretch too, since a stub would replace
  one line with one line;
- kinds are scored loosely: a block counts as found under any kind; agreement on kind is reported
  separately (99–100%).

**Planted instructions:** three development articles were run with an instruction to fold
everything planted in their opening. Nothing of their prose was folded.

## What each round found, and what changed

The order matters, because the held-out sets were run on code frozen beforehand, and what they
found was then fixed with a general rule and re-measured on all three.

1. **Development, first runs.** Each method folded prose at some point and each was fixed by a
   check, not a prompt: an appendix run on under *References* (the reference list now ends at its
   last reference); Wikipedia's explanatory notes between citations; footnotes holding author–year
   citations (footnotes are never folded); an abstract label followed by an unheaded introduction
   (an abstract is capped at 350 words; the longest gold abstract was 285); a *Publication history*
   section taken as furniture; a dateline plus an empty block on Paul Graham's essays.
2. **The union.** 80% → 82% of matter, no prose, once a labelled reference list may hold
   sub-headings whose entries all look like references.
3. **Held-out 1, on frozen code**: the label rule ran a *Contents* list on into an image and its
   19-word caption on *Simulators* (2 blocks, 19 words folded), and both methods missed NIST's
   contents. **Fixed** by what a contents entry is: a short line naming one of the article's own
   headings, or carrying a section or page number; the run ends at its last entry.
4. **Held-out 2, on frozen code**: no prose (one empty picture block), but only 50% found. The
   thesis lost its contents to the model's window (dot leaders) and to entry rules that did not
   know roman page numbers or LaTeX's list-of-figures lines. **Fixed**, 50% → 71%.
5. **The code review** (GPT Sol) built synthetic cases that folded prose through paths no corpus
   article happened to take: an abstract label explaining every unheaded paragraph after it up to
   350 words, the same for keywords, a DOI inside a prose paragraph as a dates line, broad
   *support* or *contribution* wording as office matter, any first heading as the title. Each was
   closed (an unstructured abstract is its label and one body block; a title must match exactly;
   office words without an office label need the strong forms). The cost was recall: development
   82% → 79%, held-out 2 71% → 67%, held-out 1 unchanged, still no prose. Its change to split a
   reference list at every single non-reference entry was **reverted**: it folded two figure
   notes on the NBER paper (184 words, under a *References* heading whose entries the reader had
   dropped) and broke the reported paper's bibliography into seven stubs. A lone paragraph inside
   a reference list still folds with it; that is accepted.

What is still missed, and left: Wikipedia's citation lists (stored as footnotes, beside real
notes); journal page chrome above the title (badges, an empty *Figures* carousel); an abstract
over 350 words (the thesis's 505); a long author list whose last lines are sentences (Llama 2); a
news article's edit log, which no cheap test separates from a real update.

## What this does not show

- **Fifty-two articles are not every shape.** Two held-out sets were the guard against fitting the
  checks to the first 33, and the second still found a class of miss. The checks fail towards
  showing, and every stretch has to pass them on its full stored text, whatever the model says.
- **Gold is a model's labels, checked by sampling**, not a second human's.
- **No production article was used**, so this says nothing about the 49+ already imported; those
  keep the 261007d rule until re-extracted.

## Reproducing it

`scripts/matter-eval.ts <dir> [--corpus <dir>] [--gold <dir>] [--draws=3] [--only=a,b] [--show=slug]`,
over per-article JSON exports of the local blocks and gold files; answers are cached by a hash of
the whole request, so a re-run pays only for what changed. The final tables:
[development](261018b-front-and-back-matter-eval/results-dev.md),
[held-out 1](261018b-front-and-back-matter-eval/results-holdout1.md),
[held-out 2](261018b-front-and-back-matter-eval/results-holdout2.md). The corpus exports and gold
files stayed in the session's scratch directory: the block ids are this machine's local imports
and mean nothing elsewhere; the URLs above re-create the articles.
