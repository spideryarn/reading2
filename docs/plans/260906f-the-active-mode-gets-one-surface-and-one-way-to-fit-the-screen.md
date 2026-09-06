# The active mode gets one surface, and one way to fit the screen

Item **A5** of [the main-app architecture review](260905e-main-app-architecture-review.md), plus the
half of **A6** that [A2](260905h-a-mode-failure-should-leave-the-article-readable.md) did not take.
The stage that authorises it is § *Make the common mode surface fit and behave consistently*.

Up: [Reading view](../project/reading-view-overview.md) · [Web client](../project/web-client.md) ·
[Design and CSS](../project/design-css-overview.md)

## The problem, in one paragraph

There are **two mechanisms for fitting a surface into the part of a phone the reader can actually
see**, and which one a surface gets is an accident of when it was written.
[`useVisualViewport.ts`](../../src/web/useVisualViewport.ts) measures the *visual* viewport and
hands back `height`, `offsetTop` and `bottomInset`; the comment, chat, annotate and feedback dialogs
use it, because a reader on an installed iOS app reported the Send button under the keyboard
(docs/project/feedback.md). The **mode bands** — Chat, Search, Glossary, Ideas, Summary, Outline,
Quotes, Timeline, Quiz, Referee, Debate, Diagram — use `.mode-band`'s fixed `top`/`bottom` rules and
have never heard of it. That difference is **source evidence of two mechanisms**. It is *not* proof
that Chat's composer is under the keys on a particular phone, and this plan does not claim it is.

Fourteen files also each write their own `<aside className="mode-band …" aria-label="…">` and their
own `<div className="band-head">`, so there is nowhere for the fit — or the label rule, or the
single-scroller rule — to live even once somebody decides what it should be.

## What gets built

**`src/web/ModeSurface.tsx`** — the container the active mode stands in, and nothing else. It owns:

- the `<aside class="mode-band …">` element and its **required** accessible label;
- an optional `head` slot, rendered as today's `.band-head`;
- the **visible-viewport constraint**: one `--kb-inset` on the band, from the same hook and by the
  same arithmetic the three dialogs already use;
- the **designated body scroller** — as an invariant it asserts, not as markup it imposes.

It knows nothing about jobs, `Found`, HTTP statuses, filters, access or model output. It renders the
**same DOM every panel renders today**, so no CSS selector changes meaning.

Piloted in **Search** and **Chat**, then the remaining twelve plus the two band-shaped fallbacks
(`FeatureBoundary`'s and `PublicChrome`'s `VisitorBand`).

## Design decisions

### The fit: one number, added once, to the bottom

