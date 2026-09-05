# `copernicus-ball-lightning-title/source.pdf`

**Alexander G. Keul, "A brief history of ball lightning observations by scientists and trained
professionals."** *History of Geo- and Space Sciences*, 12, 43–56, 2021. Copernicus Publications.

<https://doi.org/10.5194/hgss-12-43-2021>
PDF: <https://hgss.copernicus.org/articles/12/43/2021/hgss-12-43-2021.pdf>

The same source document as [`../../harder/`](../../harder/) — re-downloaded and re-hashed for
this fixture rather than copied, and it came back byte-identical to `harder/source.pdf`
(`sha256 18d0d66a…`), confirming both are the same file at the same URL. This is a **different
cut** of it: the first 3 pages only, for the titles corpus, rather than the full 14-page document
`harder/` uses for the extraction eval.

```
full   sha256  18d0d66a7f975d865b224cf27d9f2c489ddf670975d72d91d380e1db69597318
full   bytes   11,575,040
full   pages   14
cut    sha256  0f9f5934d3891014e3510bd4dfa5a78adc239600420281eca24aa5b49748037e
cut    bytes   7,411,636
cut    pages   3 (1–3)
```

**A hash mismatch is a new fixture version, not a hash to update.**

**Size: 7.1 MB, well over this corpus's ~1.5 MB guideline, unavoidably.** The first three pages of
the paper carry the same high-resolution figures (including a colour reproduction of an 1868
drawing) that make the full `harder/source.pdf` 11.5 MB; `pdf-lib`'s page-copy keeps the embedded
images at full resolution and this corpus does not recompress them.

## Licence

Printed on page 1 of the PDF itself:

> © Author(s) 2021. This work is distributed under the Creative Commons Attribution 4.0 License.

CC BY 4.0. Nothing about the file has been altered before cutting; the cut removes pages, nothing
else.

## Why this document

Two things at once:

- **Two-column, and the title genuinely spans both columns above them** — verified by rendering, not
  only by x-position: the title and author block sit centred across the full page width (roughly
  x=122–450 of ~597pt), and the two-column body starts beneath it. This is the same document
  `harder/LICENCE.md` records as verified twice after a PLOS candidate looked two-column by
  histogram and was not.
- **The running head repeats a shortened form of the article's own title** —
  `A. G. Keul: A brief history of ball lightning observations` — on pages 2 and 3 of this cut (page 1
  carries the citation strip instead). Over the **full 14-page document** this reaches
  `pass.furniture` (see `pass0-full.json`); within just this **3-page cut** it does not; see
  `furnitureRealistic: false` in `expected.json` and the note there. That gap is the reason
  `pass0-full.json` exists at all: a 3-page cut of this document exercises a different, more
  dangerous code path than the full 14-page paper does, because pass 0 run on the cut alone never
  calls the running head furniture and so never protects it from being dropped — or from being
  picked as the title by rung 3, which is the more interesting failure here.

`metaTitle` is empty in both the full document and the cut (Copernicus's LaTeX build sets no PDF
title), so rung 1 never fires on this fixture either.
