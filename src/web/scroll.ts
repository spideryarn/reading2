/**
 * Scrolling to a block, in one place.
 *
 * Four things now want to do this — the deep link in the URL, a click on a
 * gist, a click on a spine segment, and an ↑/↓ keypress (keynav.ts) — and
 * they must agree, because they are all claiming to put the *same* block under
 * the reader's eye. They used to disagree: the hash landed the row's top below
 * the sticky bars, while a gist click used `scrollIntoView({ block: "center" })`,
 * which centres a row that may be a single line or may be a 900-word paragraph.
 *
 * Everything addresses the block by its stable id — never by offset or selector
 * path. See docs/project/block-ids.md.
 */
import { isFolded, revealBlock } from "./fold.js";
import { blockRow, passageMarks } from "./rows.js";
import { safeAreaInsets } from "./safe-area.js";

/**
 * **Our controls bar, and never an article's.**
 *
 * `document.querySelector(".controls")` is not a safe question and stopped
 * being a harmless one on 2026-09-08. An author's prose may contain
 * `<p class="controls">`: `src/sanitize-policy.ts` strips six class names it
 * reserves and `controls` is not among them, and running the sanitiser over
 * `<div id="root"><div class="reader"><p class="controls">` returns it
 * **byte-for-byte** — checked that way rather than by reading the allowlist,
 * which is how the `thead` decoy in tests/mobile-chrome.test.ts was checked
 * too.
 *
 * That was latent while the bar was always drawn, because ours is earlier in
 * document order and a bare `querySelector` therefore always found it. It stops
 * being latent the moment the bar is *conditional* (layout.ts
 * § `barHasContent`): with ours absent, an unscoped query returns the
 * publisher's paragraph, and `stickyOffset` measures a piece of prose as the
 * chrome every deep link, `?at=` reading and arrow-key step has to clear.
 * Nothing errors and the number is plausible — docs/reusable/silent-success.md.
 *
 * **Two steps, not `document.querySelector(".reader > .controls")`**, and the
 * difference is the whole of the scoping. That one selector matches a forged
 * `<div class="reader"><p class="controls">` inside the prose as readily as the
 * real pair. This takes the **first** `.reader` in document order — which is
 * ours, because ours is the outermost element on the page and any forgery is
 * necessarily inside it — and then asks only for its own direct children. The
 * article's markup is never a direct child of `.reader`; it is inside a `<td>`.
 *
 * The durable fix is for `controls` to join the reserved-class list in
 * `src/sanitize-policy.ts`, which is a **defence** — so this session did not
 * touch it. It is written up in
 * docs/plans/260908a-the-top-bar-stops-being-drawn-when-it-has-nothing-in-it.md
 * § What this leaves for Greg.
 */
export function controlsBar(): HTMLElement | null {
  const reader = document.querySelector(".reader");
  return reader?.querySelector<HTMLElement>(":scope > .controls") ?? null;
}

/**
 * **`data-bar-stuck`: the controls bar has reached the top of the window.**
 *
 * The bar is sticky and sits in flow under the masthead, so at the top of an
 * article it is level with a mode band, which is `position: fixed` from
 * `--bar-bottom` at every scroll position. Only once the masthead has gone is
 * the bar above the band, and only then may it take the strip over it:
 * crumbs.css § above the band is the one rule that reads this.
 *
 * `sentinel` is a zero-height element directly before the bar
 * (BarStuckSentinel.tsx). Its top distinguishes leaving above from sitting
 * below the viewport. An observer rather than a rect read in
 * `watchBarVisibility`, whose callback is deliberately free of DOM reads; and
 * an attribute rather than React state, for `data-bars`'s reason.
 *
 * **Late is safe and early is not.** The root margin is `0px`, not
 * `--safe-top`, so in the installed app the attribute arrives a few pixels
 * after the bar sticks and leaves a few before it lets go. Both leave a stuck
 * bar narrower than it could be. The other direction would put the bar's left
 * end behind the band.
 *
 * `stopped` because `disconnect()` does not drop entries already queued: a
 * callback delivered after teardown would put the attribute back with nothing
 * left to clear it. Without `IntersectionObserver` this does nothing and the
 * bar stays where it always was.
 *
 * Returns its own teardown.
 * docs/plans/261004a-headings-rail-uses-the-width-above-the-mode-band.md
 */
export function watchBarStuck(sentinel: Element): () => void {
  if (typeof IntersectionObserver === "undefined") return () => {};
  let stopped = false;
  const observer = new IntersectionObserver((entries) => {
    if (stopped) return;
    const last = entries.at(-1);
    if (!last) return;
    if (!last.isIntersecting && last.boundingClientRect.top < 0) {
      document.documentElement.dataset.barStuck = "";
    } else {
      delete document.documentElement.dataset.barStuck;
    }
  });
  observer.observe(sentinel);
  return () => {
    stopped = true;
    observer.disconnect();
    delete document.documentElement.dataset.barStuck;
  };
}

/**
 * Height of the fixed bar along the bottom — Dock.tsx.
 *
 * The counterpart to `stickyOffset`, and it exists for the same reason: a line
 * underneath it is not on screen in any sense the reader cares about. A
 * top-aligned jump needs no bottom clearance, but a centred jump does: the
 * centre of the visible area is above the centre of the whole viewport by half
 * the dock's height.
 *
 * Measured rather than read off `--dock-h`, for the reason the header offset is
 * (see above): a number agreed between two files drifts, and drifts quietly.
 */
export function dockOffset(): number {
  const dock = document.querySelector<HTMLElement>(".dock");
  if (!dock) return 0;
  /**
   * **How much of the bottom of the viewport the bar is covering** — not how
   * tall it is. The distinction is exactly `stickyOffset`'s, and it arrived
   * here for exactly the same reason: since 2026-08-28 the bar slides out of
   * the way on a small device scrolled down through (narrow-window.css § a small
   * device), by `transform`, which moves where it is drawn and **does not
   * change what it measures**. Reading `.height` went on reporting a confident
   * 52 for a bar that was entirely off screen, so a centred jump would have
   * landed 26px too high. The distinction was first raised by GPT Sol for the
   * now-retired swipe screenful step.
   *
   * `innerHeight - rect.top` is the whole of it, and it needs no clamp at the
   * far end the way `stickyOffset` does: this bar is `position: fixed` and is
   * therefore always exactly where it looks, with no "not stuck yet" state to
   * predict around. `Math.max(0, …)` is only for the hidden case, where `top`
   * has gone past the bottom of the window.
   */
  return Math.max(0, window.innerHeight - dock.getBoundingClientRect().top);
}

