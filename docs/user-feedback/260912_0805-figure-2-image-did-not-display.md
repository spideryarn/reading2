# The image for Figure 2 didn't display

**[SPIDERYARN-READING2-31](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-31)** · reported
2026-09-12 08:05 UTC · kind: problem · from an admin (Greg) · *shipped*

## What the reader said

> Why didn't the image for Figure 2 display correctly?

Slug `entropy-24-00930-spya-bmvfyb`, block `spya-d8tgkx`, build `607b57a0`, on an iPad.

## What we did

**Figure 2 is drawn, not pictured.** Page 8 of this MDPI *Entropy* paper holds no bitmap at all: the
two lattices are vector paths with their labels set as text. The PDF-figure route recovered only
embedded bitmaps, so it recorded `no-raster`, and the reader got the caption and *"We couldn't
recover this figure from the PDF."* Figures 1, 3 and 4 are bitmaps, which is why they worked. Not the
`srcset` change from the monkeys report, and not a regression — the limit was named when the route
was built. Reproduced by ingesting the same PDF locally: the same four figures, the same three stored,
page 8 `failed / no-raster`.

**Shipped on `dev`:** a second route that draws the figure from the page itself. On a page with one
figure caption, no image of any kind, and ink that is provably all the caption's own, it finds the
rectangle between the caption and the prose above it and has PDFium — compiled to WebAssembly, a new
dependency — render just that rectangle. Figure 2 comes out as both lattices with every label; two
drawn figures in an arXiv paper come out too. Anything outside that case stays caption-only, as
before. GPT Sol reviewed the plan (refused the first draft), the one contested rule, and the code;
Fable arbitrated admitting a figure made of separate drawings.

**Not yet on production, and not on this article.** Production is Greg's to deploy, and this
article's `assets` step has to run again to pick the figure up —
`npx tsx scripts/stage.ts assets entropy-24-00930-spya-bmvfyb` against production after the deploy.

**Two things for Greg**, both in the plan: the new dependency (4.6 MB in the API function), and that
the server now *renders* a stranger's PDF, which changed a sentence in security.md and wants a row in
security-map.md that is his to approve.

[The plan](../plans/260912a-figure-2-vector-figures-from-a-pdf.md);
[article-images.md](../project/article-images.md) is the doc.
