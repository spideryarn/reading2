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
it — [Stage 4](#stage-4--the-fit-the-instrument-that-unblocks-it-and-the-arithmetic-that-waits).
Shipping unverified viewport geometry would be inventing a bug and a fix for it in one motion.

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

### There is a `foot` slot, and four panels want it today

An earlier draft dropped `foot` on the grounds that no band has a composer the band itself can place.
That reasoning was right about Chat and wrong as a generalisation. Chat's composer really is built
inside `Conversation`, which owns the scroller ref, the stick-to-bottom logic and the draft, and
returns transcript and composer as one fragment — so Chat keeps `Conversation` whole in `children`,
as a documented exception. But **four panels already render a pinned footer row as a direct child of
the band**: `.gloss-foot`, `.ideas-again`, `.quotes-foot`, `.tl-again`. § A5 names header/content/
footer slots, and those four are what it is naming. Sol F5.

```tsx
interface ModeSurfaceProps {
  label: string;
  feature: string;
  head?: ReactNode;
  children: ReactNode;
  foot?: ReactNode;
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

`OutlinePanel` sets a `ref`, a `data-outline-rung` attribute, its own `padding` and two custom
properties **on the band element itself**, and Chat's class and label are both conditional. So
`ModeSurface` forwards a ref and a narrow passthrough of `style` and standard element attributes.
Anything it cannot carry is a band it cannot migrate, which would leave the copies it exists to
remove.

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
   file cannot do). Two halves, both recorded in the companion `-baseline.md`: the current markup of
   every band in jsdom, and `getBoundingClientRect` for the band and its children in Chrome on this
   box at 390×844, 844×390, 1280×720 and at 24px root font size.
2. `ModeSurface.tsx` with `label`, `feature`, `head`, `children`, `foot`, the ref and the attribute
   passthrough. **No viewport subscription and no viewport style** — none at all, not even an inert
   one, because `keyboardInsetStyle` emits `--kb-inset: 0px` wherever `visualViewport` exists and
   that is desktop Chrome, which would break this stage's own acceptance. Sol F7.
3. Search and Chat adopt it, rendering markup identical to the baseline.

Done when: the baseline is recorded, both pilots are identical to it, `npm test`, `npm run typecheck`
and `npm run check` green.

### Stage 2 — the remaining bands

1. Migrate the other ten mode panels and `VisitorBand`, in batches, including visitor, empty and
   error variants. `foot` adopted by Glossary, Ideas, Quotes and Timeline.
2. **`FeatureBoundary`'s fallback stays raw**, with a test that makes `ModeSurface` throw and asserts
   the feature fallback, the prose and the dock survive while `AppBoundary`'s fallback does not
   appear. That test is what stops a later tidy-up from re-introducing Sol F4.
3. Delete the replaced markup after checking callers. The five `preview-*.tsx` files hand-copy band
   markup and are not migrated; they are on the sweep list, not the migration list.

Done when: every healthy product mode band and `VisitorBand` is emitted by `ModeSurface`;
`FeatureBoundary` remains **the sole production raw `.mode-band`**, as the circuit breaker; the five
preview copies remain documented exceptions; migrated variants match their baseline DOM and geometry
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
