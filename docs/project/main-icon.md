# The main icon: artwork, regeneration and review

Up: [design-css-overview.md](design-css-overview.md)

> and then update our docs/scripts (e.g. a main-icon.md with appropriate signposting) so that we have a process for updating it again in future
>
> — Greg, 2026-10-24

## Intent and sources

The icon is a faceless orange yarn spider absorbed in a book: a curious reading companion,
consistent with the [product vision](vision.md). Its intended eight limbs are four free rear
strands, two book supports and two crossed lower strands; the hollow oval is the body. The knot
and pose suggest character without eyes, eyebrows or fingers. Overlap deliberately leaves some
attachments to the imagination. The [design investigation](../investigations/261024a-spideryarn-logo-character-intent-and-selection.md)
preserves Greg's exact brief, alternatives, selection and later limb-proportion refinement.

> Let's go with A. Proceed autonomously.
>
> — Greg, 2026-10-25

A is the **textured reader**, not the flat B study. Greg chose it after comparing the same seated
character at tab and app sizes, with Chrome on his Mac as the main target. One artwork now serves
favicons, the small in-app mark, install icons and social images; it is resized and padded for its
host, not replaced by a separate character. The [selection and implementation](../plans/261025b-one-textured-reader-across-tab-and-app.md)
record the superseded experiments and validation.

- [Reader master](../../assets/brand/source/reader.png): the sole active artwork input, including
  wool texture, book and shading. [Prompt/input history](../../assets/brand/source/reader-generation.json)
  distinguishes generative renderings from exact pixel extraction. This choice did not edit it.
- [Former optical SVG](../../assets/brand/source/mark.svg): historical evidence only; no longer
  loaded by generation. The [flat reader study](../../assets/brand/archive/flat-reader-study-2026-10-25.svg)
  was B, considered but not selected. The separate upright-knot favicon direction was also dropped.
- [Archive](../../assets/brand/archive/) and [explorations](../../assets/brand/explorations/):
  previous masters and retained selection evidence. Change the master, then regenerate derivatives.

One transparent treatment works in both app themes. Install tiles have opaque backgrounds and
breathing room for the OS's corner mask. Exact colours, padding, filenames and dimensions have
one home: `BRAND_OUTPUTS` in [generate-brand-assets.ts](../../scripts/generate-brand-assets.ts).
The [manifest](../../public/site.webmanifest) uses ordinary `any` icons; no separately verified
maskable safe-zone treatment is supplied. The light/dark 1024px files are available exports;
the shipped Apple/Android consumers use the cream tile. The app's theme setting does not select
between those installed-icon exports.

## Updating the artwork

1. Read the intent above and the investigation before changing the character. Archive the previous
   reader master and generation provenance under a descriptive version name; keep
   selected intermediate variants and the exact input/prompt for an AI edit. The current sources
   must live in Git, not only in an image tool's output directory.
2. Refine the detailed artwork with genuine transparency, including through the body and limb gaps.
   Preserve opaque book pages. Do not introduce a second artwork source for small sizes. The [limb-refinement plan](../plans/261024a-reading-spider-limb-refinement.md)
   shows the archived inputs and why concealed paths are not a literal limb-length measurement.
3. Regenerate and check from the repository root:

   ```sh
   npm run brand:update
   npm run brand:check
   ```

   The aliases in [package.json](../../package.json) own the command sequence and focused test list.
   `brand:update` rebuilds PNG/ICO, both size-review sheets, the browser review page and static animation proof, then
   the social card. `brand:check` checks
   PNG/ICO/proof freshness and the focused image, animation, metadata and doc contracts.
   Freshness compares decoded pixels within a small tolerance, not bytes, so the Mac and the Linux
   box agree. An equivalent committed file is left byte for byte, so regenerating on the other
   machine changes nothing ([postmortem](../postmortems/261024f-a-byte-exact-freshness-check-on-a-platform-dependent-renderer.md)).
   Its OG tests check structure, dimensions and size budget; they **cannot detect an outdated
   illustration inside an otherwise valid OG image**. Use `brand:update` when artwork changes.
4. Inspect the proofs below, then check silhouette-dependent animation geometry. Run the broader
   checks appropriate to any code change through [code-quality-overview.md](code-quality-overview.md).
   Land sources, provenance, generated assets and relevant docs together through
   [version-control.md](version-control.md) and [worktrees.md](worktrees.md). A `dev` push is not a
   production deployment.

