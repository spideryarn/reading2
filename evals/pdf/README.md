# `evals/pdf/` — three PDFs, and what "read correctly" means

Run by hand, not by `npm test`. See [testing.md § evals](../../docs/project/testing.md) for the
difference and [pdf-ingestion.md § The eval](../../docs/plans/pdf-ingestion.md#the-eval-evalspdf)
for the design this implements.

**Nothing here scores anything yet.** The three source PDFs are committed and verified; the golds,
the scorer and `npm run eval:pdf` are steps 3 and 6 of the plan's build order. What exists today is
the fixtures and their provenance, so that the first-hour bake-off had something honest to run on.

## The three

| | Document | The slot it fills |
|---|---|---|
| [`easy/`](easy/) | Lyn McCredden, *Forms of Memory in Post-colonial Australia*, **Coolabah** (Universitat de Barcelona), 2009 — 8pp | Single column, born-digital, a title/abstract/keywords block, one subheading, a running header and page numbers. Deliberately unglamorous. **This is the one v1 has to get essentially perfect.** |
| [`harder/`](harder/) | Alexander G. Keul, *A brief history of ball lightning observations by scientists and trained professionals*, **History of Geo- and Space Sciences** (Copernicus), 2021 — 14pp | Genuinely two-column — verified by x-position histogram *and* by rendering the page and looking at it. Three tables, five captioned figures, running headers, footnote-size type. At 11.5 MB it is also, for free, the fixture that proves the upload path cannot go through a Vercel function. |
| [`much-harder/`](much-harder/) | L. N. Fowler, *Utility of Phrenology: A Lecture* (London: W. Tweedie, c. 1873–79), **Wellcome Collection** — 17pp | **Zero extractable characters on every content page.** A real photographic scan: foxing, toning, hyphenation across line-ends. It forces image reading and it disables v1's principal check, which is the point of the slot. |

Each directory holds `source.pdf` and `LICENCE.md`. The licence file carries the sha256 — **a hash
mismatch is a new fixture version, never a quietly updated hash**, because a gold is written against
particular pixels.

Measured with pdf.js, 2026-08-26 — the free baseline every check is built on:

```
  easy          8pp   words/page: min 241  median 499  max  598   total  3,522
  harder       14pp   words/page: min 296  median 912  max 1163   total 11,937
  much-harder  17pp   words/page: min   0  median   0  max   95   total     95
```

Those 95 words are Wellcome's generated rights page. Every page of the pamphlet itself has none,
which is what makes it the much-harder slot and not merely a hard one.

## What is deliberately not here

**BERT and Nagel.** Both are informal probes, not scored fixtures: BERT is memorised well enough
that a model can reconstruct text it failed to read, and Nagel's gold would be a full-text
transcription of a JSTOR PDF, which a private repo does not make redistributable.

**Runners-up**, recorded so nobody repeats the hunt: a Pulse review of *Weird Fiction and Science at
the Fin de Siècle* (3pp, a perfect fit, disqualified by an ND clause); Walleczek & von Stillfried on
the Radin double-slit experiment (18pp, CC BY, genuinely two-column — the reserve if ball lightning
proves unsuitable).

Three ways the choosing could have gone quietly wrong, all of which nearly did:

- **A PLOS paper looked two-column by x-position histogram and wasn't** — one wide column with a
  large left margin. Caught only by rendering the page. A layout check that never looks at the page
  can agree with itself.
- **Internet Archive's mirror of the Fowler pamphlet was rejected**: IA bakes in an ABBYY OCR text
  layer, ~3,000 legible characters a page, which would have handed the extractor the answer and
  defeated the slot entirely. Only Wellcome's own generated PDF is image-only.
- **The 11.5 MB fixture is a feature.** It sits over Vercel's 4.5 MB request-body limit, so it
  proves a design claim the plan would otherwise have to argue.

## See also

- [pdf-ingestion.md](../../docs/plans/pdf-ingestion.md) — the plan, the build order, and the bake-off these three were chosen for
- [pdf-parsing-options.md](../../docs/research/pdf-parsing-options.md) — what else we could have used to read them
- [evals/README.md](../README.md) — what an eval is here, and why it is not a test
