## Verdict

**Refuse as written.** F9–F12 are established P1s. The revised plan fixes F1–F5 and F7–F8 well, but Stage 2’s acceptance contradicts its circuit breaker, A6 remains incomplete and rests on a false event-propagation claim, and Stage 4 still chooses arithmetic before collecting the evidence A5 requires.

### F9 — P1 — established: Stage 2’s completion criterion requires deleting its own circuit breaker

(a) Stage 2 correctly keeps `FeatureBoundary`’s raw aside, then declares completion when “one place writes a band” ([candidate](/home/greg/code/spideryarn2/.claude/worktrees/a5-mode-surface/docs/plans/260906f-the-active-mode-gets-one-surface-and-one-way-to-fit-the-screen.md:209), [completion](/home/greg/code/spideryarn2/.claude/worktrees/a5-mode-surface/docs/plans/260906f-the-active-mode-gets-one-surface-and-one-way-to-fit-the-screen.md:215)). The five preview copies are also explicit exceptions.

Taken literally, satisfying that criterion requires migrating the raw fallback and recreating F4: a `ModeSurface` failure escapes to `AppBoundary`. The round-one React harness established that consequence.

(b) Replace Stage 2’s completion sentence with:

> Done when: every healthy product mode band and `VisitorBand` is emitted by `ModeSurface`; `FeatureBoundary` remains the sole production raw `.mode-band` circuit breaker; the five preview copies remain documented exceptions; migrated variants match their baseline DOM and geometry; and changing the fallback to use `ModeSurface` makes the circuit-breaker test fail.

### F10 — P1 — established: A6 is still only a one-pair fix, and its source audit is factually wrong

(a) A6 requires auditing nested Lightbox/help/menu/tooltips and defining which surface consumes one Escape ([A6](/home/greg/code/spideryarn2/.claude/worktrees/a5-mode-surface/docs/plans/260905e-main-app-architecture-review.md:378), [acceptance](/home/greg/code/spideryarn2/.claude/worktrees/a5-mode-surface/docs/plans/260905e-main-app-architecture-review.md:648)). Stage 3 still tests and fixes only Annotate+Comment ([candidate](/home/greg/code/spideryarn2/.claude/worktrees/a5-mode-surface/docs/plans/260906f-the-active-mode-gets-one-surface-and-one-way-to-fit-the-screen.md:240)).

Its claim that Floating UI’s `useDismiss` “stops nothing” is false. The installed implementation defaults `bubbles.escapeKey` to false and calls `event.stopPropagation()` ([Floating UI](/home/greg/code/spideryarn2/.claude/worktrees/a5-mode-surface/node_modules/@floating-ui/react/dist/floating-ui.react.mjs:2591), [stop](/home/greg/code/spideryarn2/.claude/worktrees/a5-mode-surface/node_modules/@floating-ui/react/dist/floating-ui.react.mjs:2628)). That matters immediately because `CommentDialog` has both a window Escape listener and nested house tooltips ([dialog listener](/home/greg/code/spideryarn2/.claude/worktrees/a5-mode-surface/src/web/CommentDialog.tsx:162), [tooltip](/home/greg/code/spideryarn2/.claude/worktrees/a5-mode-surface/src/web/CommentDialog.tsx:577)). Manual document listeners such as `useHoverCard` and `BlockGutter` behave differently. Listener phase alone is therefore not the ownership map.

Two of the three proposed fixes also fail A6’s acceptance: registration-order claiming does not encode visual ownership, while “fix only the loss” still lets one Escape close two surfaces.

(b) Replace Stage 3’s audit and steps with:

> First inventory every reachable overlap among the Dock drawer, Comment/Chat/Annotate, native dialogs, BlockGutter and prose hover cards, menus/help, and Floating UI tooltips. For each pair record its render condition, visual or top-layer order, listener target and phase, whether propagation or the default action is stopped, and the intended Escape owner. Do not infer double-close merely from `document` preceding `window`: Floating UI’s default `useDismiss` stops Escape propagation.
>
> Add one-press interaction tests for every reachable interaction-family overlap, including a tooltip inside `CommentDialog` and each reachable native-dialog/modeless pair. Fix every failing overlap locally. Stage 3 is done only when one Escape closes the topmost intended surface once and preserves every underlying draft and open state.
>
> For the reachable Annotate+Comment pair, Comment is the later, visually topmost surface. While it is present, it alone owns Escape; Annotate remains mounted with its draft intact and becomes the owner after Comment closes. Express that through explicit local enablement, not listener registration order.

### F11 — P1 — established: `max()` is still chosen before the measurement that must choose it

(a) A5 says to reproduce on iOS before “choosing its arithmetic” ([authority](/home/greg/code/spideryarn2/.claude/worktrees/a5-mode-surface/docs/plans/260905e-main-app-architecture-review.md:332)). The revision nevertheless says the plan “commits to” `max()` and that the arithmetic “is decided” ([candidate](/home/greg/code/spideryarn2/.claude/worktrees/a5-mode-surface/docs/plans/260906f-the-active-mode-gets-one-surface-and-one-way-to-fit-the-screen.md:54), [Stage 4](/home/greg/code/spideryarn2/.claude/worktrees/a5-mode-surface/docs/plans/260906f-the-active-mode-gets-one-surface-and-one-way-to-fit-the-screen.md:251)). Making implementation conditional does not undo the prior design choice.

I found no algebraic counterexample to `max()` under the assumed geometry:

