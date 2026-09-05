# `arxiv-arnn-eeg-stamp/source.pdf`

**Salim Rukhsar, Anil K. Tiwari, "ARNN: Attentive Recurrent Neural Network for Multi-channel EEG
Signals to Identify Epileptic Seizures."** arXiv:2403.03276v2 [eess.SP], 18 Nov 2024.

<https://arxiv.org/abs/2403.03276>
PDF: <https://arxiv.org/pdf/2403.03276>

```
full   sha256  4d3224a33d35b2e92c4294bad40f7593dcbcef68daaa8175e452e9d04767ab91
full   bytes   1,341,718
full   pages   12
cut    sha256  4ff245681c6c422865ce5559f5a4ab1ff090dcf0098bd5d87f2c65d8c0b9125f
cut    bytes   300,689
cut    pages   3 (1–3)
```

**A hash mismatch is a new fixture version, not a hash to update.**

## Licence

arXiv's abstract page for 2403.03276 states **License: CC BY 4.0** (Creative Commons Attribution
4.0 International) under the download options. Verified by web search of the paper's own rendered
HTML (`arxiv.org/html/2403.03276v1`), which prints the same licence line. Not an arXiv house
licence and not the arXiv-only perpetual licence — CC BY, which is what this corpus requires.

## Why this document

The arXiv-preprint slot: the vertical **`arXiv:2403.03276v2 [eess.SP] 18 Nov 2024`** stamp runs
down the left margin of page 1, rotated — confirmed by transform (`|b| > |a|`, the same test
`src/pdf.ts` § `isSideways` uses). This is the exact class of failure that function's own doc
comment records: a stamp like this, read without the rotation check, can splice into the middle of
the first word of a title (`src/pdf.ts`'s own example is `normalizaarxiv 1503 02531v1 stat ml 9 mar
2015 tion`).

A useful **control** alongside the more broken fixtures: `metaTitle` is the correct, full title —
LaTeX's `hyperref` wrote it cleanly — so rung 1 of the ladder should simply win here, and any arm
that gets this one wrong is a regression, not progress.

**Also carries a ligature-splitting artefact**, though not in the title: the abstract's word
"affordability" arrives from pdf.js as three separate runs — `"a"`, `"ff"`, `"ordability"` — because
the `ffi`/`ff` ligature glyph is its own glyph in the embedded font. Recorded because it is the
kind of thing that looks like a transcription error and is really a rendering artefact; see
`mustKeep` in `expected.json`, which holds the model to the corrected reading.
