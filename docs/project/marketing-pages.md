# The marketing pages, and how to shoot them

`/` and `/features` — the two pages a stranger sees before they sign in. This doc is the **how**:
how the visual language works, how to take a screenshot that shows what it is meant to show, and
how to photograph the pages themselves without a lying picture.

The **what** lives elsewhere and is not repeated here. [positioning.md](positioning.md) is who the
pages speak to and whose words they use; [website-text.md](website-text.md) is the copy and the
contact address; [design-css-overview.md](design-css-overview.md) is the app-wide visual map that
this sits under.

## The pieces

| File | What's in it |
|---|---|
| [`src/web/LandingPage.tsx`](../../src/web/LandingPage.tsx) | `/` — the hero, the pictures, the bento, the plans, the sign-in panel |
| [`src/web/FeaturesPage.tsx`](../../src/web/FeaturesPage.tsx) | `/features` — every mode, grouped |
| [`src/web/SiteBits.tsx`](../../src/web/SiteBits.tsx) | the furniture both pages share, so they cannot drift into two |
| [`src/web/Plans.tsx`](../../src/web/Plans.tsx) | the three plans, on both pages |
| [`src/web/shots.ts`](../../src/web/shots.ts) | every screenshot: file, pixel size, alt text |
| `styles.css` § the site | the `site-*` classes — the whole visual language, in one block |

The 2026-09-03 redesign, including the posture Greg chose and the advice he chose it against, is
[260903g-redesign-the-signed-out-marketing-pages.md](../plans/260903g-redesign-the-signed-out-marketing-pages.md).

## Shooting a screenshot of the product

This is the part that goes wrong, and it went wrong in a way worth naming. Greg, 2026-09-03:

> Try and make sure each screenshot shows exactly what we're trying to show (e.g. I saw one
> screenshot that was about the Glossary, but it included an image above in the text, which might
> confuse the reader).

### One shot, one idea

**If anything in the frame is more eye-catching than the feature being named, the shot has failed.**
That is the whole rule; the rest is consequences of it.

- **No article figures, images, diagrams, tables or code blocks in the frame.** On a near-black
  screenshot a white box is the brightest thing on the page and the eye goes straight to it. This is
  the specific failure Greg named: four of the site's shots were of one essay at one scroll
  position, and a neuron diagram sat in every one of them — including the glossary card, which was
  *on top of* the white box it was competing with. Scroll to pure prose.
- **The feature must be unmissable and unambiguous.** A glossary shot needs the card open over dark
  prose with underlined terms visibly around it. A search shot needs several hits marked. A zoom
  shot needs columns that visibly differ in detail.
- **Nothing half-cut.** A panel sliced by the frame edge reads as a rendering bug.
- **Crop the dead space**, especially at the bottom. These are drawn at the full width of the page,
  so 100px of image height is 80px of scrolling for every reader, forever.
- **Nothing embarrassing**: no debug text, no error toast, no `undefined`, no real email address.

### Vary the article

Until 2026-09-03 nearly every picture on the site was of one essay, *The Mythology of AI
Consciousness*. A site whose every screenshot is the same piece looks like a product that has been
tried on one piece. Shoot different modes against different articles; the local library has enough.
Correctness of the frame still beats variety — if one article gives the only clean glossary card,
use it.

### The mechanics

Headless system Chrome driven by `playwright-core`, per
[browser-control.md](browser-control.md) — on the remote box that is the only option, and the
extension cannot follow you there. Sign in with
[`scripts/browser-sign-in.ts`](../../scripts/browser-sign-in.ts), which types into the real form as
the seeded local admin.

Viewport 1440×900 at `deviceScaleFactor: 2`, then downscale to about twice the width the image is
drawn at, then `pngquant --quality 65-92 --speed 1`. **PNG rather than JPEG**: small light text on a
near-black ground rings around every glyph as a JPEG, and a UI screenshot has few enough flat colours
that a quantised PNG is smaller anyway.

Assets are imported by `shots.ts` rather than dropped in `public/`, so Vite hashes them and a
redeploy cannot serve a stale one.

### When you retake one, three things move together

1. The bytes in `src/web/assets/`.
2. `w:` and `h:` in [`shots.ts`](../../src/web/shots.ts) — and `alt:`, if the picture now shows
   something else.
3. A green [`tests/landing-assets.test.ts`](../../tests/landing-assets.test.ts), which reads that
   file and checks every declared size against the PNG header on disk.

