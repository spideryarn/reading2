# Keyboard: ↑ / ↓ take the step, ← / → choose the stride

> Ok, let's add keyboard shortcuts. As an experiment, I want to use left and right arrows, and what
> they do should depend on where my mouse is. If it's in the L2 column, say, left/right should jump
> to the prev/next L2 item, and so on.
>
> — Greg, 2026-08-25

**↑ and ↓ move you through the article one item at a time, and the pointer decides how big an item
is.** The keys carry the direction; the mouse carries the stride.

**← and → move the stride itself**, one column at a time across the levels on screen, so the mouse
is not the only way to say how far. Greg, 2026-08-26:

> Let's use left/right to move the ToC-column-selection, so that I can choose the level of
> granularity with keyboard when jumping up/down.

The two ways of aiming are not two modes — see [§ choosing the level without a mouse](#choosing-the-level-without-a-mouse).

### Why ↑ / ↓ and not ← / →

They were ← / → first, exactly as asked, and it was the wrong axis. Greg, the same day:

> let's switch to using up/down instead of left/right

This view spends **left-right on granularity and up-down on chronology** — that is the whole framing
the table is built on ([granularity-zoom.md](granularity-zoom.md#the-tabular-view)). Moving through
the article is a downward motion at every level, so a key that moves you through it should point
down. Pointing sideways to say *how far* and pressing downwards to say *go* now agree with what is on
the screen instead of cutting across it.

It also freed ← / →, which is what the *stride* now uses. That is the same axis reasoning read the
other way round: left-right means granularity on this screen, so a key that changes granularity
should point sideways. (It cost the browser its horizontal pan, mostly — see
[§ what we gave up](#what-we-gave-up).)

The code is [`src/web/keynav.ts`](../../src/web/keynav.ts) — the step arithmetic is pure and tested
([`tests/keynav.test.ts`](../../tests/keynav.test.ts)), the rest is three event listeners.

## Why the pointer, and not a mode

The view already shows every level of granularity at once, side by side
([granularity-zoom.md § The tabular view](granularity-zoom.md#the-tabular-view)). So the reader is
*always* pointing at a level — hovering a column is what lights up its ancestor chain, and it is how
you read the thing at all. Reusing that as the aim means one pair of keys addresses every level,
with no mode to enter, no mode to leave, and no mode to get stuck in. Slide the mouse two inches
right and ↓ stops meaning "next section" and starts meaning "next paragraph".

The alternative — a "current level" you set with a key and then have to remember — costs a key, a
piece of state, and a way to be wrong about where you are. Hover costs nothing, because it is already
what your hand is doing.

**We have since bought a small piece of exactly that**, and it is worth being clear about the price.
← / → set a level and it stays set, which is a state you can be wrong about. Three things keep it
cheap: any mouse movement clears it, so it cannot outlive the moment you stop thinking about it; the
tinted column says what it is, the indicator the pointer already had; and it can only ever hold
a level that is on screen. (The controls bar said it in words and the header row lit the `<th>`, both
until 2026-09-05 —
[§ The aim is visible before you press anything](#the-aim-is-visible-before-you-press-anything).) It is a mode you leave by accident rather
than one you have to remember to leave, which is the only kind this view can afford.

## What each zone means

This is what the *pointer* means where it lands. ← / → then move that aim off the pointer and onto
whichever column you walk it to.

| Where the pointer is | ↑ / ↓ step by |
|---|---|
| A gist column at depth *d* | that level's items — L1 parts, L2 sections, … |
| The `Text` column (the prose) | one paragraph — the leaf level, which is 1:1 with blocks |
| The leaf column beside the prose | the same: one paragraph |
| The spine, anywhere on it | **parts (L1)** |
| The masthead, the controls bar, anywhere else | sections — the same unit `?at=` stores |

The spine is one zone rather than two. It draws parts as bands and marks the one you are in, so L1
is what it is *about*; its click targets are L2 only because a 1px tick is unhittable, which is a
pointing concession rather than a statement about the rail
([`Spine.tsx`](../../src/web/Spine.tsx)).

## Choosing the level without a mouse

← and → walk the aim across the columns: coarser to the left, finer to the right, exactly the order
they sit in on screen. **The rungs are the columns actually on screen**, not every level in the tree
— a stride whose column auto-fit has dropped would light no header and change nothing you can see,
which is indistinguishable from a broken key. `navPlan` in
[`keynav.ts`](../../src/web/keynav.ts) builds that list, and it is tested.

**Both ends are reachable, and one of the ends moved.** Greg, 2026-08-26:

> I need to be able to hit left all the way to be able to select L0 (the Argument), and to be able
> to hit right all the way to select the Text.

Then, 2026-09-05:

> For Hierarchy mode, let's get rid of the "Arg" button and functionality altogether.

**The later one wins**, and it is the reason the first row of the table above is gone. There is no
L0 column to select, so ← stops at Parts. The argument column had been a rung of its own — it
*stepped* by part, borrowing the parts' cells ([the arc](granularity-zoom.md#the-arc)), which was
the only thing that made "left all the way" anything but a dead end — and both the column and the
borrowing went with it
([260905d](../plans/260905d-declutter-the-reading-view-top-bars.md) § Decisions 5). **The arc
itself is still generated and still on screen**, as a rung of Structure's nested-list face (Outline
mode's rung 4 until 2026-09-10, when that list became Structure's narrow face).

The right-hand end is untouched: the prose shares its rung with the leaf column beside it, since both
mean one paragraph, and making them two rungs would cost a press to cross a distinction that does not
exist.

Depth 0 is still in the tree, and it is still what it always was off the arc — the root repeated down
the page, one item, both arrows dead ends. It falls off the ladder on the ordinary rule ("a rung you
cannot step on is a key that does nothing") rather than by a special case.

**Pressing ← or → holds the level until you move the mouse.** This is the one piece of modal state
the pointer design was built to avoid, so it is deliberately the weakest kind available: no
threshold, no timeout, no key to release it — the very next `mousemove` hands the aim straight back
to whatever is under the pointer. You can hold a level without holding your hand still, and you take
it back by doing the thing you were going to do anyway. Nothing to get stuck in, because the way out
is the way you already navigate.

**No control on this page takes the arrow keys, and that took two goes.** Greg, on 2026-08-26,
when the mode button was still called Contents:

> I noticed that if I'd just clicked the bottom-bar "Contents" button, say, then left/right changed
> within that radio group, rather than the Contents columns (which should be the priority for those
> keys).

The first answer was narrow: three controls — the bottom bar's mode switch, the diagram's three
chips and the search panel's two matchers — were each a `role="radiogroup"`, and that role is a
*promise about the arrow keys*, so each took them whenever focus was inside it. Clicking one
therefore blurred it afterwards (`e.detail > 0` tells a pointer click from Enter or Space, which
report 0), so the keys went back to the article, while a reader who had *tabbed* in kept the
behaviour the role advertised.

That left the exception standing, and on 2026-08-31 Greg asked for it gone:

> I don't really like the way the keyboard changes modes or sub-modes, so if it helps, we can remove
> that functionality. I'd rather up/down *always* moves the text, and we can use left/right for
> mode-specific behaviours?

So all three lost their arrow keys and their roving tabindex, and each button became its own tab
stop: Tab reaches every one, Enter, Space or a click selects. **The rule at the top of this page now
holds everywhere, with no exception to remember.** It is a deliberate departure from the ARIA
authoring practice for a radiogroup, and there is a second reason for it that is worth knowing —
selecting a mode now *starts a model call* when that mode has never been built, so an arrow key that
selected as it traversed was several paid jobs from one keypress. The full reasoning and what the
extra tab stops cost is in [`Dock.tsx`](../../src/web/Dock.tsx) § the mode switch; the assertion is
`tests/arrows-belong-to-the-article.test.tsx`.

The blur on click survives all of that, and still earns its place: nothing eats the arrows now, but a
focused button still takes Enter and Space, and leaving focus on it after a mouse click is not what
the reader asked for.

The aimed column is tinted — exactly one column, because the reader has to be able to see which one
another → would leave. That matters more for the keys than it did for the pointer: with the pointer,
where you are aiming is where your hand is.

At the ends of the ladder the key is handed back to the browser rather than swallowed, the same
concession ↑ / ↓ make at the ends of the article. So → at the finest column still pans an
overflowing table rightwards, which is the half of the panning that survives.

A zone declares itself with a `data-nav-depth` attribute and nothing else — `keynav.ts` resolves it
with `closest()` from whatever is under the pointer. That is why the spine can join in from outside
the table by adding one attribute, and why a new panel would too.

## The aim is visible before you press anything

An experiment whose behaviour you cannot predict before you commit to it isn't testable by the person
running it. So the aim is drawn:

- **The aimed column is tinted**, faintly, as the pointer crosses into it. Quieter than an `.on`
  button in the controls bar, deliberately: it follows the mouse, and something that changes on every
  sideways twitch must not shout.

**It said this in two other places until 2026-09-05, and both went that day.** The controls bar
carried an `↑↓ Sections` readout and the table's header row lit the aimed `<th>`; the bar was emptied
and the header row gave up its height, both in
[260905d](../plans/260905d-declutter-the-reading-view-top-bars.md). Greg confirmed he still uses
← / →, so the aim moved onto the one surface left — the column itself.

**The mechanism, and every part of it is a thing that was got wrong first**
([styles/table.css § the aimed column](../../src/web/styles/table.css), `tests/aimed-column.test.ts`):

- **One `data-aim` attribute on `.reader`**, never a class on the cells: a deep article renders
  thousands of `<td>`s and `memo(TableView)` is what keeps a pointer move cheap. It went on `.reader`
  rather than on the `<table>` because the fisheye panels are `position: fixed` *siblings* of the
  table — see the next point — and the move let `TableView` drop `navDepth` as a prop entirely, so a
  pointer move now re-renders nothing at all.
- **The gist columns are tinted through their panel, not their cells.** In Hierarchy every gist
  column is covered by an opaque `.ctx-panel` and the cell underneath draws nothing, so a rule that
  named only the cells did nothing in exactly the case ← reaches. Found by looking at the rendered
  page; every unit check had passed.
- A `background-image: linear-gradient`, never a `box-shadow` — `.pin-left` owns `box-shadow` for the
  overflow-layer cue and a second declaration replaces it — and never a `background-color`, because
  `td.text`, `td.gist.active` and `.ctx-panel` set opaque backgrounds of their own.
- Matched on `[data-nav-depth]`, not `.depth-N`: the **prose** cell carries no `depth-N` class, and it
  is the rung you reach by pressing → all the way.
- **Nothing is tinted when the prose is the only column** (`table.only-prose`, which is Plain and
  every mode band). One rung is not a choice between columns, and the pointer sits on it permanently,
  so the tint would be a standing cast over the article.

**The spine is deliberately not tinted.** An aim is a *depth*, and the spine is depth 1 drawn a second
way — when depth 1 is aimed the Parts column already says so. The one case that shows nothing is a
pointer resting on the spine with the Parts column fitted away, which lit nothing before this change
either.

## Five rules, each with a reason

### ↑ is not the mirror of ↓

↓ is always the next item. ↑ is the **track-skip** rule from every music player: part-way into an
item it goes to *the top of the item you are in*, and only steps back to the previous one once you
are already there.

The mirror version would skip the start of the thing you are currently reading, which is the one
place you are most likely to want to get back to. And the asymmetry is what makes the pair
reversible: ↓ always lands you on an item's first row, so ↑ from there is unambiguous, and ↓ then ↑
returns you exactly where you were. That round-trip is pinned in the tests.

### Auto-repeat is ignored

Holding the key would fire ~30 smooth scrolls a second — a blur you cannot read, ending somewhere
you never saw. `event.repeat` is dropped. Press it again if you want to go again.

This matters more for ↑ / ↓ than it did for ← / →, because holding an arrow down to scroll is a
thing people actually do. Here it does nothing after the first step.

### A widget that already handled the key keeps it

The listener is on `window`, in the bubble phase, so it sees **every** arrow press in the app —
including the ones a focused widget has already dealt with. The Diagram mode's picture is a
`role="tree"` whose ↑ / ↓ step one node and take the article with them
([diagram.md](diagram.md#the-step-bar-and-the-key-that-was-firing-twice)); before 2026-08-27 the
same press then also ran the step below, so one key moved the reader one node *and* one section at
once. Two distances, neither wrong on its own, and what you see is a highlight and an article that
disagree about how far you just went.

`keynav` now returns early on `e.defaultPrevented`. That is the general form rather than a list of
elements to skip: **calling `preventDefault()` is already how a handler says "this key was mine"**,
and a list is the version that silently goes stale the next time some component grows arrow keys and
nobody remembers to come back here.

**The dock had already hit this and solved it locally.** `DockModes` in [`Dock.tsx`](../../src/web/Dock.tsx)
called `stopPropagation()` alongside its `preventDefault()`, with a comment saying in as many words
that it was there to stop `keynav.ts` also stepping the article. That was the same bug, found
earlier, fixed one component at a time — and it is the argument for putting the rule in `keynav`
instead: every future widget with arrow keys would otherwise have to know that this listener exists
and remember to shout past it.

The audit behind the change found only two places in the app that `preventDefault()` an ArrowUp or
ArrowDown: the dock's mode switcher and the diagram's picture. **The dock is no longer one of them**
— it stopped handling arrows altogether on 2026-08-31 (see above) — so the rule now has exactly one
beneficiary, the diagram's `role="tree"`. It stays anyway, and the reason is the one it was written
for: a list of elements to skip goes stale, and `defaultPrevented` is how a handler says *this key
was mine* whoever writes the next one.

### Rapid presses chain from the last target, not from the page

Scrolling is animated ([`scroll.ts`](../../src/web/scroll.ts)), so a second press landing mid-flight
would measure a position halfway between two items and step from *that* — two presses, one item of
movement. Instead `keynav.ts` remembers the row its own last jump was headed for and steps from
there, for `SCROLL_MS + 400` or until the reader grabs the page back with a wheel or a pointer.

This is the one piece of state in the file, and it exists solely because the scroll is animated. If
jumps ever become instant, delete it.

### A note on the jump itself

Repeated keypresses are what forced the scroll speed. Greg, 2026-08-25: *"can you make it scroll a
bit faster so I don't have to wait so long?"* — `behavior: "smooth"` gives Chrome a duration that
grows with distance, so a part-sized jump took noticeably longer than a paragraph-sized one, which is
backwards: the long jumps are the ones you most want over with. `scroll.ts` now runs the animation
itself at a flat 200ms. That change is shared by every jump in the app — gist clicks and spine clicks
too, which is the point of them all going through one function.

### A keypress writes no URL of its own

It scrolls, and the reading-position listener in
[`reader/useReadingPosition.ts`](../../src/web/reader/useReadingPosition.ts) notices and
updates `?at=` exactly as it would for a wheel. So there is no second answer to "does this push a
history entry?" — a stride you take twenty times must not cost twenty presses of Back, which is
[the rule position already follows](url-state.md#position-replaces-history-deliberate-acts-push).

Note the consequence, which is the existing cost of storing position as a section and not new here:
stepping paragraph-by-paragraph inside one section doesn't change the URL, so a reload puts you at
the top of that section ([url-state.md](url-state.md#the-unit-is-a-section-not-a-position)).

## The one chord that is not an arrow

**⌘-K on a Mac, Ctrl-K everywhere else, opens the command bar** — type the name of a mode, a page or
a thing to do, or one of its nicknames, press Enter, and you are there. What that bar is, and what it
deliberately cannot do, is
[reading-view-overview.md § The command bar](reading-view-overview.md#the-command-bar); this section
is only the key.

**The button moved and the chord did not**, which is worth a line because it looks like the kind of
pair that would move together. Greg asked on 2026-09-07 for the ⌘ button to sit at the left-hand end
of the Dock, just after the wordmark ([260908e](../plans/260908e-more-commands-in-the-command-bar-and-the-button-beside-the-logo.md));
the chord is bound to the **window** in `useCommandBarChord`, not to that button, so it opens the
same dialog from wherever the button happens to be — and everything below is unchanged by the move.

It obeys three of the rules above, and it is worth saying which, because they are the rules and not
a coincidence:

- **Auto-repeat is ignored** ([§ auto-repeat](#auto-repeat-is-ignored)). Holding the chord would
  otherwise reopen the bar every few milliseconds under whatever you had already typed.
- **It does not fire while focus is in an input, a textarea, a select or anything contenteditable**,
  which is the same list the arrows respect — and it matters more here, because ⌘-K is a
  text-editing chord in several editors.
- **`preventDefault()` only when the press is claimed.** Firefox focuses the address bar on ⌘-K; a
  listener that suppressed that without opening anything would be a chord that quietly breaks a
  browser feature.

Two more rules are its own, and both are about what else is on screen:

- **The Dock drawer is closed first.** That drawer has a **capture-phase** `window` Escape handler
  which calls `stopImmediatePropagation` ([`Dock.tsx`](../../src/web/Dock.tsx) § Escape closes the
  drawer), so with both open one Escape would shut the drawer nobody can see and the bar in front of
  you would never hear the key.
- **It does not open over another native modal.** The Feedback dialog, the Lightbox and the comment
  dialogs are all `<dialog>`s opened with `showModal()`, and two of those stack in the top layer
  with focus trapped in the newer one.

**Inside the bar the arrows are the bar's**, which is the one place in the app they are not the
article's — ↑ / ↓ move the selection and clamp at both ends. That is not an exception to this file's
rule so much as the rule's own escape hatch, [§ a widget that already handled the key keeps
it](#a-widget-that-already-handled-the-key-keeps-it): the bar is a modal dialog, the article is
inert behind it, and there is nothing to step through.

The chord was verified free before it was taken — a grep of `src/web/` and `tests/` for
`metaKey`/`ctrlKey` with `"k"` returned nothing, 2026-09-06. On a phone there is no chord at all,
which is why the bar also has a button in the Dock.

## What we gave up

- **Line-by-line scrolling with the arrow keys.** This is the real cost of ↑ / ↓, and it is bigger
  than the one ← / → carried: pressing ↓ normally nudges the page ~40px, and now it jumps a whole
  item. Everything else still scrolls — wheel, trackpad, scrollbar, Page Up / Page Down, space and
  shift-space, Home and End. Partial mitigation: at the ends of the article, where there is nowhere
  to step, we don't call `preventDefault`, so ↓ on the last paragraph still scrolls the final
  screenful into view rather than dying silently.
- **Modified arrows are left alone** — Cmd+↓ is "end of document", Alt+↓ and Shift+↓ have their own
  meanings — and so are arrows pressed while focus is in an input, a textarea, a select, or anything
  contenteditable.
- **Arrow-key panning of a too-wide table.** With a deep tree the table outruns the window
  ([§ fitting](granularity-zoom.md#too-many-levels-fit-the-columns-dont-just-scroll-them)), and ← / →
  used to scroll it sideways. Now they mostly change the stride instead. Traded knowingly: the
  reader can still pan with a trackpad swipe, Shift+wheel, the scrollbar, or by choosing fewer
  columns — and the pan is *partly* still there, because at either end of the ladder we don't call
  `preventDefault` and the key goes back to the browser. What is really gone is panning from the
  middle of the ladder.
- **Auto-repeat on ← / → too.** Holding → would cross a three-rung ladder before you saw it move,
  and land you on a level you never chose. One press, one column.

## This constrains which components we may use

All four arrow keys are spoken for, and now all four by this file: ↑/↓ take the step, ←/→ choose the
stride. So a component that captures arrow keys takes something real away — more than it did when
←/→ were only the browser's — and several of the obvious ones do.

**Radix's roving focus binds ArrowLeft, ArrowRight, ArrowUp *and* ArrowDown.** That is why the
granularity pills are individual shadcn `Toggle`s and not a `ToggleGroup`, which is what the
migration plan called for and what you would normally reach for
([web-client.md § Individual Toggles](web-client.md#individual-toggles-not-a-togglegroup),
2026-08-25). A group would have swallowed all four whenever focus sat inside the controls bar —
which is precisely where focus lands after you click a pill. Separate toggles give the same
`aria-pressed` and `data-state` and leave the keys alone.

The same applies to `RadioGroup`, `Tabs`, `Menubar` and `NavigationMenu`. **Check the keyboard
behaviour before adopting any of them**, and prefer the ungrouped primitive where the grouping only
buys focus management we do not need.

## Tab, and the surfaces it walks through

**Almost nothing in this app traps Tab, and that is the design rather than an omission.** Of the
seventeen overlay surfaces a reader can open, twelve have no focus trap — every one that is not a
native `<dialog>`. `aria-modal` appears nowhere in the app as an attribute, and `inert` is used
nowhere in the UI. Both absences are deliberate and argued at the surfaces themselves.

The first split is modal against modeless:

| | **Modal** | **Modeless** |
| --- | --- | --- |
| what it is | a native `<dialog>` opened with `showModal()` | an `<aside role="dialog">`, a popover, an in-flow disclosure |
| Tab | trapped inside it, **by the platform** | not trapped |
| the article behind | inert, by the platform | fully live |
| who closes it | the platform, on Escape | our own handler, in a fixed tier order |
| when it closes | the platform restores focus | **we** put focus back, or the reader loses their place |
| examples | the Lightbox, Feedback, the Command bar, the two full-screen pictures | the Comment, Chat and Annotate panels, the Dock drawer, the gutter disclosure, the hover cards |

**Modeless is the default here, and the reason is the reading.** The Comment panel dodges out of the
way while you drag out a new selection, because asking about several passages at once is the point;
a trap would fight that. Trapping a surface is a product decision, not a tidy-up.

### "Not trapped" is not one contract, it is three

**Not trapping does not mean Tab may skip your controls.** A modeless surface's controls belong in
the sequential order, near the thing that opened them — that is what
[the W3C's focus-order guidance](https://www.w3.org/WAI/WCAG21/Understanding/focus-order.html) asks,
and it is the difference between a surface that is *untrapped* and one that is *unreachable*. So
which of these a surface is decides what it owes:

- **Passive.** No focusable content at all — a tooltip is the case. It owes nothing: nothing to
  reach, nothing to give back.
- **Interactive but focus-taking-on-open: no.** It has controls a reader might use, and it appears
  without moving focus. It owes **reachability**: Tab from the thing that opened it must arrive at
  its controls rather than sail past them into the article. A surface portalled to the end of
  `<body>` does not get this for free — its controls land after everything else in document order.
- **Focus-taking.** It moves focus into itself when it opens. It owes reachability *and* **giving
  focus back**, because it will unmount the element the reader is standing on.

**Where each surface actually stands, 2026-09-07:** twelve are untrapped; ten of those have correct
traversal for their class; and **two do not** — the prose and Debate hover cards are `role="dialog"`
holding a link and a button, portalled to the end of `<body>`, opened by keyboard focus and then
skipped by Tab. That is a known defect awaiting a product decision, **not** an example of the rule
above. Anything new should look like the ten, not the two.

### What giving focus back means in practice

- **Only rescue focus that went nowhere.** A reader who has already clicked something real must be
  left there. Two shapes, and which you need depends on when you ask: a surface that closes by
  *unmounting itself* asks whether focus is still inside it, because React runs cleanup **before**
  detaching and `activeElement` has not fallen to `<body>` yet (`ChatDialog`); one that reacts to a
  flag going false can ask the simpler `activeElement === null || activeElement === document.body`
  afterwards (`TitleEditor`, `RefereeCard`).
- **Name a destination for when the opener has gone**, because often it has: the gutter's Help button
  closes its own disclosure before opening a chat, so the control that opened the panel is never
  there when the panel closes.
- **A cleanup is not proof of an unmount.** `main.tsx` runs the app in `<StrictMode>`, which fires
  every effect setup → cleanup → setup on mount; restoring in that cleanup takes focus away from a
  panel that is still open. `ChatDialog` defers by a microtask and checks `isConnected`, which is the
  only way to tell the two apart.

The inventory of all seventeen is
[the focus inventory](../plans/260906f-the-active-mode-gets-one-surface-and-one-way-to-fit-the-screen-focus-inventory.md).
**Escape is a separate question with a separate answer** — five tiers in a fixed dispatch order, a
surface's tier being the whole of its authority, because nothing anywhere reads a z-index or another
surface's state:
[the escape inventory](../plans/260906f-the-active-mode-gets-one-surface-and-one-way-to-fit-the-screen-escape-inventory.md).

**One caveat for anyone testing this: jsdom has no Tab.** It implements no sequential focus
navigation, no `showModal`, and no `inert` — all three of the mechanisms a trap is built from — and
`input.select()` does not move focus there as it does in a browser. A jsdom test claiming to prove a
trap is asserting the behaviour of a fake. `tests/tab-traversal-in-chrome.test.ts` drives a real
Chrome; `tests/the-dock-drawer-is-not-a-modal.test.tsx` tests the two mechanisms a trap would *need*,
which is what jsdom can honestly do.

## Where this leaves an older sketch

[granularity-zoom.md § Interaction](granularity-zoom.md#interaction) originally gave ← / → to *zoom
out* and *zoom in* — one level at a time, in a view that showed a single level at a time. The table
view superseded that by showing every level at once, which left "zoom" without an axis to move
along; choosing levels is the `L1 / L2` buttons and `?cols=`
([url-state.md](url-state.md#the-parameters)). So ← / → were free.

They have now come back round to something close to that original intent — ← / → *do* choose the
level again — but on a view that shows every level at once, so the key moves your **aim** across the
columns rather than replacing what is drawn in them. The zoom is still the `L1 / L2` buttons
and `?cols=`. What the old sketch had right was the axis; what it could not have known was that the
levels would stop being a thing you switch between and start being a thing you point at.

## The same step, with a finger

[touch.md](touch.md) is this file's twin for the iPad: a vertical swipe over a gist column takes the
step, and the column decides the stride, exactly as the pointer does here. It runs on the same
`stepTarget` and the same `scrollToBlock`, so the two inputs cannot disagree about where the next
section starts.

The one place they part company is the prose. A key pressed over the prose column steps one
paragraph; a finger dragged over it scrolls normally, because
[altering how scrolling behaves while someone reads](touch.md#why-the-prose-is-untouched) is the one
thing the usability research is unambiguous about.

## See also

- [touch.md](touch.md) — the swipe version of this, and why it stops at the prose column
- [web-client.md](web-client.md) — the reading view and where every piece of its code lives
- [granularity-zoom.md](granularity-zoom.md#interaction) — the feature the keys navigate
- [url-state.md](url-state.md) — why a keypress replaces rather than pushes
- [browser-testing.md](browser-testing.md) — driving the view by hand, and the ways it lies to you
- [testing.md](testing.md) — what's pinned deterministically
