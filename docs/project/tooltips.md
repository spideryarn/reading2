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
| [`src/web/Library.tsx`](../../src/web/Library.tsx) | the homepage masthead's three links, and the one place a tooltip's trigger is not a host element |
| [`src/web/styles.css`](../../src/web/styles.css) § tooltip | every pixel of the appearance; the library ships none — [design-css-overview.md](design-css-overview.md) says where that file sits in the load order |

`Tooltip` is deliberately generic — nothing in it knows about the spine.

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
([touch.md](touch.md), [260827ak-touch-glossary-card.md](../plans/260827ak-touch-glossary-card.md)). The spine's
tooltips get there through `Tooltip.tsx`'s `mouseOnly`; this one owns its own listeners, so the whole
gesture lives in `useHoverCard.ts`.

It is also the one tooltip here that **takes pointer events**, because its card carries a link out
and a button in; every other one is `pointer-events: none` so that a panel can never land under the
pointer and keep itself open. If a third customer ever has both properties — many triggers that are
not React elements — that is the point at which this becomes a shared hook rather than a second file.
[glossary.md § The hover card](glossary.md#the-hover-card) has the rest.

## `ControlTip`, which is what most of them are now

The spine's card is a *place* described. The other shape — and by count the commoner one — is a
**control** described: `ControlTip` in [`Tooltip.tsx`](../../src/web/Tooltip.tsx), a head and two
paragraphs, with one rule that is the whole reason it is worth a hover.

> The first sentence is what a reader could have guessed by pressing the control; the second is what
> they could not — where the answer comes from, what it costs, or what the control does *not*
> promise.

A second paragraph that restates the first is the failure mode, and it is easy to write by accident.
So is a first paragraph that restates the label, and so is a card that repeats a sentence already
printed, visibly, on the same screen — a hover that costs a reader a second to discover they knew it
already is worse than no card. Four cards in Referee mode did one of those three and were rewritten
or removed on 2026-09-02, after a cross-family review;
[`tests/referee-tooltips.test.tsx`](../../tests/referee-tooltips.test.tsx) now checks the two
paragraphs against each other and against the label rather than checking that the card is long.
**It catches copying and not paraphrase**, which is written down there rather than left to be
discovered.

It arrived for the Diagram band on Greg's ask — *"add detailed tooltips to the various
diagram-buttons etc to explain how things work"* (2026-08-30) — and the same ask came again for
[Referee mode](referee-mode.md) on 2026-09-02, which is now the largest customer: about thirty
controls across four sub-modes, where the unguessable half is a model call being spent, a
placement being discarded, or a number that reads like a score and is not
([referee-mode.md § Every control says what it does](referee-mode.md#every-control-says-what-it-does)).
[`DiagramPanel.tsx`](../../src/web/DiagramPanel.tsx) is the idiom to copy: a row of chips wrapped in
one `TooltipGroup`, each card `className="tip-soon"` and `keepSide`.

The **Feedback button** joined on 2026-09-03, on the same ask, and it is the one card here that is
not part of a row — no `TooltipGroup`, its own 240ms delay
([`FeedbackButton.tsx`](../../src/web/FeedbackButton.tsx)). It still wants `keepSide`, for a reason
worth knowing before copying the idiom to any other corner control: the button is hard against the
right edge, so a 22rem card cannot centre on it, and without `keepSide` the default `flip` treats
that as *not fitting* and throws the card onto the cross axis — landing it left of the button, over
the article's own title. The exclusion the button's fixed corner already buys off
([feedback.md](feedback.md)) would have come straight back in through its tooltip.

**A `title` attribute is not a small version of this**, and that is the argument for every one of
them: it waits about a second, cannot be styled, truncates at the OS's idea of a line, and does not
exist at all on a touch device. `title` attributes are a regression here rather than a shortcut, and
they are invisible on a laptop because they still show *something* — so three test files assert
their absence as well as the cards' presence
([`tests/diagram-panel-hover.test.tsx`](../../tests/diagram-panel-hover.test.tsx),
[`tests/referee-tooltips.test.tsx`](../../tests/referee-tooltips.test.tsx),
[`tests/feedback-button-tooltip.test.tsx`](../../tests/feedback-button-tooltip.test.tsx)).

**Deleting a `title` can take an accessible name with it**, and that is the trap the Feedback button
found. Its label is `display: none` below the narrow breakpoint, so with the `title` gone the button
was an unlabelled icon on exactly the widths where no tooltip can be opened either. An `aria-label`
replaced it, pinned by the same test — and nothing on a wide screen, where the visible word names
the button perfectly well, would ever have shown that it was missing.

### Two things about testing a card in jsdom

Both were measured rather than reasoned about, and both make a test that looks right assert nothing.

- **Opening and closing do not take the same event.** A native `mouseenter` dispatched on the trigger
  opens it — `useHover` binds that listener to the reference node rather than going through React, so
  a bubbling `mouseover` never reaches it. Closing is React's synthetic `onMouseLeave`, which React
  synthesises from a *bubbling* `mouseout` whose `relatedTarget` is outside the trigger; a native
  `mouseleave` alone leaves the card up. Send both.
- **The close needs two `act` blocks, not one long one.** Closing is two timers in series with a
  render between them: the close delay sets `open` false, and only the render that follows schedules
  the transition's unmount. Inside a single `act` the queued update is not applied until the block
  exits, so the card is still in the DOM however long that block waits.

A card left open is the failure that matters, because the panel is portalled to `<body>` rather than
into the test's host: the next control's assertion then reads the previous control's words. Assert
that **exactly one** card is open and that its head belongs to the control you hovered.

## What the card says, and why that

*The spine's card, which is the one this file was written for.*

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

## Five things that are load-bearing

Each of these is a way the obvious version fails silently.

1. **The floating node is two elements.** `floatingStyles` positions with a `transform`, and the
   open/close transition also wants one. One element cannot carry both — the animation fights the
   placement. Outer div positions, inner div animates. Floating UI's own recommendation, and the
   reason `useTransitionStyles` returns styles separately instead of merging them.
2. **It portals to `<body>`.** The spine is `overflow: hidden` and has to be — its bands are
   absolutely positioned in percentages of the document height and would otherwise spill out of the
   rail. Anything rendered *inside* the rail is therefore clipped to 12px — the rail's whole
   width, since the expanded 13rem form was deleted on 2026-08-26 and the strip was halved on
   2026-08-28. `<FloatingPortal>` is what stops a 22rem panel becoming a 12px one, and it is now
   the only thing standing between the reader and an unreadable card.
3. **The arrow's `fill` and `stroke` are props, not CSS.** Given a `strokeWidth`, `FloatingArrow`
   draws a second clipped path for the border and paints over the seam where the arrow meets the
   panel using the `fill` value it was passed. A stylesheet rule wins the cascade over the
   `stroke="none"` it puts on the fill path, and you get a line straight across the arrow's mouth.
   `var(--surface-raised)` works as an attribute value because presentation attributes are parsed as
   CSS values.
4. **The tooltip is the trigger's *description*, not its name.** `useRole` wires the panel up as
   `aria-describedby`. The spine's bands used to get their accessible name from the `title`
   attribute the tooltip replaced, so the name has to be restated as `aria-label` — otherwise a
   screen reader meets fifty anonymous buttons. (The masthead links below need nothing: their
   accessible name is the word next to the icon.)
5. **The trigger has to hand over its ref.** `useHover` puts a native `mouseenter` listener on
   `elements.domReference` — the node the ref gave it — so a trigger that swallows the ref opens
   nothing at all, with no error and no visible difference from before the tooltip was added. Every
   trigger in the app is a host element except the homepage masthead's, which are `Link`
   ([`src/web/Link.tsx`](../../src/web/Link.tsx)), a function component. React 19 hands a function
   component its `ref` as an ordinary prop and `Link` spreads its rest props onto the `<a>`, so it
   works — and `Link`'s props now say `ref` out loud rather than leaving it to that spread, because
   `AnchorHTMLAttributes` does not include it and `Tooltip` clones its child as
   `Record<string, unknown>`, so nothing else would have complained.
   [`tests/tooltip-on-link.test.tsx`](../../tests/tooltip-on-link.test.tsx) hovers a real one, and
   its third case is the same test with the ref taken away.

## Grouping, and why the delays are what they are

Open 240ms, close 90ms, wrapped in a `<TooltipGroup>`. The group is the interesting half: once one
tooltip is open, its neighbours open *instantly* while the pointer keeps moving, and the fade is
dropped to zero in that phase because a fade reads as lag when the panel is meant to be tracking the
pointer. The rail stops being fifty separate waits and becomes something you can scrub.

240ms is long enough that crossing the rail on the way to the article does not fire a dozen
tooltips. 90ms to close is short but not instant, so a wobble between two adjacent bands does not
blink the panel out and back.

## The pointer cannot enter a card, and that used to be exempt

Every panel is `pointer-events: none` (`.tooltip-anchor` in
[styles.css](../../src/web/styles.css)), so moving the pointer onto a card closes it: `useHover`
sees the pointer leave the trigger, and the card is not somewhere the pointer can go. That is
deliberate and it is right for the rail — a spine card that took hover would sit on top of the band
you are pointing at and hold itself open. The single exception is `ProseHoverCard`, which carries
links out and buttons in, and gets `.tooltip-anchor.interactive`.

**WCAG 2.1 § 1.4.13 "Content on Hover or Focus" asks for the opposite.** Content that appears on
hover has to stay available while the pointer moves onto it. The native `title` attribute is
explicitly exempt from that criterion; a card we drew ourselves is not. So the masthead's three
links were conforming by exemption while they were `title` attributes, and stopped being so on
2026-08-28 when they became cards. It costs a reader using magnification or a large cursor the most,
because for them the gap between trigger and panel is easy to cross by accident.

Found by ⟨Sol⟩ reviewing that change. **Undecided** — [open-questions.md § Q10](open-questions.md#q10)
carries the call, because the fix is not local: it means letting `Tooltip` take `.interactive` and a
`safePolygon()` corridor per use, and the spine, which is most of the tooltips in the app, wants
exactly the behaviour we have.

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
  thing naming a section, and the portal means the 22rem panel is unaffected by the 12px rail it
  grows out of. Since 2026-08-26 that is every width rather than the narrow ones, so this is the
  ordinary case rather than the edge one. Getting there took two goes — `resize_window` reported
  success while `innerWidth` stayed put, the tooling limit already written up in browser-testing.md,
  and the width that finally applied did so on a later window.

### The masthead links, and how to reach them at all

The three links in the homepage masthead are behind the app's sign-in gate, so a browser agent
lands on "Sign in with Google" and can go no further — it must not try to sign in, and
[browser-testing.md](browser-testing.md) says why that costs a whole run. The way in is the one
[performance.md](performance.md) uses: mint a one-time token with
[`scripts/seed-local-session.ts`](../../scripts/seed-local-session.ts) against the **local**
Supabase, then hand it to the app's own SDK instance from the page:

```js
const m = await import('/src/web/lib/supabase.ts');
await m.supabase.auth.verifyOtp({ type: 'magiclink', token_hash: '<hashedToken>' });
```

Checked this way on 2026-08-28, at 1140px, 620px and — in a same-origin iframe, because Chrome on
macOS will not make a window narrower than ~605px — 320px, where the link row wraps onto its own
line:

- **The card opens, below the link, and never covers a neighbour.** Its top sat 11–12px under the
  row at every width, including wrapped, and its horizontal span crossing under the other links
  costs nothing because the vertical clearance is what matters. At 620px the rightmost card cleared
  the window edge by 15px, and at 320px it cleared the left edge by 14px, which is `shift`'s padding
  doing its job.
- **A `mousemove` on the trigger does not open it; a real `mouseenter` does.** Worth knowing before
  concluding a card is broken — and it is the same fact the unit test is built on
  ([§ Five things](#five-things-that-are-load-bearing), point 5).
- **The group's instant phase is real**: moving from Profile to Design opened the second card with
  no measurable delay.
- **Colours, read rather than eyeballed**: panel `oklch(0.26 0 0)`, border `oklch(0.36 0 0)`, first
  line `oklab(0.97 0 0 / 0.85)`, the address under it `oklch(0.63 0 0)` — quieter, and still well
  clear of the ground.
- **Focus opens the card and blur closes it**, so the keyboard gets what the pointer gets.
- **The Admin card was not checked.** The local account is not the administrator, so that link is
  not drawn at all — the same courtesy described in [admin.md](admin.md). Whoever next has an
  administrator session locally can close that gap in one hover.
