# Controls: one height, one radius, one hover

> **Split out of [design-css-overview.md](design-css-overview.md) on 2026-09-07**, verbatim apart
> from the heading levels and a couple of "see above" links that had to become cross-doc ones. That
> doc is still the map — the stylesheets in load order, which mechanism owns what, the colour
> tokens. This is one area of the territory.

Added 2026-08-27, after Greg looked at the shelf and said the buttons were ugly. He was right, and
the reason turned out to be one line of CSS rather than taste.

## The reset covered a minority of what it named

We do not import Tailwind's preflight (the header of
[`tailwind.css`](../../src/web/tailwind.css) says why, and it is a good reason — it would reset the
article author's own HTML inside `.prose`). The replacement was scoped to `[data-slot]`, the
attribute shadcn stamps on everything it generates.

Most of the buttons in this app are not shadcn's. Measured on the shelf that morning:

| | before | after |
|---|---|---|
| buttons carrying the UA's own `2px outset white` border | **36 of 59** | 0 |
| buttons with `cursor: default` | **59 of 59** | 0 |

Both numbers are the same bug. A browser's default `border-style` for a `<button>` is not `none`,
it is `outset` — and no colour utility touches a border's *style*, so `tw:border-border` on a
hand-rolled button recoloured a border that was still white and still 2px. Tailwind v4's preflight
also dropped v3's `button { cursor: pointer }`, and shadcn does not set it, so nothing in the app
had it.

You could see the first one: the shelf's cards/table toggle was **two bright white boxes**, 33px
tall in a 38.6px fieldset, standing a head above the 26px pills beside it. `SortChips` in
[`lib/DataTable.tsx`](../../src/web/lib/DataTable.tsx) already carried a bare `tw:border-0` with no
comment — somebody hit this, fixed their own fieldset, and had no reason to think it was general.

This is [silent-success](../reusable/silent-success.md) again, and it is the *same shape* as the
story `tailwind.css` already tells two blocks further down: the previous app's
`prefers-reduced-motion` guard covering two class names while fifteen animations ran regardless. A
reset that is present, documented, and covers a minority of what it names. **The check that would
have caught it is one line in a console** — count the buttons whose computed `border-style` is
neither `none` nor `solid` — and it is worth running after anything that touches this file.

The same block was missing the *font* as well. A UA gives `<button>` its own 13.333px Arial, which
beats inheritance, and `tw:text-sm` sets a size and leaves the family alone — so every button that
set no font of its own, shadcn's included, was Arial on a Geist page; "Sign in with Google" on the
live landing page was, on 2026-09-04. Greg had seen the symptom on the Metadata page the day before
(*"some of them seem larger than others somehow?"*), and the fix there was **deliberately scoped to
that page rather than made global**, because forty-odd buttons under `src/web/styles/` set their
own font and had been laid out against the UA face beneath them. It went global the next day anyway, in
`base`: that layer sits below `app`, so every one of those rules and every utility still wins, and
what changes is the buttons that set nothing — which were the bug.

**The global version is two longhands, `font-family` and `font-size`, and not preflight's
`font: inherit`** — because the shorthand also sets `line-height`, and `body` is 1.55 against a UA
button's `normal`. That would have made every button setting only a `font-size` about 5px taller;
there are five such rules and four are on signed-in surfaces, so the shorthand's blast radius was
the earlier decision's objection made real. The longhands fix both symptoms that were observed —
the wrong face, and the wrong *size* on a button carrying no type of its own, which is what made
the shut section headings draw half again the size of their neighbours — and cannot change any
height. Buttons only; `input`, `select` and `textarea` keep their UA fonts until someone sees a
wrong one. The console check above gains a second line: count the buttons whose computed
`font-family` is not the page's.

**Three findings from one block is enough, so there is a checklist now.**
[`tests/preflight-substitute.test.ts`](../../tests/preflight-substitute.test.ts) reads Tailwind's
real `preflight.css` out of `node_modules`, pulls out every property it sets on a `<button>`, and
requires each one to be mirrored in our `@layer base` block or listed with a reason for skipping it.
It cannot know our block is *correct* — nothing can. It can know that nobody has decided about a
property preflight thinks a button needs, which is the state all three findings were in, and it
fails on the next Tailwind upgrade that adds one.

## The other half of the same hole: images

Found 2026-08-27, when Greg said the screenshots on the landing page *"look warped somehow"*. They
were: stretched vertically by about **1.95×**, every letter in them twice as tall as it should be.

