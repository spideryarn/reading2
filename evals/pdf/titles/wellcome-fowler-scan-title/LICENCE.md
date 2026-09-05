# `wellcome-fowler-scan-title/source.pdf`

**L. N. Fowler (1811–1896), *Utility of Phrenology: A Lecture*.**
London: W. Tweedie, between 1873 and 1879. Digitised by **Wellcome Collection**.

Persistent URL: <https://wellcomecollection.org/works/a5aaj99u>
PDF: <https://iiif.wellcomecollection.org/pdf/b30472854> (b-number `b30472854`)

The same source document as [`../../much-harder/`](../../much-harder/) — re-downloaded and
re-hashed for this fixture, byte-identical to `much-harder/source.pdf`
(`sha256 dc66ec70…`). This is a **different cut**: the first 3 pages for the titles corpus (the
Wellcome-generated rights page plus the first 2 pages of the pamphlet), rather than all 17 pages
`much-harder/` uses.

```
full   sha256  dc66ec70acf8216e4d0bb3f096b25af690924b9dd8107f88d09670feb9f37aca
full   bytes   6,107,493
full   pages   17
cut    sha256  4a6d41b08170d25581193789ef857ef1cbe711a574bc983c68906e845c405990
cut    bytes   738,857
cut    pages   3 (1–3)
```

**A hash mismatch is a new fixture version, not a hash to update.**

## Rights

Quoted exactly from the rights page Wellcome generates as page 1 of this PDF (and kept, since
removing it would change the page count the gold is written against):

> This work has been identified as being free of known restrictions under copyright law, including
> all related and neighbouring rights and is being made available under the Creative Commons,
> Public Domain Mark.

Public Domain Mark. Nothing about the file has been altered.

## Why this document

The scanned-with-no-text-layer slot, for the titles corpus specifically. `pass0` finds **zero
extractable characters on pages 2 and 3** of this cut — the actual pamphlet pages — confirmed with
pdf.js (`page 1: words=95`, all of it Wellcome's own rights-page text; pages 2–3: `words=0`). The
real title and byline are only recoverable by reading the page as an image:

- Page 2 (the pamphlet's own title page) reads, in large display capitals and a script subtitle:
  `UTILITY OF PHRENOLOGY.` / `A Lecture,` / `BY L. N. FOWLER, OF NEW YORK.` — kept here in the title
  case the existing `much-harder/README.md` citation already uses, since it is the same work.
- Page 3 begins the lecture proper: `It is not sufficient in this Utilitarian age to prove that
  Phrenology is true, but the query meets us at every hand—Suppose it be true, "cui bono," of what
  practical use is it to the community?`

**Internet Archive's mirror of the same pamphlet is deliberately not used here either**, for the
reason `much-harder/LICENCE.md` gives: IA bakes in an ABBYY OCR text layer that would hand the
extractor the answer and defeat the slot.