/**
 * Height of the chrome a row arriving at the top has to clear: `.controls`, and
 * the status bar behind it. **Measured, not declared.**
 *
 * This used to be the literal `84`, with a comment asking whoever changed
 * `--bar-h` or the table head's height in styles.css to remember to change it
 * here too. Three separate things now depend on it — deep links, the `?at=`
 * tracker, and the arrow keys — and the failure when it drifts is the quiet kind
 * this codebase keeps meeting (docs/reusable/silent-success.md): nothing errors,
 * every jump simply lands a few pixels under the bar it was supposed to clear,
 * and the check you would run to confirm the scroll worked says it worked.
 *
 * Measuring the bar itself cannot drift, and it covers a bar that wraps to two
 * lines, browser zoom, and a user's larger default font size. Note it is no
 * longer *only* a height — see the note inside on the bar that moves, and on
 * why the clamp's ceiling is a prediction rather than a measurement.
 *
 * **The table head left this answer on 2026-09-05.** It used to be a second
 * term, `document.querySelector("thead th")`, and two things went wrong with
 * that at once:
 *
 *  - **It measures nothing now.** The head keeps its element — the fisheye
 *    panels take every column's rectangle from it (useColumnContext.ts) and a
 *    `<th scope="col">` is what names a column for a screen reader — and gives
 *    up its height (table.css § the head with no row). A term that is always zero
 *    is not a term.
 *  - **The query had no scope on it.** An article's own prose can contain a
 *    `<table><thead><th>`, and it survives sanitising — checked by running
 *    src/sanitize.ts over one rather than by reading the allowlist. Ours was
 *    always earlier in document order, so this was latent rather than live in
 *    both directions; but "the right element by luck of ordering" is not a
 *    contract, and now there is no query to get wrong.
 *    `tests/mobile-chrome.test.ts` poses such a head as a decoy.
 *
 * One rect per call. Everything asking already reads layout in the same batch.
 */
export function stickyOffset(): number {
  const safeTop = safeAreaInsets().top;
  const bar = controlsBar();
  /* **`safeTop`, not `0`, when there is no bar.** There is a fixed opaque
     `.reader::before` of exactly the inset's height painting the strip under
     the clock (styles.css `.reader::before`), so a destination has to clear it
     whether or not a bar is drawn on top. Returning `0` here would land every
     jump under the status bar on the one kind of device that has one — and
     stage 4 of docs/plans/260905d-declutter-the-reading-view-top-bars.md takes
     the bar away in most modes, which turns this from a boot-time transient
     into the resting state. GPT Sol, reviewing the plan, 2026-09-05. */
  if (!bar) return safeTop;
  const rect = bar.getBoundingClientRect();
  /**
   * **How much of the bar a row arriving at the top will have to clear** — not
   * how tall the bar is.
   *
   * The height was right for as long as the bar could only ever be stuck at
   * `top: 0`. On a small device it now slides out of the way while you read
   * forwards (narrow-window.css § a small device) — by `transform`, which moves where
   * it is drawn and **does not change what it measures**. (`getBoundingClientRect`
   * does include the transform, which is why reading `bottom` below works and
   * reading `height` would not.) So the old expression
   * went on reporting a confident 44 for a bar that was entirely off screen, and
   * every deep link, every `?at=` reading and every arrow-key step would have
   * landed 44px too low — a wrong number from a function doing exactly what it
   * said. The class of bug this file's own header is about.
   *
   * **The clamp's upper end is a prediction, and it is deliberately not a
   * measurement.** At the very top of the article the bar has not stuck yet: it
   * is sitting below the masthead, its `bottom` is several hundred pixels down
   * the page, and it is covering nothing at all. This still returns its full
   * height there, because every caller is asking about a *destination* — where
   * a row will end up — and by the time anything arrives at the top of the
   * viewport the bar will be stuck across it. Answering "0, it covers nothing
   * right now" would be the more literal reading of the rect and would send
   * every jump from the top of the article a bar's height too high.
   *
   * An earlier version of this comment claimed the number was current coverage.
   * It is not, and GPT Sol was right to say so — the value was already what the
   * callers want, and only the sentence describing it was wrong.
   *
   * **`+ safeAreaInsets().top`, since 2026-08-28.** The bar no longer rests at
   * `top: 0`: in the installed app it rests below the status bar, so its bottom
   * edge is a status bar's height lower than the bar is tall, and a ceiling of
   * `rect.height` clamped the true answer away. Every deep link and every
   * arrow-key step would have landed ~47px underneath the chrome — on the one
   * device this whole feature is for, and nowhere else, so nothing we can run
   * here would have shown it. GPT Sol, reviewing the plan, 2026-08-28.
   *
   * It is added to the *ceiling* rather than to the result, which is what keeps
   * the stuck case honest: `rect.bottom` already includes the inset when the
   * bar is stuck, so the `min` still picks the measurement over the prediction
   * and the inset is only ever consulted at the top of the article, where there
   * is nothing to measure yet.
   *
   * **And it is the FLOOR as well, which is the case that is easy to miss.**
   * When the bar has slid away its `bottom` is negative, so the floor is what
   * the expression returns — and it is not zero: `.reader::before` still paints
   * an opaque strip of exactly this height under the clock, so a destination
   * must clear that even with the bar gone. A floor of `0` under-reported by a
   * whole status bar in exactly the state a reader spends most of their time
   * in. (The reason used to be written as "the table head is still pinned at
   * `--safe-top`", which was true and is not any more; the pseudo-element was
   * always the more durable half of it.)
   *
   * On every device without a notch both terms are `0` and this is the line it
   * always was, which is why `tests/mobile-chrome.test.ts` poses an inset
   * rather than trusting the machine it runs on.
   */
  return Math.max(safeTop, Math.min(rect.height + safeTop, rect.bottom));
}

/**
 * **Where the bar is *going*** — as against `stickyOffset` above, which is
 * where it is.
 *
 * These were one function for a few hours on 2026-09-07 and merging them was a
 * mistake, so the distinction is worth stating plainly:
 *
 * | | asks | who calls it |
 * |---|---|---|
 * | `stickyOffset` | how much of the top is covered **now** | `readingLine()` (keynav.ts), the `?at=` tracker (App.tsx), `isBlockOnScreen`, `whereIsBlock` |
 * | `stickyDestination` | how much will be covered **when a jump lands** | `scrollToBlock` |
 *
 * At rest they return the same number, which is why one function served both
 * for months. They part company only while the bar is travelling — 180ms, and
 * only since it started doing that on laptops as well as phones.
 *
 * **Why the destination half is needed.** `scrollToBlock` used to call this
 * **once** and hand the number to `glide()` as a fixed target (since 2026-09-28
 * it is asked every frame — `aimAt` — but the frames early in a glide still
 * need a prediction rather than a half-slid bar); `ourScrollY` stops
 * the bar *reacting* to the jump but cannot stop a transition already in
 * flight. So a reader who scrolled up — starting the reveal — and clicked a
 * gist 90ms later got a target computed against half a bar, and the row they
 * asked for finished underneath the other half. GPT Sol F2.
 *
 * **Why it must not be given to the others.** They ask where the reader *is*,
 * and a prediction moves the reading line by up to a bar's height while the
 * slide runs: at `safeTop` 47 with the bar's bottom at 69 and rows at
 * [0, 80, 120], the measurement makes the first row current and the prediction
 * makes it the second — so ↓ during a slide would skip a paragraph. GPT Sol
 * F8, which is the reason this is a second function rather than a new body for
 * the first one.
 *
 * **`rect.bottom <= 0`, not `<= safeTop`.** A hidden bar is translated by
 * `--bar-h + --safe-top`, so it comes to rest with its bottom edge at exactly
 * zero. Coming back, that edge travels 0 → 91 on a 47px inset, and a boundary
 * at the inset would call the whole first half of the journey "hidden" and
 * reserve 47 where 91 is needed. Invisible on every machine without a notch,
 * because there the two boundaries are the same number. GPT Sol F7.
 *
 * **The rect, and deliberately not `data-bars`.** The attribute is not the same
 * question: the two `:has()` guards in shell.css hold the bar down —
 * `--bar-hide: 0px` — while the attribute is still set, so a reader in a band
 * mode, or tabbing along the pills, would have had every jump land under a bar
 * that is plainly there. Asking the element is what makes those guards free.
 *
 * Mid-*hide* this over-reserves by up to a bar's height, and that is the right
 * way round to be wrong: an over-reserved target lands a little lower than it
 * needed to, an under-reserved one lands invisible.
 */
