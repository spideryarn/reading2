# Redesign the signed-out marketing pages

`/` and `/features` are honest, well-written and visually flat. Greg, 2026-09-03: *"We want to work
on the Home page for non-logged in users at `/` and also `/features`, to make them look more
attractive."* This is that work.

## What was measured first

Playwright against system Chrome, 1440×900, of the pages as they stood on 2026-09-03:

| | Home | Features |
|---|---|---|
| Page height | 4,872px | 11,042px |
| Words | 811 | 1,052 |
| Product imagery above the fold | none | none |

And what the screenshots showed:

- The first 900px is a wordmark, two lines of tagline, a boxed beta strip, and a **large "Already
  have an account? Sign in" panel**. The lead product shot begins below the fold.
- Every `Shot` is `border-border` on `bg-card` — `--card` is `oklch(0.205 0 0)`, `--background` is
  `oklch(0.145 0 0)`, `--border` a touch above both. Three greys within 0.13 of each other, so a
  dark app screenshot on the dark page reads as a smudge rather than an object.
- The lead shot, `glossary-card.png`, is about half filled by a **white figure from the article**,
  and the glossary card — the point of the shot — sits on top of that white box. Greg named this
  one: *"I saw one screenshot that was about the Glossary, but it included an image above in the
  text, which might confuse the reader."*
- Body copy is `text-muted-foreground` at `0.95rem` throughout. Marketing type on the sites the
  research surveyed runs 3–5× the body size at the hero; ours runs about 2×.
- `/features` is fourteen screenshots stacked vertically with captions.

## The decision Greg made, and the advice he made it against

Offered three postures — tidy it, restructure it, or go full modern-SaaS (glows, large display
type, tilt, bento, scroll-reveal) — **Greg chose full modern-SaaS**, 2026-09-03.

Both consultations had recommended the middle one, and on brand grounds:

- **Fable**: *"(c) is out on brand grounds and 'prefer boring': glows and scroll-reveal are the
  visual grammar of the products whose anti-goals vision.md lists."*
- **The research** ([260903b-landing-page-design-research.md](../research/260903b-landing-page-design-research.md)):
  of the six comparable sites fetched, the one closest to this brand — Matter, a
  restraint-branded reading product — *"goes further than 'toned down' … no gradients, no
  animation, screenshots shown plainly"*.