Regeneration makes no AI calls. It needs the lockfile's installed canvas/ICO dependencies and
Geist font (`npm ci`). The [OG renderer](../../scripts/make-og-card.ts), also available as
`npm run brand:og`, additionally needs the system Chrome selected by `chromePath()` in
[browser-sign-in.ts](../../scripts/browser-sign-in.ts). This is an image renderer, not a live app
or signed-in browser check. Cross-OS/font/Chrome byte identity is not promised, which is why the
canvas checks compare pixels. The OG card is not freshness-checked at all. The [library decision](../investigations/261024a-spideryarn-logo-character-intent-and-selection.md#regenerationlibrary-decision)
explains why the existing canvas dependency and a small ICO library were sufficient.

## Native-size review

> And can you inspect it when it's really really small and zoomed out to make sure it doesn't look ugly?
>
> — Greg, 2026-10-24

`brand:update` includes [the size/theme proof](../../assets/brand/preview.png) and
[the tiny-size proof](../../assets/brand/tiny-size-preview.png). Both come from generated public
PNGs. Open at 100% in an image viewer: fitting the whole sheet to a narrow window rescales its
supposedly native-size samples. Judge the normal rows first; the enlarged pixel grid is diagnostic.

The tiny sheet includes actual favicon pixels, the app PNG reduced to ordinary and zoom-equivalent
sizes, and the install tile reduced below its normal size, on light and dark. It is a static raster
inspection, not proof of browser or physical phone rendering. The earlier optical-mark assessment
was superseded by Greg's concern that its lower overlaps looked busy and confused. Do not use that
old assessment as acceptance evidence for the current textured mark.

### Chrome tab target

Chrome's ordinary tab favicon is about **16 logical pixels** across; on a 2× display that can use
**32 image pixels** across. A raw 32px image shown at 32 logical pixels exaggerates the icon's
apparent tab size, while a raw 16px reduction alone understates the available detail on a Retina
display. Prioritise the actual Chrome tab at the user's display scale, with 16px as the 1× fallback.
[Chromium's favicon size/scaling contract](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/components/favicon_base/favicon_url_parser.h)
and [coordinate spaces](https://www.chromium.org/developers/design-documents/blink-coordinate-spaces/)
explain the distinction.

`brand:update` generates [browser-preview.html](../../assets/brand/browser-preview.html) from the
current public assets. Serve the repository root locally and open `/assets/brand/browser-preview.html`
in Chrome at 100% page zoom. Its fixed-size samples distinguish 16 logical pixels from the 16px/32px
resources, show larger app marks on both backgrounds, and declare the actual generated favicon
files for the page's tab. Check the selected file/cache and active/inactive tab backgrounds before
judging a replacement; page samples do not prove what Chrome loaded into its own tab strip.

[RealFaviconGenerator](https://realfavicongenerator.net/developers/favicon-generation) was tried in
an isolated preview with A. Its generated desktop formats passed its checker; the comprehensive
report also warned about a missing touch title. It helps with packaging and platform declarations,
not character design. It added no visual benefit requiring another project dependency, so the
existing generator remains authoritative. An SVG wrapping raster input does not create vector detail.

For a physical-device check, inspect a newly added home-screen entry and record the device/OS,
appearance and installation state. A regenerated file alone does not demonstrate that an existing
installation has refreshed its icon.

## Animation and consumer traps

The shared app mark remains transparent because Radius Sweep masks its alpha. Semaphore cuts
two limbs out of that same PNG; **changing only the lower artwork can still move the upper limbs**,
because generation crops to visible bounds and recentres. Its existing
[pixel-geometry tests](../../tests/semaphore-geometry.test.ts) check actual foreground selection,
pivots and reconstruction. Follow a failure to the source crop/CSS; do not loosen a threshold to
make a changed silhouette pass. [design-logo.md](design-logo.md) owns the animation behavior and
[motion/rest proof](../../assets/brand/animation-preview.png). Recheck or refresh that proof when
its source changes, including still/reduced-motion appearance.

[LogoGlyphs.tsx](../../src/web/LogoGlyphs.tsx) owns the shared mark/letter hooks and accessible
markup; preserve them when replacing artwork. If output names change, follow the consumers in
the [shell head](../../index.html), manifest, email templates and
[site brand list](../../src/site-pages.ts), including robots/public-shell fixtures.
The [Chrome extension](chrome-extension.md) already uses the same textured reader on cream. Its
[build](../../scripts/build-extension.ts) copies committed files from `extension/icons/`; those
are a separate package, not outputs of `brand:update`. A future master change must update and
review those icons explicitly too. This selection leaves their already consistent artwork unchanged.

[Brand tests](../../tests/brand-assets.test.ts) cover alpha, gaps, padding, ICO pixels and declared
dimensions; [OG tests](../../tests/og-card.test.ts) cover its separate structural contract.
For live page/theme/motion checks, start at [browser-control.md](browser-control.md) and use the
machine's prescribed mechanism. Record unavailable checks as unavailable, not passed.