export function stickyDestination(): number {
  const safeTop = safeAreaInsets().top;
  const bar = controlsBar();
  if (!bar) return safeTop;
  const rect = bar.getBoundingClientRect();
  if (rect.bottom <= 0) return safeTop; // gone, and no further to go
  return rect.height + safeTop; // here, or on its way here
}

/*
 * **`SMALL_DEVICE` used to live here, and it went on 2026-09-07.**
 *
 * It was `"(max-height: 620px), (max-width: 731px)"`, duplicated from
 * narrow-window.css § a small device and pinned character-for-character by
 * `tests/spine-width.test.ts` — a real guard against a real drift, because the
 * failure mode is "the bar never hides", which looks exactly like the feature
 * being off. The reason for the copy was that `watchBarVisibility` asked
 * `matchMedia` the same question the stylesheet asked, so a laptop would attach
 * no scroll listener for an attribute no rule read.
 *
 * **The bar hides at every width now** (Greg, 2026-09-07:
 * *"can we make it so that it's invisible most of the time except when we
 * scroll"*), so every width reads the attribute and there is nothing left to
 * gate. The string stays in the stylesheet, where it still gates the *dock*
 * half and the rest of § a small device — the Dock deliberately did not come
 * with the top bar onto laptops — and `tests/spine-width.test.ts` keeps the
 * half of its assertion that ties that number to `GIST_MIN + PROSE_MIN +
 * SPINE_W − 1`.
 *
 * docs/plans/260907b-the-top-bar-leaves-while-you-read-at-every-width.md.
 */

/** px of downward travel before the bar gives way. */
export const BAR_HIDE_AFTER = 24;
/** Never hide inside the first screenful — see `stepBar`. */
export const BAR_KEEP_UNTIL = 160;
/**
 * **How long `data-bar-moving` may stay on without a `transitionend` to end
 * it**, and the reason there is a number here at all.
 *
 * The attribute scopes the fisheye panels' `transition: top` to the one case
 * that should have one — the bar moving — because a panel's `top` also changes
 * on ordinary scrolling, while the sticky head settles out from under the
 * masthead over the first ~150px, and there a slide is a lag rather than an
 * animation (useColumnContext.ts § ColumnRect.top; GPT Sol F1, 2026-09-07).
 *
 * `transitionend` is what normally ends it. **A transition that never starts
 * never ends**, and there are at least three ways to have one: `prefers-
 * reduced-motion`, which turns the transition off outright; a background tab,
 * where it does not advance; and somebody deleting the rule. In every one of
 * those the attribute would latch on, and the symptom is not an error but the
 * defect it was added to prevent, permanently and everywhere.
 *
 * 400 rather than the 180 the transition takes: this is a backstop, not a
 * duration, and clearing it early would cut the slide short on a slow frame.
 * Nothing measures it, so it only has to be comfortably longer than 180 and
 * comfortably shorter than a reader's next gesture.
 */
export const BAR_MOVE_MAX_MS = 400;

export interface BarStep {
  /** Whether the controls bar should be out of the way. */
  hidden: boolean;
  /** The scroll position the *next* delta is measured from. */
  from: number;
}

/**
 * One scroll sample in, one bar state out.
 *
 * **Pulled out of the listener because it cannot be tested inside it.** The
 * only way to exercise this in place is to drive a real browser, and it turns
 * out that is not merely awkward but impossible from the harness we have: the
 * measuring tab is not the frontmost window, `document.visibilityState` reads
 * `hidden`, and **`requestAnimationFrame` does not run in a hidden tab at all**
 * — so the listener never fires and a completely broken implementation would
 * look exactly like this one. (It looked exactly like this one for ten minutes
 * on 2026-08-27.) Everything below is arithmetic on three numbers and none of
 * it needs a DOM. See tests/bar-visibility.test.ts.
 *
 * Three rules, and the asymmetry between the first two is the design:
 *
 *  - **Down takes a push.** `BAR_HIDE_AFTER` of accumulated downward travel
 *    before the bar goes, so a jittery hand does not make chrome flicker.
 *  - **Up is instant.** Any upward movement brings it back, because a reader
 *    scrolling up is usually looking *for* something.
 *  - **Never near the top.** Inside the first screenful the bar has not
 *    finished sticking, and hiding something that is still sliding into place
 *    reads as a glitch rather than as an affordance.
 *
 * The threshold is cumulative rather than per-event: a downward delta that does
 * not reach it leaves `from` alone, so a slow scroll eventually adds up to it
 * instead of never reaching it in one go. That is the whole reason this returns
 * `from` rather than the caller just remembering the last `y`.
 */
export function stepBar(hidden: boolean, y: number, from: number): BarStep {
  if (y < BAR_KEEP_UNTIL) return { hidden: false, from: y };
  const delta = y - from;
  if (delta > BAR_HIDE_AFTER) return { hidden: true, from: y };
  if (delta < 0) return { hidden: false, from: y };
  return { hidden, from };
}

