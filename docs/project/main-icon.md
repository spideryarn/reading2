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

- [Detailed master](../../assets/brand/source/reader.png): wool texture, book and shading for
  install icons, social previews and large use. [Prompt/input history](../../assets/brand/source/reader-generation.json)
  distinguishes generative renderings from exact pixel extraction.
- [Optical SVG](../../assets/brand/source/mark.svg): the same loop, fan, book and crossed base
  with broad gaps and one orange, for favicons and small app wordmarks. It is a size treatment
  of the same identity; shrinking the wool illustration alone loses too much detail.
- [Archive](../../assets/brand/archive/) and [explorations](../../assets/brand/explorations/):
  previous masters and the retained selection evidence. Change sources, then regenerate derivatives.

One transparent treatment works in both app themes. Install tiles have opaque backgrounds and
breathing room for the OS's corner mask. Exact colours, padding, filenames and dimensions have
one home: `BRAND_OUTPUTS` in [generate-brand-assets.ts](../../scripts/generate-brand-assets.ts).
The [manifest](../../public/site.webmanifest) uses ordinary `any` icons; no separately verified
maskable safe-zone treatment is supplied. The light/dark 1024px files are available exports;
the shipped Apple/Android consumers use the cream tile. The app's theme setting does not select
between those installed-icon exports.

## Updating the artwork

1. Read the intent above and the investigation before changing the character. Archive the previous
   detailed master, optical SVG and generation provenance under a descriptive version name; keep
   selected intermediate variants and the exact input/prompt for an AI edit. The current sources
   must live in Git, not only in an image tool's output directory.
2. Refine the detailed artwork with genuine transparency, including through the body and limb gaps.
   Preserve opaque book pages. Match meaningful silhouette/proportion changes in the optical SVG,
   editing that vector directly. Check the crossed strand's duplicated mask geometry as well as its
   visible path. The [limb-refinement plan](../plans/261024a-reading-spider-limb-refinement.md)
   shows the archived inputs and why concealed paths are not a literal limb-length measurement.
3. Regenerate and check from the repository root:

   ```sh
   npm run brand:update
   npm run brand:check
   ```

   The aliases in [package.json](../../package.json) own the command sequence and focused test list.
   `brand:update` rebuilds PNG/ICO, both size-review sheets and the static animation proof, then
   the social card. `brand:check` checks
   PNG/ICO/proof byte freshness and the focused image, animation, metadata and doc contracts.
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
or signed-in browser check. Byte comparison is a same-runtime check; cross-OS/font/Chrome
screenshot byte identity is not promised. The [library decision](../investigations/261024a-spideryarn-logo-character-intent-and-selection.md#regenerationlibrary-decision)
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
sizes, and the detailed install tile reduced below its normal size, on light and dark. It is a
static raster inspection, not proof of a browser, Retina screen or physical phone rendering.
On 2026-10-24, parent and simulated icon-expert inspection found the simplified 16px mark tidy
but abstract, the 20px wordmark companion balanced, and the detailed reader clear at 48–60px.
The book and limbs merged in the detailed 24px reduction; at 10px the optical mark was only an
orange accent. These are observations about this artwork, not guarantees for its next revision.
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
[Brand tests](../../tests/brand-assets.test.ts) cover alpha, gaps, padding, ICO pixels and declared
dimensions; [OG tests](../../tests/og-card.test.ts) cover its separate structural contract.
For live page/theme/motion checks, start at [browser-control.md](browser-control.md) and use the
machine's prescribed mechanism. Record unavailable checks as unavailable, not passed.
