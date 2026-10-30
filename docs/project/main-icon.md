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

> I can't really tell the difference between B and C. Maybe C? I think these are better, especially for the smaller verisons. Proceed.
>
> — Greg, 2026-10-25

The current master is **C from the upper-limb study**: the textured seated reader with slimmer,
longer free rear limbs. It refines the earlier A selection; the body, book and seated pose retain
the same identity. The four free rear strands, two book supports and two crossed lower strands
still suggest eight limbs without a literal face or hands. One master serves favicons, the small
in-app mark, install icons, extension icons and social images. The
[airier-limb adoption](../plans/261025i-airier-reader-limbs-across-the-icon-family.md) records the
exact source and validation; the earlier [A selection](../plans/261025b-one-textured-reader-across-tab-and-app.md)
explains why the separate optical mark was dropped.

- [Reader master](../../assets/brand/source/reader.png): the sole active artwork input, including
  wool texture, book and shading. [Prompt/input history](../../assets/brand/source/reader-generation.json)
  distinguishes generative renderings from exact pixel extraction. C is a new generative rendering,
  not a mathematically exact limb edit; prompt percentages are visual aims, not measured changes.
  The [previous master](../../assets/brand/archive/reader-before-airier-limbs.png) and
  [B/C studies](../../assets/brand/explorations/airier-limbs-prompts.json) preserve the comparison.
- [Former optical SVG](../../assets/brand/source/mark.svg): historical evidence only; no longer
  loaded by generation. The [flat reader study](../../assets/brand/archive/flat-reader-study-2026-10-25.svg)
  was B, considered but not selected. The separate upright-knot favicon direction was also dropped.
- [Archive](../../assets/brand/archive/) and [explorations](../../assets/brand/explorations/):
  previous masters and retained selection evidence. Change the master, then regenerate derivatives.

### Margin follows display size

> So I guess what I'm suggesting, the smaller the icon, the less margin.
>
> — Greg, 2026-10-25

Favicons and the shared small in-app mark nearly fill their image box, retaining only a sampling
allowance at the tips. Home-screen tiles use the middle fuller treatment Greg preferred; large
reader/social and theme exports retain their existing breathing room. Intended **display size**
matters: a high-resolution phone tile is still a small icon when installed.
The `BRAND_OUTPUTS` and `EXTENSION_OUTPUTS` tables in
[generate-brand-assets.ts](../../scripts/generate-brand-assets.ts) own exact inset values, measured around
the longest visible-alpha dimension. The
[margin follow-up](../plans/261025h-less-margin-in-smaller-reader-icons.md) records the choice and checks.

