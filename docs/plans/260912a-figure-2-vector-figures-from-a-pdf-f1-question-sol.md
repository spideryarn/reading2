**F11 — P1 — established: foreign drawings inside the caption’s horizontal span become part of the region, rather than causing refusal.**

Concrete A4 counterexample:

- One full-width `Figure 7` caption at `x=60–535`, `y≈100`.
- Its intended figure is a vector plot at `x=70–270`, `y=140–350`.
- An unrelated boxed equation occupies the other column at `x=325–525`, `y=180–300`.
- The preceding prose is above `y=400`; there are no images, other markers, page-sized paths, or intersecting prose.

Both drawings overlap the caption’s column, so step 4 selects both immediately. Step 5 finds no *other* ink. Their union passes the size bounds, and the stored crop contains the plot plus the unrelated equation.

Consequently:

- A page-sized border is refused, but a smaller border, watermark, boxed equation or ornament is not necessarily refused.
- A sidebar or neighbouring-column drawing is refused under a narrow caption only when it remains outside the grown region.
- A full-width caption makes essentially every drawing in the band a seed, so the two-column adversary is admitted.
- A narrow caption under a wider multi-panel figure is safely refused when panels neither overlap the caption nor touch the seed; if they form a touching chain, it is admitted. That does not solve ownership.

**F12 — P1 — established: “all painted ink” does not cover independently painted text.**

Place the short text watermark `DRAFT` inside the bounding rectangle between Figure 2’s lattices, without touching either lattice. It is not a painted path, is too short to count as prose, and is not incorporated as a touching label. Nothing refuses it, but PDFium renders it because it lies inside the final rectangular crop.

The same applies to short equation text or an ornament drawn with font glyphs. Counting every visible text box in the band would close this particular hole, but not F11.

**F13 — P1 — established: one extracted marker does not prove one printed caption.**

For side-by-side drawings over two stacked captions, suppose extraction produced a marker only for the upper caption. The page satisfies “exactly one marker”; the lower printed caption is below the target and therefore cannot act as its ceiling. With a full-width upper caption, both drawings are selected.

Eligibility must independently require exactly one printed figure-caption opening anywhere on the page, not merely one extracted marker. This does not affect Figure 2.

**F14 — P1 — reasoned: no geometry-only refinement can make disconnected ownership sound.**

Figure 2’s valid layout and an invalid layout containing one lattice plus an unrelated, similarly placed diagram can have identical component boxes, spacing, caption width and text-line classes. The distinction is semantic, so any rule using only those observations must accept or reject both.

The smallest sound change that still admits Figure 2 is therefore a narrowly verified exception: key the exact one-page PDF bytes and caption/page by digest, use the visually verified fixed crop containing both lattices, and refuse generic disconnected regions. A general route would need an additional ownership signal—such as verified PDF figure structure or human approval—not another spacing threshold.

**Verdict: sound with changes (F11–F14).**