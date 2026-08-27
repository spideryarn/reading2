# Tooltips

> In the left-most column, add a nice hover-tooltip to show more detail somehow.
>
> — Greg, 2026-08-25

The left-most column is [the spine](granularity-zoom.md#the-spine-a-birds-eye-rail), and that is
what makes a tooltip more than decoration here. The rail is **proportional**: each part and section
gets vertical space in proportion to how much of the document it occupies, which is what makes it a
real position indicator, and which also means a short section is a two-pixel sliver with no room for
a word. The design accepted that cost knowingly. The tooltip is where the cost gets paid back.

So this is not "a label, but on hover". It is the one surface in the rail that can hold a sentence.

## What we chose

**[Floating UI](https://floating-ui.com) — `@floating-ui/react`**, v0.27.20, added 2026-08-25.
One dependency, ~10kB gzipped, MIT.

Picked by the process in
[third-party-library-selection.md](../reusable/third-party-library-selection.md), whose first and
loudest criterion is *long-lasting community, lots of docs and discussion* — because that is also
what makes a library well-represented in the training data of the models writing against it.

| Candidate | Verdict |
|---|---|
| **`@floating-ui/react`** | **Chosen.** The positioning engine the others are built on — it is Popper.js's successor by the same author, so a decade of Popper questions and answers describe the same model. ~6M downloads/week. Headless: it positions and it handles interaction, and ships no CSS, which suits a bespoke dark palette. TypeScript-first, hooks-based, tree-shakeable. |
| `@radix-ui/react-tooltip` | A close second, and a fine answer. It wraps Floating UI and adds WAI-ARIA conformance out of the box. Passed over because it brings a `Provider` + `Portal` + `asChild` component convention this repo uses nowhere else — we lifted shadcn's *tokens* from the original app, not its components — and because its tooltip is deliberately restricted to non-interactive descriptive text. We would have been styling someone else's structure to look like ours. |
| `@tippyjs/react` | **In maintenance mode as of April 2026**; development moved to Floating UI, which Tippy already used internally. Ruled out on the first criterion, which is about longevity. |
| `react-tooltip` | Fine for a quick `data-tooltip` attribute; the API is string- and attribute-shaped rather than composition-shaped, and it fits rich, per-item content less well. |
| Hand-rolled | Rejected. The work is not "put a div next to the cursor" — it is collision handling, hover intent, and dismissal, which is exactly the list of things that are subtly wrong in every hand-rolled tooltip. |

### Revisited the same day, and narrowed

Later on 2026-08-25 the repo adopted Radix, via shadcn components
([web-client.md § Tailwind and shadcn](web-client.md#tailwind-and-shadcn-components)). That
re-opened the row above, and the answer is **unchanged but resting on less**. Worth writing down: a
decision re-affirmed for a narrower reason is a weaker decision than it was, and the next person
should know which leg it is standing on.

- **One of the two reasons expired.** *"It brings a `Provider` + `Portal` + `asChild` component
  convention this repo uses nowhere else"* is simply no longer true — `radix-ui` is installed and
  that convention is now in the controls bar and the masthead.
- **The other stands, and decides it alone: the grouping.** Once one band's tooltip is open,
  neighbours open instantly **and the fade drops to zero** while the pointer keeps moving
  ([§ Grouping](#grouping-and-why-the-delays-are-what-they-are)). That is `useDelayGroup`'s
  `isInstantPhase` feeding `useTransitionStyles`. Radix's `Tooltip.Provider` has `delayDuration` and
  `skipDelayDuration` — the *timing* half — but no equivalent of `isInstantPhase`: it animates from
  `data-state` attributes in CSS, which do not distinguish "opening cold" from "opening warm". Radix
  could probably reach parity with enough custom CSS, at the cost of re-proving a tuned interaction
  that already works, on the one surface where the tooltip *is* the feature.
- Two smaller costs, from the registry sources: shadcn's `tooltip.tsx` is a deliberately inverted
  one-liner (`bg-foreground text-background … text-xs`), and ours is a raised dark card carrying
  crumb, title, gist, sub-section list and footer — migrating `BandCard` into it means overriding
  essentially every class it ships. And it is the only component in the shortlist that needs
  `tw-animate-css`, a dependency bought solely for this swap.

Radix is modestly better on two of the four traps below — it owns the two-element transform problem,
and its arrow is a plain rotated div rather than an SVG with `fill`/`stroke` props. If "one component
library, no exceptions" ever becomes the rule, that is a defensible reason to switch. Do it alone,
last, and accept the scrub feel degrading: the risk is not correctness, it is that the spine stops
feeling like one surface, which is invisible in a screenshot and obvious in use.

Sources, read 2026-08-25: [Floating UI docs](https://floating-ui.com/docs/react),
[`@floating-ui/react` on npm](https://www.npmjs.com/package/@floating-ui/react),
[floating-ui/floating-ui releases](https://github.com/floating-ui/floating-ui/releases),
[PkgPulse, "Floating UI vs Tippy.js vs Radix Tooltip 2026"](https://www.pkgpulse.com/blog/floating-ui-vs-tippyjs-vs-radix-tooltip-popover-2026).

## Where the code is

| File | What it does |
|---|---|
| [`src/web/Tooltip.tsx`](../../src/web/Tooltip.tsx) | the wrapper: `<Tooltip content={…}>{trigger}</Tooltip>`, plus `TooltipGroup` |
| [`src/web/Spine.tsx`](../../src/web/Spine.tsx) | `BandCard` — what a spine band actually says |
| [`src/web/ProseHoverCard.tsx`](../../src/web/ProseHoverCard.tsx) | the other one — see below |
| [`src/web/styles.css`](../../src/web/styles.css) § tooltip | every pixel of the appearance; the library ships none — [design-css-overview.md](design-css-overview.md) says where that file sits in the load order |

`Tooltip` is deliberately generic — nothing in it knows about the spine. The obvious second customer
is a gist cell in [`TableView.tsx`](../../src/web/TableView.tsx), where a long summary is clipped by
its column.

### The second implementation, and why there is one

`ProseHoverCard.tsx` (2026-08-26) does not use `Tooltip`, and the reason is not that it wanted something
different — it is that `Tooltip`'s whole interface is *wrap a React element*. Its triggers are the
`<mark>`s in the verbatim column, which are **injected HTML**: the prose goes in through
`dangerouslySetInnerHTML` because [`annotate.ts`](../../src/web/annotate.ts) cuts the text nodes and
labels the pieces, so there is no component to clone a ref onto. And there are hundreds of them on a
long article, so one instance per occurrence would be hundreds of Floating UI instances for the one
the reader is pointing at.

So it is **one** floating panel for the whole page, positioned with `setPositionReference` against
whichever mark the pointer is on, and the hover intent is a delegated `pointerover` listener plus two
timers rather than `useHover` and `getReferenceProps`. Floating UI still does the hard half — flip,
shift, and repositioning while the page scrolls.

Since 2026-08-27 it has a third set of triggers and still one instance: the **links a chat answer
writes into its prose**, plus the source list under it ([links.md § The links chat writes](links.md#the-links-chat-writes)).
That cost one selector, which is the argument for the hook made twice. It also forced the selector to
name its places — it had been a bare `a[href]` on the document, and so had been firing on the
masthead, on citation chips and on this card's own buttons.

It is also the only one a **finger** can open: a tap on a glossary mark reveals the card and a second
tap commits, which is `bandPress`'s rule reached by a different route
([touch.md](touch.md), [touch-glossary-card.md](../plans/touch-glossary-card.md)). The spine's
tooltips get there through `Tooltip.tsx`'s `mouseOnly`; this one owns its own listeners, so the whole
gesture lives in `useHoverCard.ts`.

It is also the one tooltip here that **takes pointer events**, because its card carries a link out
and a button in; every other one is `pointer-events: none` so that a panel can never land under the
pointer and keep itself open. If a third customer ever has both properties — many triggers that are
not React elements — that is the point at which this becomes a shared hook rather than a second file.
[glossary.md § The hover card](glossary.md#the-hover-card) has the rest.

## What the card says, and why that

Top to bottom: the **part** it belongs to, the section **title**, its **gist**, the **sub-sections**
inside it, and a footer of **words** and **how far into the piece** it sits. That is the answer to
four different questions a reader can have about a band they cannot read — what is this, what is it
about, what is inside it, how big is it and where am I.

`navLabel` may appear here in place of a gist, and only because the spine is one of the two places
the node shape explicitly sanctions navigation chrome
([granularity-zoom.md § Node shape](granularity-zoom.md#node-shape)). It is styled differently, and
it is never a fallback for a missing gist in the reading view.

Listing the sub-sections is why [`App.tsx`](../../src/web/App.tsx) builds the outline three levels
deep rather than two. The rail itself still only ever draws L1 and L2.

## Four things that are load-bearing

Each of these is a way the obvious version fails silently.

1. **The floating node is two elements.** `floatingStyles` positions with a `transform`, and the
   open/close transition also wants one. One element cannot carry both — the animation fights the
   placement. Outer div positions, inner div animates. Floating UI's own recommendation, and the
   reason `useTransitionStyles` returns styles separately instead of merging them.
2. **It portals to `<body>`.** The spine is `overflow: hidden` and has to be — its bands are
   absolutely positioned in percentages of the document height and would otherwise spill out of the
   rail. Anything rendered *inside* the rail is therefore clipped to 1.5rem — the rail's whole
   width, since the expanded 13rem form was deleted on 2026-08-26. `<FloatingPortal>` is what stops
   a 22rem panel becoming a 24px one, and it is now the only thing standing between the reader and
   an unreadable card.
3. **The arrow's `fill` and `stroke` are props, not CSS.** Given a `strokeWidth`, `FloatingArrow`
   draws a second clipped path for the border and paints over the seam where the arrow meets the
   panel using the `fill` value it was passed. A stylesheet rule wins the cascade over the
   `stroke="none"` it puts on the fill path, and you get a line straight across the arrow's mouth.
   `var(--surface-raised)` works as an attribute value because presentation attributes are parsed as
   CSS values.
4. **The tooltip is the trigger's *description*, not its name.** `useRole` wires the panel up as
   `aria-describedby`. The spine's bands used to get their accessible name from the `title`
   attribute the tooltip replaced, so the name has to be restated as `aria-label` — otherwise a
   screen reader meets fifty anonymous buttons.

## Grouping, and why the delays are what they are

Open 240ms, close 90ms, wrapped in a `<TooltipGroup>`. The group is the interesting half: once one
tooltip is open, its neighbours open *instantly* while the pointer keeps moving, and the fade is
dropped to zero in that phase because a fade reads as lag when the panel is meant to be tracking the
pointer. The rail stops being fifty separate waits and becomes something you can scrub.

240ms is long enough that crossing the rail on the way to the article does not fire a dozen
tooltips. 90ms to close is short but not instant, so a wobble between two adjacent bands does not
blink the panel out and back.

## Checking it in a browser

[browser-testing.md](browser-testing.md) is the general how, and its warnings all apply — in
particular **do not judge the panel from a screenshot**. A screenshot taken during the 120ms fade
shows a transparent tooltip with the prose behind it bleeding through, which looks exactly like a
missing `background`. `getComputedStyle(document.querySelector('.tooltip')).backgroundColor` settles
it in one call.

Two more, learned on 2026-08-25:

- **The spine does not render in a hidden tab.** It measures inside `requestAnimationFrame`, which
  Chrome pauses for a backgrounded tab, so an agent driving Chrome sees an empty
  `<aside class="spine">` and no hit targets at all. Nothing is broken — take a screenshot first, or
  otherwise make the tab visible, and it populates. Check `document.visibilityState` before
  believing an empty rail.
- **The collapsed rail is where it earns its keep, and it works.** Verified at ~1170px, back when
  the rail also had an expanded form and 1170px was where it collapsed: the tooltip is the *only*
  thing naming a section, and the portal means the 22rem panel is unaffected by the 24px rail it
  grows out of. Since 2026-08-26 that is every width rather than the narrow ones, so this is the
  ordinary case rather than the edge one. Getting there took two goes — `resize_window` reported
  success while `innerWidth` stayed put, the tooling limit already written up in browser-testing.md,
  and the width that finally applied did so on a later window.