Ivory remains the default opaque phone background by agent judgment under Greg's instruction to
choose: it separates the dark book from the orange yarn better than charcoal. Dark remains an
export, not an automatically selected iPhone theme. [Apple's app-icon guidance](https://developer.apple.com/design/human-interface-guidelines/app-icons)
describes opaque full-bleed background layers and system-applied corner masks for native icons;
those native clear/layered appearances are not a promise about our flat web-clip PNG.
[WebKit's transparency report](https://bugs.webkit.org/show_bug.cgi?id=255596) documents unexpected
black backgrounds/borders with transparent web-clip icons; this historical report is a reason for
a predictable opaque tile, not a claim that every current iOS appearance forbids transparency.
[Apple-touch-icon takes precedence over manifest icons](https://webkit.org/blog/13878/) on the
web-app path. Physical iPhone appearance and cached installations still need device verification.

### Dark mode on an iPhone

> I'm in dark mode on my iPhone, and for some reason the new Spideryarn icon still has a white background.
>
> — Greg, 2026-10-26 (`spya-shpsvx`)

The likeliest thing he saw is the home-screen tile (`apple-touch-icon.png`), then the only icon
we shipped with an opaque, ivory background; the favicons and the in-page mark are transparent.
Asked (`q-q5da5a`), he chose:

> Maybe we can try and offer a switch between light and dark mode, but if in doubt, default to dark
> mode for the icon
>
> — Greg, 2026-10-26 (`spya-e50wvz`)

**So the touch icon follows the phone's mode when it is added, and is dark wherever that cannot be
known.** `index.html` names the charcoal `/apple-touch-icon.png`, and an inline script right after
it (`touch-icon-boot`) swaps in the cream `/apple-touch-icon-light.png` when
`prefers-color-scheme: light` matches, and again if the mode changes while the page is open. The
switch is the phone's setting, not a Spideryarn one: the home screen is the phone's, and the app's
Appearance choice says how the page looks, not what the home screen is. Everything that cannot
follow a mode takes the dark default: the Android manifest icons, a root `/apple-touch-icon.png`
probe, and the logo in our emails (`src/email-frame.ts` and the Supabase templates name the same
file, on a `#0a0a0a` header). [261026i](../plans/261026i-home-screen-icon-follows-the-phone-mode-dark-by-default.md)
is the plan.

**Why a script and not two `media`-qualified links.** WebKit's
[`LinkIconCollector.cpp`](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/html/LinkIconCollector.cpp),
read 2026-10-26, walks the direct children of `<head>` in the live DOM, takes each link's current
`href`, sorts by `sizes` with an unstable sort, and does not evaluate `media`; it passes attributes
on to Safari, whose code is closed. So a script-set `href` is read as set, and a media pair is a
guess. **What nobody here has checked on a phone**: whether Add to Home Screen uses the snapshot
taken after parsing (which the inline swap covers) or re-collects the live DOM (which would also
pick up a mid-visit change of mode), and what iOS 26's tinted and clear treatments do to either
tile. Greg's re-add is that check.

**There is no documented way to give a web clip a dark, clear or tinted variant.** Native apps
have had those since iOS 18 (clear since iOS 26), but nothing in `apple-touch-icon` or the
manifest says which appearance an icon is for. Developers asking on Apple's forums
([2024](https://developer.apple.com/forums/thread/761615), [June 2025](https://developer.apple.com/forums/thread/787919),
[September 2025](https://developer.apple.com/forums/thread/801448)) got no answer from Apple, and
[WebKit's Safari 26 notes](https://webkit.org/blog/16993/news-from-wwdc25-web-technology-coming-this-fall-in-safari-26-beta/)
add SVG icons but say nothing about appearances. What else is reported, none of it checked on a
current phone by us:

- **A transparent tile is filled with black**, in reports from iOS 16 (the WebKit bug above) and
  iOS 18 (the 2024 thread), so it does not follow the appearance either.
- **iOS's own tinted treatment** reaches web clips on the home screen; its automatic dark one was
  reported in 2024 to reach notifications and Settings but not the home screen.
- **Choosing the touch icon in JavaScript** from `prefers-color-scheme` when the page loads is
  reported to work (the 2024 thread): the clip keeps whichever was current when it was added,
  and does not switch later.
- **An SVG icon's own `prefers-color-scheme` rule is ignored** by Safari 26.3
  ([WebKit bug 309949](https://bugs.webkit.org/show_bug.cgi?id=309949)), and the home-screen
  image is taken once anyway.

iOS keeps the picture it took when the clip was added, so a changed tile shows only after the clip
is removed and added again; the `?v=` on the link is a defensive buster for Safari's own icon
caches (bump it when the pixels change), not for an installed clip. Production serves the icons
with `max-age=0, must-revalidate`, and no icon path has ever been renamed, so there is no old path
to clear.

One transparent treatment works in both app themes. Install tiles have opaque backgrounds and
breathing room for the OS's corner mask. Exact colours, padding, filenames and dimensions have
one home: the public and extension output tables in
[generate-brand-assets.ts](../../scripts/generate-brand-assets.ts).
The [manifest](../../public/site.webmanifest) uses ordinary `any` icons; no separately verified
maskable safe-zone treatment is supplied. The light/dark 1024px files are available exports.
The install tiles are charcoal, bar the cream touch icon for a light phone (above); the Chrome
extension's 128px store tile stays cream, being a different surface. The app's theme setting does
not select between any of them.

## Updating the artwork

1. Read the intent above and the investigation before changing the character. Archive the previous
   reader master and generation provenance under a descriptive version name; keep
   selected intermediate variants and the exact input/prompt for an AI edit. The current sources
   must live in Git, not only in an image tool's output directory.
2. Refine the detailed artwork with genuine transparency, including through the body and limb gaps.
   Preserve opaque book pages. Do not introduce a second artwork source for small sizes. The [limb-refinement plan](../plans/261024a-reading-spider-limb-refinement.md)
   shows the archived inputs and why concealed paths are not a literal limb-length measurement.
   Deliberately refresh the selected-master identity guard in [brand tests](../../tests/brand-assets.test.ts)
   and the independently annotated source/hash in [anatomy checks](../../tests/semaphore-geometry.test.ts)
   when accepting a new master; do not weaken the checks to accommodate an unreviewed file.
3. Regenerate and check from the repository root:

   ```sh
   npm run brand:update
   npm run brand:check
   ```

   The aliases in [package.json](../../package.json) own the command sequence and focused test list.
   `brand:update` rebuilds public/extension PNGs and ICO, both size-review sheets, the browser review page and static animation proof, then
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
The [Chrome extension](chrome-extension.md) uses the same master on cream. `brand:update` and
`brand:check` now generate/check `extension/icons/` as well as the public family; the
[build](../../scripts/build-extension.ts) packages those committed icons. Rebuild its package after
an artwork change. Building/pushing assets does not submit a store update; the extension guide
owns versioning and publication.

[Brand tests](../../tests/brand-assets.test.ts) cover alpha, gaps, padding, ICO pixels and declared
dimensions; [OG tests](../../tests/og-card.test.ts) cover its separate structural contract.
For live page/theme/motion checks, start at [browser-control.md](browser-control.md) and use the
machine's prescribed mechanism. Record unavailable checks as unavailable, not passed.
