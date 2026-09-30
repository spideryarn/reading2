# Illustrated plates with the paper's own figures, 2026-09-30

For [260930f](../../../docs/plans/260930f-illustrated-diagram-draws-on-the-paper-figures.md).
Local article `entropy-24-00930-spya-pywwkq` (an Entropy review of partial information
decomposition), four stored PDF figures, Sketch drawn first ($0.24, 3 scenes). JPEG copies of the
stored PNG plates, made for this folder; the originals are in the blob store under the hashes in
the plan doc.

| run | what the brief did | figures handed over | cost |
|---|---|---|---|
| 1 | named `FIGURE A` in the overview's composition, **never wrote the separate `figures` list** | 0 | $0.53 |
| 2 | (after the fix: a plate's figures are the labels its composition names) | 6 across 3 plates | $0.51 |

- `entropy-run1-overview-no-figures-attached` — the Venn medallion is drawn from the caption
  alone. This is the failure the fix closes: told to draw FIGURE A, handed nothing.
- `entropy-run2-overview-figures-A-D` — FIGURE A (`entropy-source-figure-A`) is recognisably
  redrawn as a framed inset at the "splitting" scene: outer ellipse, two circles, hatched overlap,
  none of its lettering. FIGURE D (`entropy-source-figure-D`, a five-panel results figure) went in as
  small chart panels inside the brain in the bowl. **One lettering leak:** tiny glyphs, "lul4" and
  "RC", on two vessel necks — "RC" is probably Figure D's "Out RC / In RC".
- `entropy-run1-zoom-pid-framework` and `entropy-run2-zoom-pid-framework-figures-A-B` — **both** zoom
  plates re-draw large parts of the overview (run 1's whole lower half; run 2's vessels, gate and
  bowl, including the Figure D panels the zoom was not handed) and both repeat a caption. Since run
  1 had no figures attached, this is existing behaviour of the overview-as-style-reference, not
  something figures introduced.

## The ordering probe

`scripts/probes/260930f-figure-order-probe.ts`, two runs, $0.14 each: a red circle and three blue
triangles, captions that do not describe them, placed by label. **The PNGs were lost** — deleted
after a JPEG conversion that wrote black frames (an async image decode) — so this is what was seen:

- **Overview position** (figures only): circle on the left, triangles on the right, as asked, both
  redrawn as engravings. The numbering in the envelope was honoured.
- **Zoom position** (style plate first): asked for triangles on top and the circle below, it drew
  them the other way round, in the order the style plate had them. Confounded by the behaviour
  above — the model edits the style plate — so ordering in the zoom position is **unproven**, not
  shown wrong.