`.mode-band` is `position: fixed`, so its `top` and `bottom` are the **layout** viewport's. On
Chromium `interactive-widget=resizes-content` shrinks the layout viewport when the keyboard opens and
the existing rules are already right. On WebKit it does not
([bug 259770](https://bugs.webkit.org/show_bug.cgi?id=259770)) — the layout viewport stays full
height and a smaller visual viewport is panned over it — so a fixed bottom edge is under the keys.

The correction is the one already shipped for the dialogs, extended to a fourth surface:

```css
/* .mode-band, was: */ bottom: calc(max(var(--dock-bottom), var(--safe-bottom)) + var(--hint-h));
/* becomes:      */ bottom: calc(max(var(--dock-bottom), var(--safe-bottom)) + var(--hint-h) + var(--kb-inset, 0px));
```

with `ModeSurface` supplying `--kb-inset` through the existing
`keyboardInsetStyle()`. Four properties of that choice, and each is why it is the choice:

- **No `visualViewport` ⇒ no property ⇒ `var(--kb-inset, 0px)` ⇒ today's geometry, byte for byte.**
  That is the whole fallback, and it is the path jsdom, an old browser and every desktop take.
- **`bottomInset` is 0 whenever the keyboard is shut**, and clamped at 0 when pinch-zoom makes the
  visible box taller than the layout viewport. So on every environment this repo can test, the rule
  evaluates to exactly what it evaluates to today.
- **It is added once.** The band is *not* also re-sized from `visible.height`, and its `top` is *not*
  moved by `offsetTop`. Doing either as well as this would count the keyboard twice — the trap § A5
  names explicitly. `top` is left alone on its own merits too: everything at the top of the reader is
  fixed or sticky, so when iOS pans the visual viewport they all drift together and stay in step;
  only the **bottom** edge is a genuine occlusion.
- **It makes the band a new consumer of an established mechanism, rather than a second mechanism.**
  Said precisely, because the loose version is wrong: `--kb-inset` is today read *only* by
  `.cmt-dialog`, `.chat-dialog` and `.annotate-dialog`, so `.mode-band` reading it is new. What is
  reused is the hook, the property name, the `var(…, 0px)` fallback convention and the arithmetic —
  which is the whole of what "two mechanisms" meant.

**What this deliberately does not do.** The dock is `position: fixed` at the foot of the layout
viewport, so with the keyboard up it is occluded too, and the band's bottom then sits a dock-height
above the keyboard instead of flush against it. That wastes ~40px and hides nothing. Moving the dock
above the keyboard is a **visible product change** nobody asked for; it is recorded here and not
done.

### Where the surface sits relative to the failure boundary

A2 put `FeatureBoundary` **outside** the controller, at the point `Reader` composes the band, because
a boundary cannot catch a throw from the component it lives in and because the throw is likeliest in
the controller rather than the panel
([A2 § Where the boundary goes](260905h-a-mode-failure-should-leave-the-article-readable.md#where-the-boundary-goes-and-what-resets-it)).
Nothing here changes that. `ModeSurface` is rendered **by the panel, inside the controller, inside
the boundary** — it is a container, not a boundary, and it must not be mistaken for one.

The consequence worth stating: `FeatureBoundary`'s fallback renders its own `<aside class="mode-band">`
today, precisely so a failure keeps the band's shape. That fallback moves onto `ModeSurface` as well,
so the failed band and the healthy band are the same shape by construction rather than by a copied
comment.

### There is no `foot` slot, because no band has a composer it could put in one

§ A5 lists "an optional composer" among the surface's slots. Read against the code, no band today has
a composer the *band* can place. Chat's is built inside `Conversation`, which owns the scroller ref,
the stick-to-bottom logic and the draft, and returns scroller and composer as one fragment; Search's
input is at the **top**, not the bottom, and is absent entirely for a visitor. A `foot` prop would
therefore ship with zero callers and a restructuring of `Conversation` as its price.

So the composer is not a slot. **It is the thing the fit exists to keep reachable**, and it stays
where it is. If a band later grows a composer the band itself renders, `foot` is a five-line
addition at that point. *Simplest version first* — [vision.md](../project/vision.md#simpler-first).

### The designated body scroller: "exactly one child gives way", not "exactly one scroller"

`tests/referee-band-fits.test.ts` records what goes wrong without a rule here: four children
totalling 687px in a 636px band, the only child carrying `min-height: 0` squeezed to 0px with 321px
inside it, and `.mode-band` having `overflow: visible` so **nothing was clipped, scrolled to, or
announced**. Criteria, Claims, Mirror and Candidates were all unreachable, on an ordinary article.

The obvious phrasing of the invariant — *one scroller per band* — is **false today**, and an
inventory of all fourteen bands (2026-09-06, recorded in the companion baseline) is why:

| Band | Scrollers | Which one gives way |
|---|---|---|
| Referee | `.ref-brief`, `.ref-panel`, nested `.ref-scan-list` | `.ref-panel` (`flex: 1`); the other two are capped by `max-height` |
| Search | `.srch-saved`, `.srch-hits` | `.srch-hits`; `.srch-saved` is capped by `.srch-saved-wrap`'s `max-height: 40%` |
| Chat | `.chat-scroll` **xor** `.chat-threads` | whichever is mounted — the identity changes with state |
| Outline | none, deliberately — `.mode-band.outln { overflow: hidden }` and a fisheye rung measured to fit |
| Quiz | `.quiz-one`, but **only in the ready branch** — the empty and loading states have none |
| Visitor band, failure fallback | none — a centred Tailwind block |

So the invariant the surface asserts is the one that is actually true and actually load-bearing:
**at most one child is the flexible scroller — `flex: 1` with `min-height: 0` — and every other
scrolling descendant is capped.** A band with none says so. That is exactly the property the Referee
bug violated, and stating it the naive way would have made the check green on a broken band and red
on six working ones.

`ModeSurface` does not wrap children in a scroller of its own; that would change the DOM under
fourteen sets of CSS selectors for no gain. The band **declares** its scroller instead, through one
shared marker rather than a string typed per file, and three things check it: the type, a jsdom test
over every band's rendered markup, and a browser pass that measures the real thing.

**Two latent instances of the Referee class fall out of that inventory**, and neither is fixed on a
reading of the CSS alone — § A5's rule is reproduce first:

- `.quotes-list` (styles.css:13814) is `flex: 1; overflow-y: auto` with **no `min-height: 0`**, and
  `.quotes-foot` sits below it. It is the only scroller missing it.
- None of the seven footer rules declares `flex: none`; they rely on the scroller above them being
  the child that gives way.

### The surface has to carry what Outline puts on the band

`OutlinePanel` sets a `ref`, a `data-outline-rung` attribute, its own `padding` and two custom
properties **on the band element itself**, and Chat's class and label are both conditional. So
`ModeSurface` forwards a ref and a narrow passthrough of `style` and standard element attributes,
merging its own fit style rather than replacing one. Anything it cannot carry is a band it cannot
migrate, which would leave the copies it exists to remove.

### `fitView` stays the horizontal authority

Untouched. `App.tsx` writes `--mode-w` and the `band-covers` class on `.reader` from the same
`fit.modeW`, and the stylesheet consumes that decision; the 2026-09-03 removal of
`@media (max-width: 843px)` is why (styles.css § a band with no room). **No rule added here may
recompute a competing breakpoint**, and none does: `--kb-inset` is vertical.

### Why the subscription belongs to the surface and not to each panel

`useVisualViewport` re-renders its owner on every visual-viewport `scroll`, which iOS fires
continuously while the keyboard slides. Owned by `ModeSurface`, that re-render stops at
`ModeSurface`: `children` is the same element reference across those renders, so React bails out of
the whole panel subtree. Owned by `ChatPanel`, it would re-render a transcript on the frames a phone
has least to spare.

## Stages

Each ends green, committed, with this doc updated in the same commit, and with a GPT Sol review — two
rounds, then settled here.

### Stage 1 — the baseline, then the surface, piloted in Search and Chat

Nothing about the rendered page may change in this stage.

1. **Baseline first**, because § A5 says to capture behaviour rather than invent a bug a test then
   pretends to fix, and because jsdom cannot measure a band (`referee-band-fits.test.ts` § what this
   file cannot do). Two halves:
   - **jsdom**: the current markup of every band — element, classes, label, head presence, scroller
     — snapshotted into `tests/…`, so the migration has something to be identical to.
   - **Chrome on this box, via Playwright**: `getBoundingClientRect` for the band and its children at
     390×844 portrait, 844×390 landscape, 1280×720, and at 1.5× root font size, for Search and Chat.
     Recorded in a companion `-baseline.md`.
2. `ModeSurface.tsx` with `label`, `feature`, `head`, `children` and the fit.
3. Search and Chat adopt it. The rendered DOM is identical to the baseline.
4. `--kb-inset` is **not** yet in the `.mode-band` rule — the container lands first, alone.

Done when: the baseline is recorded, both pilots render byte-identical markup, `npm test`,
`npm run typecheck`, `npm run check` green.

### Stage 2 — the fit, and the scroller invariant

1. `--kb-inset` into `.mode-band`'s `bottom`, supplied by `ModeSurface`.
2. Tests, modelled on `tests/visual-viewport-dialogs.test.tsx`, which is the file that already knows
   how to fake a `visualViewport`: no `visualViewport` ⇒ no property; a keyboard ⇒ the property, once;
   the numbers keep up with `resize` and `scroll`; a negative inset clamps; the listeners go when the
   band unmounts.
3. The scroller mark, its shared constant, and the jsdom test that every band has exactly one.
4. A browser pass: narrow portrait, landscape, large text, long labels, touch selection, and — for
   the keyboard — a **synthetic** `visualViewport` on desktop Chrome, reported as synthetic.

Done when: the fit is one mechanism, and the report says plainly which claims are measured on a real
phone (none) and which are measured in Chrome or in jsdom.

### Stage 3 — the remaining twelve, the A6 audit, and the docs

1. Migrate the other bands plus `FeatureBoundary`'s fallback and `VisitorBand`, in batches, including
   visitor/empty/error variants. Delete the replaced markup after checking callers.
2. **A6, what A2 left, and it is one specific thing.** A2 settled and shipped the Dock drawer's
   contract — `aria-modal` dropped, the labelled `role="dialog"` kept, focus moved in, untrapped,
   the opener restored on all four close paths — and left the Escape ordering alone on purpose
   ([A2 stage 2](260905h-a-mode-failure-should-leave-the-article-readable.md), *"the capture-phase
   Escape handler and its race with `CommentDialog` … are untouched"*). That race is what is left.

   **The finding, from source, 2026-09-06.** Escape ownership is expressed exactly once, ad hoc, in
   `Dock.tsx` — a `window` **capture** listener calling `stopImmediatePropagation`, which is why the
   drawer wins over everything in JS. Every other pair of overlays double-closes, because
   `useEscapeToClose` is a `window` **bubble** listener that stops nothing, and the hover card,
   `BlockGutter`'s disclosure and Floating UI's `useDismiss` are all `document` bubble, which runs
   strictly first. So priority is derived from **listener phase, not from stacking order** — and the
   topmost visible surface is usually the one that loses.
   **There is no test anywhere that opens two overlays and presses Escape once.**

   The reachable, lossy pair: `AnnotateDialog` and `CommentDialog` are rendered on independent
   conditions (`App.tsx` — `owner && annotating` against `!overlay && openComment`), both
   `position: fixed` at `z-index: 70` in the same corner. `selectProse` clears the comment before
   opening the annotation; the reverse path, `openCommentDialog`, does not clear `annotating`. One
   Escape then discards a half-typed annotation *and* closes the comment.

   **Reproduce first, then fix the one pair.** A red test that mounts both and presses Escape once.
   The fix is chosen against that test from three candidates — make the pair mutually exclusive as
   the other direction already is; have the hook claim the press; leave the stacking and fix only
   the loss — and the choice is written down here with what it costs. **No global overlay manager**:
   § A6 forbids one unless an overlap test shows local ownership cannot express the requirement, and
   one pair does not show that. The general rule for who owns Escape is **recorded as a finding for a
   follow-up, not built here.**
3. Docs: [touch](../project/touch.md), [tooltips](../project/tooltips.md),
   [reading-view-overview](../project/reading-view-overview.md),
   [design-css-overview](../project/design-css-overview.md), [new-mode](../project/new-mode.md).
   Rule wording follows [edit-important-docs.md](../reusable/edit-important-docs.md); signposting does
   not.

## What is out of scope, and stays out

**The mobile redesign is a separate product experiment and is not authorised here** — § A5 and the
review's *Alternatives* row both say so. Not built: a bottom sheet, automatic close on citation,
hiding the spine by default, moving controls into a menu. **The current default Plain and the
granularity and outline options are preserved.** If the comparison is worth having, it wants a
concrete prototype and evidence put to Greg, not a refactor deciding it quietly.

Also out: `fitView`'s horizontal arithmetic, a `{kind: "none" | "beside" | "cover"}` presentation
type (a type cleanup, not a bug), moving the dock above the keyboard, and any change to which modes
exist.

## Whose ground this crosses

Four sibling jobs from the same review are live in their own worktrees, and two of them own files
this needs:

- **A10** owns `src/web/styles.css` and is splitting it into ordered semantic sheets. This plan makes
  **one** edit there — `+ var(--kb-inset, 0px)` inside `.mode-band`'s existing `bottom` — plus at
  most one line if the `.quotes-list` defect reproduces. `git merge origin/dev` at the start of every
  stage; if the split has landed, the edit goes to wherever the band's rules now live, and the commit
  message names A10's ground.
- **A1** owns `App.tsx`, `Reader` and the mode controllers. Referee's band is inside `App.tsx`
  (`<aside className="mode-band gloss referee">`), and the A6 fix touches `openCommentDialog` there.
  Both are small, named edits, made after a merge, and migrating Referee goes **last** in stage 3 so
  it collides with the least.

`.mode-band` markup is also hand-copied into five `preview-*.tsx` files and overridden by injected
stylesheets in three of them. They are not migrated — they exist to render a band out of its fixed
context — but they are on the sweep list for any rename, per
[rename-or-move.md](../reusable/rename-or-move.md).

## The simpler option passed over

**Do nothing but delete the fourteen `<aside>`/`<div class="band-head">` copies.** That is the old
`<Band>` proposal, and § A5 is right that it "offered little deletion" — about 40 lines. It was
passed over because it leaves the two fit mechanisms in place, which is the part of A5 with an actual
reader-facing consequence, and because a container with no responsibility is the kind of wrapper that
gets deleted again in six months.

**Size the band from `visible.height` and `offsetTop` instead of insetting its bottom.** Rejected: it
replaces one mechanism with a third rather than converging on the one already shipped, it makes the
no-`visualViewport` fallback a special case instead of a default, and it is the direct route to
counting the keyboard twice.

## Review log

_(filled in per stage)_