/**
 * Hide the controls bar while the reader is going forwards; give it back the
 * moment they turn round.
 *
 * Greg, 2026-08-27, on a landscape phone: *"the vertical screen estate was at a
 * premium … Only show after certain kinds of scrolling?"* At 844 × 390 the three
 * bars were 124px of a 390px viewport, and this is 44 of them.
 *
 * Three things about how it is written, each of which is the reason it is here
 * rather than in a component:
 *
 *  - **It re-renders nothing.** The result goes onto a `data-` attribute on the
 *    root element and the stylesheet does the rest. React state would have
 *    re-rendered `Reader` on every direction change, and performance.md is a
 *    long account of what scroll-time re-renders cost this particular page.
 *  - **The listener is passive**, so it can never delay a scroll.
 *  - **The reading is deferred to a frame.** `scrollY` is cheap, but doing the
 *    work in rAF means at most one update per painted frame however fast the
 *    events arrive — and it is skipped entirely in a background tab, where rAF
 *    does not run and nobody is looking anyway.
 *
 * The threshold is deliberately asymmetric. Going **down** it takes a
 * deliberate push (`HIDE_AFTER`) before the bar goes, so a jitter while reading
 * does not make chrome flicker; coming **up**, any movement at all brings it
 * straight back, because a reader scrolling up is usually looking *for*
 * something. And it never hides near the top of the article, where the bar has
 * not finished sticking and hiding it would just look like a glitch.
 *
 * **The breakpoint used to be asked twice, and is not asked at all now.** From
 * 2026-08-27 to 2026-09-07 this function held a copy of § a small device's media
 * query and attached its listener only while that matched, so a laptop paid
 * nothing for an attribute no rule there read. Greg asked for the bar to leave
 * on a laptop too (2026-09-07), so every width reads it and the gate had nothing
 * left to protect — see the note where `SMALL_DEVICE` used to be.
 *
 * What that costs, stated rather than waved past, because performance.md argues
 * against a scroll listener on every machine: this one is `passive`, coalesced
 * into a `requestAnimationFrame`, and its body is `stepBar` — arithmetic on
 * three numbers with no DOM read in it. The page already installs a scroll
 * listener at every width for the fisheye panels (useColumnContext.ts), and
 * that one measures rects.
 *
 * **The bottom bar did not come with it.** `--dock-bottom` stays inside § a
 * small device: the Dock is 40px, it names the mode and it is the way out of
 * every one of them, and it joined this switch on a phone because 124px of a
 * 390px viewport was desperate. On a laptop it is not.
 *
 * Returns its own teardown.
 */
export function watchBarVisibility(): () => void {
  let hidden = false;
  let from = window.scrollY;
  let pending = 0;

  /**
   * **`data-bar-moving`: the bar is travelling right now.**
   *
   * The fisheye panels are the one thing under the bar that CSS does not move:
   * they are `position: fixed` with a `top` measured off the table head by
   * useColumnContext.ts. So they need a `transition: top` to slide with
   * everything else — and they must **not** have one at any other time, because
   * the same measured `top` also changes on ordinary scrolling, while the
   * sticky head settles out from under the masthead over the first ~150px. A
   * standing transition would turn that into a 180ms lag on every frame of it:
   * a worse defect than the one it was added to fix. GPT Sol F1, 2026-09-07.
   *
   * Under continuous scrolling the two cases cannot overlap, which is what
   * makes an attribute enough rather than approximate — `stepBar` refuses to
   * hide the bar inside the first `BAR_KEEP_UNTIL` pixels, and the head has
   * finished settling before then, so a gesture that arrives frame by frame has
   * left the first case before it can enter the second. **A single frame that
   * jumps more than 160px from the top does combine them**, and the panel then
   * glides its whole distance rather than snapping and sliding — measured in a
   * browser, 2026-09-07, and left alone; column-context.css § the panels and
   * the measuring stick has the numbers and the reason.
   *
   * `transitionend` on the bar's own `transform` is what normally ends it, and
   * `BAR_MOVE_MAX_MS` is the backstop for the several ways a transition can
   * never begin — see the constant for the list. Both, not either: the event
   * alone latches, and the timer alone would cut a slow frame short.
   */
  let settle = 0;
  let bar: HTMLElement | null = null;
  const stopMoving = () => {
    if (settle) clearTimeout(settle);
    settle = 0;
    bar?.removeEventListener("transitionend", arrived);
    bar = null;
    delete document.documentElement.dataset.barMoving;
  };
  /**
   * **The bar's own `transform`, by name, and nothing else.**
   *
   * `transitionend` bubbles, and this bar is full of things that transition:
   * the granularity pills are shadcn `Toggle`s carrying
   * `transition-[color,background-color,border-color]` over **120ms**
   * (pill.ts). Hover or press one while the bar is sliding and three of these
   * arrive at `.controls` 60ms before the bar has finished its own 180ms
   * travel. Taking any of them would end the slide a third of the way through
   * and stop every panel dead in the middle of the screen — with no error, and
   * only when a pointer happened to be on a pill.
   *
   * Both halves are needed: `target` because a descendant's `transform` would
   * pass the property test, and `propertyName` because `.controls` itself could
   * be given a second transitioning property later.
   */
  const arrived = (e: TransitionEvent) => {
    if (e.target === bar && e.propertyName === "transform") stopMoving();
  };
  const startMoving = () => {
    stopMoving(); // a reversal mid-slide restarts the window rather than extending it
    document.documentElement.dataset.barMoving = "";
    bar = controlsBar();
    bar?.addEventListener("transitionend", arrived);
    settle = window.setTimeout(stopMoving, BAR_MOVE_MAX_MS);
  };

  /* Put the bar back **and abandon any slide in flight**. Both callers are
     cases where nothing is animating any more and nobody is watching: a
     teardown, and a rotation that takes the rules away. Leaving `data-bar-moving`
     behind either would strand it on the root for the rest of the session, with
     no `transitionend` ever coming to clear it.
     Note the ordinary hide→show flip does NOT come through here — `apply` does
     that inline, precisely because it *is* a slide. */
  const show = () => {
    hidden = false;
    stopMoving();
    delete document.documentElement.dataset.bars;
  };

  const apply = () => {
    pending = 0;
    // A jump we started is not the reader scrolling, and chrome that answers to
    // it would move the ground under a destination already calculated. See
    // `ourScrollY`.
    /* Exactly, not within a tolerance: `ourScrollY` is the browser's own
       readback, so an unmoved page reports the same number, and a quarter of a
       pixel is the reader. With no clock to end it, a tolerance would ignore
       that movement for good (GPT Sol, plan review of 261005c, F1). */
    if (window.scrollY === ourScrollY) {
      from = window.scrollY;
      return;
    }
    /* Any other pixel is the reader taking over. Let the bar answer this
       movement, and forget ours. */
    ourScrollY = null;
    const next = stepBar(hidden, window.scrollY, from);
    from = next.from;
    if (next.hidden === hidden) return;
    hidden = next.hidden;
    /* Before the attribute the panels answer to, so a `MutationObserver` on
       `data-bars` (useColumnContext.ts) already sees the slide is on when it
       takes its fresh measurement. */
    startMoving();
    if (hidden) document.documentElement.dataset.bars = "hidden";
    else delete document.documentElement.dataset.bars;
  };

  const onScroll = () => {
    if (pending) return;
    pending = requestAnimationFrame(apply);
  };

  /**
   * **Focus moves the bar too, and nothing else can tell.**
   *
   * `:root:has(.controls:focus-within, .mode-band)` in shell.css puts
   * `--bar-bottom` and `--bar-hide` back **while `data-bars` is still
   * `"hidden"`** — that is the guard that stops the bar sliding out from under
   * a keyboard reader tabbing the granularity pills. So focus alone moves the
   * bar and the table head by the bar's height, twice, and neither end of it changes an
   * attribute on `<html>`.
   *
   * Nothing would have noticed. The fisheye panels take their `top` from the
   * head and re-measure on `data-bars`, so a reader who tabbed into the pills
   * got a bar back over panels that stayed where the hidden bar had left them,
   * until they happened to scroll. GPT Sol F6, 2026-09-07.
   *
   * `focusin` / `focusout` rather than the bar's `transitionrun`, which was the
   * other candidate and looks more general: `transitionrun` does not fire under
   * `prefers-reduced-motion`, where the bar snaps and the panels still need to
   * be re-placed. This fires either way.
   *
   * **Only while the bar is hidden**, because only then does the guard change
   * anything. At rest `--bar-bottom` is already its resting value, so
   * announcing a move would put every panel into a 180ms transition for a bar
   * that is going nowhere — on every tab through the pills.
   */
  const onFocusShift = (e: FocusEvent) => {
    if (!hidden) return;
    if (!(e.target instanceof Node)) return;
    if (!controlsBar()?.contains(e.target)) return;
    startMoving();
  };

  from = window.scrollY;
  window.addEventListener("scroll", onScroll, { passive: true });
  document.addEventListener("focusin", onFocusShift);
  document.addEventListener("focusout", onFocusShift);
  return () => {
    window.removeEventListener("scroll", onScroll);
    document.removeEventListener("focusin", onFocusShift);
    document.removeEventListener("focusout", onFocusShift);
    if (pending) cancelAnimationFrame(pending);
    show();
  };
}