The same missing preflight, in a place nobody thought to look. `width` and `height` on an `<img>`
are not merely hints about aspect ratio — the HTML spec maps them to CSS `width` and `height` as
**presentational hints**. [`LandingPage.tsx`](../../src/web/LandingPage.tsx) sets both (deliberately,
so the page does not jump as a large capture lands) and then sizes the image with `tw:w-full`. The
utility overrode the width; nothing overrode the height. So a 1245×815 screenshot was drawn 640 CSS
px wide and still 815 tall, and 1245/640 is exactly the 1.95 you can see.

Three things kept it hidden, and all three are worth naming:

- **The file was never wrong.** [`landing-assets.test.ts`](../../tests/landing-assets.test.ts) reads
  the JPEG's own header and checks it is the shape the page reserves space for. It passed, because
  it was true. The test is about the *asset*; the bug was in the *rule*.
- **`.prose img` in [`styles/prose.css`](../../src/web/styles/prose.css) has carried
  `height: auto` all along**, so every image inside an article was fine. Only chrome images were affected — a split that stops
  anyone suspecting something global.
- **The page around it looked perfect.** This reads as "the screenshots look odd", which sounds like
  a capture problem, not a stylesheet one.

The fix is preflight's own rule, `img, video { max-width: 100%; height: auto }`, in `@layer base`
alongside the button reset — so an explicit height in `app` or a `tw:h-*` utility still wins. The
`max-width` half comes with it: an image overflowing its column is the other face of the same
surprise.

Two general lessons. **A hand-written reset is a list of the cases you happened to think of**, and
this one was written while looking at buttons — so widening it once for buttons did not widen it for
anything else. And **an HTML attribute that also sets CSS is a rule you did not know you wrote**;
`width`/`height` on an image are the common one, and the moment a utility sets only one of the pair,
they stop being about aspect ratio and start being about size.

## Two hover languages, and the orange one won

`--accent` is a raised dark grey **surface**, not the orange; both `styles/tokens.css` and
[`src/web/styles/tokens.css`](../../src/web/styles/tokens.css) carry shouted comments about that
name. shadcn's `outline` and `ghost` both hovered to `bg-accent`, while every hand-rolled control
on the shelf hovered to `bg-highlight/10`. Same page, two answers.
The variants were repainted to the app's own; see the header comment in
[`button.tsx`](../../src/web/components/ui/button.tsx), which is now **two** local edits rather than
one.

`outline` lost more than a hover. It shipped `dark:bg-input/30` over `bg-background` plus
`shadow-xs`, and every `dark:` here means *always* (the `@custom-variant` in `tailwind.css`), so it
rendered as a muddy translucent grey slab — `oklab(0.3 0 0 / 0.3)` — under a 5%-black drop shadow
that a near-black page cannot show. That is what made **Add**, the one thing the shelf exists to let
you do, the quietest control on the page. It is `default` now, and orange.

One more thing that only bites on a dark ground: `hover:bg-primary/90` composites the orange over
what is behind it, so the stock hover makes an orange button **darker**. `hover:brightness-110`
instead.

## The numbers

Not a scale — the page has no spacing scale and this does not invent one — but the controls on a
list page now agree, and agreeing is the whole of it:

| | height | radius |
|---|---|---|
| sort chips, Unread, Undo, Show archived, card icon buttons, the view toggle | **28px** (`h-7` / `size-7`) | pill for state, `rounded-md` (8px) otherwise |
| the view toggle's two halves | 24px (`size-6`) inside the 28px box | `rounded-sm` (6px) = outer 8 − 2px padding |
| shadcn `size="sm"` | 32px | `rounded-md` |
| shadcn `size="default"`, and the inputs beside it | 36px | `rounded-md` |

The chip is stated as a **height**, not as padding, in `chipClass` in
[`lib/DataTable.tsx`](../../src/web/lib/DataTable.tsx) — that is what lets an icon-only control in
the same row agree with a text one without anybody redoing the arithmetic when an icon changes. It
is exported because the shelf has two more chips of its own
([`ShelfControls.tsx`](../../src/web/ShelfControls.tsx)) and the class string had been copied out
character for character.

## See also

- [design-css-overview.md](design-css-overview.md) — the map this was split out of:
  the stylesheets in load order, which mechanism owns which rule, and the colour tokens
- [narrow-windows.md](narrow-windows.md) — what a narrow window does to a row of these
