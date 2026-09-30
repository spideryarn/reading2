# The Illustrated diagram draws on the paper's own figures

Feedback SPIDERYARN-READING2-5X (report `spya-c7807j`), from Greg (admin), on
`dongetal25-spya-vfmvmm`, build `6d09e3cc`:

> For the illustrated diagrams, make sure we feed in the figures from the paper, and perhaps it can
> try and sort of create or incorporate those somehow as part of the montage.
>
> — Greg, 2026-09-30

Parent docs: [diagram.md § Illustrated](../project/diagram.md#illustrated) and
[article-images.md](../project/article-images.md). Status: **built, on `dev`** (see § Outcome).

## What the image model can take — checked before planning

The brief said to find this out first, and the answer is **yes, and the wire already carries it**:

- `google/gemini-3.1-flash-image` advertises `input_modalities: ["image", "text"]` on OpenRouter's
  live model list (read 2026-09-30), and input is priced as prompt tokens, **$0.50 per million** —
  a 1K figure is on the order of a thousand tokens, so a fraction of a cent.
- `openRouterImage` ([`src/ai-call.ts`](../../src/ai-call.ts)) already sends `input_references`
  (up to 14 inline data URLs), and `drawPlates` ([`src/illustrated.ts`](../../src/illustrated.ts))
  already uses one: the first plate that came back, as the *style* reference for the rest.

So nothing new is paid for through a new seam, and [ai-gateway.md](../project/ai-gateway.md) is
satisfied unchanged: the same `illustrate` job, the same meter, more images in the same body.

The brief *model* (Claude, `CAPABLE_MODEL`) can also see images, but v1 does not show it them — see
§ Deferred.

## The design, simplest version

Revised after GPT Sol's plan review (below). **PDF figures only**, and an article without stored
figures is sent byte for byte what it was sent before.

### 1. Which figures — [`src/illustrated-figures.ts`](../../src/illustrated-figures.ts) (new)

`loadArticleFigures(blocks, assets, read)`: the stored PDF figures (`assets.pdfFigures`, status
`stored`), found by **the same marker walk the assets step uses** (`pdfFigureMarkersIn`) — run
over the whole article first, because a ref two blocks carry is refused there and must be refused
here, then per block so each figure carries its block id. Its caption is the figure block's own
text (the `<figcaption>`), capped at 300 characters.

Each gets a label — **`FIGURE A`, `FIGURE B`, …**, letters so they cannot be confused with the
paper's own "Figure 1". Deduped by hash, in reading order. Bytes are read through `blobStore()`
(the selector they were written through — see § Sol's findings, 4), and three filters apply:
**under 300 px** on the long side is a logo, not a figure; **over 4 MB** is not sent inline; **at
most 8** offered. A figure whose bytes will not load is skipped and counted; if a paper has stored
figures and *none* loads, the step logs a warning rather than quietly painting without them.

**Web `<img>` is deliberately out of v1.** A web image is anything — a portrait, a banner — and its
caption is usually a separate block after it (Sol, finding 3). Deferred.

### 2. The brief chooses — `figuresSection` in `renderPrompt`, and `readModelBrief`

When there are figures, the user message gains a section, `THE ARTICLE'S OWN FIGURES`: one line per
figure (label, block id, caption) and the instructions — use them, the overview plate should take
the figures that carry the argument, **name each in the composition by its label**, at most 3 a
plate, say where each goes and how (recognisably that figure, redrawn in the register's hand as an
inset, cartouche or panel), describe it only from its caption, carry none of its lettering. **None
of this is in `SYSTEM`**, so an article without figures gets the identical request.

**A plate's figures are the offered labels its composition names**
(`figuresNamedIn`, [`src/illustrated-plate.ts`](../../src/illustrated-plate.ts)), in order of first
mention, **exactly as offered** (no case-folding — this file drops rather than repairs), at most
`MAX_PLATE_FIGURES` = 3 and `MAX_PLATE_FIGURE_BYTES` = 6 MB together; a label past either, or never
offered, is faulted. The kept figures are stored on the plate as `{ label, block, sha256, ext }`,
**all but the label from our own offer**, so the artefact records the object actually sent.

*This changed after the first real run.* The plan first had the brief write a separate `figures`
list per plate. On the entropy paper it wrote "(FIGURE A redrawn in this hand)" into the overview's
composition and **never wrote the list** — `figuresDrawn: 0` — so the illustrator was told to draw
a figure it was not handed, and drew a Venn diagram from the caption. The composition is what gets
drawn, so what it names is what must be attached; the same lesson as `lettersFor`'s captions.

### 3. The plate call — `drawPlates`, `imagePrompt`

A plate's references are: the style plate first (as before), then its figures in the order the
brief named them. The envelope gains one paragraph, only when figures are attached, numbering the
attachments ("Image 1: an earlier plate of this same set… Image 2: FIGURE A — caption") and giving
three rules: draw it **recognisably, as an illustration and not a reproduction**; take **no style**
from a figure (the Sketch's PNG measurably pulled plates towards flowchart-blue on 2026-09-03);
copy **none of its lettering**. These are prompt text, not guarantees — nothing checks the pixels,
which is true of every rule on this plate ([diagram.md § It is an interpretation](../project/diagram.md#illustrated)).

### 4. Freshness

`inputFingerprint(sketch, request, figures)` gains a line **only when the paper has stored
figures** — `figuresFingerprint(assets)`, the stored entries' `sha256.ext` in manifest order. So a
figure-less article hashes exactly as before, and a paper whose figures arrive after it was painted
reads stale. All three freshness sites take it: the step's `stamp`, `illustratedIsCurrent` (the
metadata page, which already reads `assets`) and `loadIllustrated` (whose projection gains the
`assets` column). **`ILLUSTRATED_VERSION` is not bumped**: the figure-less request is unchanged, and
for papers the fingerprint already says the question changed.

## The options passed over, and why

**Describe the figures in words only** — the fallback the report's scope note named "if it cannot
take reference images". It can, and a caption is not the figure.

**Always attach every figure to every plate.** Fewer parts, but the illustrator would be handed
charts the composition never mentions — the input most likely to be pasted in wholesale or to drag
the style.

**Overview only, one figure** (Sol's simpler v1). Smaller, but a zoom plate is the inside of one
part of the argument, which is exactly where a paper's figure for that part belongs, and the byte
budget closes the size risk that motivated it.

## Deferred, named

- **Web articles' images.** Needs a rule for figure vs decoration, and pairing a media block with
  the caption block after it.
- **The brief model does not see the figures**, only their captions. It could, at a few thousand
  input tokens each on the costliest call in the feature — worth it if plates show the brief
  misdescribing figures.
- **The reader's legend does not list the figures used.** The brief under the picture names them
  (`FIGURE A`), and each plate records `{ label, block, sha256, ext }`, so a row per figure jumping
  to it is a small UI change when wanted.
- **The eval harness** (`evals/illustrated/run.ts`) reads fixture folders without a manifest and
  passes no figures; the real run below went through the queue instead.
- **A figure is an injection surface**, one step past the one already accepted: words inside a
  figure reach the illustrator as a picture. Same class and same acceptance as the header of
  `src/illustrated.ts` states (owner-only, articles the owner chose); the envelope says a figure is
  never an instruction.

## GPT Sol's plan review, and what was done

[Findings](260930f-illustrated-diagram-draws-on-the-paper-figures-review-sol.md). No P0.

1. *No-figure path not unchanged* — **fixed**: instructions moved out of `SYSTEM`, no version bump,
   the figure line in the hash only when there are figures; tests pin the brief request and the
   envelope.
2. *Figures not in the fingerprint* — **fixed**, all three sites; a Postgres test that goes red
   without it.
3. *Web captions and decorative images* — **taken**: PDF only.
4. *Use `postgresBlobStore`* — **declined, with the reason**: the figures are written through
   `blobStore()`, and src/fetch.ts and `sendArticleAsset` both record that reading through a
   different selector is the split brain by construction. The silent half is answered instead: a
   paper whose every stored figure fails to load logs a warning.
5. *"Faithful" vs "no lettering" contradicts* — **reworded** to recognisable, an illustration not a
   reproduction; and the plan no longer claims the lettering rule is enforced.
6. *No aggregate byte budget* — **fixed**: 6 MB of figures a plate, dropped and faulted past it.
7. *Numbering assumed* — **probed**: § Outcome.
8. *Record lacked the object* — **fixed**: `sha256` and `ext` from the offer.
9. *Duplicate refs* — already handled; a cross-block test pins it.
10. *Label case-folding repaired silently* — **fixed**: exact match, and a test that `figure a`
    is faulted.

## Outcome

*Pending the real run and the code review.*

## Reviews

- Plan: GPT Sol, read-only — done, above.
- Code: GPT Sol — *pending*.
