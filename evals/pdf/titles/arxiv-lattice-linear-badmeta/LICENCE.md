# `arxiv-lattice-linear-badmeta/source.pdf`

**Arya Tanmay Gupta, Sandeep S Kulkarni, "Eventually Lattice-Linear Algorithms."**
arXiv:2311.09760v2 [cs.DC], 13 Jan 2024. To appear in the *Journal of Parallel and Distributed
Computing*.

<https://arxiv.org/abs/2311.09760>
PDF: <https://arxiv.org/pdf/2311.09760>

```
full   sha256  ce816e28f2e7ad937d7f1931c812b2397bf1777e56828de34c5dece4b96e5a47
full   bytes   794,448
full   pages   28
cut    sha256  1b7f9ac256f2d81a6a0ce134220ecd2806ea211fd16e555feaf0183b66eadf08
cut    bytes   231,754
cut    pages   3 (1–3)
```

**A hash mismatch is a new fixture version, not a hash to update.**

## Licence

arXiv's own rendered HTML for this paper (`arxiv.org/html/2311.09760v2`) states
**License: CC BY 4.0**. Verified by web search, the same way as
[`../arxiv-arnn-eeg-stamp/`](../arxiv-arnn-eeg-stamp/).

## Why this document

Two things at once:

- **The vertical arXiv margin stamp** — `arXiv:2311.09760v2 [cs.DC] 13 Jan 2024` — down the left
  edge of page 1, the same class of hazard as the ARNN fixture.
- **A valid-looking but wrong PDF metadata title.** `pdfinfo`'s `Title` field is not the paper's
  title at all — it is `hyperref`'s title concatenated, with no separators, onto the paper's own
  footnotes:

  > `Eventually Lattice-Linear AlgorithmsTo appear in the Journal of Parallel and Distributed
  > Computing.The experiments presented in this paper were supported through computational
  > resources and services provided by the Institute for Cyber-Enabled Research, Michigan State
  > University.A preliminary version of this paper was published in Proceedings of the 23rd
  > International Symposium on Stabilization, Safety, and Security of Distributed Systems (SSS
  > 2021) Gupta2021.Email addresses: {atgupta,sandeep}@msu.edu`

  This is diagnostic precisely because it **does not look like a filename** —
  `titleFrom`'s `looksLikeAFilename` guard (`src/pdf-read.ts`) would not catch it, so rung 1 would
  hand this whole run-on string to the reader as the title unless something else intervenes. The
  real title, `Eventually Lattice-Linear Algorithms`, is the first ~36 characters of it — the rest
  is `\thanks{}` footnotes that LaTeX's `hyperref` folded into the PDF `/Title` key with no
  whitespace between them.
