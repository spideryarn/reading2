# A proof resampling its supposedly native input

On 2026-10-24, the [main-icon process work](../plans/261024o-a-repeatable-main-icon-update-and-tiny-size-review.md) produced a sheet labelled as native favicon pixels while its canvas changed those pixels. An independent exact-pixel test caught it before this implementation's first commit. Nothing reached a reader; the public icon and OG hashes stayed unchanged.

## The class: a proof resampling its supposedly native input

The proof reused one canvas for two different claims: native samples and deliberately reduced samples. High-quality image smoothing was appropriate for the reductions, but remained enabled for native draws. In the installed canvas runtime it changed even integer-positioned, 1:1 draws. Reading the correct PNG bytes did not establish that the sheet displayed those bytes faithfully.

The same shared state affected the full-size proof's native favicon row and 180px install tile. Those siblings were fixed too; intentional app/detail downsampling retains smoothing. The drawing boundaries live in `renderPreview` and `renderTinyPreview` in [the generator](../../scripts/generate-brand-assets.ts).

## Evidence and the wrong diagnosis

The first assertion showed a blue channel of 237 instead of 238. I called this premultiplied-alpha rounding and temporarily allowed a difference of one. That assertion then failed on a difference of two. Measuring the whole native sample exposed the actual scale:

| Sample | Largest channel difference | Example |
|---|---:|---|
| Light native 16px favicon | 35 | blue 203, expected 238 |
| Dark native 16px favicon | 39 | red 75, expected 36 |
| Either 8× nearest-neighbour diagnostic | 0 | exact agreement |

The unsmoothed diagnostic supplied the useful contrast: the source and compositing could agree exactly. The tolerance was removed, smoothing was disabled for native draws, and strict comparisons passed.

**Introducing commit:** none. This defect was introduced and corrected in the uncommitted `261024o` implementation. The preceding generator commit, `d3baedfe0e83cd63afdd715a5c6e83b4d024e02b`, lacked the new proof-context high-quality smoothing assignment; its existence is not an introducing commit for this defect.

## Why the earlier checks agreed

Visual inspection looked plausible at tiny sizes. Freshness and determinism checked that the generator reproduced its own output, including its unwanted filter. Neither established the native-pixel claim. The new test compared proof regions with the separately composited generated favicon, rather than with another call to the proof renderer.

## Countermeasures, ranked by ease against value

1. **Compare claimed-native pixels independently — done.** [The brand test](../../tests/brand-assets.test.ts), `preserves native favicon pixels and unsmoothed 8x diagnostic blocks in the tiny proof`, checks both backgrounds and exact diagnostic blocks. It was red on the actual defect and is included in `brand:check`.
2. **Set sampling at the draw boundary — done.** Native draws explicitly disable smoothing; reductions explicitly enable it. A shared context's previous use no longer decides the meaning of the next sample.
3. **Permit a small unexplained tolerance — rejected.** It weakened the contract before the difference had been understood, and would have hidden smaller instances of the same class.
4. **Rely on visual/browser review to prove pixel identity — rejected.** Those checks matter for appearance and device behaviour, but cannot replace a cheap exact comparison of a claimed-native raster.

I knew this sheet was evidence about the renderer's output, then treated a renderer setting as cosmetic. The right fix preserves the input at the evidence boundary; it does not make the assertion accept the altered proof.

Up: [Postmortems](../project/postmortems.md).