/**
 * How long a jump takes — the same length whatever the distance.
 *
 * Greg, 2026-08-25: "can you make it scroll a bit faster so I don't have to
 * wait so long?"
 *
 * That wait is not a constant we chose; it is the browser's. `behavior:
 * "smooth"` runs an animation whose duration Chrome scales with how far you are
 * going, and this view routinely jumps thousands of pixels — a section, a part,
 * the far end of the article — so the very moves that most need to feel like a
 * jump are the ones the browser makes longest. There is no API to shorten it,
 * so we run the animation ourselves and hold the duration flat: near or far, a
 * jump costs the same fifth of a second.
 *
 * Short, but deliberately not zero. The travel is what tells you the article
 * moved *under* you rather than being replaced — with the arrow keys pressed
 * repeatedly that is the difference between reading a document and shuffling
 * through slides.
 */
export const SCROLL_MS = 200;

/** Fast off the mark, gentle into the stop. */
const ease = (t: number) => 1 - (1 - t) ** 3;

let frame = 0;
let release: (() => void) | null = null;
/**
 * Where the jump in flight is headed, or null when nothing is moving.
 *
 * Exposed through `glideTarget` so readers of position can tell whether a jump
 * is still in flight rather than treating an intermediate frame as the place
 * the reader chose.
 */
let aiming: number | null = null;

/**
 * When the page is being moved by us rather than by the reader.
 *
 * **The bar must not react to our own scrolling, and this is a correctness
 * problem rather than a tidiness one.** A jump must not hide or reveal the
 * controls as though the reader had scrolled. When this guard was introduced,
 * the destination was measured once, so reacting to the jump also changed the
 * clearance underneath that fixed target. Caught by GPT Sol reviewing the
 * plan, 2026-08-27, before it was ever run.
 *
 * The target is now re-measured every frame by `aimAt`, using
 * `stickyDestination()` to reserve the bar's eventual coverage. That corrects
 * the destination when layout changes; this guard keeps the bar's visibility
 * from changing in response to our own movement.
 *
 * **A scroll event that reports the pixel we last moved the page to is ours,
 * whenever it arrives; one at any other pixel is the reader's.** Every path in
 * this file that moves the page goes through `moveWindow`, which remembers
 * where the browser actually put it, and `watchBarVisibility` and the arrival
 * anchor sit out an event at that pixel — chrome answers to the reader's
 * gesture, never to ours.
 *
 * **It used to be a clock**, and that was the bug: a *quiet window* opened when
 * the glide began and closed 150ms after it was due to end, and outside it
 * every scroll event was the reader. But a click that jumps also re-renders
 * the reading view, and the glide's own last event waits behind that render —
 * 745 to 1,243ms on a 1,025-block article, measured. It arrived after the
 * window, at the very pixel the glide had reached, and was read as the reader
 * leaving: the anchor went, `?at=` was rewritten to the section before the one
 * clicked, and the bar hid itself for a jump. How long our event takes is not
 * ours to promise; which pixel it reports is.
 * docs/postmortems/261005d-whose-scroll-was-that-decided-by-a-clock.md.
 *
 * Nothing here expires. It is forgotten when an event arrives at another
 * pixel, or when the reader's wheel or finger stops a glide (`cancel`).
 */
let ourScrollY: number | null = null;

/** Move the page and remember the browser's clamped/rounded answer. */
function moveWindow(top: number): void {
  window.scrollTo({ top, behavior: "auto" });
  ourScrollY = window.scrollY;
}

/**
 * **Who is waiting to hear how the jump in flight ends** — `scrollToBlock`'s
 * `done`, held while a glide runs. At most one, because at most one glide runs:
 * starting another cancels this one first, which tells its caller so.
 */
let landing: ((outcome: ScrollOutcome) => void) | null = null;

/**
 * Abandon any jump in flight — a newer one, or the reader taking over.
 *
 * `outcome` is what the jump's caller is told, and it is `settled` only from
 * the glide's own last frame, which ends the animation through here too.
 */
function cancel(outcome: ScrollOutcome = "cancelled") {
  /* **The reader taking over ends our claim on the pixel, and must.** `cancel`
     is what a wheel, a touch or a `pointercancel` runs (see `bail` below), so
     past this line the page is moving because *they* are moving it — and a
     reader's first event can land on the pixel our last frame reached, which
     is exactly the gesture most likely to be them reaching for the chrome this
     suppresses. Cheap to get wrong, invisible when wrong: the bar would merely
     feel unresponsive now and then. Raised by GPT Sol, 2026-08-27. */
  /* …but a glide's own last frame is not the reader taking over, and its
     scroll event is still to come: keep the pixel, so that event is not read
     as the reader scrolling away from the arrival it has just made (`anchor`,
     plan 260929a). */
  if (outcome !== "settled") ourScrollY = null;
  /* Any movement at all ends a centred arrival's hold on the position. */
  clearArrivalAnchor();
  if (frame) cancelAnimationFrame(frame);
  frame = 0;
  aiming = null;
  release?.();
  release = null;
  /* Told last, after the state above is clear, so a caller that starts a new
     movement from inside `done` is not cancelled by the tail of this one. */
  const done = landing;
  landing = null;
  done?.(outcome);
}

/** Where the current jump is going, or null if nothing is in flight. */
export function glideTarget(): number | null {
  return aiming;
}

