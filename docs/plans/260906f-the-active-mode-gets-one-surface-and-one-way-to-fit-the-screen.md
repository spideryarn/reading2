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
| 2 — the remaining eleven bands | **Done and committed** (`af589082`), two review rounds, F25–F33. **Not yet on `dev`:** blocked behind the A1 collision below. |
| 4 step 1 — the diagnostic | **Done**, on `dev` (`2dfa5235`). |
| 3 — A6, who owns Escape | **Inventory done and committed**; the implementation is **not started**. |
| 4 — the fit itself | **Blocked**, and correctly so: it needs a trace from a real iPhone, which no machine here can produce. **A5 is therefore incomplete**, and the fit is not delivered. |

**The open collision.** A1 landed while stage 2 was being built and moved every mode controller into
`src/web/modes/<mode>/`, including `RefereeBand` → `src/web/modes/referee/RefereeMode.tsx`. Stage 2
migrated Referee onto `ModeSurface` *in `App.tsx`*, where it no longer lives. All eleven panels merge
cleanly; only `App.tsx` and `tests/referee-band-fits.test.ts` conflict. The merge was **aborted rather
than resolved** — [a conflict is a proposal before it is an edit](../reusable/git-resolve-merge-conflicts.md).
The proposal is to take `origin/dev`'s `App.tsx` whole, re-apply only the `ViewportProbe` import and
mount, move the Referee migration to `RefereeMode.tsx`, and combine both sides of the test (their
`BAND_FILE` constant, this branch's `ModeSurface` regex). Nothing is discarded either way.

## Design decisions

### The fit: specified, reviewed, and blocked on a phone

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
| **Q1** — when "later" and "topmost" come apart, which wins? | **Topmost.** § Stage 3 above said "the later and visually topmost surface", which conflates two things that pair 6 splits. Topmost is what the reader can see; "later" was only ever a proxy for it. The rule is now: **the surface the reader sees in front owns the press.** |
| **Q2** — does the Dock drawer keep winning over a tooltip painted above it (pair 12)? | **Yes, and it is written down rather than fixed.** This is the one pair local ownership cannot express — beating a `window`-capture listener needs either registration order, which § A6 forbids, or a global signal, which is the thin end of the manager it also forbids. The only reachable instance is a hover/focus tooltip on the dock bar, which costs nothing to leave standing and closes itself when the pointer moves. Renouncing the requirement is cheaper than the machinery, and **no other pair asks for a manager**. |
| **Q3** — how does a native modal silence the JS tiers? | **A target test inside `useEscapeToClose`**, not a new `useNativeModalOpen()` hook. Asking `dialog[open]` is asking *the platform what the platform already owns* — the top layer is the authority, so this reads an existing fact rather than building a parallel registry. Fewer parts touching each other, and the same test goes in the Dock for pair 16. |
| **Q4** — should an annotation draft survive a close at all? | **Not here. This is a product call and it is Greg's.** The ordering fix below is already authorised and makes the draft survive *these* pairs, because Annotate is never closed by a press that belongs to something in front of it. Making the draft survive a **deliberate** close of Annotate is a different, user-visible change that nobody asked for, and A5's own § *What is out of scope* is explicit that a refactor does not get to decide product quietly. Flagged to Greg, not built. |

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

Docs move with the stage that changes what they describe: [touch](../project/touch.md),
[tooltips](../project/tooltips.md), [reading-view-overview](../project/reading-view-overview.md),
[design-css-overview](../project/design-css-overview.md), [new-mode](../project/new-mode.md). Rule
wording follows [edit-important-docs.md](../reusable/edit-important-docs.md); signposting does not.

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
