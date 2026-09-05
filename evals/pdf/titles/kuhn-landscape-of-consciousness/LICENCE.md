# `kuhn-landscape-of-consciousness/source.pdf`

**Robert Lawrence Kuhn, "A landscape of consciousness: Toward a taxonomy of explanations and
implications."** *Progress in Biophysics and Molecular Biology*, 190 (2024), 28–169. Elsevier.

Local copy only: `/home/greg/uploads/Lawrence Kuhn (2024) - A landscape of consciousness_ Toward a
taxonomy of explanations and implications.pdf` — no public URL was recorded with the upload, so
provenance rests on this file as given by the reader who reported the bug.

```
full   sha256  0a74e33b25dfbf4556527a68914a161c167e6d3d5ad3623c2735d47b8138bf5c
full   bytes   8,748,470
full   pages   142
cut    sha256  075825552c2ae4e8e28e67c7b086850aa7e3c8dcb19e62aa284df4f8b304d8d9
cut    bytes   324,097
cut    pages   3 (1–3)
```

**A hash mismatch is a new fixture version, not a hash to update.**

## Licence — do not redistribute

**This is the one exception to the corpus's own rule.** Printed on page 1 of the PDF itself:

> 0079-6107/© 2024 The Author(s). Published by Elsevier Ltd. This is an open access article under
> the CC BY-NC-ND license (http://creativecommons.org/licenses/by-nc-nd/4.0/).

That is a **CC BY-NC-ND** licence — it carries a No-Derivatives clause, which is exactly the
condition [`../README.md`](../README.md) records a fixture being rejected for. This is not the
"unclear" case the brief that produced this fixture anticipated; reading the page settled it
outright, and it settled it against redistribution.

**Kept anyway, because it is the motivating case.** The whole corpus exists because this document
was ingested and titled *"Progress in Biophysics and Molecular Biology"* — the journal, not the
paper — and every later fixture is chosen to generalise from what is actually true of this one. Cut
to three pages (of 142) so the `source.pdf` here is a small excerpt for eval purposes, not the
work. **Treat this fixture as internal-only: do not push it anywhere the repository itself would
not otherwise reach, and do not cite it as a redistribution precedent for anything else in this
corpus.**

The sha256 of the full local file matches the one on disk at the path above as of 2026-09-05; there
is no independent copy to re-verify against.

## Why this document

The motivating case, and it turns out to demonstrate more than the one bug:

- **The journal running header, in small type, above the real title** (the reported bug). Page 1's
  masthead is `Progress in Biophysics and Molecular Biology 190 (2024) 28–169`, set *larger* than
  the article's own title — Elsevier's banner box is visually the biggest thing on the page, so a
  model calling it `heading1` is being reasonable. Rung 3 of `titleFrom` already excludes it via
  `pass.furniture`; rung 2 did not, and rung 2 answers first. See
  `docs/plans/260905b-pdf-front-matter-and-the-title-it-stole.md`.
- **The title's own fragment repeats as the running head on later pages** — `pass0` over the full
  142 pages puts the word `landscape` in `pass.furniture` (folded from the recto running head, a
  fragment of "A Landscape of Consciousness"), alongside `r l kuhn` (the verso running head,
  "R.L. Kuhn"). That is the alternating verso/recto pattern, and it is also the trap rule 1 of the
  fix has to avoid: naively dropping every furniture-matching heading would throw away the article's
  own title on the pages where it is the header.
- **`ARTICLE INFO` and `ABSTRACT`**, Elsevier's layout labels, sit on page 1 in exactly the position
  a naive "biggest heading" rule would consider. Per Fable's product review in the plan doc, these
  are furniture to drop, not content to keep.
- **The PDF has no metadata title at all** (`metaTitle` is `null`), so rung 1 never fires here — the
  reported bug lives entirely in rungs 2 and 3.
- **The text layer's reading order is scrambled**: the footer (`Available online…`, the CC-BY-NC-ND
  line) is interleaved with the masthead and the title in the raw stream, ahead of the title itself.

See `evals/pdf/titles/expected.json` for the gold title, the furniture list and `mustKeep`.