/**
 * **Travel to wherever `aim()` says, asking it again on every frame.**
 *
 * `aim` is a question, not a number, and that is the whole of the fix for
 * docs/postmortems/260928c-a-scroll-aimed-at-a-pixel-not-at-the-element.md.
 * This used to take the destination as a pixel measured once, at the moment of
 * asking — and the layout above a row is not obliged to hold still for 200ms.
 * Skim's "Next stop ›" door leaves the row above its target when React
 * commits the step, *after* the press measured the target; an image can load, a
 * band can open. Each of those moved the row and left the glide landing on the
 * place it used to be, with nothing reporting anything but `settled`. Asking
 * each frame makes the last frame land where the row *is*.
 *
 * `ms === 0` is the instant move (reduced motion, `behavior: "auto"`): the page
 * moves now, synchronously, as it always did, and one frame later — after
 * whatever render the caller's click also started has committed — it is asked
 * again and corrected, and only then is the move reported `settled`.
 *
 */
function glide(
  aim: () => number,
  done?: (outcome: ScrollOutcome) => void,
  ms: number = SCROLL_MS,
  finish: () => "settled" | "missing" = () => "settled",
  /** The first answer was measured without what it is aiming at — `aimAt`. */
  provisional: () => boolean = () => false,
) {
  cancel();
  const from = window.scrollY;
  const first = aim();
  // Already there is a landing: the reader is looking at the row right now —
  // unless that answer is provisional, and then the corrective frame of the
  // instant path below is what decides (plan 260929a, Sol F2).
  if (Math.abs(first - from) < 1) {
    if (!provisional()) return done?.("settled");
    ms = 0;
  }
  const started = performance.now();
  /* An instant move has already arrived as far as `glideTarget` is concerned:
     the re-check only corrects. */
  aiming = ms > 0 ? first : null;
  landing = done ?? null;
  if (ms === 0) moveWindow(first);

  // The browser's own smooth scroll gives up the moment you touch the wheel.
  // Ours has to be told, or we would drag the reader back to a destination they
  // have visibly changed their mind about.
  const bail = () => cancel();
  window.addEventListener("wheel", bail, { passive: true });
  window.addEventListener("touchstart", bail, { passive: true });
  window.addEventListener("pointercancel", bail, { passive: true });
  release = () => {
    window.removeEventListener("wheel", bail);
    window.removeEventListener("touchstart", bail);
    window.removeEventListener("pointercancel", bail);
  };

  const tick = (now: number) => {
    const t = ms <= 0 ? 1 : Math.min(1, (now - started) / ms);
    /* Re-aimed every frame: the eased fraction of the way from where we began
       to where the row is *now*, so at t = 1 it is exactly there. */
    const to = aim();
    if (ms > 0) aiming = to;
    const top = from + (to - from) * ease(t);
    /* Only when it moves anything: the instant path's re-check usually finds
       the page already right, and a no-op `scrollTo` is still a scroll event
       for every listener on the page. */
    // `top` only: a vertical jump must not disturb any horizontal position.
    if (Math.abs(top - window.scrollY) >= 0.5) moveWindow(top);
    if (t < 1) frame = requestAnimationFrame(tick);
    else cancel(finish());
  };
  frame = requestAnimationFrame(tick);
}

/** Whoever asked for motion, this reader has said no. */
export function reducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

/**
 * **Back to the top of the article, and stop anything already in flight.**
 *
 * A bare `window.scrollTo({ top: 0 })` is not enough, and that is the whole
 * reason this exists. `glide` keeps its own `requestAnimationFrame` loop, and
 * that loop does not care that somebody else has moved the page: its next tick
 * carries on toward the destination it was given, so the reader presses Back,
 * arrives at the top, and is then dragged forward again to wherever the jump
 * they just undid was going. `cancel()` is what says the jump is over — the
 * same call `scrollToBlock`'s instant branch already makes.
 *
 * GPT Sol found it, 2026-08-30, reviewing the fix for a different bug in the
 * same hook. It predates that fix: the `at === null` branch of the URL → page
 * effect (App.tsx § useReadingPosition) has always scrolled raw.
 */
export function scrollToTop() {
  cancel();
  moveWindow(0);
}

/**
 * **How a `scrollToBlock` ended**, for a caller that has something to do on
 * arrival — the flash (flash.ts, called from keynav.ts § `beginJump`).
 *
 *  - `settled`: the row is where it was sent — where it is *then*, re-measured,
 *    not where it was when asked. At once only for a move of less than a
 *    pixel; on the glide's last frame; and for an instant move (reduced motion,
 *    `"auto"`) one frame after it, when the post-commit re-check has run.
 *    docs/postmortems/260928c-a-scroll-aimed-at-a-pixel-not-at-the-element.md.
 *  - `cancelled`: the reader's wheel or touch stopped the glide, or a newer
 *    movement replaced it (another jump, an arrow key, Back, `abandonScroll`).
 *  - `missing`: there is no row for that id when asked, or it disappeared and
 *    was not replaced before the last frame. In the latter case the glide may
 *    have moved toward its last known position, but no arrival action fires.
 *
 * Reported rather than guessed with a timer, because a timer set to
 * `SCROLL_MS` fires just the same when the reader has already taken the page
 * somewhere else. GPT Sol F1 on
 * docs/plans/260928b-one-block-link-component-with-a-rich-tooltip-and-a-flash-on-arrival.md.
 */
export type ScrollOutcome = "settled" | "cancelled" | "missing";

/**
 * **Where the destination sits once it has arrived.**
 *
 * - `top` — its top just under the bars. Every step and every restore: ↑ / ↓,
 *   `?at=` on load or Back, the re-flow re-anchor. A stride reads down
 *   the page, and a restored position is a top-of-section fact.
 * - `centre` — in the middle of the free area, so the reader sees what comes
 *   before and after it. Every **jump**: `beginJump` (every block link, in every
 *   mode) and Skim's arrivals. Greg, 2026-09-29 (SPIDERYARN-READING2-4M):
 *   *"the linked-to block should be vertically-centred on the page so it's easy
 *   to see its context."* Something taller than the free area is not centred —
 *   its middle would be on screen and its start hidden, the very reason this
 *   file stopped using `scrollIntoView({ block: "center" })` — and goes to the
 *   top instead. docs/plans/260929a-trajectory-opens-on-stop-one-two-end-of-pass-doors-centred-jumps-compact-position.md § 3.
 */
export type ScrollAlign = "top" | "centre";

export interface ScrollHow {
  align?: ScrollAlign;
  /**
   * A passage inside the block — the key annotate.ts writes into its marks'
   * `data-hit`. When its marks are drawn, *they* are what is centred rather
   * than the whole row, so a quote at the foot of a long paragraph is centred
   * even when the paragraph is too tall to be. Only with `centre`.
   */
  passage?: string | undefined;
}

/**
 * **The page offset that puts a thing where `align` says** — the arithmetic,
 * pure and pinned in tests/scroll.test.ts.
 *
 * `top` and `height` are the thing's, in document coordinates; `bar` and
 * `dock` the obstructions at the top and bottom of the viewport; `max` the
 * furthest the page can scroll. Centred when it fits between them, else its
 * top under the bar; clamped to the page either way.
 */
