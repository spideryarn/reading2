# `frontiers-wrapped-title/source.pdf`

**Mei-jun Ou, Xiang-hua Xu, Hong Chen, Fu-rong Chen, Shuai Shen, "Development and preliminary
validation of Cancer-related Psychological Flexibility Questionnaire."** *Frontiers in Psychology*
14:1052726, 2023. doi: 10.3389/fpsyg.2023.1052726.

<https://www.frontiersin.org/articles/10.3389/fpsyg.2023.1052726>
PDF: <https://public-pages-files-2025.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2023.1052726/pdf>

```
full   sha256  c1c32382856ac360b9930b31130e9c6b8f381ad4a0b196e67ffdace66b5aaed4
full   bytes   1,395,636
full   pages   11
cut    sha256  cb77ee3bd88d49527d431473db498458807100b3d209404977788c03bcedd123
cut    bytes   117,175
cut    pages   3 (1–3)
```

**A hash mismatch is a new fixture version, not a hash to update.**

## Licence

Printed in the document's copyright block, page 1:

> © 2023 Ou, Xu, Chen, Chen and Shen. This is an open-access article distributed under the terms of
> the Creative Commons Attribution License (CC BY).

## Why this document

**The title wraps across four lines** — `Development and preliminary` / `validation of
Cancer-related` / `Psychological Flexibility` / `Questionnaire` — each its own text run, so a naive
"first heading" rule that stops at one line would return only `Development and preliminary`. Also a
useful **control**: `metaTitle` (Adobe InDesign's PDF export) is the correct, complete title, so
rung 1 should simply win here.

Two more things worth having, seen while inspecting page 1:

- A page-1 label, `TYPE — Original Research`, top right — the kind of heading1-shaped line
  `docs/plans/260905b-pdf-front-matter-and-the-title-it-stole.md` names as furniture-that-looks-like-
  a-heading (`"Research Article"`/`"Original Investigation"`), here as `"Original Research"`.
- The running **footer** (not header) `Frontiers in Psychology  01  frontiersin.org` repeats on
  every one of this cut's three pages, so unlike most of this corpus's other multi-page fixtures it
  *does* reach `pass.furniture` within just the 3-page cut — see `furnitureRealistic: true` in
  `expected.json`.