- A mode band forces the dock back to `--dock-space`, so the “hidden dock plus mode” state is currently unreachable ([styles](/home/greg/code/spideryarn2/.claude/worktrees/a5-mode-surface/src/web/styles.css:12708)).
- Dock, safe area and install hint form one contiguous bottom clearance.
- A non-keyboard `bottomInset` still represents the layout strip below the visual viewport, so its union with that clearance is still `max`.
- Pinch/pan creates a separate top-edge problem through `offsetTop`; it does not invalidate the bottom-edge union.

What remains unproved is whether iOS gives the fixed band and those measurements the assumed common coordinate system.

(b) Replace “The arithmetic this plan commits to…” with:

> The candidate arithmetic to test, not a committed decision:

Replace Stage 4’s opening with:

> The `max()` expression above is a reviewed hypothesis. Device evidence decides whether the band is layout-anchored and whether `bottomInset` represents the relevant bottom occlusion; until then no viewport-fit arithmetic is chosen.

Replace step 3 with:

> Choose the arithmetic from the recorded measurements. Use `max(base clearance, bottomInset)` only if they show both terms are bottom-anchored intervals in the same coordinate space; account for `offsetTop` as the evidence requires.

### F12 — P1 — established: the diagnostic cannot validate the arithmetic it is meant to authorize

(a) A5 requires measuring the visual viewport **and actual occluding bars**, plus notch, pinch and viewport pan ([vertical contract](/home/greg/code/spideryarn2/.claude/worktrees/a5-mode-surface/docs/plans/260905e-main-app-architecture-review.md:350), [acceptance](/home/greg/code/spideryarn2/.claude/worktrees/a5-mode-surface/docs/plans/260905e-main-app-architecture-review.md:646)). The diagnostic records the controls bar, band, header and composer, but not the bottom dock, install hint, safe-area/dock/hint values or pinch/pan states ([candidate](/home/greg/code/spideryarn2/.claude/worktrees/a5-mode-surface/docs/plans/260906f-the-active-mode-gets-one-surface-and-one-way-to-fit-the-screen.md:254)). The existing Chrome baseline explicitly says its safe-area and hint terms were zero, so it supplies none of that missing evidence.

A merely live display also cannot reliably retain the transient “opening” frames.

(b) Replace Stage 4 steps 1–2 with:

> 1. A production-geometry diagnostic using `ModeSurface`, not copied band markup. From focus until the keyboard settles, retain timestamped, copyable samples on every visual-viewport `resize` and `scroll`: `innerHeight`, visual-viewport width/height/offsets/scale, page scroll, computed `--safe-bottom`, `--dock-bottom` and `--hint-h`, and rectangles for controls, dock, install hint when present, band, header, body and composer.
> 2. Run it on the reporting iPhone in installed and ordinary-Safari states where available: portrait and landscape/notch; keyboard closed, opening and open; then pinch and pan. Record which dock/hint surfaces are actually visible in every sample. Put the exported trace in `-baseline.md`.

### F13 — P2 — reasoned: the diagnostic-only ending needs an explicit incomplete status

(a) The text calls an unbuilt fit an “honest end,” but does not state that Stage 4 and A5 remain incomplete. That leaves room to mark the job complete after shipping only the diagnostic.

(b) Add:

> Stage 4 is complete only when the device trace, chosen implementation, automated checks and real-phone acceptance all land. If the trace does not arrive, the diagnostic may be committed, but Stage 4 and A5 are recorded as blocked/incomplete; the viewport fit is not reported as delivered.

### F14 — P2 — reasoned: the optional body marker is redundant truth with no enforcement

(a) The plan rejects a structural scrolling invariant, then permits a `none`/`body` marker whose jsdom test verifies only its own declaration ([candidate](/home/greg/code/spideryarn2/.claude/worktrees/a5-mode-surface/docs/plans/260906f-the-active-mode-gets-one-surface-and-one-way-to-fit-the-screen.md:147)). Nothing connects it to CSS or reachability, and neither the interface nor stages actually need it.

(b) Replace that paragraph with:

> `ModeSurface` owns no body/scroller marker in v1. The browser pass uses an explicit per-mode table of existing feature selectors and checks outcomes: non-zero body height, footer/composer inside the band, and every overflowing region reachable.

## Answers to the specific suspicions

- **Stage 4 is not inherently scope-dodging.** A blocked, explicitly incomplete handoff is the correct response to A5. Calling the arithmetic decided or the stage complete is not.
- **`foot` is expressive enough.** React fragments add no DOM node, and a conditional `ReactNode` works. Preserve each full guard exactly—especially Glossary’s enclosing ready condition plus `owner?.glossary`.
- **The circuit-breaker test is valid fault injection.** Mock the real `ModeSurface` module to throw, count that the mock ran, and mount the production boundary composition under `AppBoundary`. That tests the dependency seam, not an unrelated stand-in.
- **Drop the marker in v1.**
- **Stage 3’s ordering is sensible:** stages 1–2 remain deployable, A6 can proceed while the phone blocks Stage 4. Because stages 2 and 3 both touch actively owned `App.tsx`, they should follow A1’s landing and occur consecutively; moving A6 behind the phone gate would only block unrelated assigned work.
- **The A6 outcome must be chosen now.** Preserve the annotation draft and give the visually topmost Comment explicit Escape ownership; do not use mount order.

One repository discrepancy: `git status --short` shows the baseline and round-one review as untracked, despite the supplied “untracked: none.” Both are linked from the plan and should land with it.

No files were changed and no test was run; the refusal is established from the governing contract and the local source/dependency implementations.