export function alignedOffset(o: {
  top: number;
  height: number;
  bar: number;
  dock: number;
  viewportH: number;
  max: number;
  align: ScrollAlign;
}): number {
  const free = o.viewportH - o.bar - o.dock;
  const slack = o.align === "centre" && o.height < free ? (free - o.height) / 2 : 0;
  return Math.max(0, Math.min(o.top - o.bar - slack, Math.max(0, o.max)));
}

/**
 * **The arrival that owns "where the reader is"** until something else moves
 * the page — plan 260929a, GPT Sol F1.
 *
 * Everything that asks where the reader is measures at the reading line, just
 * under the bars: the `?at=` spy, the next jump's origin (the "Back to …"
 * chip), `beginJump`'s "already there", ↑ / ↓, and `whereIsBlock`. A centred
 * block's top sits *below* that line, so every one of them would name the
 * block above it — `?at=` rewritten to the previous section, a chip that
 * returns one paragraph short, a second press on the same link jumping again.
 * So when a centred movement settles it leaves this anchor, and those callers
 * answer with it while it lasts.
 *
 * It lasts until the next movement of any kind — `cancel`, which every glide
 * runs first and which a wheel or touch mid-glide also runs — or a scroll
 * event at any pixel but the one it arrived at. The glide's own delayed event
 * reports that pixel and a reader's movement does not, so the pixel decides,
 * however late the event is (§ `ourScrollY`). A re-flow that makes the browser
 * scroll ends it too, and then the reading line answers again, which is the
 * old behaviour rather than a wrong one.
 */
let anchor: { id: string; passage: string | undefined } | null = null;
let anchorY = 0;
let anchorListening = false;
const anchorListeners = new Set<() => void>();

/** Anchor changes can settle or end without scrolling; live position samplers must hear them. */
export function subscribeArrivalAnchor(listener: () => void): () => void {
  anchorListeners.add(listener);
  return () => {
    anchorListeners.delete(listener);
  };
}

function onScrollWhileAnchored(): void {
  /* The glide's delayed event reports the pixel it just reached, and may
     arrive a second later behind a render. The page has not moved, so the
     reader has not left — no clock is asked (§ `ourScrollY`). */
  if (window.scrollY === anchorY) return; // exactly: `anchorY` is a readback too
  clearArrivalAnchor();
}

/** End a centred arrival without implying that a glide is in flight. */
export function clearArrivalAnchor(): void {
  const held = anchor !== null;
  anchor = null;
  if (anchorListening) {
    window.removeEventListener("scroll", onScrollWhileAnchored);
    anchorListening = false;
  }
  if (held) for (const listener of anchorListeners) listener();
}

function holdAnchor(id: string, passage: string | undefined): void {
  anchor = { id, passage };
  anchorY = window.scrollY;
  if (!anchorListening) {
    window.addEventListener("scroll", onScrollWhileAnchored, { passive: true });
    anchorListening = true;
  }
  for (const listener of anchorListeners) listener();
}

/** The centred arrival the reader is standing on, or `null` — see `anchor`. */
export function arrivalAnchor(): { id: string; passage: string | undefined } | null {
  /* A re-extraction or page change can remove the row without moving the
     viewport. Never let module state make position readers name a block that
     the current article no longer draws. */
  if (anchor !== null && blockRow(anchor.id) === null) clearArrivalAnchor();
  /* Nor a block folded away since the arrival (fold.ts). */
  if (anchor !== null && isFolded(anchor.id)) clearArrivalAnchor();
  return anchor;
}

export function scrollToBlock(
  id: string,
  behavior: ScrollBehavior = "smooth",
  done?: (outcome: ScrollOutcome) => void,
  how: ScrollHow = {},
) {
  /* **A jump to a block is a request to see it**, so a folded section holding
     it opens first — synchronously, so the row measured below already has its
     height (fold.ts § Why a style element). Every jump comes through here,
     which is why this is the one place folding needs to be told. ↑ / ↓ step
     over folded rows before they get this far (keynav.ts § `step`). */
  revealBlock(id);
  const row = blockRow(id);
  /* A request that cannot move is still a newer request. Letting the old glide
     carry on would make its callback report `settled` after this one has
     already reported `missing`, so the older jump could flash as though it
     were the destination the reader most recently chose. */
  if (!row) {
    cancel();
    return done?.("missing");
  }
  const align = how.align ?? "top";
  const aim = aimAt(id, row, align, align === "centre" ? how.passage : undefined);
  glide(
    aim.read,
    /* The anchor is left *after* `cancel` has run for the last frame (it
       clears it), and before the caller hears — so a caller that asks where
       the reader is from inside `done` gets the arrival. */
    (outcome) => {
      if (outcome === "settled" && align === "centre") holdAnchor(id, how.passage);
      done?.(outcome);
    },
    behavior === "smooth" && !reducedMotion() ? SCROLL_MS : 0,
    aim.finish,
    aim.provisional,
  );
}

/**
 * **Where the page must be for `id`'s row to sit under the bars — asked, not
 * remembered.** `glide` calls it every frame (see there for why).
 *
 * Explicit and clamped rather than scrollIntoView(): we want the row's own top
 * edge, offset to clear the bars, and no surprise when the row sits inside a
 * cell that spans dozens of others.
 *
 * A row React has replaced mid-glide is found again by its id; a row that has
 * gone altogether keeps the last answer rather than aiming at a detached
 * node's zero rectangle, but reports `missing` rather than claiming that stale
 * pixel was an arrival.
 *
 * **Centred** (`ScrollAlign`), the thing measured is the passage's marks when
 * a passage was named and they are drawn — every fragment, unioned, found by
 * the same token rule the flash uses (rows.ts § `passageMarks`, Sol F3) — and
 * the row otherwise. Until they are found the aim is `provisional`: the marks
 * of a Skim stop are published by the render the click starts, after
 * the click has asked for the scroll, so `glide` must not settle on a first
 * answer measured without them (Sol F2).
 */
function aimAt(
  id: string,
  first: HTMLElement,
  align: ScrollAlign = "top",
  passage?: string,
): { read: () => number; finish: () => "settled" | "missing"; provisional: () => boolean } {
  let row = first;
  let last: number | null = null;
  let present = true;
  let found = passage === undefined;
  return {
    read: () => {
      if (!row.isConnected) {
        const again = blockRow(id);
        if (!again) {
          present = false;
          return last ?? window.scrollY;
        }
        row = again;
      }
      present = true;
      let rect: { top: number; height: number } = row.getBoundingClientRect();
      if (passage !== undefined) {
        const cell = row.querySelector("td.text");
        const marks = cell ? passageMarks(cell, passage) : [];
        found = marks.length > 0;
        if (found) {
          const rects = marks.map((m) => m.getBoundingClientRect());
          const top = Math.min(...rects.map((r) => r.top));
          rect = { top, height: Math.max(...rects.map((r) => r.bottom)) - top };
        }
      }
      last = alignedOffset({
        top: rect.top + window.scrollY,
        height: rect.height,
        bar: stickyDestination(),
        dock: align === "centre" ? dockOffset() : 0,
        viewportH: window.innerHeight,
        max: document.documentElement.scrollHeight - window.innerHeight,
        align,
      });
      return last;
    },
    finish: () => (present ? "settled" : "missing"),
    provisional: () => !found,
  };
}

