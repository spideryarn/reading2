# Touch scrolling on an iPad: should it step?

> We're going to want to read on an iPad a lot.
>
> Can we play with the way touch-scrolling works so that it jumps step-by-step if I scroll within a
> column, kinda like the up/down buttons?
>
> — Greg, 2026-08-26

The working behind that question: what the web says about discrete scrolling on iOS, what a
cross-family reviewer said about doing it *here*, what a browser actually did when we tried it, and
where the sources disagree. The decision this fed, and what got built, is in [touch.md](../project/touch.md) — this file is the
part you don't have to research again.

**Status: decided and built**, 2026-08-26. Nothing here is verified on a device; the hand-test list
lives in [touch.md](../project/touch.md#what-only-a-real-ipad-can-tell-us).

## The shape of the problem

The reading view is a table ([granularity-zoom.md § the tabular view](../project/granularity-zoom.md#the-tabular-view)).
Down is chronology, across is granularity. On a desktop, ↑ / ↓ already step one item at a time and
the *stride* is whichever column the pointer is over ([keyboard.md](../project/keyboard.md)). Greg's
question is whether a finger can say the same thing a pointer does.

Four facts about this codebase constrain every answer below:

- **The document is the vertical scroller.** There is no inner vertical container — `scroll.ts`
  drives `window.scrollTo`, and the sticky bars are pinned against the page.
- **The page scrolls horizontally too**, whenever the table outruns the window
  ([layout.ts](../../src/web/layout.ts)).
- **The DOM already holds one snap-target candidate per item per level.** A gist `<td>` carries
  `data-nav-depth` and a `rowSpan` covering exactly the item it summarises, so "the cells of level
  *d*" is already "the items of level *d*" with nothing to compute. `navPlan.starts` in
  [keynav.ts](../../src/web/keynav.ts) is the same fact as row indices.
- **Jumps are animated by us, not by the browser.** `glide()` in [scroll.ts](../../src/web/scroll.ts)
  runs a 200 ms rAF loop calling `window.scrollTo({behavior: "auto"})` once per frame, because
  Chrome's own smooth scroll takes longer the further you go. It already bails on `touchstart`.

Items vary in height by orders of magnitude. An L1 "part" cell can be many screens tall; a leaf row
is one paragraph. **That single fact decides most of what follows.**

## What the web says: iOS and WebKit

### The finding that reframes the request

**On iOS Safari, turning on scroll snap already disables native momentum.** Instead of a fling that
decelerates across many items, a swipe moves to the next snap point. That is
[WebKit bug 243582](https://bugs.webkit.org/show_bug.cgi?id=243582) — filed August 2022, still open,
and re-raised on the [CSSWG list in August 2025](https://lists.w3.org/Archives/Public/public-css-archive/2025Aug/0817.html),
so it is current rather than folklore. Everywhere else it is a defect that authors complain about.
Here it is the feature being asked for.

The practical consequence: **we probably do not have to write a gesture handler at all.** The
platform bug does the stepping, and our job is to place the snap points.

The tension in the same finding, and it is not resolved by any source: behaviour depends on flick
speed. Moderate flicks give one snap per gesture; *very fast* flicks have been reported to blow
straight past everything to the end of the container
([react-window #290](https://github.com/bvaughn/react-window/issues/290)). `scroll-snap-stop: always`
is the intended cure — and genuinely is one, see below — but no source confirms WebKit honours it
against that overshoot. **Test with deliberately violent swipes, not polite ones.**

### The traps

- **Never put snap on `document.body`.** It breaks scrolling outright — `body.scrollTop`,
  `window.scroll` and anchor links all stop working
  ([Apple dev forums](https://developer.apple.com/forums/thread/24954)). Old, and still cited as
  current. The document scroller is `html`, and that is where the property goes.
- **WebKit caches snap positions at layout time.** Changing snap targets from JS afterwards is
  reported to cause overshoot, jumpy scrolling, snapping that fails to lock, and snapping that only
  takes effect on the *second* gesture. This matters here more than in most apps, because the whole
  design is *moving the snap points when the aimed level changes*. The mitigation reported is to
  batch every style change into one synchronous write rather than updating incrementally. Blog-level
  sourcing, but consistent with WebKit's known internals.
- **Safari is not passive-by-default for `touchmove`.** The Chrome and Firefox rule that
  `touchstart` / `touchmove` on `document` and `window` default to `{passive: true}` is
  [not Safari's](https://github.com/mdn/browser-compat-data/issues/13561) — Safari still needs an
  explicit `{passive: false}` before `preventDefault()` does anything. Only matters if we hijack the
  gesture, and is one more argument not to.
- **rAF is unreliable while a finger is down.** iOS defers queued `requestAnimationFrame` callbacks
  during active touch, firing them once all touches end. A rAF-driven scroll animation the user is
  still touching can stall — a direct hazard for `glide()`.
- **Once native momentum has started, JS cannot cancel it.** Interception has to happen during
  `touchmove`, before the finger lifts. `glide()`'s existing `touchstart` bail is therefore doing the
  only thing that *can* be done, and doing it at the right moment.
- **`-webkit-overflow-scrolling: touch` is dead weight.** Per Safari 13's release notes iOS applies
  momentum natively everywhere; tutorials that still include it are cargo-culting. Sources disagree
  here, and Apple's own statement wins.
- **Set `overflow-x` / `overflow-y` explicitly on a snap container** — an implicit value is reported
  to make the browser silently ignore snapping on that axis. A silent-success failure of exactly the
  kind [we keep meeting](../reusable/silent-success.md).

One piece of good news: the old WebKit jitter bug for layout-during-scroll
([173887](https://bugs.webkit.org/show_bug.cgi?id=173887), 2017) was fixed and shipped in October
2021. It is worth knowing only because it shows this part of WebKit has a history of being fragile
around layout changes mid-scroll, which is what the caching warning above is also about.

## What the web says: whether we should at all

This is where the research argues with itself, and the disagreement is the useful part.

### The case against, and it is aimed straight at us

NN/g's [Scrolljacking 101](https://www.nngroup.com/articles/scrolljacking-101/) (2023, moderated
study) is the canonical source, and one of its findings describes this feature almost exactly:

> pages that altered the rate and duration of scrolling while *also* requiring the user to read text
> exhibited the most severe usability issues

The majority of participants were at least mildly disoriented; some read it as a bug and tried to
reload or leave. Task-oriented users tolerated it far worse than browsing users.

The exceptions NN/g found are instructive rather than reassuring. Scrolljacks that were *liked* —
BBC News, the Apple Watch Ultra walkthrough — were **brief, guided sequences that progressively
disclosed new information**, not sustained reading. A reader can spend an hour in one column here,
which is not the shape the positive precedent has.

### The precedent is unanimous and says "make it a setting"

Neither of the two dominant iPad readers ships anything between the extremes. **Apple Books** and
**Kindle** both offer an explicit, discoverable, reversible toggle between continuous scroll and
page-turn, per book. Neither ships a hybrid where the scroll gesture jumps by an internal unit
without looking like pages. Read-later apps — Instapaper, Pocket, Readwise Reader, Medium, Substack —
appear to do nothing special at all, though that is absence of evidence rather than a documented
decision.

Worth noting that both first-party implementations are *reported buggy by real users* (settings not
persisting on some iPad Pro models). If Apple and Amazon find this fiddly, we should expect to.

### The comprehension evidence does not settle it

- **Older desktop research** found paging read faster with roughly equal comprehension, and a
  reasonably replicated **spatial-memory** effect: fixed page positions give incidental cues that
  help readers remember and re-find passages, which scrolling erodes.
- **The newest and most relevant study** — Joshi et al., [CHI EA 2025](https://dl.acm.org/doi/full/10.1145/3706599.3720178),
  on phones — found **no significant difference** in comprehension, duration or workload. The
  argued reason is that touch scrolling is direct manipulation in a way mouse-wheel scrolling was
  not, so the older paradigm's results may not transfer.

These are in genuine tension. The older effect is better replicated but on a different interaction
paradigm; the newer one is more relevant but is a single study. **Treat "does stepping help on a
touch device" as an open empirical question, not settled science.** One nuance worth keeping: at
least one study found the effect is moderated by individual preference, which is an argument for an
option rather than a default.

### The knob the two reports disagree about — and the spec settling it

**`mandatory` versus `proximity`** looked like the decisive choice, and the two web reports came
down on opposite sides:

- **`mandatory`**, because `proximity` is "more prone to WebKit inconsistencies". Blog-level, no
  primary source.
- **`proximity`**, because a `mandatory` snap always resolves to the top of one target or the next,
  so **the middle of a target taller than the viewport is unreachable**.

The second argument is the one that sounds decisive, and **it is wrong for this geometry**. Checked
against the spec rather than taken on trust, [CSS Scroll Snap, § Oversized Snap Areas](https://www.w3.org/TR/css-scroll-snap-1/):

> If the snap area is larger than the snapport in a particular axis, then any scroll position in
> which the snap area covers the snapport … is a valid snap position in that axis.

Every position inside an oversized area is a *valid* snap position, so the reader scrolls through it
freely and nothing pulls them out. Our snap target would be the `<td rowSpan>`, which **is** the
whole tall item — so the tall-item objection does not apply to us. It would apply if we snapped to a
small marker at each item's start, which is the design to avoid.

So this knob is not the crux, and neither report's reasoning survives intact. Two other spec facts,
checked the same way, matter far more.

**`scroll-snap-stop: always` — and this doc got it wrong twice before getting it right.** The first
draft treated it as a guaranteed one-item-per-fling API, which the first web report had implied. The
second draft corrected that to "not a per-gesture API at all", quoting the exception:

> This property has no effect on scrolling operations with only an intended end position, as they do
> not conceptually "pass over" any snap positions.

**That correction was itself wrong**, and the cross-family review caught it. The exception is about
scrolls that have *only* an endpoint. The spec classifies a fling the other way, explicitly:

> Common examples of relative scrolls with both an intended direction and end position include: a
> "fling" gesture, interpreted with momentum; a panning gesture, released with or without momentum…

A fling is a relative scroll, so it does "pass over" snap positions, so `always` **does** apply to
it — it is exactly the intended cure for fast-flick overshoot. What remains unknown is whether
WebKit implements it reliably, which is a different and much weaker claim than the one this doc made.

Recorded at length because it is the third wrong argument in this file, and because the pattern is
worth seeing: each wrong version was a plausible reading of a real quotation, and each survived until
somebody checked the surrounding definition rather than the sentence. **None of it changes the
decision** — snapping was rejected on the programmatic-scroll conflict and the mandatory re-snap,
which are unaffected.

**Snapping applies to programmatic scrolling**, explicitly including `scrollTo()`. That is the one
that hurts, and it is dealt with next.

### The conflict with our own scroll animation

`glide()` calls `window.scrollTo({behavior: "auto"})` **once per animation frame**. Since the spec
subjects programmatic scrolls to snapping, every one of those frames is a scroll operation the
browser may snap. Under `mandatory` each frame is a fresh endpoint to be resolved; under `proximity`
the final frames can still be adjusted. Jitter, stalling, and arriving somewhere we did not choose
are all permitted by the spec — it gives `glide()` no useful guarantee either way.

The obvious dodge — turn snapping off for the duration of a glide — carries its own trap, and it is
worth writing down because it is not obvious: `glide()` cancels itself when a finger lands, so
restoring snapping immediately afterwards would snap the document from the halfway position the
reader interrupted it at. The reader grabs the page and it jumps.

**This is the strongest single argument against document snapping here**, and it comes from the
piece of this codebase least likely to change: the flat-duration jump exists because
[Greg asked for it](../project/keyboard.md#a-note-on-the-jump-itself).

### Accessibility, which is not automatic

- **`prefers-reduced-motion` does not disable scroll snap.** Browsers do not do this for you; the
  override has to be written. Several sources phrase this loosely enough to imply otherwise — they
  are wrong, and this doc should not repeat it. Involuntary snap-jumps are a documented vestibular
  trigger.
- **`mandatory` snap can trap keyboard scrolling** inside a region when the content between snap
  points is not fully visible ([Adrian Roselli](http://adrianroselli.com/2022/06/keyboard-only-scrolling-areas.html)).
  Another count against `mandatory`, and it lands on a codebase that has just spent two rounds
  getting the arrow keys right.
- **Pinch-zoom, text scaling, native gesture fallback and keyboard scrollability must all survive.**
  Pure CSS snap keeps these by construction; a JS gesture handler that intercepts touch is where
  they break. Apple's own WWDC guidance for reading apps is that paginated content must still be
  traversable as one continuous sequence for assistive technology — the page boundary should be
  invisible to VoiceOver.

## Where this leaves the mechanism

Four candidates were considered.

1. **CSS scroll snap on the document scroller**, with `scroll-snap-align` applied only to the cells
   of the currently-aimed level. Rides the platform rather than fighting it, keeps every native
   affordance, and is a few lines. Its risks are WebKit's snap-position caching and the untested
   fast-flick overshoot.
2. **JS snap after the fact** — let momentum run, then glide to the nearest boundary once scrolling
   settles. Fully controllable and portable, but "settle, then jerk" is the classic bad feel, and it
   re-enters exactly the rAF path that iOS defers during touch.
3. **Full gesture hijack** — `preventDefault` on `touchmove`, one swipe equals one step. This is the
   most literal reading of "kinda like the up/down buttons" and the one NN/g's finding is aimed at.
   It also gives up momentum, fine positioning, and the accessibility guarantees above.
4. **Snap in the gist columns only, and leave the prose free.** Greg's own phrasing — *"if I scroll
   within a column"* — already contains this. The gist columns are navigation, where discrete
   movement is what a card carousel does and nobody objects. The prose column is reading, which is
   the exact case NN/g says not to touch.

## What the cross-family reviewer said

GPT Sol was given the codebase and the same question, with no sight of the web research
([codex-cli-as-subagent.md](../reusable/codex-cli-as-subagent.md)). It ranked the four options
**(4), (2), (1), (3)** — and argued flatly against document snapping, which is where the web research
had pointed.

Three of its objections were checked against the spec rather than taken on trust, and all three
held. They are the ones written into the sections above: oversized snap areas are freely scrollable,
`scroll-snap-stop: always` is not a per-gesture guarantee, and programmatic scrolls are snapped.
Getting the first one right is what corrected this doc's own draft.

It also caught the structural fact the web research could not have known:

**In reading mode the gist columns are covered by a fixed, `overflow: hidden` panel** —
`.ctx-panel`, [column-context.md](../project/column-context.md). So a finger in a gist column is not
touching the `<td>` at all; it is touching a panel that does not scroll, and the page moves by scroll
chaining. Document snapping would therefore be snapping to the boundaries of boxes the reader cannot
see, hidden behind the panel that replaced them. In outline mode there is no panel and the cells are
touched directly, so the two modes would not behave the same.

Its recommendation is a **scoped one-step swipe**: Pointer Events on the gist surfaces only, with
`touch-action: pan-x pinch-zoom` so vertical motion is ours while horizontal panning and pinch-zoom
stay the browser's; the step fires on `pointerup` and goes through the existing `stepTarget` and
`scrollToBlock`. Declarative `touch-action` rather than a non-passive `touchmove` listener, which is
what sidesteps Safari's passive-listener divergence entirely. Its stated red line:

> If stepping must also apply when a swipe begins in prose, I would recommend not building the
> feature.

Two implementation details from it worth keeping whichever way this goes: **suppress the synthetic
click after a consumed swipe**, or the swipe also fires the panel's `onJump`; and **give touch its
own target chain**, for the same reason the keyboard has one — rapid gestures otherwise measure from
a half-finished glide ([keyboard.md § rapid presses](../project/keyboard.md#rapid-presses-chain-from-the-last-target-not-from-the-page)).

## What a browser actually did

A probe ran the candidate CSS against the real app in Chrome. **Most of it has to be thrown away**,
and the reason is one already written down in
[browser-testing.md](../project/browser-testing.md): the automation tab is hidden, `rAF` measured
**zero frames in 500 ms**, and Chrome's snap-pull appears tied to that same paused rendering step. So
every "the document did not snap" result is equally consistent with "snap does not work on these
targets" and "the compositor was asleep". They are not evidence. This is the third time this
environment has produced a confident-looking negative that meant nothing — see
[silent-success.md](../reusable/silent-success.md).

**One result survives, because it does not depend on the compositor and it had a control.**

With `scroll-snap-align` on the depth-2 cells and the page settled at scrollY 15676.82, rewriting the
stylesheet in one synchronous assignment — moving `scroll-snap-align` from depth 2 to depth 3 — left
`window.scrollY` already at **15860.91 on the very next synchronous line**. A 184.09 px jump, with no
gesture and no elapsed frame, landing exactly on a real depth-3 cell's snap position. Reproduced
twice with an identical delta. The control — rewriting the same stylesheet with an unrelated harmless
change, keeping the snap rule where it was — moved nothing.

So **changing which elements carry `scroll-snap-align` jumps the page immediately**, not gently, and
synchronously on style recalc. That is not a re-snap the reader would read as settling; it is the
article moving under them.

Two honest limits on that number, since the rest of the same session was thrown away: it is **Chrome,
in the hidden automation tab**, and the claim that it landed on a particular cell's snap position is
arithmetic on the delta rather than something separately observed. What makes it usable anyway is
that it does not depend on the compositor — the jump had already happened by the next synchronous
line — and that the control isolates the cause. The spec reading below is what turns it from one
measurement into a reason.

This is aimed at the heart of mechanism (1), whose entire design is to swap which level's cells carry
`scroll-snap-align` when the aimed level changes.

**And it is not a bug we could wait out.** Checked against the spec afterwards, on the arbitrator's
prompting, [CSS Scroll Snap, § Re-snapping After Layout Changes](https://www.w3.org/TR/css-scroll-snap-1/) *requires* a container
to re-snap when its snap positions change, and says of the resulting movement:

> Scrolling required by a re-snap operation to a new or different box must behave and animate the
> same way as any other scroll-into-view operation, including honoring controls such as
> `scroll-behavior`.

`scroll-behavior` defaults to `auto`, which is instant. So Blink jumping 184px with no animation is
**conforming behaviour**, not a defect — which puts it in a different class from the momentum bug
this mechanism was going to ride. That one might be repaired out from under us; this one is the
design's own semantics and will not be.

Two consequences worth stating, because both are worse than they first look. The obvious patch —
record `scrollY` before the swap and restore it after — is itself a programmatic scroll, and
programmatic scrolls are snapped, so it is another turn of the same fight. And the damage is not
confined to touch: on a desktop the aim follows the *pointer*, so a snap rule keyed to the aimed
level would lurch the page every time the mouse crossed a column boundary. Scoping the CSS to touch
devices avoids that and leaves the jump firing whenever a finger lands in a different column from
last time — which is the ordinary way this feature is used.

One correction to the probe, since it overstated a finding: it reported that no `td[data-nav-depth="1"]`
exists in the DOM at all and concluded Parts is only ever the spine rail. Its window was 900 px wide
and column auto-fit had simply dropped the Parts column ([layout.ts](../../src/web/layout.ts)); at
wider widths it renders. Horizontal overflow could not be tested for the same reason — the table was
narrower than the window, so there was nothing to pan.

## The decision

**Mechanism (4): a scoped one-step swipe on the gist surfaces, prose untouched, reading mode only.**
Built in [`swipe.ts`](../../src/web/swipe.ts); what it does and why is
[touch.md](../project/touch.md).

The web research and the cross-family reviewer disagreed — snap versus gesture — so it went to a
third model as arbitrator with both cases, the verified spec facts and the browser measurement. It
picked the gesture, and the argument that decided it was not on either original list:

> A tries to coax a continuous physics system into emitting discrete steps, and its load-bearing
> mechanism is an acknowledged WebKit *bug* … If Apple fixes it, A's stepping silently reverts to
> momentum flinging.

That is this codebase's [own recurring failure](../reusable/silent-success.md) written into a
dependency on purpose. The second argument is the one that makes the choice cheap rather than merely
safe: snapping's advertised virtue was "no gesture handler to get wrong", and **it does not have
that virtue** — snap is per-scroller, the page is the scroller, so it must still detect which column
the finger landed in and rewrite the snap CSS on touch-down. That is a gesture handler, driving the
one operation both engines are unhappy about, before every single swipe.

Set against that, the gesture's costs are ordinary engineering: a click to swallow, a target chain
to keep, a `touch-action` keyword to verify. All of them fail loudly.

### What the arbitration changed

**Reading mode only**, which neither investigation caught. In outline mode `showText` is false and
there is no prose column at all — every surface on screen is a gist column, so the design as written
would have left the page with nothing that scrolls continuously. The gate has to be in the CSS as
well as the hook, because `touch-action` takes native scrolling away whether or not any JavaScript is
listening.

**No setting**, despite every shipped precedent being one. The Books/Kindle toggle governs how the
*prose* paginates, and this never touches the prose — so the precedent does not transfer, and the
toggle here is spatial and already exists: move your hand one column.

### The third option, now the only alternative

Neither investigation's list had it: **settle after the scroll**. Keep native scrolling everywhere
and, once it ends (`scrollend`, or debounced), glide to the nearest boundary of the aimed level. Free
momentum, no snap CSS, no gesture capture. Not chosen because it answers a different question — it
gives "wherever you land, aligned", not one gesture one step — but it is the fallback if the
release-only gesture feels dead under the finger, and it is written down here so the first device
test can judge three options rather than two. Note `scrollend` reached Safari only in 26.2, so it
would need a debounced fallback.

### What should change our mind

Named in advance, so the first iPad session measures rather than reminisces:

- **Dead under the finger.** Nothing moves until release. If the first swipes are followed by a
  pause and a harder second swipe, the gesture needs to track the finger. Note that the answer is
  **not** to fall back to snapping — the re-snap jump above is a worse fault than the one we would be
  fleeing. The escalation is to keep the gesture and add live feedback: translate the panel's list
  under the finger and commit the step on release. Only if that fails does
  [settle-after-scroll](#the-third-option-now-the-only-alternative) come up.
- **`touch-action: pan-x pinch-zoom` not parsing.** If the fix needs a non-passive `touchmove`
  fighting native momentum, the cost profile flips and "don't build it" comes back on the table.
- **Hunger for fine adjustment.** If the reader keeps trying to nudge by less than an item from a
  gist column, the lost continuous scroll matters more than the argument above allows — restrict
  stepping to the coarse columns, or move to the settle-after-scroll option.

The full hand-test checklist is in [touch.md](../project/touch.md#what-only-a-real-ipad-can-tell-us).


## Sources

Web research was run by two subagents on 2026-08-26; the reports are summarised rather than
reproduced. Recency and authority are noted inline above, and deliberately: several of the claims
that matter most are developer-reported rather than Apple-documented, and one of the two
`mandatory`-versus-`proximity` arguments is a blog post.

- [WebKit 243582](https://bugs.webkit.org/show_bug.cgi?id=243582) — snap disables momentum on iOS.
  Open. The single most important source here.
- [CSSWG list, Aug 2025](https://lists.w3.org/Archives/Public/public-css-archive/2025Aug/0817.html) —
  the same issue, current.
- [NN/g, Scrolljacking 101](https://www.nngroup.com/articles/scrolljacking-101/) — the usability
  case against, and the exceptions.
- [Joshi et al., CHI EA 2025](https://dl.acm.org/doi/full/10.1145/3706599.3720178) — pagination vs
  scrolling on phones; no significant difference.
- [MDN, scroll snap basic concepts](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Scroll_snap/Basic_concepts)
  and [`scroll-snap-stop`](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/scroll-snap-stop).
- [Adrian Roselli, keyboard-only scrolling areas](http://adrianroselli.com/2022/06/keyboard-only-scrolling-areas.html).
- [MDN compat-data #13561](https://github.com/mdn/browser-compat-data/issues/13561) — Safari's
  passive-listener default.
- [Apple dev forums](https://developer.apple.com/forums/thread/24954) — snap on `body`.

## See also

- [keyboard.md](../project/keyboard.md) — the pointer-aimed stride this would extend to a finger
- [granularity-zoom.md](../project/granularity-zoom.md#the-tabular-view) — the view being scrolled
- [browser-testing.md](../project/browser-testing.md) — driving the view by hand, and how it lies
- [silent-success.md](../reusable/silent-success.md) — several failures above are that pattern
