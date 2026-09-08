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
| [`src/web/Tooltip.tsx`](../../src/web/Tooltip.tsx) | the wrapper: `<Tooltip content={…}>{trigger}</Tooltip>`, plus `TooltipGroup` and `TipNote` — the latter being the panel's text where the panel is only a sentence, which is most of them outside the reading view |
| [`src/web/Spine.tsx`](../../src/web/Spine.tsx) | `BandCard` — what a spine band actually says |
| [`src/web/ProseHoverCard.tsx`](../../src/web/ProseHoverCard.tsx) | the other one — see below |
| [`src/web/Dock.tsx`](../../src/web/Dock.tsx) | the bottom bar — the mode buttons, twice over, and the experimental switch. See [§ The bar](#the-bar-and-the-two-shapes-of-the-same-modes) |
| [`src/mode-catalog.ts`](../../src/mode-catalog.ts) | the words in those fourteen cards, both paragraphs of each — the bar holds none of its own copy |
| [`src/web/Library.tsx`](../../src/web/Library.tsx) | the homepage masthead's links — Profile, plus Admin for the administrator — and the one place a tooltip's trigger is not a host element |
| [`src/web/Masthead.tsx`](../../src/web/Masthead.tsx) | the two things said at the top of an article — where it came from, and who can read it. Both were `title` attributes or a bare sentence until 2026-09-06 and are `ControlTip`s now; the origin one is also the app's only tooltip on a line of *text* rather than on a glyph. Its trigger is the address's own anchor when there is an address, and a plain `<span>` with `cursor: help` and an `sr-only` pair of sentences when there is not — the second of those is the app's one tooltip a keyboard cannot open, which is why its content is duplicated rather than only shown |
| [`src/web/PublicLibraryPage.tsx`](../../src/web/PublicLibraryPage.tsx) | the line under `/read/public`'s lede — **the app's only `ControlTip` on a link to a *page* rather than on a control**, and the only one whose reader may want nothing from us at all ([public-readable-sharing.md](public-readable-sharing.md)). Greg asked for five claims in it; two of the five were false, so the card carries the idiom's two paragraphs and the page carries the claims |
| [`src/web/ShelfEntry.tsx`](../../src/web/ShelfEntry.tsx) | the shelf card's five action buttons — the one row where a card also has to say *why this one does nothing* ([library.md § When a button cannot do its job](library.md#when-a-button-cannot-do-its-job)) |
| [`src/web/AccessSharing.tsx`](../../src/web/AccessSharing.tsx) | the sharing card's three controls, and its two dozen inventory chips — where a tooltip is the *only* place a row's sentence is written, which is why each chip is a `<button>` rather than a `title` attribute ([security-map.md § the inventory](security-map.md#the-owner-is-shown-the-inventory-before-they-publish)) |
| [`src/web/styles/tooltip.css`](../../src/web/styles/tooltip.css) § tooltip | every pixel of the appearance; the library ships none — [design-css-overview.md](design-css-overview.md) says where that file sits in the load order |

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

**The shelf's action row joined on 2026-09-05**, and it brought the one shape none of the others
needed: a card on a control that *cannot be pressed*. That forces `aria-disabled` rather than the
native attribute — a disabled button is out of the tab order and suppresses activation, and engines
differ on whether it dispatches pointer events at all, so it is not a reliable tooltip trigger by any
route. If a second row ever wants this, copy [`IconButton.tsx`](../../src/web/IconButton.tsx)'s
handling rather than the idea, and read
[library.md § When a button cannot do its job](library.md#when-a-button-cannot-do-its-job) for the
jsdom trap that makes a test of it pass while doing nothing.

It also brought the largest single haul of **false sentences** any card set here has produced: four
of nine, all caught by a cross-family review rather than by a test, because
[`ControlTip`'s restatement check](#controltip-which-is-what-most-of-them-are-now) can only see a
card arguing with itself and not one arguing with the code. Worth knowing before writing the next
set — the second paragraph is where the unguessable fact goes, which is exactly where a plausible
invention goes too. The four are listed in
[260905h](../plans/260905h-rich-tooltips-on-the-shelf-action-buttons.md#four-of-these-were-wrong-in-the-first-draft).

### The bar, and the two shapes of the same modes

**The bottom bar joined on 2026-09-07**, on the same ask again — Greg: *"Make sure all the modes in
the bottom-bar have rich tooltips."* It is the largest customer by count after Referee and the one
whose cards had existed longest, because the buttons had a card already: a head and **one**
sentence, which was the mode's `description` and therefore what the label plus a second's thought
already said. A card can be present and still not be a card
([260907b](../plans/260907b-rich-tooltips-on-the-dock-modes.md)).

Three things about it are not true of any other set here.

- **The copy is not in the component.** Both paragraphs come from `MODE_CATALOG`
  ([`src/mode-catalog.ts`](../../src/mode-catalog.ts)), which is a pure module the server can read
  too, so a fifteenth mode is a compile error until somebody has written both halves. Everywhere
  else in this file the words sit beside the JSX. [new-mode.md § The card on the
  button](new-mode.md#the-card-on-the-button) is what a new mode's author is told to do, including
  the rule that **no card in this bar names a price** — the command bar says `generates` and no
  figure, and a tooltip on the button beside it must not be more disclosed than the bar is.
- **The same fourteen modes are drawn by two different components**, and only one of them had a
  card. On the reading view they are a `role="radiogroup"` segment; on the metadata and tweets pages
  they are loose `DockLink`s, and those carried a `title` attribute while the segment had a panel.
  `DockLink`'s hover became a two-member union rather than a `title: string` so that the arm a link
  took was a choice the compiler could see, with the three buttons that are *not* modes sitting
  visibly in the `title` arm — the debt written into the type rather than into a comment. **That
  lasted one day**: the three took cards on 2026-09-07 too (below), the arm emptied, and the union
  went with them. A discriminant with nothing on one side of it is a shape the next author has to
  read before finding out it decides nothing.
- **The visitor's sentence goes above the description**, as `ControlTip`'s `state`. It was a third
  paragraph while the card had two; with the second paragraph added it would have been third of
  three, burying the one line saying why the button is drawn dimmed under two about a mode the
  visitor cannot *use* — they can open it, and what they get is a band explaining the gap, which is
  why the button is dimmed rather than `aria-disabled`. That widened `state`, which until then had
  meant *this switch is mid-flight or broken*; what the two share is that somebody who opened the
  card because the control looked wrong wants that answered before they are told what it is for.
- **And the three buttons in the bar that are not modes** — Comments, Tweets and Metadata — took the
  same two-paragraph card later the same day. Their copy is `NOT_A_MODE` in
  [`Dock.tsx`](../../src/web/Dock.tsx) rather than `MODE_CATALOG`, because a record keyed by `Mode`
  is the wrong home for three things that are not modes and never will be. They are in a
  `TooltipGroup` of their own, so running along the end of the bar is instant after the first card;
  the experimental switch stays outside it, being the adjacent account-level control — a setting
  rather than a view of this article.
- **And then the last two**, on 2026-09-08: the wordmark and the command button, which are not modes
  either and do not go through `DockLink`. `DockCommands` joined the group above it that morning and
  **left again the same day**, when Greg asked for it beside the logo — so the two are now neighbours
  at the *left-hand* end, each in no group and each waiting its own 300ms. That is the cost of the
  move and it was taken deliberately: one button, no longer about that group's subject. Its own
  docblock already argued three ways that it is not a fifteenth mode, which matters more now that it
  sits against the radiogroup. `DockHome` is likewise in no group — there is no scrub from one to the next
  to make instant. **No button in the bar row carries a `title` now** — the one left in
  `Dock.tsx` is the drawer's Close, and 260907b § Stage 3 says why it stays.

  `DockHome` took a `signedIn` prop to do it, and that is the point of it rather than a detail. A
  stranger reading a shared article sees the wordmark, and signed out `/` is the landing page — so
  *back to your library* is a sentence true for the owner and false for the reader most likely to
  need it, which is the shape of the Comments bug the day before. The corner logo
  ([`HomeLogo.tsx`](../../src/web/HomeLogo.tsx)) still carries the same `title` string this one
  dropped; it is a different component on different pages and wants the same question asked of it.

  Comments is the one that repaid the pass. It is **two** buttons — a `DockTab` opening the drawer on
  the reading view, a `DockLink` back to it everywhere else — and a visitor's copy on it had gone
  stale in a way only reading both could show: the drawer's *comments belong to whoever added this
  article* notice was retired on 2026-09-04, when a shared link started carrying them
  ([260904c](../plans/260904c-more-modes-on-a-shared-link.md)), and the button went on saying half of
  it. Both arms read one string now. `COMMENTS_GAP` and the `readers-own` variant behind it were
  retired on 2026-09-08, along with `readersOwnWork` in [`messages.ts`](../../src/messages.ts),
  which nothing reachable called. A message with no reachable caller is not inert: that one had been
  false for four days and was still being read out to visitors by a button that had copied half of
  it. 260904c had already decided the deletion and nobody had done it.

Five of the fourteen second paragraphs were drafted, checked against the source and thrown away for
being **plausible and false** — the same failure the shelf's row produced four of, and the reason
this page keeps saying so. All five are named in the plan, and four of them were caught by re-reading
the set as a group rather than by any check in the diff: each looked right on its own line.

Then three of the three non-mode buttons' six sentences went the same way, and their shared cause is
worth more than the count: **each was inherited from a project doc or a module header that had itself
gone stale.** *Nothing on the metadata page is generated* came from `Metadata.tsx`'s own docblock,
and the page opens with the hierarchy's gist and summary on it. Copy written from a doc inherits the
doc's staleness with none of its dating, so a sentence a reader will act on gets checked against the
code even when a doc already says it.

**A `title` attribute is not a small version of this**, and that is the argument for every one of
them: it waits about a second, cannot be styled, truncates at the OS's idea of a line, and does not
exist at all on a touch device. `title` attributes are a regression here rather than a shortcut, and
they are invisible on a laptop because they still show *something* — so five test files assert
their absence as well as the cards' presence
([`tests/diagram-panel-hover.test.tsx`](../../tests/diagram-panel-hover.test.tsx),
[`tests/referee-tooltips.test.tsx`](../../tests/referee-tooltips.test.tsx),
[`tests/feedback-button-tooltip.test.tsx`](../../tests/feedback-button-tooltip.test.tsx),
[`tests/shelf-action-tooltips.test.tsx`](../../tests/shelf-action-tooltips.test.tsx),
[`tests/dock-mode-tooltips.test.tsx`](../../tests/dock-mode-tooltips.test.tsx), the last of which
checks both arms of the bar because the arm that had the attribute was not the one anybody looked
at).

**An SVG `<title>` is the same mistake spread over a whole picture**, and it is worse than the
attribute because there is nothing to aim at: the tooltip is the *whole* drawing, so the sentence
follows the pointer around and comes up on top of shapes the panel is already describing in a card
of its own. The Sketch picture had one until 2026-09-03 — Greg: *"The 'Down the page is time…'
tooltip for Diagram/Sketch mode is annoying — it shows whenever the mouse is hovering over the
Sketch diagram"*. It was not carrying the accessible name either: the same `<svg>` has an
`aria-label`, which takes the *name* and leaves a `<title>` beside it to land on the *description* —
so the tree was announcing the caption twice, and removing it removed the duplicate, not the name.
The caption now lives on the Sketch chip's own card
([diagram.md](diagram.md#the-sketch-chip-also-says-what-was-actually-drawn-2026-09-03)) and, where
the picture has only one scene, on a card on its name in the bar — that name held a `title`
attribute until the same day, and it survived only because the SVG `<title>` was showing the same
sentence anyway. Both are pinned by
[`tests/sketch-caption-is-not-a-native-tooltip.test.tsx`](../../tests/sketch-caption-is-not-a-native-tooltip.test.tsx).
A picture that has no `aria-label` still needs one of the two, so remove a `<title>` only once
something else names the element.

**Deleting a `title` can take an accessible name with it**, and that is the trap the Feedback button
found. Its label is `display: none` below the narrow breakpoint, so with the `title` gone the button
was an unlabelled icon on exactly the widths where no tooltip can be opened either. An `aria-label`
replaced it, pinned by the same test — and nothing on a wide screen, where the visible word names
the button perfectly well, would ever have shown that it was missing.

### Three things about testing a card in jsdom

All three were measured rather than reasoned about. The first two make a test that looks right assert
nothing; the third makes one fail loudly for a reason that is not in the code it is testing, which
costs an hour in a different way.

- **Opening and closing do not take the same event.** A native `mouseenter` dispatched on the trigger
  opens it — `useHover` binds that listener to the reference node rather than going through React, so
  a bubbling `mouseover` never reaches it. Closing is React's synthetic `onMouseLeave`, which React
  synthesises from a *bubbling* `mouseout` whose `relatedTarget` is outside the trigger; a native
  `mouseleave` alone leaves the card up. Send both.
- **The close needs two `act` blocks, not one long one.** Closing is two timers in series with a
  render between them: the close delay sets `open` false, and only the render that follows schedules
  the transition's unmount. Inside a single `act` the queued update is not applied until the block
  exits, so the card is still in the DOM however long that block waits.
- **Re-hovering the same control inside a `TooltipGroup` needs a *third* `act` block.** Two blocks
  close the card and unmount it; the third is not part of closing at all, and waits out the group
  instead. `FloatingDelayGroup` waits its `timeoutMs` after a close before clearing the current group
  member — 400ms in the bottom bar — and that timer starts at the close *render*, so two 300ms waits
  do not outlast it. Hover the same control again while it is pending and the card opens instantly
  (the group is in its instant phase) and the stale timer's close lands in the same `act`: it opens
  and shuts inside one block, and the assertion reads zero. One more wait fixes it, and
  [`tests/dock-mode-tooltips.test.tsx`](../../tests/dock-mode-tooltips.test.tsx)'s `cardFor` is the
  copy to take.

  **This was diagnosed wrongly first**, and the wrong diagnosis is instructive: the symptom is *a
  control opens its card once per mount*, which is what three probes appeared to show — an identical
  re-render between the hovers, a prop-changing one, and no render at all, all failing the same way.
  That reading blamed the element and was remounted around. `useHover` keeps no one-shot state; it
  was the group's timer the whole time, and the same element reopens three times running once the
  timer is allowed to finish. A reproduction that fails three ways can still be failing for a fourth
  reason. GPT Sol found it, 2026-09-07.

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

Listing the sub-sections is why [`reader/Reader.tsx`](../../src/web/reader/Reader.tsx) builds the
outline three levels
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
[styles/tooltip.css](../../src/web/styles/tooltip.css)), so moving the pointer onto a card closes it: `useHover`
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
  no measurable delay. (Design left the masthead for `/admin` on 2026-09-05 — the measurement stands
  as a dated example of the group, not as a description of that row today.)
- **Colours, read rather than eyeballed**: panel `oklch(0.26 0 0)`, border `oklch(0.36 0 0)`, first
  line `oklab(0.97 0 0 / 0.85)`, the address under it `oklch(0.63 0 0)` — quieter, and still well
  clear of the ground.
- **Focus opens the card and blur closes it**, so the keyboard gets what the pointer gets.
- **The Admin card was not checked.** The local account is not the administrator, so that link is
  not drawn at all — the same courtesy described in [admin.md](admin.md). Whoever next has an
  administrator session locally can close that gap in one hover.