/**
 * Which block a link should put under the reader's eye when it opens.
 *
 * A URL can carry two things that sound like a position, and until 2026-08-26
 * only one of them moved the page. `?at=` restored the section and `?note=`
 * opened the dialog, so `/read/<slug>?note=<id>` with no `?at=` beside it —
 * which is exactly the shape of a link somebody *sends* — showed the reader an
 * explanation of a paragraph that was somewhere off screen, with no way to tell
 * where. Recorded as open in docs/plans/260825e-metadata-page.md and fixed here.
 *
 * **The note wins**, and the argument is about which parameter anybody meant.
 * `?at=` is written by scrolling: it is debounced, it replaces rather than
 * pushes, and it says where the sender's eye happened to be when the address
 * bar last caught up. `?note=` is only ever in a URL because someone opened a
 * dialog. So when the two disagree, one is a byproduct and the other is the
 * point of the link.
 *
 * Nothing is lost when they agree, either — if the note's passage sits inside
 * the section `?at=` names, the passage is simply the finer of the two answers,
 * and the caller's `isBlockOnScreen` check means an already-visible passage
 * costs no movement at all.
 *
 * A `?note=` naming a comment we do not have falls back to `at`. That covers
 * both the comment being deleted and the fetch not having landed yet, and the
 * caller distinguishes them by trying again when the comments arrive.
 *
 * Pure, and pinned in tests/scroll.test.ts — the rule is worth a test even
 * though the wiring around it can only be checked in a browser. Structural
 * types rather than `Comment`, so this file stays about pixels.
 */
export function arrivalTarget(
  at: string | null,
  note: string | null,
  comments: readonly { id: string; blockId: string }[],
): string | null {
  if (note === null) return at;
  return comments.find((c) => c.id === note)?.blockId ?? at;
}

/**
 * Whether a block's row is already comfortably in view.
 *
 * Used to decide whether stepping between comments should scroll at all. Two
 * comments in the same paragraph are the common case, and jolting the page
 * between them costs the reader their place for nothing.
 *
 * "Comfortably" means clear of the sticky bars at the top and not jammed against
 * the bottom edge — a row whose first line is hidden under the header is not on
 * screen in any sense the reader cares about. The margin is a tenth of the
 * window rather than a constant, so it scales with the viewport.
 */
export function isBlockOnScreen(id: string): boolean {
  const row = blockRow(id);
  if (!row) return false;
  /* **A folded row is never on screen**, though its zero-height rectangle
     may sit inside the viewport — and "already there" is what lets a caller
     skip the `scrollToBlock` that would have unfolded it. GPT Sol's plan
     review of 261002e, finding 1. The same in the two below. */
  if (isFolded(id)) return false;
  /* A centred arrival is on screen by construction; a large one may reach the
     bottom margin, which would call it away (Sol F1). */
  if (anchor?.id === id) return true;
  const { top, bottom } = row.getBoundingClientRect();
  const margin = window.innerHeight * 0.1;
  return top >= stickyOffset() && bottom <= window.innerHeight - margin;
}

/**
 * **Where a block is relative to the reader**, in the three answers a caller
 * that wants to *move* them actually needs.
 *
 * `isBlockOnScreen` above answers two of them and folds the third in with the
 * wrong one: it says `false` both for a row far below the fold and for a row
 * that **is not in the document at all**. That is right for its own callers,
 * which only ask whether to bother scrolling — and wrong for anything that
 * takes a history entry for the journey, because a missing row means no journey
 * happens and the entry is a promise of a return that was never made. GPT Sol
 * F23, 2026-09-06.
 *
 * It also answers `false` for a paragraph **taller than the viewport**, which
 * cannot satisfy "fits between the bars" at any scroll position — so a reader
 * stepping between two comments inside one such paragraph was jolted to its
 * top, which is exactly the no-jolt case the guard exists to prevent. Here a
 * row *crossing the reading line* counts as `here`, the same line
 * `measureRow` uses for "which item am I in" (keynav.ts). GPT Sol F10.
 */
export type Whereabouts = "nowhere" | "here" | "away";

/**
 * **Whether a passage inside a block is comfortably in view** — `beginJump`'s
 * "already there" for a jump that names a quote (plan 260929a, Sol F2). The
 * block can be under the reading line with the quote a screen further down,
 * so the block's answer is not the passage's. `false` when its marks are not
 * drawn: nothing says it is there, so the jump goes ahead.
 */
export function isPassageOnScreen(id: string, passage: string): boolean {
  if (isFolded(id)) return false;
  const cell = blockRow(id)?.querySelector("td.text");
  const marks = cell ? passageMarks(cell, passage) : [];
  if (marks.length === 0) return false;
  const rects = marks.map((m) => m.getBoundingClientRect());
  const top = Math.min(...rects.map((r) => r.top));
  const bottom = Math.max(...rects.map((r) => r.bottom));
  return top >= stickyOffset() && bottom <= window.innerHeight - window.innerHeight * 0.1;
}

export function whereIsBlock(id: string): Whereabouts {
  const row = blockRow(id);
  if (!row) return "nowhere";
  if (isFolded(id)) return "away"; // a jump to it will unfold it
  if (anchor?.id === id) return "here"; // § `anchor`
  const { top, bottom } = row.getBoundingClientRect();
  const line = stickyOffset();
  const margin = window.innerHeight * 0.1;
  if (top >= line && bottom <= window.innerHeight - margin) return "here";
  /* Crossing the line: its top is above the reader and its bottom below, so
     they are standing *inside* it however tall it is. */
  return top <= line && bottom >= line ? "here" : "away";
}

/**
 * **Stop a movement we started.** For a caller that has just decided the reader
 * is already where they asked to be, and must therefore not be carried off by a
 * glide that is still running from the last thing they asked for.
 *
 * The sequence: a step to question A starts the 200ms glide; while it is
 * passing question B — comfortably on screen at that instant — the reader
 * presses Prev. Without this the note changes to B and the glide carries
 * serenely on to A, leaving B off screen. GPT Sol F22, 2026-09-06.
 *
 * Narrowly named because it is `cancel` with none of `cancel`'s other duties:
 * the reader has not taken over, and nothing here is starting a new movement.
 */
export function abandonScroll(): void {
  /* "Already here" callers use this to stop an older glide. With no glide,
     cancelling would only discard a centred arrival even though the page did
     not move — notably when the comment dialog opens on that same block. */
  if (frame !== 0) cancel();
}
