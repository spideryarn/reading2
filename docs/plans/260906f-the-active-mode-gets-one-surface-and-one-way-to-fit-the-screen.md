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

Fourteen files write a `.mode-band` aside and nine of them also write a `.band-head`, so there is
nowhere for the fit — or the label rule — to live even once somebody decides what it should be.

## What gets built, and the one thing that does not

**`src/web/ModeSurface.tsx`** — the container the active mode stands in, and nothing else:

- the `<aside class="mode-band …">` element and its **required** accessible label;
- an optional `head` slot, rendered as today's `.band-head`;
- an optional `foot` slot for a footer row the band itself places;
- the children between them, unwrapped and in order.

It knows nothing about jobs, `Found`, HTTP statuses, filters, access or model output, and it adds no
wrapper elements — it renders the **same DOM every panel renders today**, so no CSS selector changes
meaning. Piloted in **Search** and **Chat**, then the remaining ten mode panels and `VisitorBand`.

**The viewport fit is specified here and deliberately not built.** § A5 requires a real iOS
reproduction *before* choosing the arithmetic, and no iOS device is reachable from this box. What
lands instead is the instrument that gets the measurement and the reviewed arithmetic waiting for
it — [Stage 4](#stage-4-the-fit-the-instrument-that-unblocks-it-and-the-arithmetic-that-waits).
Shipping unverified viewport geometry would be inventing a bug and a fix for it in one motion.

## Where this stands, 2026-09-07

| Stage | State |
|-------|-------|
| 1 — the surface, piloted in Search and Chat | **Done**, on `dev` (`8cef3161`). Two review rounds, F15–F24. |
| 2 step 0 — capture every band before touching it | **Done**, on `dev` (`e4952ecb`), committed on its own so the ordering is provable. |
| 2 — the remaining eleven bands | **Done and committed** (`af589082`), two review rounds, F25–F33. Merged with `origin/dev` at `285437a8`; the collision below is **resolved**. |
| 4 step 1 — the diagnostic | **Done**, on `dev` (`2dfa5235`). |
| 3 — A6, who owns Escape | **Done**, on `dev` (`3f2b37ad`). Two review rounds, eleven findings, all accepted. 30 one-press tests over real components; pairs 12 and 18 renounced with the reasoning written down. |
| 4 — the fit itself | **Waiting on a requested iPhone trace; A5 remains incomplete.** Still externally blocked — the useful correction is not that it stopped being blocked but that *the blocker is a request nobody had sent*: `?probe=1` is **already in production** (verified 2026-09-07 in the deployed `assets/main-dDOSrXXx.js`), so the measurement is a two-minute task on the phone rather than hardware nobody has. `scripts/viewport-trace.ts` + `scripts/read-viewport-trace.ts` turn the file it produces into the decision. The fit is not delivered. |
| 5a — the rest of A6: click-away, return focus, and the contract | Planned; [the focus inventory](260906f-the-active-mode-gets-one-surface-and-one-way-to-fit-the-screen-focus-inventory.md) is done. **Preparatory, and it does not complete A5's modal/modeless checkbox** — see stage 5b. |
| 5b — the hover cards' keyboard reachability | **Not started, and needs a product decision** (§ *The fork* in the inventory). The checkbox stays unticked until this lands, whatever 5a achieves. |

**The collision with A1, and how it was settled.** A1
([260906c](260906c-separate-article-access-reader-composition-and-mode-controllers.md)) landed while
stage 2 was being built: every mode controller left `App.tsx` for `src/web/modes/<mode>/`, the reader
for `src/web/reader/Reader.tsx`, and `App.tsx` went from 5,716 lines to 462. Stage 2 had migrated
Referee onto `ModeSurface` *in `App.tsx`*, where it no longer lives. The other eleven panels are
their own files and merged untouched, so the whole collision was Referee.

The first merge was **aborted rather than resolved** —
[a conflict is a proposal before it is an edit](../reusable/git-resolve-merge-conflicts.md) — and the
proposal was put to Greg before anything was changed. It was then carried out at `285437a8`, and
**nothing was discarded on either side**:

- `src/web/App.tsx` takes `origin/dev`'s version **whole**. It is their file and their refactor, and
  this branch's side of the conflict was the old monolith. The Referee migration moves to
  `src/web/modes/referee/RefereeMode.tsx`; the `ViewportProbe` mount needed nothing, because A1 had
  already carried it into `Reader.tsx` intact when they split the file.
- `tests/referee-band-fits.test.ts` had both sides editing the same two lines, and they turned out to
  be **complementary**: `dev` changed which *file* the regex reads (`BAND_FILE`,
  `readerCssNoComments`, a `-1` guard), this branch changed the *pattern* it matches
  (`feature="gloss referee"` … `</ModeSurface>`). Both are kept.
  `tests/referee-how-card.test.tsx` auto-merged into the same combination.

Two things are worth recording because they are evidence rather than opinion. **The oracle held**:
all 63 tests in the five files this stage owns pass after the merge, including the Referee shape read
through `<App/>`, so it survived both the `ModeSurface` migration and A1's restructuring of the
reader. And **somebody else maintained the oracle while this branch was away** — its comments were
re-homed file by file, and a fixture bug of mine was fixed in passing (`importance: 90` and
`striking: 80` where `score()` in `src/quotes.ts` wants 0–1; it sat there looking plausible because
nothing downstream read the numbers, and `quoteTier` reads them now). That is the check working in
the direction it was built for.

## Design decisions

### The fit: specified, reviewed, and waiting on a phone

`.mode-band` is `position: fixed`, so its `top` and `bottom` are the **layout** viewport's. On
Chromium `interactive-widget=resizes-content` ([`index.html:40`](../../index.html)) shrinks the
layout viewport when the keyboard opens and the existing rules are already right. On WebKit it does
not ([bug 259770](https://bugs.webkit.org/show_bug.cgi?id=259770)) — the layout viewport stays full
height and a smaller visual viewport is panned over it — so a fixed bottom edge is under the keys.

The **candidate arithmetic to test — not a committed decision**, because A5 says the phone chooses
it and the phone has not spoken:

```css
/* .mode-band, was: */
bottom: calc(max(var(--dock-bottom), var(--safe-bottom)) + var(--hint-h));
/* becomes: */
bottom: max(
  calc(max(var(--dock-bottom), var(--safe-bottom)) + var(--hint-h)),
  var(--kb-inset, 0px)
);
```

**`max`, not `+`, and that correction is the whole of what a review bought here.** The dock, the safe
area, the install hint and the keyboard all occlude the *same* strip at the bottom of the screen.
Overlapping occlusions combine by union, and adding them reserves the same pixels twice: at a 44px
top bar and a 40px dock, a 390px layout viewport with a 120px visible strip leaves **36px** of band
under the additive form, and below an 84px strip the band collapses to nothing — a *visible*
regression where today's failure is only occlusion. The `max` form does not move the dock; it stops
reserving space for a dock the keyboard is already covering. GPT Sol F2, 2026-09-06.

Two further properties, both load-bearing:

- **No `visualViewport` means no property, and `var(--kb-inset, 0px)` then leaves today's geometry
  exactly as it is.** That is the path jsdom and an old browser take. A *present*, full-size viewport
  supplies `0px` instead, which is a different serialisation and the same computed result — so the
  acceptance test is **computed geometry, not serialised markup**. Sol F7.
- **`offsetTop` is unresolved and must not be waved away.** An earlier draft argued that the band and
  the controls bar drift together when iOS pans the visual viewport, so only the bottom edge matters.
  That argument does not hold up: `.controls` is `position: sticky` with its own `top`/`transform`
  rules ([styles.css:669](../../src/web/styles.css)) and consumes `offsetTop` no more than the band
  does, and `useVisualViewport`'s own docstring says `offsetTop` is what a top-anchored element has
  to add. Whether leaving it unused keeps the band's header reachable is **a measurement, not an
  argument**. Sol F1.

### Where the surface sits relative to the failure boundary — and where it must not

A2 put `FeatureBoundary` **outside** the controller, at the point `Reader` composes the band, because
a boundary cannot catch a throw from the component it lives in
([A2 § Where the boundary goes](260905h-a-mode-failure-should-leave-the-article-readable.md#where-the-boundary-goes-and-what-resets-it)).
Nothing here changes that. `ModeSurface` is rendered **by the panel, inside the controller, inside
the boundary** — a container, not a boundary, and not to be mistaken for one.

**`FeatureBoundary`'s fallback keeps its own raw `<aside className="mode-band">` and is deliberately
not migrated.** An earlier draft migrated it, for symmetry. That would have been a P1: if
`ModeSurface` itself throws, the boundary catches the first render and then renders a fallback that
invokes **the same throwing component again**, and the second throw escapes to `AppBoundary`, which
replaces the whole reader — the exact failure A2 exists to prevent. Sol built a React 19 harness and
confirmed the shape reaches the root fallback. So the duplication is a **circuit breaker**, not an
oversight, and it gets a test that says so. Sol F4, 2026-09-06.

`VisitorBand` has no such role and migrates normally.

### There is a `foot` slot, and six panels want it today

An earlier draft dropped `foot` on the grounds that no band has a composer the band itself can place.
That reasoning was right about Chat and wrong as a generalisation. Chat's composer really is built
inside `Conversation`, which owns the scroller ref, the stick-to-bottom logic and the draft, and
returns transcript and composer as one fragment — so Chat keeps `Conversation` whole in `children`,
as a documented exception. But **six panels already render a pinned footer row as a direct child of
the band**: `.gloss-foot`, `.ideas-again`, `.quotes-foot`, `.tl-again`, and — missed by the first
inventory — Debate's `.dbt-again` and Quiz's `.quiz-rewrite`. § A5 names header/content/footer slots,
and those six are what it is naming. Sol F5, corrected from four to six by Sol F22 on 2026-09-06;
`debate.css` says of `.dbt-again` in as many words, "Pinned under the scroller rather than at the end
of it, like `.tl-again`".

```tsx
interface ModeSurfaceProps {
  label: string;
  /* Optional: `PublicChrome`'s visitor band and `FeatureBoundary`'s fallback
     are both a bare `<aside className="mode-band">`, with no hook class. */
  feature?: string | undefined;
  head?: ReactNode;
  children: ReactNode;
  foot?: ReactNode;
  /* For `OutlinePanel`, plus a narrowed passthrough of standard attributes. */
  ref?: Ref<HTMLElement>;
}
```

`head`, then the body children unchanged, then `foot` — with **no body or footer wrapper added**.

### No structural scrolling invariant in v1

`tests/referee-band-fits.test.ts` records what goes wrong when a band's children do not fit: four
children totalling 687px in a 636px band, one child squeezed to 0px with 321px of content in it, and
`.mode-band` having `overflow: visible` so **nothing was clipped, scrolled to, or announced**.

It is tempting to answer that with an invariant. An earlier draft did, in two successive wordings,
and **both were false of the code**:

- *One scroller per band* is false. Referee has three, Search two, Chat's changes identity with
  state, Outline has none by design (`.mode-band.outln { overflow: hidden }` plus a fisheye rung
  measured to fit), and Quiz has one only in its ready branch.
- *The child that gives way carries `flex: 1; min-height: 0`* is false, and worse: it is **the exact
  reverse of the Referee fix**. `.ref-brief` is the child that gives way (`flex: 0 1 auto;
  min-height: 0`), and `.ref-panel` carries `flex: 1` with a deliberate `min-height: 5rem` floor —
  which `tests/referee-band-fits.test.ts` has an explicit test forbidding anyone to set back to `0`.
  Following the stated invariant would have undone the correction that made Referee's controls
  reachable. Sol F3, 2026-09-06.

So **`ModeSurface` claims no uniform scrolling invariant and owns no body marker in v1.** Each mode
keeps its own scroll policy. A marker was in the previous draft and is gone: a `none`/`body`
declaration that jsdom can only check against itself is a *second place for the truth to live* with
nothing tying it to the CSS or to reachability, which is a liability rather than a check. Sol F14.

**What checks the thing that matters is the browser pass**, against an explicit per-mode table of the
existing feature selectors, and it checks outcomes: the body region has non-zero height, the footer
sits inside the band, and every overflowing region is reachable. Two candidates for the Referee class
surfaced in the inventory and are for that pass to confirm or dismiss, not for a reading of the CSS
to fix: `.quotes-list` is the one scroller with no `min-height: 0`, and none of the seven footer
rules declares `flex: none`.

### Two traps in the acceptance check itself, from the baseline

The Chrome baseline (2026-09-06, `-baseline.md`) turned up two things that would each have made the
"after" comparison lie, and both are about the check rather than the code:

- **Do not compare a sum of children's heights.** Chat's band has a fourth child that is an `sr-only`
  live-region announcer — `position: absolute`, 1×1px, pulled up by `margin: -1px`, and therefore
  out of flow. It consumes no flex space, but a naive sum counts its pixel, so the raw check reads
  761 against a band of 760 and calls a no-op refactor a regression. Worse in the other direction:
  *deleting* that announcer would make the sum check start passing while having changed nothing that
  matters. **Compare `lastChild.bottom` against `band.bottom`**, which is the sharper check and was
  correct in all eight measured cases.
- **Search fits with zero slack** — children sum to the band height to the fraction of a pixel in all
  four conditions, including the 306px band at 844×390. There is no headroom, so if `ModeSurface`
  adds so much as a hairline of padding to the band, `.srch-hits` (`flex: 1 1 0%`) silently absorbs
  it and the only evidence is one pixel on the scroller. The surface must add no box of its own.

### The surface has to carry what Outline puts on the band

`OutlinePanel` sets a `ref` and a `data-outline-rung` attribute **on the band element itself**
([`OutlinePanel.tsx:307`](../../src/web/OutlinePanel.tsx)), and Chat's class and label are both
conditional. So `ModeSurface` forwards a ref and a passthrough of standard element attributes.
Anything it cannot carry is a band it cannot migrate, which would leave the copies it exists to
remove.

**An earlier version of this paragraph also said Outline sets its own `padding` and two custom
properties there. It does not** — those are in `src/web/styles/outline-mode.css` under
`.mode-band.outln`, and no mode panel writes `style` on its band today. So the passthrough is not
justified by a `style` requirement that does not exist; what it is actually for is `data-outline-rung`,
which `{...rest}` is the only thing carrying to the DOM. GPT Sol F19, 2026-09-06, checked against
the source.

The passthrough is narrowed rather than open: `dangerouslySetInnerHTML` is omitted because `children`
is required and React throws when both are set, and `role` is omitted because the labelled
`complementary` landmark is the point of the `label` prop and `role="presentation"` would silently
remove it. Sol F18.

### `fitView` stays the horizontal authority

Untouched. `App.tsx` writes `--mode-w` and the `band-covers` class on `.reader` from the same
`fit.modeW`, and the stylesheet consumes that decision; the 2026-09-03 removal of
`@media (max-width: 843px)` is why (styles.css § a band with no room). **No rule added here may
recompute a competing breakpoint**, and none does — the one rule this plan touches is vertical.

### Why the subscription, when it comes, belongs to the surface

`useVisualViewport` re-renders its owner on every visual-viewport `scroll`, which iOS fires
continuously while the keyboard slides. Owned by `ModeSurface`, that re-render stops at
`ModeSurface`: `children` is the same element reference across those renders, so React bails out of
the whole panel subtree. Owned by `ChatPanel`, it would re-render a transcript on the frames a phone
has least to spare. Verified in a React 19 harness — the child's render count stayed at one across a
surface state update, even with a fresh `style` object. Sol, checks section, 2026-09-06.

## Stages

Each ends green, committed, with this doc updated in the same commit, and with a GPT Sol review — two
rounds, then settled here.

### Stage 1 — the baseline, then the surface, piloted in Search and Chat

Nothing about the rendered page may change.

1. **Baseline first**, because § A5 says to capture behaviour rather than invent a bug a test then
   pretends to fix, and because jsdom cannot measure a band (`referee-band-fits.test.ts` § what this
   file cannot do). Two halves, in two places:
   - **Geometry** in the companion `-baseline.md` — `getBoundingClientRect` for the band and its
     children in Chrome on this box at 390×844, 844×390, 1280×720 and at 24px root font size, **for
     Search and Chat only**, those being the two panels this stage migrates.
   - **Markup** in `tests/mode-surface-changes-no-markup.test.tsx`, as literals.

   **An earlier wording of this step said the baseline records "the current markup of every band in
   jsdom". It does not, and never did** — it covers the two piloted panels. That matters because
   stage 2's acceptance below refers to "their baseline DOM", so the missing capture would have been
   discovered as an unmet precondition halfway through a twelve-band migration. Sol F21, 2026-09-06.
2. `ModeSurface.tsx` with `label`, `feature`, `head`, `children`, `foot`, the ref and the attribute
   passthrough. **No viewport subscription and no viewport style** — none at all, not even an inert
   one, because `keyboardInsetStyle` emits `--kb-inset: 0px` wherever `visualViewport` exists and
   that is desktop Chrome, which would break this stage's own acceptance. Sol F7.
3. Search and Chat adopt it, rendering markup identical to the baseline.

Done when: the baseline is recorded, both pilots are identical to it, `npm test`, `npm run typecheck`
and `npm run check` green.

### Stage 2 — the remaining bands

0. **Capture each band's pre-migration shape before editing that band** — its root attributes, its
   ordered child signatures and its header's children, recorded as literals in
   `tests/mode-surface-changes-no-markup.test.tsx` in the same way stage 1's five shapes are. Not
   afterwards, and not from the migrated code: a literal read off the code you just wrote is the
   implementation agreeing with itself. This is a step rather than a note because stage 1 shipped
   without it for the other ten and Sol found the gap (F21).
1. Migrate the other ten mode panels and `VisitorBand`, in batches, including visitor, empty and
   error variants. `foot` adopted by Glossary, Ideas, Quotes, Timeline, **Debate and Quiz**.
   `BandShape.attrs` is per-shape for exactly this: Outline legitimately carries `data-outline-rung`
   on the band, so the oracle must not hardcode the two attributes every other band has.
2. **`FeatureBoundary`'s fallback stays raw**, with a test that makes `ModeSurface` throw and asserts
   the feature fallback, the prose and the dock survive while `AppBoundary`'s fallback does not
   appear. That test is what stops a later tidy-up from re-introducing Sol F4.
3. Delete the replaced markup after checking callers. **Two** `preview-*.tsx` files hand-copy band
   markup and are not migrated — `preview-sketch.tsx` (a raw `<aside>`) and `preview-chat-markdown.tsx`
   (a raw `<div>`); they are on the sweep list, not the migration list. An earlier count of five was
   wrong: `preview-colour`, `preview-timeline` and `preview-diagram-wait` mount the *real* panels and
   only name `.mode-band` in a comment or an override rule, and `preview-illustrated` tests a dialog
   with no band at all. GPT Sol F29, 2026-09-07. `DesignPage.tsx`'s band is a third exception of the
   same kind — a specimen on `/design`, not a product mode band.

Done when: every healthy product mode band and `VisitorBand` is emitted by `ModeSurface`;
`FeatureBoundary` remains **the sole production raw `.mode-band`**, as the circuit breaker; the two
preview copies (`preview-sketch`, `preview-chat-markdown`) and the `/design` specimen remain
documented exceptions; migrated variants match their baseline DOM and geometry
(by `lastChild.bottom`, not a height sum); and changing the fallback to use `ModeSurface` makes the
circuit-breaker test fail.

The last clause is the point. An earlier draft said "done when one place writes a band", which — read
literally, which is how a checklist gets read at the end of a long day — **requires deleting the
circuit breaker** and re-creating the P1 the stage exists to prevent. Sol F9.

### Stage 3 — A6: who owns Escape

A2 shipped the Dock drawer's contract — `aria-modal` dropped, the labelled `role="dialog"` kept,
focus moved in, untrapped, the opener restored on all four close paths — and left the Escape ordering
alone on purpose. That is what is left, and it gets its own stage rather than riding along with a
migration.

**The audit, from source, 2026-09-06.** Escape ownership is expressed exactly once, ad hoc, in
`Dock.tsx`: a `window` **capture** listener calling `stopImmediatePropagation`, which is why the
drawer wins over everything in JS. `useEscapeToClose` is a `window` **bubble** listener that stops
nothing, so two of those fire on one press. Native `<dialog>` cancel is not a listener at all and
`stopImmediatePropagation` cannot reach it — only `preventDefault` on `cancel` can, and nobody does
that. There is no test anywhere that opens two overlays and presses Escape once.

**But "phase decides it" is not the whole map, and an earlier draft of this section said it was.**
Floating UI's `useDismiss` does *not* let Escape through: `escapeKey` defaults to `true`, `bubbles`
is left undefined, and the `if (!escapeKeyBubbles) { event.stopPropagation(); … }` branch runs —
`node_modules/@floating-ui/react/dist/floating-ui.react.mjs:2628`, checked by hand here, not taken on
trust. So every Floating UI surface — the tooltips, the search colour picker, `ProfilePanel` — claims
the press, while the hand-rolled `document`-bubble listeners in `useHoverCard` and `BlockGutter` do
not. **Ownership is therefore a per-pair fact about who stops what, not a rule derivable from
phase**, and that is exactly why it has to be inventoried rather than reasoned about. Sol F10.

The reachable, lossy pair: `AnnotateDialog` and `CommentDialog` are rendered on independent
conditions (`App.tsx` — `owner && annotating` against `!overlay && openComment`), both `position:
fixed` at `z-index: 70` in the same corner. `selectProse` clears the comment before opening the
annotation; the reverse path, `openCommentDialog`, is `(id) => void setNote(id)` and clears nothing.
One Escape then discards a half-typed annotation *and* closes the comment.

1. **Inventory every reachable overlap** — the Dock drawer, Comment/Chat/Annotate, the native dialogs
   (Lightbox, Feedback, Illustrated, Sketch), `BlockGutter`'s disclosure, the prose hover cards, and
   the Floating UI tooltips and pickers. For each pair: its render condition, its visual or top-layer
   order, the listener target and phase, **whether propagation or the default action is stopped**,
   and the intended owner. Nesting is real and designed for — `.tooltip-anchor` is `z-index: 100`
   explicitly to sit over the drawer's 95, and the search picker is 99 for the same reason.
2. **A one-press interaction test for every reachable overlap**, including a tooltip inside
   `CommentDialog` and each reachable native-dialog/modeless pair. Fix every failing one locally.
3. **The Annotate + Comment decision, made now rather than deferred to the keyboard.** Comment is the
   later and visually topmost surface, so **while it is present it alone owns Escape; Annotate stays
   mounted with its draft intact and becomes the owner once Comment closes.** Expressed through
   explicit local enablement — the hook takes an `enabled` argument — and **never through listener
   registration order**, which encodes mount time rather than what the reader can see. The two
   rejected alternatives and why: making the pair mutually exclusive would silently discard a
   half-typed annotation the moment a comment opened, and "fix only the loss" leaves one press
   closing two surfaces, which is the thing A6 asks to end.
4. **No global overlay manager.** § A6 forbids one unless an overlap test shows local ownership
   cannot express the requirement. If the inventory turns up a pair local ownership genuinely cannot
   express, that is a finding to report — not a licence to build one here.

#### What the inventory found, and the four calls it sent back

The inventory is
[the escape inventory](260906f-the-active-mode-gets-one-surface-and-one-way-to-fit-the-screen-escape-inventory.md):
**15 surfaces, 18 reachable pairs in 9 classes, 5 unreachable.** Its organising finding is that
Escape is **five tiers running in a fixed order** — `window` capture (the Dock alone), the React root
(the text boxes), `document` bubble (Floating UI, the hover cards, `BlockGutter`), `window` bubble
(`useEscapeToClose`), then the platform's close request for a native `<dialog>` — and that a
surface's tier is the whole of its authority, because nothing anywhere reads a z-index or another
surface's state.

**The audit in this plan was incomplete, not merely wrong about Floating UI.** It had no T1 tier at
all, and the text boxes decide whether a press reaches any tier below them. Two further consequences
it did not have: `stopPropagation` on `document` does not stop *siblings* on `document`, so one press
closes every open T2 surface at once; and T2 protects T3 while T3 protects nothing, so an open
Floating UI surface silently saves the comment dialog while an open hover card does not.

**The lossy pair is three pairs**, and the third needs no click: hovering a glossary term opens a
hover card that stops nothing, so one Escape closes the card *and* discards a half-typed annotation.
The loss is not a property of Comment at all — it is `setAnnotating(null)` being reachable from a
listener that never asks whether anything is in front of it.

| Q | The call |
|---|----------|
| **Q1** — when "later" and "topmost" come apart, which wins? | **Topmost — but only where the two surfaces actually overlap.** § Stage 3 above said "the later and visually topmost surface", which conflates two things that pair 6 splits. Topmost is what the reader can see; "later" was only ever a proxy for it. The rule is: **the surface the reader sees in front owns the press** — and where nothing is in front, because the two do not share any part of the screen, it is the one the reader just opened. See the amendment below, which was written after the stage was built. |
| **Q2** — does the Dock drawer keep winning over a tooltip painted above it (pair 12)? | **Yes, and it is written down rather than fixed.** This is the one pair local ownership cannot express — beating a `window`-capture listener needs either registration order, which § A6 forbids, or a global signal, which is the thin end of the manager it also forbids. The only reachable instance is a hover/focus tooltip on the dock bar, which costs nothing to leave standing and closes itself when the pointer moves. Renouncing the requirement is cheaper than the machinery. **A second pair joins it below** — pair 18, for the same reason and by the same reckoning — and **neither asks for a manager**. |
| **Q3** — how does a native modal silence the JS tiers? | **A target test inside `useEscapeToClose`**, not a new `useNativeModalOpen()` hook. Asking `dialog[open]` is asking *the platform what the platform already owns* — the top layer is the authority, so this reads an existing fact rather than building a parallel registry. Fewer parts touching each other, and the same test goes in the Dock for pair 16. |
| **Q4** — should an annotation draft survive a close at all? | **Not here. This is a product call and it is Greg's.** The ordering fix below is already authorised and makes the draft survive *these* pairs, because Annotate is never closed by a press that belongs to something in front of it. Making the draft survive a **deliberate** close of Annotate is a different, user-visible change that nobody asked for, and A5's own § *What is out of scope* is explicit that a refactor does not get to decide product quietly. Flagged to Greg, not built. |

#### Two amendments, made after the stage was built and reviewed

Both came out of GPT Sol's review of the built code, 2026-09-07. Neither is a change of mind about
what A6 asks for; both are places where the answers above turned out to be **under-specified rather
than wrong**, and the code had already been written one particular way. Recording the reasoning here
rather than in a comment is the point — a code comment asserting an exception is not the same thing
as the exception having been decided.

**Q1 is amended: "topmost" only decides between surfaces that overlap.** Sol's reading was literal
and correct — the inventory puts the gutter disclosure at `z-index: 3` and the three modeless dialogs
at 70, so a bare "topmost wins" makes pair 6 close the *dialog* and leave the gutter open, and both
the implementation and its test do the opposite. The amendment, rather than the rewrite:

- **A z-index only compares surfaces that share some of the screen.** The gutter disclosure opens in
  the prose margin, beside a paragraph; the three dialogs are corner overlays. Nothing is in front of
  anything, so there is no "topmost" to read, and the number is a fact about painting rather than
  about attention.
- **Where nothing overlaps, the surface the reader just opened is the one they are looking at.** The
  disclosure was opened by a press a moment ago; the dialog may have been sitting there for a minute.
- **And decisively: the other answer discards a draft.** Closing Annotate — with a half-typed note in
  it — because the reader pressed Escape over a gutter row they had just opened is precisely the loss
  A6 exists to end. Between two readings of an ambiguous rule, the one that throws a reader's words
  away loses.

This needs no machinery: tier order already encodes it, the gutter being T2 and the dialogs T3.

**And the amendment has to be ordered, or it is not a rule.** Sol's second round made the fair
objection that "topmost, and otherwise the one last opened" leaves *"most recently opened"* and
*"currently interacting with"* undefined against each other — which is not a quibble, because the
hover card's 220ms close delay produces exactly that state: focus has moved from the card into a text
field, the card is **still on screen**, and Escape arrives. So the rule is written as two clauses in
order, and the first one settles that case:

1. **A surface that is visibly in front owns the press.** Visible is the test, not recency: the card
   in its close delay is still painted over the page, so it is still what the reader sees in front,
   and the code claiming the press there is right. This is the clause that decides almost everything.
2. **Where neither is in front of the other** — because they do not share any screen space at all,
   like a gutter row in the prose margin and a dialog in the corner — **the one the reader last acted
   on owns it.**

The 220ms window is therefore **decided rather than overlooked**: Escape closes the card, not the
field, and the field's own Escape is one further press away. It costs a keystroke and loses nothing,
where the alternative — teaching the card what has focus elsewhere — is the lifted state § A6
forbids.

**Pair 18 joins pair 12 as declared rather than fixed.** All of tier T2 are *siblings* on `document`,
and `stopPropagation` does not stop a sibling — only `stopImmediatePropagation` does, and that
resolves by **registration order**, which § A6 forbids in as many words. The alternative is a shared
signal, which is the manager it also forbids. So a tooltip and the search colour picker, or a tooltip
and a gutter row, still both close on one press.

What was *not* left standing: the prose hover card moved to the **capture** phase during this review
(for a different reason — see below), which puts it ahead of every T2 sibling as well. Since the card
is `z-index: 100`, that is Q1 being satisfied rather than dodged, and it removes the card from pair 18
entirely. What remains is Floating UI against a hand-rolled sibling, and Floating UI's phase is not
ours to choose.

The cost of leaving it is one extra surface closing, never a draft: **no member of T2 holds editable
or unsaved reader input.** An earlier wording said "nothing a reader has typed", and that is
literally false — `ProfilePanel` shows the reader's own profile and reading purpose. But those words
are saved and read-only, so closing the panel loses nothing, which is the property the renunciation
actually rests on. GPT Sol, round 2. **That is the line** — pairs 12 and 18 are renounced because
what they cost is a surface that would have closed itself anyway, and **no pair that can lose words
is on this list**.

**Also fixed during the review, and not in the build list above:**

- **Pair 3 was not actually fixed by the first attempt, and its test said it was.** `AnnotateDialog`
  focuses its textarea on mount, and *hovering* a term moves no focus — so the press landed on the
  textarea's own two-stage Escape (tier T1, ahead of the card on the bubble path), which wiped the
  draft while leaving the card open. The test had blurred the box first, justified by a comment that
  is true of a click and false of a hover, which is the pair's whole point: it needs no click. Fixed
  by moving `useHoverCard`'s listener to `document` **capture**, which is ahead of every React
  handler; pinned by a test that does not blur, watched red beforehand.
- **Pair 17**, the same platform fact as pairs 13–15 one tier out: neither the hover card nor the
  gutter asked whether a native `<dialog>` was open, so a press that the platform was going to spend
  on the dialog closed one of them too. Both now make the same `dialog[open]` query.
- **Pair 7**, the masthead rename, which no build item named: `TitleEditor`'s input stopped nothing,
  so cancelling a rename with any of the three dialogs open closed that too.

#### What gets built, from the inventory

1. **Topmost owns the press, expressed as explicit local enablement** — `useEscapeToClose` takes an
   `enabled` argument, and Annotate passes `false` while Comment, `ChatDialog` or a hover card is in
   front. Never registration order, which encodes mount time rather than what the reader can see.
2. **The two T2 members that forget to stop, stop** — `useHoverCard` and `BlockGutter` call
   `stopPropagation` **when they actually have something open**, which is two lines and fixes five
   pairs. Conditional, because the hover card's handler runs whenever the hook is mounted and an
   unconditional stop would swallow Escape for the whole reader.
3. **`useEscapeToClose` declines a press that belongs to an open native `<dialog>`**, and so does the
   Dock. Nothing calls `preventDefault` on `cancel` anywhere, and the two `cancel` handlers take no
   event argument at all, so the fix cannot live in the dialog.
4. **A one-press test for every reachable overlap**, which is the thing that does not exist today:
   nine test files mention Escape and every one paints a single surface.

Also from F6, and small: two comments asserting the tooltip layer is 80 when it is 100
(`annotations.css`, `Dock.tsx`), and `openCommentDialog`'s parameter typed `BlockId` while two
callers pass a *comment* id — harmless only because `BlockId` is a bare alias, and a type error the
day it is branded.

Done when one Escape closes the topmost intended surface once, every underlying draft and open state
survives it, and each reachable overlap has a test.

### Stage 4 — the fit: the instrument that unblocks it, and the arithmetic that waits

**The `max()` expression above is a reviewed hypothesis, not a decision.** Device evidence decides
whether the band is layout-anchored and whether `bottomInset` represents the relevant bottom
occlusion at all; until then no viewport-fit arithmetic is chosen. What is missing is the one thing
this box cannot produce, so this stage builds the thing that produces it.

1. **A production-geometry diagnostic, using `ModeSurface` itself** — not copied band markup, or it
   measures a replica rather than the thing. From focus until the keyboard settles it **retains
   timestamped, copyable samples** on every visual-viewport `resize` and `scroll` — a live readout
   cannot hold the transient "opening" frames, which are the interesting ones. Each sample:
   `innerHeight`; visual-viewport width, height, `offsetTop`, `offsetLeft` and `scale`; page scroll;
   the computed `--safe-bottom`, `--dock-bottom` and `--hint-h`; and rectangles for the controls bar,
   **the dock**, **the install hint where present**, the band, its header, its body and its composer.
   The dock and the hint are there because A5 asks for the *actual occluding bars* and the previous
   draft measured only the band's own parts. Sol F12.
2. **Run on the reporting iPhone**, in the installed app and ordinary Safari where both are
   available: portrait and landscape/notch; keyboard closed, opening, open; then pinch and pan.
   Record which dock and hint surfaces are actually visible in each sample. The exported trace goes
   in `-baseline.md` beside the Chrome numbers, labelled as the device measurement.
3. **Choose the arithmetic from the recorded measurements.** `max(base clearance, bottomInset)` only
   if they show both terms are bottom-anchored intervals in the same coordinate space; account for
   `offsetTop` as the evidence requires. Then the rule and `ModeSurface`'s subscription land together.
4. Tests modelled on `tests/visual-viewport-dialogs.test.tsx`, which already knows how to fake a
   `visualViewport`: no `visualViewport` ⇒ no property; a keyboard ⇒ the property, once; the numbers
   keep up with `resize` and `scroll`; a negative inset clamps; the listeners go on unmount.

**Stage 4 is complete only when the device trace, the chosen implementation, the automated checks and
a real-phone acceptance pass have all landed.** If the trace does not arrive, the diagnostic may be
committed, but **stage 4 and A5 are recorded as blocked and incomplete, and the viewport fit is not
reported as delivered.** Stages 1–3 stand on their own either way. Sol F13 — because "an honest end"
was still one sentence away from being read as a finished one.

#### Step 3½, added 2026-09-07: the trace is read by a program, not by eye

Two corrections to the above, both from a Fable arbitration of "what is the honest stage 4 without a
phone", and the first of them makes the second worth building.

**"Blocked" was hiding the actual next action.** It is still externally blocked, and Sol's F48 was
right that saying otherwise argues terminology; what was wrong is that the blocker was recorded as
missing hardware when it was **a request nobody had sent**. The probe is *already deployed*: `www.spideryarn.com`'s reader chunk contains it, verified by fetching
`assets/main-dDOSrXXx.js` on 2026-09-07 and finding the panel's own marker string. So the trace is
not waiting on hardware nobody has — it is waiting on **one ask, of the one person who has the
phone**, and nobody had sent it. Recorded as *waiting on a requested trace*. The ask itself:

> On the iPhone, in Safari: open `https://www.spideryarn.com/read/<any article>?mode=chat&probe=1`,
> open a thread, tap the `probe N` chip at the top left, tap **mark**, tap into the composer, wait
> for the keyboard to settle, tap **mark** again, then **copy**, and paste it back. Then once more
> in landscape, and once in the installed app if it can be got to that URL. While the probe is up,
> tapping into a **comment dialog** too costs nothing and verifies the 2026-09-04 `--kb-inset` fix,
> which `feedback.md` still records as never having been watched on a phone.

**There is a real-device *symptom consistent with* the mechanism already, and this plan never cited
it.** [The 2026-09-04 report](../user-feedback/260904_1723-mobile-keyboard-done-send-button.md) came
from the installed iOS app: a `position: fixed`, bottom-anchored dialog with its Send button behind
the keys. **The WebKit-pan explanation of it remains an inference** — that report's own § *Honest
limit* says nobody has raised a real keyboard on a real phone, so no viewport values were measured,
and calling it an observation *of the mechanism* overstates it. Sol F39. What it is: a symptom on the
phone that matters, of the shape the mechanism predicts. It does **not** promote the band's composer
from hypothesis to defect — the
band is not that dialog, and Safari's focus-pan may drive `offsetTop` up instead, at which point
`bottomInset` is 0, the composer clears the keys, and the band's *head* is off the top instead.
Which of those happens is precisely Sol's F1, and only the trace says. But it does mean the
mechanism is observed rather than merely specified, and the plan should have said so.

**[`scripts/read-viewport-trace.ts`](../../scripts/read-viewport-trace.ts)** reads the probe's file
and answers the three questions the trace exists to settle: whether anything is actually hidden;
whether the keyboard **shrinks** the strip (`bottomInset` moves, so a `bottom:` rule is the right
shape) or **pans** it (`offsetTop` moves, so a `bottom:` rule cannot reach the head at all); and
`max` against `+`, both computed per sample and printed side by side. It decides nothing and
contains no fix — it makes the choice a computation over recorded data rather than a person reading
four hundred lines of JSON and finding what he expected.

**Three things a first draft got wrong, all found by Sol's review and all fixed before any trace
arrives** — which matters, because the first trace is the one that would have been misread:

- **A trace that cannot answer must say `INCONCLUSIVE`, not `clean`.** A missing rectangle became a
  zero, a keyboard that never opened got a reassuring explanation, and a Chromium-shaped trace read
  as "no defect" — when what it actually says about iOS is nothing. `clean` now requires positive
  evidence: a usable keyboard-closed→open transition *and* recorded rectangles for everything a
  reader must reach. The CLI exits **3** on inconclusive, so nothing downstream can read silence as
  success. Sol F36, and it is silent-success in one function.
- **Which way the viewport moved is a comparison, not a maximum.** The draft took the largest
  `bottomInset` anywhere against the largest `offsetTop` anywhere — different moments, pinched
  samples included — which can say *"shrank, so a bottom rule is right"* about a trace whose head is
  clipped off the top. It now takes **deltas from a keyboard-closed baseline** over scale-1 samples,
  and **refuses to endorse bottom-only arithmetic whenever a measured head is clipped above**,
  whatever the deltas say. Sol F34.
- **External JSON is not a type.** Casting the file to an interface made TypeScript believe
  `win[1]` was a number when it was `undefined`. Every sample is now validated field by field, and
  malformed ones are **named with their index** rather than dropped. Sol F35.

Also from that review: the probe's own `vis` field means *"inside the layout viewport"*, not *"inside
the visible strip"* — it compares against `window.innerHeight`, so a dock behind the keyboard reads
`on` (Sol F38). **The probe is not changed**, deliberately: it is already deployed, so an edit would
not reach the trace that arrives, and it records the dock's and hint's rectangles, from which real
occlusion is computable here. `vis` is parsed, carried, and never used for a conclusion. Sol's second
round agreed this is right for the imminent trace, and left **one outstanding producer change for
whenever `ViewportProbe` is next deployed**: rename or recompute `vis`, so a future raw trace does
not carry a knowingly misleading "on screen".

**The checks moved out of the script and into `tests/viewport-trace.test.ts`** — 42 of them after
the second round, run by the ordinary gate, and six of those run the CLI as a subprocess because its
exit codes are a contract nothing else touched. A `--self-test` living inside the script was a check no gate ran (Sol F37). The
cases are chosen to be the ones a wrong implementation passes: a plain shrink, a plain pan, both
moving at once, a head clipped above with shrink-shaped deltas, a pinched sample, a Chromium-shaped
trace, a missing composer rectangle, four kinds of malformed file, and the arithmetic to the pixel.
**Two were watched failing under mutation**: removing the clipped-head refusal reddens exactly the
F34 case, and turning a missing rectangle back into a zero reddens exactly the F36 one. The
arithmetic case earned its keep immediately — it caught the plan's own worked example being
mis-transcribed, and now pins both of its numbers.

The one derived check worth more than the columns: `.mode-band` is `position: fixed` with a known
`bottom:`, so `band.y + band.height` must equal `innerHeight − clearance` in every sample **if**
rectangles are measured against the layout viewport. That equation is the premise the whole fix
rests on, stated in numbers, and the script prints whether it holds rather than assuming it from a
spec nobody measured.

**What was considered and rejected**, so it is not re-proposed: a Chromium pinch experiment via CDP
to settle the same questions locally. It cannot. Fixed elements anchoring to the layout viewport is
the definition of the visual viewport, so a pinch would confirm a spec sentence; the genuinely open
question is what Safari's *focus-pan* does to `offsetTop` for an input inside a fixed element, which
is neither pinch nor Chromium. And no WebKit build exists on this box — `~/.cache/ms-playwright/`
holds `chromium-1234` and `chromium_headless_shell-1234` only — while WebKitGTK has no soft keyboard
and no focus-pan even if it were installed.

**A CSS characterisation test was rejected too, and that rejection was wrong.** The reasoning was
that with no keyboard `--kb-inset` is `0px` and `max(x, 0px) = x`, so the test passes before and
after any correct fix. That holds only for a test that *waits* for a keyboard — and a real-browser
test can **inject a non-zero `--kb-inset`**, at which point the current rule, the `max` form and the
additive form give three different computed geometries and are told apart. Sol F40, and the repo
already has the pattern: [`tests/mark-sign-in-chrome.test.ts`](../../tests/mark-sign-in-chrome.test.ts)
is one Chrome, one page, the real stylesheet inlined and `getComputedStyle` — with a loud skip where
no Chrome exists, which is honest rather than red on a machine that cannot answer.

So the correction is a **sequencing** one, not a refusal: the iPhone trace stays the evidence that
*chooses* the rule, and a Chrome computed-geometry regression test is **required once the rule is
chosen**, as part of step 4. What must not happen is picking the arithmetic from a browser that does
not have the bug.

Docs move with the stage that changes what they describe: [touch](../project/touch.md),
[tooltips](../project/tooltips.md), [reading-view-overview](../project/reading-view-overview.md),
[design-css-overview](../project/design-css-overview.md), [new-mode](../project/new-mode.md). Rule
wording follows [edit-important-docs.md](../reusable/edit-important-docs.md); signposting does not.

### Stage 5 — the rest of A6: Tab, click-away, and the focus that comes back

The other half of A5's modal/modeless checkbox. Stage 3 did Escape; this does Tab, Shift-Tab,
click-away and return focus, over the same surfaces.
[The focus inventory](260906f-the-active-mode-gets-one-surface-and-one-way-to-fit-the-screen-focus-inventory.md)
is written and is the authority for what follows. **It needs no phone**, which is why it is worth
doing while the trace is awaited.

**Its finding inverts the expected work, so read it before the steps.** Twelve of seventeen surfaces
have no focus trap — every one that is not a native `<dialog>` — and for ten of those it is correct,
several arguing it in their own docstrings:
this app is deliberately modeless nearly everywhere, `aria-modal` appears nowhere as an attribute,
and `inert` is used nowhere in the UI. **The job is not to add traps.** It is to state each
surface's contract and check it against its own — and A5's wording is exactly that: *"follow the
declared contract"*.

**And the constraint that shapes every check, measured on this box rather than assumed:** jsdom
implements **no** Tab traversal, **no** `showModal`/`show`/`close`, and **no** `inert`. All three of
the mechanisms a trap is built from are absent, so a jsdom test claiming to prove a trap asserts the
behaviour of a fake. Two models to copy, both already here:
`tests/the-dock-drawer-is-not-a-modal.test.tsx` tests the two mechanisms a trap would *need* rather
than traversal, and says so; and [`tests/mark-sign-in-chrome.test.ts`](../../tests/mark-sign-in-chrome.test.ts)
drives **one real Chrome from inside vitest**, skipping loudly where there is no Chrome. The second
is what makes an honest Tab test possible at all, and the first review of this stage was right that
without it the stage's headline behaviour would go untested (Sol F45).

#### It is two stages, and the split is the point

Sol's F43: *"Deferring the hover-card product choice is sensible; deferring the defect and then
completing Stage 5 is not."* That is right, and it is the F13 move I would otherwise have made. So:

- **Stage 5a** is everything below. It is **preparatory**, and finishing it **does not tick A5's
  modal/modeless checkbox.**
- **Stage 5b** is the hover cards, and it needs a product decision that is Greg's. The checkbox
  stays unticked until 5b lands, whatever 5a achieves.

#### Stage 5a

0. **The masthead rename's focus-on-open is unprotected, and this was established by mutation
   rather than suspected.** Two measurements on this box, 2026-09-07:

   - `input.select()` **moves focus in real Chrome and does not in jsdom**, while setting the
     selection range in both — so the call looks as if it worked either way. `TitleEditor` focuses
     the rename input with `select()` and nothing else, so that input **is** focused for a reader
     and **is not** under test.
   - Replacing that `select()` with a no-op leaves **all 13 tests in `tests/article-rename.test.tsx`
     green.** Deleting the feature outright is silent. A reader would have to click the pencil and
     then click again before they could type, and nothing in the suite would say so.

   The restore test that looks like it covers this — *"puts focus back on the pencil rather than on
   the body"* — passes in both worlds by different routes: `EditableTitle` restores only when
   `activeElement` is `body` or `null`, which jsdom reaches because focus never left `body`, and
   production reaches because unmounting the focused input drops focus there. Same assertion, same
   result, different world. This is the postmortem's class arriving from **the harness** rather than
   from a helper, which is why it is step 0 and not a footnote.

   **The fix is a real-Chrome check**, now that there is a pattern for one — not a jsdom test, which
   cannot express the thing, and not a proxy assertion dressed up as the behaviour.

1. **Pin the five native dialogs' backdrop press.** Five copies of `if (e.target === ref.current)
   onClose()` — Lightbox, Feedback, Illustrated full, Sketch full, CommandBar — and **not one test
   dispatches a click whose target is the dialog**. Both directions each: the dialog element closes
   it, a child does not. This needs no `showModal`, because the handler only compares targets.
2. **Fix `tests/feedback-dialog.test.tsx`'s `reopen()`.** Its comment says *"Shut it the way Escape
   or the backdrop does"* and its body flips the `open` prop, which is neither route. It hides
   nothing today — both routes reach the same state through `onClose` — but it is
   [the class the stage-3 postmortem named](../postmortems/260907b-a-test-blurred-away-the-condition-it-existed-to-test.md),
   the second instance on this plan, and it is one line from being a real one.
3. **Pin `outsidePress` in both Floating UI consumers.** `tests/profile-panel.test.tsx` and
   `tests/search-colour-picker.test.tsx` test Escape and never an outside press, so the default that
   dismisses them is unpinned in the app that relies on it. **And their focus restore is
   conditional, not simply "yes"** — Floating UI returns focus to the trigger only where the outside
   press did not itself land focus on something real, so the two cases (blank space, another
   control) are different and both want observing in Chrome rather than citing from the bundle.
   Sol F46.
4. **Give AnnotateDialog and ChatDialog the focus restore they have none of.** The inventory calls
   these real gaps and the first draft of this stage then repaired neither, which Sol's F42 caught.
   Both take focus on open — Annotate focuses its textarea, Chat's draft arm focuses its composer —
   and neither records an opener, so closing either drops the reader on `<body>`. The pattern is
   already written twice, in `Dock.tsx` § *the drawer takes focus, and gives it back* and in
   `CommentDialog`: record `document.activeElement` on mount, restore it on cleanup if
   `isConnected`, and name a fallback for the case where the control that opened it has gone.
   **Every close route**, not only the button.

   **These two need a *captured, dynamic* opener, and that is what makes them different from step 5
   below.** The control that opened Annotate is a selection in the prose; the one that opened a chat
   draft may be a gutter chip that is gone by the time the dialog is. Chat has a second case of its
   own: focused content is unmounted when the `draft` arm becomes the `thread` arm, **before** the
   dialog closes at all, so "restore on unmount" does not cover it.
5. **Surface 17: `RefereeHowCard`.** Missed by the first inventory because it is in flow — and as
   Sol's F41 says, being in flow removes the *trap* requirement, not the *return-focus* one. Its
   Close button is the focused element and `how.show(false)` unmounts it, so a keyboard reader who
   opens the explanation and closes it lands on `<body>`. Restore focus to `RefereeHowButton`, and
   test with the Close button focused before it is activated.

   **It is more reachable than the others, not less**: `useHowCard` is
   `useState(() => !howCardDismissed())`, so the card is **open by default** until a reader has
   dismissed it once. The first thing a keyboard reader does in Referee mode is close this card,
   and the reward is losing their place. `useHowCard` holds `open` and nothing else — there is no
   focus code in the file at all.

   **This is a simpler problem than step 4, and an earlier draft wrongly said the two shared one
   shape.** Sol: *"the three-surface focus generalisation is false, not merely unargued."* Referee
   does **not** take focus on open — the card appears and focus stays on the always-mounted toggle;
   the loss happens only to a reader who Tabs *into* the card and presses its Close button. So there
   is no dynamic opener to capture and no fallback to invent: the destination is permanent and
   known. Hold a ref to `RefereeHowButton` and restore straight to it. Using step 4's
   capture-the-opener machinery here would be borrowing a solution for a problem this does not have.
6. **`ChatDialog`'s `?thread=` arm focuses nothing** (`focusNonce={0}` against `{1}` in the draft
   arm). **Do not "fix" this by passing `{1}`.** Sol's F44 said the obvious change contradicts a
   recorded contract; checked by hand, it is stronger than that — the contract is **Greg's own
   decision, quoted in `ChatPanel.tsx`**:

   > when a new chat is started, move focus to the input box
   >
   > — Greg, 2026-08-26

   with the code's own gloss: *"Which is the only time it is right … a focused textarea turns ↑ / ↓
   from 'step through the article' into 'move the cursor', and nothing on screen would say why."* So
   `{1}` here would undo a product decision **and** break the arrow-key contract in
   [keyboard.md](../project/keyboard.md).

   **The target is the Close control.** An earlier draft of this step said "decide the target first
   — container, heading, or Close control", and Sol was right that this is the decision moved into
   an implementation imperative rather than taken. Taking it: the Close control **exists immediately
   in every state the dialog can open in** — thread, loading, and the gone/deleted case — where a
   heading may not; it is already a genuine tab stop and already the reader's way out, so nothing new
   becomes focusable; and it is what `CommentDialog` does, so this is the established pattern rather
   than a second one. It does not touch the composer, so Greg's decision above stands untouched.

   **This step is a focus-restore fix, not a focus-on-open one**, and confusing the two is what makes
   `{1}` look right.
7. **Write the modal/modeless contract down** where a reader of the code meets it — the tier table
   in [keyboard.md](../project/keyboard.md) gained Escape's order in stage 3 and this is its
   sibling. Not a new rule: a statement of the one the code already follows, so the next surface has
   something to be consistent with instead of a precedent to guess at.
8. **A real-Chrome traversal check** for one native modal and one modeless surface, on the
   `mark-sign-in-chrome` pattern. Sol's F45 offered an alternative ending — declare it unreliable
   and record a manual pass instead — and **that escape hatch is closed, because the feasibility was
   spiked rather than guessed.** In headless Chrome on this box, 2026-09-07, with a page holding a
   link, a `<dialog>` with two buttons, a trigger and a portalled card:

   | from | Tab, Tab, Tab, Tab |
   | --- | --- |
   | modal **closed**, starting behind it | `trigger → c1 → c2 → body` — the shut dialog's buttons are skipped |
   | modal **open**, starting inside it | `d2 → body → d1 → d2` — it **cycles within the dialog** and never reaches anything behind it |
   | Shift-Tab from the card's first control | `trigger` |

   Deterministic, and the platform trap is plainly observable. **One caveat for whoever writes it:**
   `body` appears in a modal's tab ring, so the assertion must be *"nothing outside the dialog is
   ever reached"* rather than an exact sequence — an exact-sequence test would be brittle for a
   reason that has nothing to do with the behaviour.

#### Stage 5b — the hover cards, which need a decision first

Both hover cards are `role="dialog"` with a link and a button inside, portalled to the end of
`<body>`, opened by keyboard focus (`focusable: true`) — and Tab then goes to the next link in the
article rather than into the card, because its controls sit past everything in document order. It is
a real defect and A5's checkbox names it: *"No footer/composer or close control may be
unreachable."*

The sharpest part is that the reasoning which created it is in the file. `role="dialog"` was chosen
over `tooltip` on a GPT Sol review of 2026-08-26, for the right reason — *"a tooltip does not take
focus and should not contain focusable controls. This one holds a link and a button."* The review
made the role honest about the content, and nothing then made the content reachable.

**Why it waits for Greg rather than for more thinking:** the three fixes are not equivalent (§ *The
fork* in the inventory lays them out), one of them trades a keyboard bug for a possible stacking
bug, and **a card the reader can Tab into is a card they must Tab out of, on every hyperlink in the
article** — which changes what reading with a keyboard feels like. A5 is explicit that a refactor
does not decide product quietly.

**Its acceptance, whichever option is chosen**, because a stage that waits on a decision can still
say how it will be judged — and Sol's F45 was only half discharged while 5a had a traversal check and
the surface with the actual defect had none. In real Chrome, on the `mark-sign-in-chrome` pattern:
open the card **by keyboard focus**, Tab into it, traverse its controls, Shift-Tab back out, dismiss
it, and land focus somewhere a reader can carry on from. The honest manual fallback stands if that
cannot be made reliable — but the Chrome spike above says it can, so the fallback should not be
needed.

**Also not in either stage:** adding a uniform click-away. The inventory establishes that **no
unsaved reader prose is lost to an outside click today**, because the three surfaces that hold
drafts have no outside-press mechanism at all. Adding one uniformly would create three new loss
paths, Annotate's immediately. That is a finding, not an absence of work.

## Whose ground this crosses

Four sibling jobs from the same review are live in their own worktrees, and two own files this needs:

- **A10** owns `src/web/styles.css` and is splitting it into ordered semantic sheets. This plan makes
  **no** edit there before stage 4, and one line then. `git merge origin/dev` at the start of every
  stage; if the split has landed, the edit goes wherever the band's rules now live, and the commit
  message names A10's ground.
- **A1** owns `App.tsx`, `Reader` and the mode controllers. Referee's band lives in `App.tsx`, and
  the stage-3 fix touches `openCommentDialog` there. Both are small, named edits made after a merge,
  and Referee migrates **last** in stage 2 so it collides with the least.

## What is out of scope, and stays out

**The mobile redesign is a separate product experiment and is not authorised here** — § A5 and the
review's *Alternatives* row both say so. Not built: a bottom sheet, automatic close on citation,
hiding the spine by default, moving controls into a menu. **The current default Plain and the
granularity and outline options are preserved.** If the comparison is worth having, it wants a
concrete prototype and evidence put to Greg, not a refactor deciding it quietly.

Also out: `fitView`'s horizontal arithmetic, a `{kind: "none" | "beside" | "cover"}` presentation
type (a type cleanup, not a bug), moving the dock above the keyboard, a global overlay manager, and
any change to which modes exist.

## The simpler option passed over

**Delete the fourteen `<aside>` copies and stop.** That is the old `<Band>` proposal, and § A5 is
right that it "offered little deletion" — about 40 lines. Kept in the plan anyway, because after
Sol's F1 that is close to what stages 1–2 actually are, and it is worth being honest that the fit —
the part with a reader-facing consequence — is the part that cannot land without a phone. What the
container still buys is the place for it to land in, one label rule instead of fourteen, and the
`foot` seam four panels already wanted.

**Add the keyboard inset to the dock clearance.** Rejected: overlapping occlusions combine by union,
and the additive form collapses the band to nothing below an 84px visible strip. See § the fit.

**Migrate `FeatureBoundary`'s fallback too, for symmetry.** Rejected as a P1: it makes the fallback
re-invoke the component that just threw. See § where the surface sits.

## Review log

### Round 1 — the plan, GPT Sol, 2026-09-06

Verdict: **refuse as written**, F1–F6 as established P1s.
[The review](260906f-the-active-mode-gets-one-surface-and-one-way-to-fit-the-screen-review-sol.md).

| ID | Finding | Disposition |
|----|---------|-------------|
| F1 | Chose unverified bottom-only arithmetic; A5 requires an iOS reproduction first, and the "top chrome drifts together" argument is wrong about `.controls` | **Accepted.** The fit moved to stage 4, blocked on a device measurement, with an instrument built to get one. The `offsetTop` argument is withdrawn as unevidenced. |
| F2 | Dock clearance and keyboard inset are overlapping occlusions and must combine by `max`, not `+`; the additive form collapses the band below an 84px strip | **Accepted**, and it is the better arithmetic. Verified by hand: the collapse is real. |
| F3 | The scroller invariant is the reverse of the Referee fix — `.ref-brief` is the child that gives way, and a test forbids `min-height: 0` on `.ref-panel` | **Accepted.** Checked against styles.css:7052/7294 and the test at line 74; Sol is right. No structural invariant in v1; the browser pass checks outcomes instead. |
| F4 | Migrating `FeatureBoundary`'s fallback onto `ModeSurface` lets a `ModeSurface` throw escape to `AppBoundary` and replace the reader | **Accepted.** The best finding of the round — Sol built a harness. The raw fallback is now a documented circuit breaker with a test. |
| F5 | Dropping `foot` is defensible for Chat but wrong in general; four panels already render a direct footer row | **Accepted.** Confirmed at `GlossaryPanel.tsx:487` and `QuotesPanel.tsx:674`. `foot` is in. |
| F6 | The A6 step stops short of its acceptance; drop A6 from this job entirely | **Partially overruled.** The brief assigns A6's remainder to this job, so dropping it is not mine to do. But Sol's real complaint — that a twelve-band migration and an interaction audit do not belong in one stage — is right, so A6 is now its own stage 3, delivering the whole audit and the ownership rule rather than deferring it. |
| F7 | Stage 1 cannot be "with the fit" and byte-identical, because `keyboardInsetStyle` emits `0px` wherever `visualViewport` exists | **Accepted.** Stage 1 has no viewport code at all, and the acceptance is computed geometry rather than serialised markup. |
| F8 | The copy counts are wrong: 14 asides, 9 heads, ten panels left after the pilot | **Accepted**, corrected throughout. |

Sol also confirmed two claims rather than faulting them: the React 19 bailout, and that no descendant
of a mode band reads `--kb-inset` today, so there is no inherited-property collision.

### Round 2 — the revised plan, GPT Sol, 2026-09-06

Verdict: **refuse as written**, F9–F12 as established P1s.
[The review](260906f-the-active-mode-gets-one-surface-and-one-way-to-fit-the-screen-review-sol-r2.md).
F1–F5, F7 and F8 were accepted as fixed. **All of F9–F14 are accepted**; discovery closes here, per
[engineering-manager.md](../reusable/engineering-manager.md) — two rounds, then settle.

| ID | Finding | Disposition |
|----|---------|-------------|
| F9 | Stage 2's "done when one place writes a band" requires deleting its own circuit breaker and re-creating F4 | **Accepted.** The acceptance now names `FeatureBoundary` as the sole production raw band, and requires that migrating it makes the test fail. |
| F10 | A6 is still a one-pair fix, and the audit's claim that Floating UI's `useDismiss` stops nothing is false | **Accepted, and the factual half checked by hand** at `floating-ui.react.mjs:2628` — `escapeKey` defaults true, `bubbles` is undefined, `stopPropagation()` runs. My audit was wrong and the plan said so in bold. Stage 3 now inventories every reachable overlap and tests each. Sol's ownership decision for Annotate+Comment is adopted as written. |
| F11 | `max()` is still "committed to" before the measurement that A5 says must choose it | **Accepted.** It is now a candidate to test. Sol also reported finding no algebraic counterexample to it, and established that the "hidden dock plus open mode" state is unreachable (styles.css:12708) — useful, but not a substitute for the phone. |
| F12 | The diagnostic cannot validate the arithmetic: it omits the dock, the install hint, the safe-area/dock/hint values and pinch/pan, and a live readout cannot retain the "opening" frames | **Accepted** in full; the strongest finding of the round. The instrument now retains timestamped samples and measures the actual occluding bars. |
| F13 | "An honest end" leaves room to mark the job complete after shipping only the diagnostic | **Accepted.** Stage 4 and A5 are recorded blocked and incomplete if the trace does not arrive, and the fit is not reported as delivered. |
| F14 | The `none`/`body` marker is redundant truth with no enforcement | **Accepted**, and it was my own suspicion #4. Dropped in v1. |

Sol also caught a mistake in my review prompt rather than in the plan: I wrote "untracked: none" while
the baseline and the round-one review were both untracked. They are committed with this revision.

### Stage 1 code, round 1 — GPT Sol, 2026-09-06

Verdict: **refuse as written**, no P0 or P1.
[The review](260906f-the-active-mode-gets-one-surface-and-one-way-to-fit-the-screen-review-stage1-sol.md) ·
[the prompt](260906f-the-active-mode-gets-one-surface-and-one-way-to-fit-the-screen-review-stage1-prompt.md).

Sol confirmed from the scoped pre/post diff that **both migrations preserve their DOM** in every
branch — Search's owner/visitor and meaning/words conditionals, Chat's open/list, `chat remember`,
error ordering, the `ArmedDelete` key and the keyed `Conversation` — that the added fragments
introduce no DOM, that `FeatureBoundary` stays raw, and that there is no viewport code. The findings
are all about the surface's edges and about the evidence, not about the migration.

| ID | Finding | Disposition |
|----|---------|-------------|
| F15 | The empty-head guard excludes `null`, `undefined` and `false` but **not `true`**, which React also renders as nothing — so `head={someBoolean}` still yields an empty `.band-head`, and the comment claiming "all four nothing values" covered three | **Accepted.** The guard is `typeof head !== "boolean" && head != null`, which is a fact about React rather than a list of remembered cases. `""` and `[]` are explicitly **not** treated as absent, and the reason is written into the code: a fragment of `null`s is equally empty and no runtime check distinguishes it, so a rule with a stated edge beats one that catches some empties and not others. |
| F16 | The acceptance oracle misses the changes it exists to catch: a wrapper *around* the `<aside>`, added text nodes (anonymous flex items), and any extra attribute such as `style` | **Accepted in full, and the best finding of the round** — these generalise to every shape, which the per-shape literals do not. `expectShape` now asserts the band is the panel's entire output, that its attribute set is exactly `class` and `aria-label`, and that no non-whitespace text sits directly inside it. All three were watched going red. |
| F17 | The docstring claims every literal came from the Chrome baseline; the baseline records only Search/words and Chat/open, and no `aria-label` at all | **Accepted.** The claim was false and is now split into two labelled provenances — *measured* for the two baseline shapes, *read from the pre-migration source at `369699af~1`* for the labels, Remember, and the two shapes added here. Two extra shapes are pinned (Search visitor, Chat list) because they change the band's own children; the other dozen are not, because transcribing code written an hour ago is agreement with the implementation rather than a check on it. |
| F18 | `PassThrough` admits `dangerouslySetInnerHTML` — a type-valid call React throws on, since `children` is required — and `role`, which can remove the landmark the component says it owns | **Accepted.** Both omitted. Sol also confirmed the spread order is right and that moving `{...rest}` after the owned props would be worse. |
| F19 | The Outline rationale describes code that does not exist: `OutlinePanel` writes no padding and no custom properties on the band, only a ref and `data-outline-rung` | **Accepted**, and it was in this plan as well as in the component — both corrected. The real seam is `data-outline-rung`, which only `{...rest}` carries to the DOM. |

Both of the defects listed under F15 and in the test's own docstring were found **before** this
review, by reading rather than by a failing caller, and neither had a caller in stage 1 — they were
waiting for stage 2. That is the argument for migrating the remaining bands only behind this test.

### Stage 1 code, round 2 — GPT Sol, 2026-09-06

Verdict: **refuse as written**, no P0 or P1.
[The review](260906f-the-active-mode-gets-one-surface-and-one-way-to-fit-the-screen-review-stage1-sol-2.md) ·
[the prompt](260906f-the-active-mode-gets-one-surface-and-one-way-to-fit-the-screen-review-stage1-prompt-2.md).

Sol judged F15, F17 and F19 fixed, F18's two props fixed with an adjacent hole (F23), and F16 only
partly fixed (F20). **Discovery closes here** — two rounds, then settle, per
[engineering-manager.md](../reusable/engineering-manager.md). **All of F20–F24 are accepted**; there
is nothing to overrule.

| ID | Finding | Disposition |
|----|---------|-------------|
| F20 | The oracle records only each child's *class*, so a `<form class="chat-composer">` becoming a `<div>`, an attribute appearing on a child, a changed header row, or text beside the `<aside>` all still pass | **Accepted, and it was the round's best finding.** Children are now compared as `tag.class[attrs]` signatures, the whole-output check reads `childNodes` rather than `children`, and the header's own children are pinned. The signatures immediately proved the point: `.chat-composer` is a `<form>`, `.chat-threads` an `<ol>`, `.srch-hits` a `<ul>`, `.srch-legend` a `<p>` — four tag changes a class-only check could not have seen. Each tag was verified against the panels at `369699af~1` before being recorded. |
| F21 | The plan claims the baseline holds "the current markup of every band in jsdom"; it holds Search and Chat geometry only, and stage 2's acceptance depends on baselines that do not exist | **Accepted.** The stage-1 wording was false and is corrected. Stage 2 gains a step 0: capture each band's shape *before* editing it. `BandShape.attrs` is now per-shape so Outline's `data-outline-rung` does not force the oracle to be relaxed for everyone. |
| F22 | Six panels render a pinned footer row, not four — Debate's `.dbt-again` and Quiz's `.quiz-rewrite` were missed | **Accepted.** Verified by hand: both are direct children after the scrolling child, and `debate.css` describes `.dbt-again` as "Pinned under the scroller… like `.tl-again`". Corrected in the plan and in the component. |
| F23 | `PassThrough` still admits `aria-hidden` and `aria-labelledby`, which undo the landmark and the accessible name that `label` exists to guarantee | **Accepted.** Both omitted. Omitting `role` while leaving those was half a rule. |
| F24 | Three comments still assert false things: a leftover "all four values are transcribed from the baseline", the plan's interface block still showing `feature: string` required, and the empty-head rationale | **Accepted.** The first two were stale text left behind by the round-1 fixes — the same class of error as F17 and F19, which is why the round-1 log now says to weight it. On the third, Sol is right that the boundary is better justified as **sentinel versus content** than as "a rule with an edge"; the decision stands and the reason is rewritten. |

Sol also confirmed, established, that **no remaining band needs an extra wrapper or a new slot**:
Visitor, Summary and Outline omit `head`, Outline uses the existing ref and passthrough, the other
fixed header rows fit `head`, and the six pinned rows fit `foot`. So the interface is stage-2 ready;
what stage 2 still owes is the per-band evidence, which is now its step 0.

### Stage 2 code, round 1 — GPT Sol, 2026-09-07

Verdict: **refuse as written**, no P0 or P1, and "the runtime migration itself is correct".
[The review](260906f-the-active-mode-gets-one-surface-and-one-way-to-fit-the-screen-review-stage2-sol.md) ·
[the prompt](260906f-the-active-mode-gets-one-surface-and-one-way-to-fit-the-screen-review-stage2-prompt.md).

Sol confirmed, established: all eight fragment sites preserve their prior DOM; **all six footer
guards are exact conjunctions** of their former outer and inner guards; Debate's portal renders under
`document.body` so `.dbt-again` stays after `.dbt-scroll`; Outline's ref still reaches the `<aside>`
and `data-outline-rung` survives; Referee's two regex slices remain equally strong and fail
non-vacuously; and the circuit-breaker test genuinely exercises the second-throw path. Every finding
is about the stage's **evidence**, not its behaviour — which is the right place for them to be.

| ID | Finding | Disposition |
|----|---------|-------------|
| F25 | Quiz's own trap is not pinned: the oracle always supplies `subMode`, and `tests/quiz-panel.test.tsx` omits it but never looks at `.band-head` — so `head={subMode}` deletes the row with the whole suite green | **Accepted, and the best finding of the round**, because it is the regression this stage's headline fix exists to prevent, left unguarded. `QUIZ_NO_SUBMODE` now pins it. Watched: with `head={subMode}`, that one test goes red and the other 31 stay green — exactly as described. The first attempt used a default parameter and caught *itself*: `mountQuiz(QUIZ, undefined)` selects the default, so it pinned the wrong shape. |
| F26 | `new-mode.md` turns a migration exception into a universal rule, and would tell a future mode whose header genuinely belongs in one state only to manufacture a blank row in every other | **Accepted.** My wording, and it contradicted the very next rule in the same file. Rewritten as a question rather than an instruction: a row that must persist while its contents come and go takes a fragment; a header that should not exist takes the conditional. Also corrected there — it is four bands that empty *while loading*, plus Diagram's ordinary state, not five loading bands. |
| F27 | The circuit-breaker test is untracked, and so is the review prompt — so the protection this stage claims would not have shipped | **Accepted, and it is the second time I have misdeclared untracked files to a review** (Sol caught the same thing on the round-2 plan prompt). Both are in this commit. An untracked test protects nothing, and "untracked: nothing" is a claim to check rather than assert. |
| F28 | Diagram's fragment rationale overclaims: a conditional `head` would not undo the 2026-08-30 fix, because the caveat still builds a `.band-head` whenever it exists — it removes only the *empty* row | **Accepted.** The fragment is still right, for the plainer reason that this stage preserves the DOM the band already had. Corrected in the file. |
| F29 | The raw-band inventory is stale: two preview files hand-copy band markup, not five, and the oracle's stage-2 describe still says the bands "have not migrated yet" | **Accepted.** `preview-colour`, `preview-timeline` and `preview-diagram-wait` mount the real panels and only name `.mode-band` in a comment or an override; `preview-illustrated` has no band. Corrected in the plan, the describe and `preview-diagram-wait`'s own comment. |

**Three source-reading tests broke on this migration and all three were right to.** `referee-band-fits`
slices `App.tsx` by regex in two places, and `referee-how-card` anchors on `className="band-head"`,
which `ModeSurface` now writes instead of `App.tsx`. Each anchor was updated to the new form with the
reason recorded beside it.

### Stage 2 code, round 2 — GPT Sol, 2026-09-07

Verdict: **refuse as written**, no P0 or P1, "the runtime migration remains correct". Discovery closes
here — two rounds, then settle.
[The review](260906f-the-active-mode-gets-one-surface-and-one-way-to-fit-the-screen-review-stage2-sol-2.md) ·
[the prompt](260906f-the-active-mode-gets-one-surface-and-one-way-to-fit-the-screen-review-stage2-prompt-2.md).
**All of F30–F33 are accepted**; nothing is overruled. F25, F26 and F28's primary claim were judged
fixed, and the two `referee-band-fits` slices sound.

| ID | Finding | Disposition |
|----|---------|-------------|
| F30 | F27 is **still** unfixed — the circuit-breaker test and both round-1 review files are still untracked, so the protection the stage claims would not ship | **Accepted, and this is the third time.** I asserted in the round-2 prompt that they were "tracked and in the pending commit"; they were not, because I had written the sentence instead of running `git add`. Fixed for real, and verified with `git ls-files` rather than by claim. The lesson is narrow and worth keeping: *a statement about the repository is a command's output, never a recollection.* |
| F31 | The repaired `referee-how-card` assertion passes with the button deleted — the migration comment I added **inside the slice** contains the words `RefereeHowButton`, and the end anchor is unchecked so a missing `.ref-brief` reads most of the file | **Accepted. The worst finding of the stage, and I introduced it while fixing F29's neighbour.** A repair that makes a test pass on its own prose is worse than the break it replaced. Now asserts `briefAt > bandAt` and searches for `"<RefereeHowButton"`; watched red with the button removed, where the previous version stayed green. |
| F32 | The F29 inventory correction is incomplete: the acceptance criterion still says "the five preview copies", and the oracle still says nineteen shapes and "the eleven bands the migration has not touched yet" | **Accepted.** Corrected in all three places. A correction that fixes the paragraph and not the checklist eight lines below it is the same class of error as the thing it was correcting. |
| F33 | Three comments still assert what the code does not do — including **my own justification for duplicating the `referee-band-fits` regex**, which claimed a shared stale slice would pass vacuously; it would not, because `toContain` on an `undefined` match throws | **Accepted, and the middle one is mine twice over**: I wrote the wrong reason for a decision that was right anyway. The duplication makes a failure *local*; it is not what prevents a vacuous pass — the assertions naming real tags are. Also fixed: Quiz's helper pointing at a test that does not guard its case, and Diagram's surviving claim that an `h2` pushes a third child, when that `h2` went on 2026-09-05. |

On the oracle's sufficiency Sol's answer is **reasoned, and I am taking it**: it is enough as the
standing guard for the `ModeSurface` seam — root, exact class and name, attribute names, wrapper and
sibling structure, ordered direct children, loose text, header contents — and it is **not** a full-DOM
oracle. It cannot see descendants below a non-header direct child, attribute values on children, a
branch no fixture mounts, portals, or geometry. That is the right boundary for what this seam is, and
`new-mode.md` now says "surface shape" rather than "every band's markup", which was mine and overstated
it.

Sol also judged, reasoned, that this stage neither complicates nor helps A6, and that **Escape
ownership must not move into `ModeSurface`** — it cannot know whether a tooltip, a drawer, a native
dialog or an editor currently owns the press. That matches the inventory's tier model and stage 3
keeps ownership local.

### Stage 4's reframe and reader (code) + stage 5 (plan), round 1 — GPT Sol, 2026-09-07

A **mixed** review, and the two halves were weighted differently on purpose: `scripts/read-viewport-trace.ts`
was built and reviewed as code; stage 5 was specified and reviewed as a plan. Fifteen findings,
**all accepted**, and three of them changed what gets built rather than how.

| ID | Finding | Disposition |
| --- | --- | --- |
| F34 | The shrink/pan verdict compares the largest `bottomInset` **anywhere** against the largest `offsetTop` **anywhere** — different moments, pinched samples included. It can report "shrank, so a bottom rule is right" for a trace whose head is visibly clipped above | **Accepted, and the finding that would have cost the most**, because its output is an instruction to build the wrong shape of fix. Classification now works on **deltas from a keyboard-closed baseline** over scale-1 samples only, returns `shrank`/`panned`/`mixed`/`inconclusive`, and **refuses to endorse bottom-only arithmetic whenever a measured head is clipped above, whatever the deltas say**. `tests/viewport-trace.test.ts` § *refuses a bottom-only rule …* is exactly Sol's counterexample — inset larger than offset, head clipped — and was watched going red with the refusal removed. |
| F35 | The producer/reader seam has no runtime contract: the reader casts arbitrary JSON to a hand-copied type, so `win[1]`, `vv[2]` and `band[3]` are "safe" even when the file is malformed or from a newer probe. The copies had already drifted | **Accepted.** Every sample is validated field by field — tuple lengths, finiteness, required keys — and malformed ones are **named with their index** rather than dropped. Four parse cases in the suite. Sol's deeper point stands and is recorded rather than built: a shared type is not a contract for stored external JSON. |
| F36 | Missing evidence still produced a clean verdict — absent rectangles became zero via `?? 0`, a missing `visualViewport` warned and carried on, and a trace where the keyboard never opened got a reassuring explanation | **Accepted, and it is silent-success in one function.** `clean` now requires *positive* evidence: a usable closed→open transition **and** recorded rectangles for everything a reader must reach. Everything else is `INCONCLUSIVE`, which the CLI exits **3** on. A Chromium-shaped trace is now inconclusive rather than clean — which is right, since what it says about iOS is nothing. Watched red by turning a missing rectangle back into a zero. |
| F37 | The self-test exercised neither pan, nor hidden-above geometry, nor malformed data, nor either arithmetic — and no repository gate ran it | **Accepted.** The analysis moved to `scripts/viewport-trace.ts` as pure functions and the checks to `tests/viewport-trace.test.ts`, 23 of them, in the ordinary gate. The arithmetic case paid for itself at once: it caught **this plan's own worked example being mis-transcribed** (120px leaves 36px of band, not zero) and now pins both numbers. |
| F38 | The probe's `vis` means "inside the layout viewport", not "inside the visible strip" — it compares against `window.innerHeight`, so a dock behind the keyboard reads `on` | **Accepted, and fixed at the other end.** Sol offered changing the probe; that would not help, because **the probe is already deployed** and an edit cannot reach the trace that arrives. It records the dock's and hint's rectangles, so occlusion against the visible strip is computed in the reader instead. `vis` is parsed, carried, and never used for a conclusion. Two tests pin the difference. |
| F39 | Step 3½ overstates the 2026-09-04 report as an observation *of the mechanism*; that report's own § *Honest limit* says nobody measured a phone's viewport values | **Accepted.** Reworded to "a real-device **symptom consistent with** the mechanism", with the inference named as an inference. Sol also confirmed the plan does *not* promote the band's composer from hypothesis to defect, which was the thing being guarded. |
| F40 | Rejecting a CSS characterisation test outright is wrong: a real-browser test can **inject** a non-zero `--kb-inset` and tell the current rule, `max` and `+` apart | **Accepted, and my rejection was wrong on its own terms** — it reasoned about a test that *waits* for a keyboard rather than one that supplies the variable. Corrected to a **sequencing** rule: the iPhone trace still chooses the arithmetic, and a Chrome computed-geometry regression test is required once it is chosen. Sol also found the precedent I did not know was there — `tests/mark-sign-in-chrome.test.ts` drives one real Chrome from inside vitest, with a loud skip where there is none. |
| F41 | The "complete sixteen-surface census" is incomplete: `RefereeHowCard` was excluded for being in flow, yet its focused Close button is unmounted with no restoration to *How this works* | **Accepted.** Verified by hand. **Being in flow removes the trap requirement, not the return-focus requirement** — the exclusion applied a real rule to the wrong question. It is surface 17, and repairing it is stage 5a step 5. |
| F42 | The inventory calls Chat's and Annotate's missing focus restore real gaps, and stage 5 then repaired neither | **Accepted, and it is the more embarrassing half of F41**: naming a defect and planning nothing is worse than missing it. Both are now stage 5a step 4, and they turn out to share one shape with `RefereeHowCard` — each takes focus on open and unmounts the focused element on close. One pattern, already written twice in this codebase, fixes all three. |
| F43 | Deferring the hover-card *product choice* is sensible; deferring the *defect* and then completing stage 5 is not | **Accepted, and it is the F13 move I would otherwise have made.** The stage is split: **5a** is preparatory and explicitly **does not tick A5's modal/modeless checkbox**; **5b** is the hover cards and waits on a decision that is Greg's. The checkbox stays unticked whatever 5a achieves. |
| F44 | Stage 5 treats Chat's thread arm as one missing focus call, but the obvious `focusNonce={1}` contradicts `ChatPanel`'s recorded contract that opening an existing conversation must not steal focus into the composer | **Accepted.** My step said "small, inside the contract" and it was neither. The step now says to decide the target first — container, heading or Close control — and forbids the obvious change by name, since the next reader of that step would otherwise make it. |
| F45 | No retained test is planned for actual Tab/Shift-Tab order, which is the stage's headline behaviour, despite the Chrome-in-vitest precedent | **Accepted**, and it follows from F40's discovery. Stage 5a step 8 adds a real-Chrome traversal check for one native modal and one modeless surface — **or**, if it cannot be made reliable, says so and leaves the Tab half of the checkbox explicitly incomplete with a recorded manual pass. Both endings are honest; a green jsdom suite proving nothing is not. |
| F46 | The Floating UI table says focus restore is simply "yes"; the source makes it conditional on the outside press not having landed focus somewhere eligible | **Accepted.** The table now says *conditional*, and the entry stays **unsettled rather than resolved** — two readings of a bundle are still not a run — with stage 5a step 3 requiring both cases (blank space, another control) to be observed in Chrome. |
| F47 | Two nested-case claims are false or too strong: multiple `showModal()` dialogs *can* stack, and CommandBar restores the actual prior focus rather than categorically "into the modeless dialog" | **Accepted, and verified against the code's own comment** — `Dock.tsx` says outright that `showModal()` over another modal "stacks two in the top layer". So what prevents it here is **the app's reachability guards, not a platform rule**, and a "cannot occur" resting on a false platform rule is one refactor from occurring. Both corrected. |
| F48 | "Waiting on a requested trace — not the same as blocked" argues terminology, and the nearby heading still said "blocked on a phone" | **Accepted.** It *is* still externally blocked; what was wrong was recording the blocker as **missing hardware when it was a request nobody had sent**. Status now reads "Waiting on requested iPhone trace; A5 remains incomplete", and the stale heading is fixed. |

**Four things Sol looked at and did not fault**, recorded because they were the ones most likely to
be wrong: the `max` vs `+` wording handles an inconclusive trace correctly and "not disproved" is not
an endorsement; rejecting a Chromium pinch as a substitute for Safari's keyboard focus-pan is right;
the stage-4 status does not launder completion; and the backdrop-handler count, the `reopen()`
diagnosis, the absence of `aria-modal`/`inert` in the UI, and the two Floating UI outside-press gaps
are all accurate.

Sol would refuse to rely on a first phone trace until F34–F36 were fixed, and refuse to build stage 5
as one stage until F41–F45 were resolved. Both conditions are now met.

### Stage 4's reader and stage 5's plan, round 2 — GPT Sol, 2026-09-07

**Both refusal conditions were re-tested and one failed.** Sol's verdict: the trace-reader condition
was **not met** — "F34 moved into a temporal-order bug, and F35–F36 still allow unsupported
answers"; the stage-5 condition was met *in the narrow sense* that the split is real, but the round-1
log's claim that F41–F45 were all resolved was itself wrong on two counts. Nine findings, **all
accepted**. Sol ran counterexamples rather than describing them, which is why none of this is
arguable.

| ID | Finding | Disposition |
| --- | --- | --- |
| F49 | **Blocker: the F34 fix moved the bug rather than removing it.** `classify()` found a keyboard-closed sample *anywhere* and then measured every moved sample against it — **including samples recorded before it**. Sol ran an open→closed-only trace: `SHRANK`, `bottomRuleSuffices: true`, `DEFECT`, all off a baseline from the future | **Accepted, and it is reachable in ordinary use, which is what makes it a blocker rather than a curiosity.** The probe's **clear** button empties the sample list *without recording a new `start`* — so clearing with the keyboard up and then dismissing it produces exactly this trace. Rewritten: `chronology()` walks samples forwards, a baseline governs only what follows it, moved samples before any baseline are reported as **orphans**, and the trace is cut into closed→open episodes. Out-of-order timestamps are now fatal. Watched red by re-seeding the baseline from anywhere — one line, and the test that catches it is Sol's own counterexample. |
| F50 | Transient and settled motion are conflated: one mid-animation frame where both deltas move makes a whole trace `mixed`, even when the state the reader held still in was a clean shrink | **Accepted**, and it is the better model of what a trace *is*. The decision now comes from the **marked** frames only — the recipe asks the reader to tap `mark` with the keyboard shut and again once it has settled — and the sliding frames are reported beside the verdict as `transientClipping` rather than inside it. Two tests: a slide that must not change the verdict, and a slide with a clipped head that must be reported and must not decide. |
| F51 | The runtime contract accepts any event string, ignores the producer marker, discards `of`, and treats `dm`/`vis` as optional. Sol supplied a trace with no `head` and `ev: "banana"` and got `clean` | **Accepted in full.** `head.probe` must be the deployed marker or the file is refused outright — guessing at another program's tuple order is how a confident wrong answer gets printed. `ev` is checked against the enum, `of` and `vis` and `dm` are required. The deployed probe writes no version, so this format is recorded as v0 by definition and a future probe should carry one. |
| F52 | **More seriously**: rejected samples were printed and then *removed before classification*, so a malformed clipped frame could be dropped while the surviving subset exited 0 as clean | **Accepted, and this is the sharpest of the nine.** `verdictOf` now takes the rejection list and returns `inconclusive` whenever it is non-empty — the malformed frame is exactly as likely to be the one that mattered. Watched red by disabling that guard. |
| F53 | F36 still does not establish that a *keyboard* happened. "Open" meant only that visual-viewport numbers moved, which browser chrome hiding also does. The probe records the focused element in `of.focus` and the reader was throwing it away | **Accepted, and the evidence was already in the file I was parsing.** A `CHAT` profile now requires an **editor focused at the settled endpoint** — `textarea`, `input` or `form` — before it will call a viewport movement a keyboard. Three tests: nothing focused, a focused link, and the three tags that do count. |
| F54 | `MUST_REACH = ["head", "composer"]` is wrong as a global contract — Glossary and Outline legitimately have no composer, `ModeSurface` permits no head — and simultaneously too weak, because a rectangle seen only in the *closed baseline* counted as evidence for the open state | **Accepted, both halves.** The caller now names a `Profile`: `CHAT` (head + composer + editor) or `NO_COMPOSER` (head only). Requirements are checked **in the settled frame** rather than anywhere in the trace, so a composer that vanished by the time the keyboard was up no longer counts. |
| F55 | **The third uncaught mutation, which I had asked for**: changing the CLI's inconclusive return to `0` leaves every analysis test green, because none of them runs the command. And there was already a live contract mismatch — a missing file rejected `main()` and exited **1** where the documented contract said **2** | **Accepted.** Six subprocess tests now run the CLI for real: 0 on defect, **3 on inconclusive**, 2 on invalid JSON, 2 on a foreign file, 2 on a missing file, 2 on an unknown profile. `readFile` is caught inside `main()`. Watched red with Sol's exact mutation. He also asked for `SLOP = 0` to be pinned, since every fixture moved by whole pixels; there is now a sub-pixel-wobble case. |
| F56 | **The three-surface focus generalisation is false, not merely unargued.** `RefereeHowCard` does *not* take focus on open; and Chat loses focused content when `draft` becomes `thread`, before the dialog closes at all | **Accepted, and the over-generalisation was mine, from two cases to three.** Steps 4 and 5 are now separate problems with separate fixes: Annotate and Chat need a *captured, dynamic* opener with a fallback; Referee has a **permanent, known** destination and needs only a ref to `RefereeHowButton`. Corrected in the plan, the inventory and the round-1 log. Borrowing step 4's machinery for Referee would have been solving a problem it does not have. |
| F57 | **F44 was recorded as accepted and was not actually decided** — step 6 still said "choose among container, heading, or Close control", which is the decision moved into an implementation imperative | **Accepted, and it is the failure mode this plan produces most often** — a disposition table is exactly where "I will decide later" hides as "decided". Taken: **the Close control**, because it exists in every state the dialog can open in where a heading may not, it is already a tab stop and already the reader's way out, and it matches `CommentDialog` rather than inventing a second pattern. |
| F58 | F45 is half disposed: 5a requires a Chrome traversal check, but **5b — the surface with the actual keyboard-unreachable defect — has no retained test requirement at all** | **Accepted.** 5b now carries its own acceptance, whichever product option is chosen: keyboard-open, Tab in, traverse, Shift-Tab out, dismiss, land somewhere usable. A stage waiting on a decision can still say how it will be judged. |

**What Sol did not fault**, recorded because two of them were deliberate deviations from his own
round-1 advice: the decision **not** to change the deployed probe for F38 is "sound for the trace
that is about to arrive", since editing a producer cannot alter an already-produced trace and the
rectangles it records are enough to compute occlusion properly in the reader. He would still rename
`vis` in the producer **on the next deployment**, so future raw traces do not carry a knowingly
misleading "on screen" field — recorded here as the one outstanding producer change, and not a
refusal condition. F39, F40, F41's census inclusion, F43 and F46–F48 all carried through.

**Settling it, after two rounds.** Nothing is overruled. Every finding in both rounds was accepted,
which is unusual and worth saying plainly rather than dressing up: the plan was in reasonable shape
and **the instrument that would read Greg's one measurement was not**, twice over. The three
blocker-grade defects — a baseline from the future, a subset exiting 0 as clean, and "the viewport
moved" standing in for "a keyboard opened" — would each have produced a confident, wrong instruction
about what to build, from a trace that can only be taken once.
