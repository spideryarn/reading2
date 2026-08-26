# `much-harder/source.pdf`

**L. N. Fowler (1811–1896), *Utility of Phrenology: A Lecture*.**
London: W. Tweedie, between 1873 and 1879.
Digitised by **Wellcome Collection**, 183 Euston Road, London NW1 2BE.

Persistent URL: <https://wellcomecollection.org/works/a5aaj99u>

```
sha256  dc66ec70acf8216e4d0bb3f096b25af690924b9dd8107f88d09670feb9f37aca
bytes   6,107,493
pages   17   (1 Wellcome-generated rights page + 16 pages of the pamphlet)
```

**A hash mismatch is a new fixture version, not a hash to update.**

## Rights

Quoted exactly from the rights page Wellcome generates as page 1 of this PDF:

> This work has been identified as being free of known restrictions under copyright law, including
> all related and neighbouring rights and is being made available under the Creative Commons, Public
> Domain Mark.
>
> You can copy, modify, distribute and perform the work, even for commercial purposes, without
> asking permission.

Public Domain Mark. Nothing about the file has been altered — **including that page 1 is kept**,
because removing it would change the page count the gold is written against and would strip the
attribution Wellcome asks for.

## Provenance

Downloaded 2026-08-26. The persistent URL, the rights statement and the citation are all printed on
page 1 of the document, so this one verifies itself.

**Internet Archive's mirror of the same pamphlet was deliberately rejected.** IA bakes in an ABBYY
OCR text layer — roughly 3,000 legible characters a page — which would have handed the extractor the
answer and destroyed the whole point of this slot. Only Wellcome's own generated PDF is image-only.

## Why this document

The `much-harder` slot: **zero extractable characters on every content page**, confirmed with
pdf.js. The 95 words the text layer does contain are Wellcome's rights page and nothing else. A
genuine photographic scan — foxing, toning, hyphenation across line-ends — so it forces real image
reading and it disables v1's principal check, which is the point.

It is also the document that decided the bake-off: every Claude Haiku 4.5 variant silently dropped
the first page of a two-page chunk, three runs out of three, while Gemini 3.7 Flash read both. See
[pdf-ingestion.md § The bake-off](../../../docs/plans/pdf-ingestion.md#the-bake-off-and-what-it-decided-2026-08-26).