The option Greg picked was labelled with that cost when he picked it. **It is recorded here rather
than quietly absorbed**, in the same spirit as
[vision.md § Prefer boring](../project/vision.md#prefer-boring)'s two exceptions: a principle
overridden without anybody noticing stops governing anything. The anti-goals themselves are
untouched — nothing on the page promises less effort, no engagement mechanic appears, and every
claim still links back.

So: build (c), and spend the craft on making it good rather than loud. Where Fable's structural
advice does not conflict with Greg's choice, take it — it is the same advice the research gives,
and most of it is about competence rather than posture.

## The simpler option passed over

**Tidy the existing single column** — fix the contrast, frame the screenshots, tighten the rhythm,
change nothing structural. Rejected because Greg rejected it, and because it does not fix the
actual defect: the hero comment in `SiteBits.tsx` calls the lead shot *"the point of the page"* and
it is below the fold behind a sign-in panel. No amount of contrast fixes an absent picture.

## No new dependency

The research evaluated Motion (45.6KB gzip for two static pages), `react-intersection-observer`,
shadcn's official blocks (dashboard-shaped, not marketing-shaped), Tailwind Plus and
shadcnblocks.com (both copy-paste references at a one-time price, not installs), and mesh-gradient
packages (none maintained). **Nothing is worth adding.** Scroll-reveal is native CSS
`animation-timeline: view()` at 86% support, authored visible-by-default so Firefox — which has not
shipped it — simply sees static content.

That keeps [vision.md § Prefer boring](../project/vision.md#prefer-boring) intact on the tooling
axis even though the visual posture went the other way. No third framework exception.

## Where the new styles live

A block of semantic classes in [`src/web/styles.css`](../../src/web/styles.css), not utility soup
in the JSX. [design-css-overview.md § Which mechanism owns what](../project/design-css-overview.md#which-mechanism-owns-what)
puts anything that reads as a *system* there, and a hero glow, a screenshot frame, a bento grid and
a reveal are used on both pages — which is what makes them a system rather than a one-off. The
`tw:` utilities stay for per-element nudges.

## The build

**Stage 1 — the shared furniture.** A sticky translucent top nav and a footer, extracted so both
pages carry the same one; a `WindowShot` that frames a screenshot as a raised object; the glow, the
bento and the reveal as classes in `styles.css`.

**Stage 2 — the home page.** Hero with product shot above the fold; sign-in panel moved to the
foot; copy reordered per below; alternating text/shot sections; bento for the feature list.

**Stage 3 — the features page.** Grouped sections, one large shot per group with the rest of that
group's modes as small tiles. Target roughly half the current height.

**Stage 4 — the screenshots.** Greg, 2026-09-03, chose *retake only the bad ones*. That is the
glossary card above all, and any other shot that does not show its own feature cleanly. A small
number of fresh articles are being ingested locally so the shots are not all of one essay.

## Copy

Greg's words are load-bearing here — [positioning.md § Whose words](../project/positioning.md#whose-words)
— so this is **reordering and cutting, not writing**. Every sentence keeps its provenance comment.

- **Promote** the dog-eared-book sentence to sit directly under the hero shot. It is the most vivid
  thing he has said about the product and it is currently the second paragraph of the third section.
- **Promote** "And deliberately not" out of the gap between the principles and the prices.
- **Cut the duplicates**: "A companion, not a replacement" appears twice; "keeps bringing you back
  to the original text" appears twice.
- **Move** "Who it's for" below the shots — a stranger asks whether it is for them after seeing
  what it is.

## The lead shot

Changed from the glossary card to **the outline**. The plan that chose the glossary
([260902k](260902k-website-copy-homepage-and-features.md)) called it for a good reason — Greg's own
image of the product is a clever friend's scribbles in a margin — but the asset does not carry it:
half of it is a white figure, and the card sits on the white. The outline shot is the whole app in
one frame, it is what he named first when asked what the product does, and it makes the strapline's
"orients" literal. The glossary keeps second place, retaken over dark prose.

## How we'd know it worked

Page height down on both. A product shot inside the first 900px. Every screenshot legible as an
object against the page. `npm test`, `npm run typecheck`, and `tests/landing-assets.test.ts` still
green — it reads `shots.ts` and checks every declared size against the bytes on disk, so a retaken
screenshot with new dimensions fails it until the record is updated.

## What actually happened

Measured the same way, at 1440 wide, when the work landed:

| | Before | After | Aim |
|---|---|---|---|
| Home | 4,872px | 7,244px | — |
| Features | 11,042px | 11,698px | ~5,500px |
| Product image above the fold | none | the outline shot | yes |
| Landscape shot drawn at | 768px (53% scale) | 1152px (80%) | legible |

**The height goal was missed, and not narrowly.** Two of the three claims above are met and this one
is not, so it is worth saying why rather than quietly dropping it.

Regrouping the features page did save height — the six tall band shots went from six stacked
full-width figures to two rows of three. **Widening the pictures gave it all back and more.** A
landscape shot went from 768px wide to 1152px, which is half as tall again, seven times over.

That trade was made deliberately, part-way through, on seeing the first build: at 689px in a
two-column row the app's own prose rendered at 48% — legible as a texture and not as words. A page
whose argument is that you should read carefully cannot show unreadable reading, so **legibility won
and length lost.** Retaking the four worst shots and tightening the rhythm took about 700px back;
the honest summary is that `/features` is as long as it was and the pictures on it are now worth
looking at.

**If length is worth more than this**, the lever is demoting two or three of the seven `/features`
showcases to `Tile`s — the page would lose those pictures rather than shrink them, which is the
trade that was actually available and was not taken.

---

Up: [docs/plans/](.)
