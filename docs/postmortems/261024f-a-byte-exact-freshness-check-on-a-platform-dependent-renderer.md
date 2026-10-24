# A byte-exact freshness check on a platform-dependent renderer

On 2026-10-24 `npm run deploy` on the Hetzner box, at `dev` `bcac8a33`, stopped on one test:
`brand assets > keeps the committed public family fresh` reported `spideryarn-logo.png`, the three
favicon PNGs and `favicon.ico` as stale. The log was
`logs/deploy/2026-10-24T12-38-29-742Z-bcac8a33-test.log`. Nothing reached readers, because the gate
held. It just could not be passed from the box.

## The class: a byte-exact freshness check on a platform-dependent renderer

A golden-file check compared committed images with a fresh render **byte for byte**. The images
were rendered on Greg's Mac and checked on the x86_64 Linux box. Skia (via `@napi-rs/canvas`)
antialiases vector paths and text slightly differently on the two. So the check could only ever
pass on the machine that last ran the generator.

No source had changed. `assets/brand/source/mark.svg` and its outputs were last written together in
`001b02724`. The measurements, decoded and premultiplied:

| Output | Largest channel difference, Mac vs box |
|---|---:|
| Mark outputs (logo, 16/32/48 favicons; from the SVG) | 2 |
| `preview.png`, `tiny-size-preview.png` (text and marks) | 2 |
| `animation-preview.png` (vector clips and text) | 2 |
| Reader outputs (scaled from a PNG master) | 0, byte-identical |

The smallest real source edit measured, blue `+8` on the mark colour, moved 9. A 1-unit nudge to a
limb moved 94–135, a half-unit stroke change 52–120, and one book-page vertex 32–168. Only the first
check was in `npm test`. `brand:check` would have failed the same way on all three.

**Introducing commits:** `d3baedfe0` added the public-family byte check, and `173e0d995` added the
same comparison for the proofs and the animation proof. [main-icon.md](../project/main-icon.md)
already said "cross-OS … byte identity is not promised". The hazard was written down while the gate
went on assuming the opposite: [a sentence is not a fix](../reusable/written-down-is-not-checked.md#a-sentence-is-not-a-fix).

## Why no earlier check disagreed

Every run that passed ran on the machine that had just generated the files: "byte-identical" in the
commit message, the Sol review, and the 301 focused tests. A determinism check only proves
determinism on the machine it runs on. The box was the first second machine to look.

## The fix

[`raster-equivalence.ts`](../../scripts/raster-equivalence.ts) compares decoded, premultiplied pixels
with a tolerance of 3 levels, and the generator and the animation proof both use it. A committed PNG
that is equivalent to a fresh render is **kept byte for byte**, so regenerating on the other machine
churns nothing. The ICO is packed from the kept PNGs, so it stays an exact-bytes check everywhere.
`brand-assets.test.ts` now drifts a committed favicon by 2 levels and expects it kept, and it edits
the mark's colour and stroke and expects the check to fail. With the tolerance set to 0, both that
test and the original one go red on the box.

Rejected: regenerating on the box, which turns the Mac red instead; dropping the freshness check;
and committing a rasterised master of the SVG, which moves the platform-dependent step without
removing it.

## Countermeasure for the class

Before writing a golden-file check on any renderer (canvas, a browser screenshot, a font
rasteriser), ask whether every machine that runs it will produce the same bytes. If not, compare
the decoded result with a tolerance you have **measured against both drift and the smallest real
change**, and write both numbers next to the constant.

Up: [Postmortems](../project/postmortems.md).