That test is not ceremony. An `<img>` with `width: 100%` uses its `width`/`height` attributes only to
reserve an aspect ratio, so a wrong pair is invisible jank — and worse, `height` is a *presentational
hint*, which is how a 1245×815 capture once drew 640px wide and still 815 tall, every letter in it
stretched 1.95×, on a page that otherwise looked completely fine. The story is in
[`tailwind.css`](../../src/web/tailwind.css)'s image block.

## Screenshotting the pages themselves, for review

**A full-page capture of these pages lies, twice.** Both are capture artifacts rather than page bugs,
and both are indistinguishable from real bugs in a picture — which is the
[silent-success](../reusable/silent-success.md) shape pointed at your own eyes.

- **Every reveal below the first viewport comes back blank.** Playwright's `fullPage` stitches
  without really scrolling, so a `animation-timeline: view()` section never enters the view and keeps
  its start state.
- **Composited frames come back empty** — a screenshot inside a transformed element renders as its
  own background colour.

So: **capture one viewport at a time, scrolling between shots.** That is what a reader sees anyway.
If you must take a full-page shot, inject
`.site-reveal,.site-tilt,.site-nav{animation:none!important;opacity:1!important;transform:none!important}`
first — the same override `@media print` carries, and for the same reason.

Before believing any of it, check the DOM rather than the picture: `naturalWidth`, `complete` and
computed `opacity` on every `img`. That is what settled it here, after half an hour of believing the
page was broken when it was not.

## The visual language, and the four rules in it

All of it is `site-*` classes in one block at the foot of
[`styles.css`](../../src/web/styles.css), with the reasoning beside each rule. Four things there are
decisions rather than taste, and are the ones to preserve:

- **One glow per page.** Behind the hero, nowhere else. Every comparable site the research surveyed
  uses its gradient exactly once; repeated, it stops reading as emphasis and becomes wallpaper.
- **The hero tilt straightens as you scroll.** A tilted screenshot of a *reading* product is arguing
  against itself held still, so it arrives at an angle and is flat by the time you have read a
  sentence of the page.
- **Reveals and tilts are authored in their finished state**, with the animation layered behind
  `@supports (animation-timeline: …)`. Firefox has not shipped scroll-driven animation, so anything
  authored the other way round is invisible content, not a missing flourish.
- **Depth comes from a hairline and an inset top highlight, not from a drop shadow.** A black shadow
  on a near-black page does almost nothing; the 1px lit top edge is what makes a dark screenshot read
  as a raised object. The app's own `--background` / `--card` / `--border` are three greys within
  0.13 of each other, which is why the site block stages its own surfaces in translucent white — and
  why those values must not be lifted into `tokens.css`.

**Landscape shots go full width, not into a two-column row beside their caption.** A 1440px capture
drawn 689px wide renders the app's own prose at 48% — legible as a texture, not as words. A page
selling careful reading cannot show unreadable reading.

### The reduced-motion guard here is its own, and testing it needs care

`tailwind.css`'s global guard sets `animation-duration: 0.01ms !important`, which is the right
instrument for a time-driven animation and **does nothing whatever to a scroll-driven one**: CSS
Animations Level 2 treats a time duration on a scroll-progress timeline as `auto`, so the scroller
still drives it. The site block therefore carries its own `prefers-reduced-motion` block that turns
the animations *off*. Found by a cross-family review, 2026-09-03; the guard was present, documented,
and missed every piece of motion on the page.

The obvious check passes either way, which is the part worth remembering. Reading back
`animation-duration` returns `0.01ms` whether or not the animation is still running. **Assert on
`animation-name` and on `transform` instead**, in a Playwright context with
`reducedMotion: 'reduce'` — and assert that a `no-preference` context *differs*, or the check is
green for the wrong reason. Verified that way on 2026-09-03: `none` for tilt, reveal and nav under
`reduce`, and `site-untilt` / `site-rise` / `site-nav-settle` without it.

## The copy is not yours to write

Every sentence on both pages carries a comment naming its source, or `[tissue]` for the connecting
lines an agent wrote. Restructuring may move a sentence; it may not rewrite one.
[positioning.md § Whose words](positioning.md#whose-words) is the rule and Greg's reason for it.

And **a claim on these pages is checked against the code, never against a doc about the code**. The
page said "six diagrams" for a day, having been written from a doc, when there were four.

## Before you call it done

`npm test` and `npm run typecheck`; `tests/landing-assets.test.ts` specifically if any picture
changed. Then look at both pages at 1440 and at 390 wide, a viewport at a time, and ask of every
screen: *what is this screen for, and is that the thing the eye lands on?*

---

Up: [design-css-overview.md](design-css-overview.md)
