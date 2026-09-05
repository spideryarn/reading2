# `nasa-tm-interplanetary-streams/source.pdf`

**Y. C. Whang (Catholic University of America), L. F. Burlaga (NASA Goddard Space Flight Center,
Laboratory for Extraterrestrial Physics), "Evolution and Interaction of Large Interplanetary
Streams."** NASA Technical Memorandum 86192, February 1985. Submitted to the *Journal of
Geophysical Research*.

<https://ntrs.nasa.gov/citations/19870005698>
PDF: <https://ntrs.nasa.gov/api/citations/19870005698/downloads/19870005698.pdf>

```
full   sha256  2518780c45c4f87777f3b9028d5f4abfef8571c8fd3d4550c60317adb7df7102
full   bytes   1,358,822
full   pages   40
cut    sha256  08bbf5e274c582e7101e37fa691b21311bc294314b20702654b3f10562c4e3f1
cut    bytes   85,286
cut    pages   3 (1–3)
```

**A hash mismatch is a new fixture version, not a hash to update.**

## Licence

**U.S. Government work, public domain.** No copyright notice (no `©`) appears anywhere in this
document, and it was published in February 1985 — before the Berne Convention Implementation Act
of 1988 took effect on 1989-03-01, a US publication without a copyright notice on it entered the
public domain outright under the law then in force. NASA's own Technical Memorandum series is
official NASA-published work; the corresponding author, L. F. Burlaga, is a NASA Goddard employee
(Laboratory for Extraterrestrial Physics), which is the primary reason NASA published it in its own
TM series rather than only in *JGR*. NTRS hosts and redistributes it without any access
restriction. The one hedge worth naming: the co-author, Y. C. Whang, is an academic at the Catholic
University of America, not a federal employee, so this is a jointly authored report rather than one
authored solely by government employees — recorded here rather than glossed over, per this
project's own standard of writing down anything that was weighed rather than merely assumed.

## Why this document

Three things at once, all visible in these first three pages:

- **A bibliographic control card, not the article, is page 1.** It is NASA's own indexing entry for
  the report — a *scanned* card, badly OCR'd (`"S-HAND"` for `"S-BAND"`-style garbling is exactly
  the pattern here, e.g. `(NASA-ZM-86192)`, `E V G L C T I C N`) — followed by the accession number,
  subject category and an `Unclas`(sified) stamp. The real title, on this evidence alone, is
  unreadable; a naive extractor reading only page 1 has nothing usable to grab.
- **The real title, in ALL CAPS, is on page 2** — the actual title page: `EVOLUTION AND INTERACTION
  OF LARGE INTERPLANETARY STREAMS`, printed larger than everything else on the page, with the
  authors, `FEBRUARY 1985`, and — **below** the title and authors, not above — `National Aeronautics
  and Space Administration` / `Goddard Space Flight Center` / `Greenbelt, Maryland 20771`. Also on
  this page: `Short title: Evolution of large streams` and `Submitted to the Journal of Geophysical
  Research`.
- **Page 3 is the abstract**, in full — there is no article body prose within this 3-page cut; the
  introduction begins on the (uncut) page 4. `mustKeep` in `expected.json` draws its "body" snippet
  from the abstract itself and says so.

`pass0` over the full 40-page document finds `metaTitle: null` (NTRS's scan carries no PDF-level
title) and an empty furniture set — the running heads on this document's later, born-typeset pages
do not repeat within just the first three.
