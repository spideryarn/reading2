# Keyboard: arrows aimed by the pointer

> Ok, let's add keyboard shortcuts. As an experiment, I want to use left and right arrows, and what
> they do should depend on where my mouse is. If it's in the L2 column, say, left/right should jump
> to the prev/next L2 item, and so on.
>
> — Greg, 2026-08-25

**← and → move you through the article one item at a time, and the pointer decides how big an item
is.** The keys carry the direction; the mouse carries the stride.

The code is [`src/web/keynav.ts`](../../src/web/keynav.ts) — the step arithmetic is pure and tested
([`tests/keynav.test.ts`](../../tests/keynav.test.ts)), the rest is three event listeners.

## Why the pointer, and not a mode

The view already shows every level of granularity at once, side by side
([granularity-zoom.md § The tabular view](granularity-zoom.md#the-tabular-view)). So the reader is
*always* pointing at a level — hovering a column is what lights up its ancestor chain, and it is how
you read the thing at all. Reusing that as the aim means one pair of keys addresses every level,
with no mode to enter, no mode to leave, and no mode to get stuck in. Slide the mouse two inches
right and → stops meaning "next section" and starts meaning "next paragraph".

The alternative — a "current level" you set with a key and then have to remember — costs a key, a
piece of state, and a way to be wrong about where you are. Hover costs nothing, because it is already
what your hand is doing.

## What each zone means

| Where the pointer is | ← / → step by |
|---|---|
| A gist column at depth *d* | that level's items — L1 parts, L2 sections, … |
| The `Text` column (the prose) | one paragraph — the leaf level, which is 1:1 with blocks |
| The leaf column beside the prose | the same: one paragraph |
| The spine, anywhere on it | **parts (L1)** |
| The masthead, the controls bar, anywhere else | sections — the same unit `?at=` stores |

The spine is one zone rather than two. It draws parts as bands and names the current one in its
header strip, so L1 is what it is *about*; its click targets are L2 only because a 1px tick is
unhittable, which is a pointing concession rather than a statement about the rail
([`Spine.tsx`](../../src/web/Spine.tsx)).

A zone declares itself with a `data-nav-depth` attribute and nothing else — `keynav.ts` resolves it
with `closest()` from whatever is under the pointer. That is why the spine can join in from outside
the table by adding one attribute, and why a new panel would too.

## The aim is visible before you press anything

Two places say it, because either one alone has a hole:

- **The column header lights up** as the pointer crosses into it (`thead th.nav-aim`). Quieter than
  an `.on` button in the controls bar, deliberately: it follows the mouse, and something that changes
  on every sideways twitch must not shout.
- **The controls bar names the level** — `←→ Sections`. This is the one that still works when the
  aimed zone is the spine, which has no header, or is nothing at all.

An experiment whose behaviour you cannot predict before you commit to it isn't testable by the person
running it.

## Four rules, each with a reason

### ← is not the mirror of →

→ is always the next item. ← is the **track-skip** rule from every music player: part-way into an
item it goes to *the top of the item you are in*, and only steps back to the previous one once you
are already there.

The mirror version would skip the start of the thing you are currently reading, which is the one
place you are most likely to want to get back to. And the asymmetry is what makes the pair
reversible: → always lands you on an item's first row, so ← from there is unambiguous, and → then ←
returns you exactly where you were. That round-trip is pinned in the tests.

### Auto-repeat is ignored

Holding the key would fire ~30 smooth scrolls a second — a blur you cannot read, ending somewhere
you never saw. `event.repeat` is dropped. Press it again if you want to go again.

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

It scrolls, and the reading-position listener in [`App.tsx`](../../src/web/App.tsx) notices and
updates `?at=` exactly as it would for a wheel. So there is no second answer to "does this push a
history entry?" — a stride you take twenty times must not cost twenty presses of Back, which is
[the rule position already follows](url-state.md#position-replaces-history-deliberate-acts-push).

Note the consequence, which is the existing cost of storing position as a section and not new here:
stepping paragraph-by-paragraph inside one section doesn't change the URL, so a reload puts you at
the top of that section ([url-state.md](url-state.md#the-unit-is-a-section-not-a-position)).

## What we gave up

- **Arrow keys no longer pan a horizontally-scrolling table.** When the columns outrun the window
  ([§ fitting](granularity-zoom.md#too-many-levels-fit-the-columns-dont-just-scroll-them)) the
  browser's own ←/→ would scroll it sideways, and we take that. Trackpad, shift-wheel and the
  scrollbar all still do it. Partial mitigation: at the ends of the article, where there is nowhere
  to step, we don't call `preventDefault`, so the keypress goes back to the browser.
- **Modified arrows are left alone** — Alt+← and Cmd+← are Back, Shift+← extends a selection — and so
  are arrows pressed while focus is in an input, a textarea, a select, or anything contenteditable.
- **↑ / ↓ are untouched.** The vertical axis is chronology and the browser already scrolls it
  correctly. If they are ever claimed, the obvious meaning is the same thing at a fixed level.

## Where this leaves an older sketch

[granularity-zoom.md § Interaction](granularity-zoom.md#interaction) originally gave ← / → to *zoom
out* and *zoom in* — one level at a time, in a view that showed a single level at a time. The table
view superseded that by showing every level at once, which left "zoom" without an axis to move
along; choosing levels is the `L0 / L1 / L2` buttons and `?cols=`
([url-state.md](url-state.md#the-parameters)). The arrows were free, so this took them.

## See also

- [web-client.md](web-client.md) — the reading view and where every piece of its code lives
- [granularity-zoom.md](granularity-zoom.md#interaction) — the feature the keys navigate
- [url-state.md](url-state.md) — why a keypress replaces rather than pushes
- [browser-testing.md](browser-testing.md) — driving the view by hand, and the ways it lies to you
- [testing.md](testing.md) — what's pinned deterministically
