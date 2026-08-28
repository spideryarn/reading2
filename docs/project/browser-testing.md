# Testing it in a browser

The reading view has no DOM tests and won't for a while — see
[testing.md § What we test, and what we don't](testing.md#what-we-test-and-what-we-dont). Until it
does, **looking at it in a browser is the test harness for stage 6**, and that makes it worth
writing down what to look at and where the eye lies to you.

This doc is the how. What the client *is*: [web-client.md](web-client.md). Why the feature exists:
[granularity-zoom.md](granularity-zoom.md).

## Before anything, check the server is actually up

```bash
npm run dev                                    # http://localhost:5273 (vite.config.ts)
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:5273/
```

Don't take another agent's word for it, or your own from ten minutes ago. On 2026-08-24 a session
was told the server was running on 5273 and it wasn't — nothing was listening, and `npm run dev`
had to be started fresh. A refused connection and a blank page look nothing alike in a terminal and
almost identical in a screenshot.

### And check the port, not just the server

`npm run dev` takes 5273 if it can and **silently moves to 5274, 5275, …** if another agent in this
tree already has it. It says so in one line of its own output and nowhere else, so a session that
assumes 5273 gets a refused connection or — worse — *somebody else's* dev server, which serves a
page that looks exactly right and is running different code. Read the port off the line Vite prints
and pass it on to anything you dispatch.

### There is no `file://` shortcut — serve it

**The Chrome extension refuses `file://` URLs.** `navigate` comes back with an error rather than a
page, and the tab does not move. This costs an hour if you don't know it, because writing a
throwaway HTML file and opening it is the obvious way to look at one page of markup, and it is the
one way that cannot work.

Serve the directory instead, on a port nothing else is using, and hand the agent an `http://`
address:

```bash
npx http-server <dir> -p 8791 --silent    # then navigate to http://127.0.0.1:8791/page.html
```

Used on 2026-08-28 to check what four equation- and table-heavy extracted articles actually look
like — rebuilt pages written to a scratch directory, served, and screenshotted. The related trick for getting a *real
component* on screen without the auth gate is a throwaway Vite page, which the dev server already
serves over HTTP and so never runs into this.

### A phone-width window does not exist, so use an iframe

**Chrome on macOS will not make a window narrower than 605 CSS px.** `resize_window` returns
"Successfully resized window ... to 390x844", `innerWidth` stays at 605, and nothing anywhere errors
— the same lie the section below describes, with a hard floor underneath it. A session that trusts
the call measures a 605px page believing it is a phone.

What works is a **same-origin iframe** of the exact size, injected into a page the dev server is
already serving. Inside an iframe, `innerWidth`, `100vw` and every width media query are the
*iframe's*, so `fitView` and the stylesheet see a real 390 × 740; being same-origin, you can read
computed boxes straight out of `contentWindow`. For a frame wider than the 605px window, a CSS
`transform: scale()` on the iframe keeps its layout at full size and only shrinks the paint, so
screenshots still work.

```js
const f = document.createElement("iframe");
f.style.cssText = "width:390px;height:740px;border:0";
f.src = "/read/<slug>";
document.body.appendChild(f);
// then: f.contentWindow.innerWidth === 390
```

Three things it cannot do, and all have cost real time:

- **A scripted wheel event cannot be delivered into the frame.** Dispatched at a coordinate well
  inside a 390px iframe it scrolls the *outer* page instead — confirmed twice, with `wheel`
  listeners on both documents and neither one firing, while the outer `scrollY` simply changed.
  So the iframe can measure a phone layout and cannot scroll one, which rules out everything
  driven by `watchBarVisibility`. Use a real small window for those: it will not go below 605px
  wide, so only the `max-height: 620px` half of § a small device is reachable — a 900×337 window
  does it. Found 2026-08-28 checking the dock's hide-on-scroll.

- **`@media (hover: none)` and `(any-pointer: coarse)` still match the desktop.** No touch-keyed rule
  is being exercised. On 2026-08-27 the per-paragraph chat button was found to be unreachable on any
  touch device by *reading the stylesheet*; every screenshot looked perfect.
- **Anything driven by `requestAnimationFrame` is dead**, because the tab is not frontmost — see the
  next section. This is the one that most looks like success.

### A stale parsed stylesheet in a long-lived tab

After a session's worth of HMR updates, a tab's `<style>` element can hold **byte-for-byte correct
CSS text that Chrome has not re-parsed.** On 2026-08-27 the text said `top: var(--bar-bottom)`, the
custom property demonstrably switched value on `:root`, and the element's computed `top` came from an
older build — so every check agreed with itself and all of them were wrong. Half an hour went into
blaming the build pipeline.

Two habits that catch it:

- **Check a CSS mechanism in a brand-new tab before concluding the CSS is wrong.** One navigation
  settled it.
- **Run a control.** Set a made-up property (`--zz-control`) the same way you set the real one and
  read both back. If the control works and yours does not, it is your property; if neither works, it
  is your method. That one call is what turned "the CSS is broken" into "the browser is stale".

### A hidden tab does not animate, and half this app is animated

The measuring tab is not the frontmost window, so `document.visibilityState` reads `hidden` — and
in a hidden tab the browser stops running the animation frame loop. Two consequences bit hard on
2026-08-27 and both produced *confident, self-consistent, wrong* readings:

- **CSS transitions never advance.** `getComputedStyle` returns the value the property started from,
  however long you wait, and `getBoundingClientRect` agrees with it. So an element with
  `transition: transform 0.18s` reads as *not having moved* even when the rule that moves it is
  correct — and setting the property by hand from the console reads the same way, which kills the
  usual control. Two separate root causes were written down and committed off the back of this
  before the pattern was spotted. **Turn transitions off before measuring anything that has one:**

  ```js
  const kill = document.createElement("style");
  kill.textContent = "*,*::before,*::after{transition:none!important;animation:none!important}";
  document.head.appendChild(kill);
  // ... measure ...
  kill.remove();
  ```

- **Anything debounced through `requestAnimationFrame` never runs.** The spine measures its bands in
  a `useLayoutEffect` that defers to rAF, so **in the harness the spine renders as an empty rail**:
  `document.querySelectorAll(".spine-hit").length === 0`, always, on a perfectly healthy page. It is
  not a regression and no amount of waiting or scrolling fixes it. Anything you wanted to check about
  the rail — its bands, its tooltips, its tap behaviour — cannot be checked here at all.

Before diagnosing anything that moves, print the three facts together:

```js
({ visibility: document.visibilityState, hasFocus: document.hasFocus(),
   rafRuns: await new Promise(r => { requestAnimationFrame(() => r(true)); setTimeout(() => r(false), 400); }) })
```

### Work in your own tab

Several agents drive this same browser. On 2026-08-26 a session's measurements were being
contaminated by a stray tab from another session that was auto-scrolling on its own; the fix was
`tabs_context_mcp{createIfEmpty:true}` into a fresh tab group and staying in it. Related, and worth
knowing before you conclude your fix did nothing: `resize_window` **reports success while doing
nothing** once a session's window has got into a bad state — every later call returns fine and
`innerWidth`/`innerHeight` stay pinned. Always read them back rather than trusting the call, and if
they are stuck, a brand-new tab usually clears it. A whole verification pass that afternoon was run
at 900×507 by a session that thought it had asked for 1300 tall, which made its numbers degenerate
without making them look wrong.

### Click by reference, not by pixel

The `computer` tool's screenshot dimensions are not reliably 1:1 with CSS pixels here, and are not
stable between calls, so arithmetic on a screenshot to hit a checkbox or a slider thumb lands
somewhere else often enough to matter. On 2026-08-26 a session mis-clicked a saved-search tick that
way and silently started a second search, which then showed up as extra results in the run it was
measuring — a wrong measurement that looked like a finding. Use `find` and click the reference it
returns, or drive the control from the keyboard: a range input takes Home, End and arrow keys, which
is also the only way to check that its whole track steps 1:1.

**The same goes for hovering, and there the mismatch has a number.** Measured 2026-08-26 with a
`mousemove` listener logging the real `clientX`/`clientY`: `computer.hover` asked for (100, 300) and
the page received (94, 283) — about 5–6% out. On the spine, a rail of stacked bands a few pixels
tall, that is easily a whole band.

**And the size of that gap is not a constant — treat it as unknown until you measure it.** On
2026-08-27 the same listener trick found the tool's coordinates matching the *screenshot's* pixel
dimensions (1062 × 1148) rather than the viewport's (700 × 757) — a factor of about 1.52, so a raw
CSS-pixel coordinate missed its target by a third of the page rather than by 6%. Coordinates
expressed in screenshot space landed correctly. Which means the ratio is whatever this session's
screenshot scaling happens to be, and the only safe procedure is the one above: click by reference,
and if you must use a coordinate, capture what the page actually received before believing anything
downstream of it.

The expensive version of this is not a mis-click, it is a **bug report for a bug that does not
exist**, because somebody then goes looking for it. A session hovered a band at a literal
coordinate, then called `document.elementFromPoint` at *that same literal coordinate*, and found the
open tooltip belonged to a different band — three times, reproducibly, including on a fresh page
with one isolated hover. It wrote it up as a stale-content bug in the tooltip group. It was not: the
two calls were asking about two different points, and a second agent hovering by element reference
could not reproduce it once. So anything that maps a coordinate back to an element —
`elementFromPoint`, `caretPositionFromPoint` — must be given the position **the page saw**, captured
from a listener, never the one you asked for.

**But only in a visible tab.** Keys into a hidden one are *intermittent* rather than dead — see
[A background tab will lie to you](#a-background-tab-will-lie-to-you-about-scrolling) below, whose
fourth point is the longer version. On 2026-08-26 a session pressed `ArrowRight` thirty times at a slider and the value did not
move once, with `visibilityState` reading `hidden` throughout; clicking the track worked every time.
So the two pieces of advice on this page are ordered: **visible tab first, then keyboard, then
refs** — and never pixel arithmetic.

### Counting marks is not counting results

A search result's highlight is drawn as **one `<mark>` per text-node run**, not one per result, so a
passage crossing an `<em>` or a link is several marks. Counting `<mark>` elements and comparing that
to the rows in the panel therefore disagrees on perfectly correct pages.

And `data-hit` is a **space-separated list**, not one id — two results overlapping in the same run
share a mark ([`annotate.ts`](../../src/web/annotate.ts), and the overlapping-marks wall in
[search.md](search.md)). So it has to be split before it is counted, or a doubled-up mark reads as
one exotic id and the total comes out low:

```js
new Set(
  [...document.querySelectorAll("[data-hit]")].flatMap((m) => m.dataset.hit.split(" ")),
).size
```

*That* number is comparable to `.srch-hits li`, and it is what "the panel and the prose agree"
actually means (search.md § Prioritised). Found while checking the confidence threshold, 2026-08-26
— and the first version of this snippet, which did not split, is why the caveat is here.

### Scroll for real, and let a frame render

`window.scrollTo()` followed immediately by a DOM read measures a page mid-flight — before a
`useLayoutEffect` has re-placed anything and before the rAF sampler has run. On 2026-08-26 that
produced a reading showing a panel's current entry clipped 191px past its bottom edge, which a
screenshot taken a moment later showed sitting correctly. Take a screenshot (which forces a real
frame) between the scroll and the read, or use a real wheel scroll. And note the pair interacts:
the same session saw a screenshot *between* `scrollTo` calls revert `scrollY` to 0.

## Signed out is not signed out, in a browser you have used before

Since 2026-08-27 the app has a gate ([auth.md](auth.md)): signed out, there is nothing to look at
but a sign-in screen. Which makes the first line of every browser pass a question you did not used
to have to ask.

**A tab that has been used for this app before is signed in**, and will stay signed in across a
reload, a restart and a week. The session lives in `localStorage` under `sb-<host>-auth-token`. So
"I loaded the page and got the shelf" is not evidence the gate is broken — it is the commonest way
to *think* it is. Found the hard way on the first browser pass of the gate itself.

```js
localStorage.clear()   // then reload. Now you are signed out.
```

Two consequences for a run:

- **Test "signed out" first, and clear storage before you do.** Afterwards you have to sign in
  again, which is slower, so it is worth ordering the pass around it.
- **`localStorage` is per origin, and the port is part of the origin.** A session on `:5273` is not
  a session on `:5275`. If several agents are running `npm run dev` in this one tree, you may be
  signed in on one port and out on another, which reads as flakiness.

To sign in without a Google round trip, use email and password — the local stack has
`mailer_autoconfirm` on, so "create an account" lands you straight in the app with no email to
click. Google needs the port to be on the local redirect allow-list; see
[setup-dev.md](setup-dev.md#signing-in-needs-four-more) for the two ways that goes quietly wrong.

## The URLs and widths worth checking

The view has two modes and the second is easy to forget:

| URL | What you're looking at |
|---|---|
| `/` | reading mode: column headers `Article L0 │ Parts L1 │ Sections L2 │ Text verbatim` (the first reads `Argument L0` once `arc.json` exists), and a controls bar of `Spine · Arg · L1 · L2 · Para · Text` — [granularity-zoom.md § What the bar calls each column](granularity-zoom.md#what-the-bar-calls-each-column) |
| `/?text=0` | **outline mode** — rows collapse to natural height and the same table becomes a whole-article ToC. A leaf column of navLabels appears *here and only here*, styled by `.nav-label`. Check accents separately; it is visually a different page |
| `/?at=spya-k6fpme` | deep link, opens scrolled to that section — [block-ids.md](block-ids.md), [url-state.md](url-state.md) |
| `/#spya-k6fpme` | the old spelling. Should *rewrite itself* to `?at=` before the page paints; if you ever see the hash survive in the address bar, the migration in `main.tsx` broke |
| `/?cols=0,1&text=1` | an explicit column choice, which pins the columns and takes them off auto-fit |
| `/?spine=0` | the rail hidden by hand. Check the article **reflows into the reclaimed 24px** rather than leaving a gutter, and that the corner wordmark clears the controls bar — that padding compensation is the one thing `--spine-w: 0` is load-bearing for ([HomeLogo.tsx](../../src/web/HomeLogo.tsx)) |
| `/?text=0&spine=1` | the rail kept in outline mode, where it is off by default. The one combination that proves `?spine=` is three-state rather than two |
| `/?mode=chat&spine=0` | the rail hidden with a mode band open, which is the only way `fitMode` returns `off`. Both smallest terms of the sticky bars' `left` at once |
| `/?slug=<slug>` | a different article; defaults to `example` |

**Widths.** At the default three gist columns the table is 1120px wide. Anything under that
overflows horizontally and the pinned end columns start overlapping the middle ones — which is the
design, not a fault: the pinned columns sit *on top* and the drop shadow is there to say "more to
scroll". 1000×900 is a good window for exercising it; a full-width window hides the whole class of
bug. Below the `td.text` minimum of 34rem the prose measure clamps rather than breaking.

## Scroll, then read the address bar

The `?at=` parameter is the one thing here no unit test can reach: the parsers and the section
arithmetic are pinned in `tests/url-state.test.ts`, but the scroll listener that drives them needs a
real layout. Four checks, in order — each one catches a different failure:

1. **Scroll a few sections and stop.** After ~300ms `?at=` should appear and then change only as you
   cross a section boundary, not continuously. If it updates on every pixel, the debounce is gone.
2. **Reload.** You should land back at the same section. If you land at the top, the restore ran
   before layout; if you land twice, `history.scrollRestoration` is not `manual`.
3. **Press Back.** It must *leave the page*, not walk you back up it. Any scroll that created a
   history entry is a bug — see [url-state.md](url-state.md).
4. **Scroll to the very top.** `?at=` should disappear from the URL entirely.

Then click a gist to jump: that one *should* add a history entry, so Back returns you to where you
jumped from. It is the only scroll that does.

The failure mode to watch for is a **feedback loop** — scrolling writes the URL and the URL scrolls
the page, so a broken guard shows up as the page fighting you or juddering, not as an error.

### A background tab will lie to you about scrolling

Worth knowing before you conclude `?at=` is broken, because it looks exactly like a dead listener.
**Chrome suspends the rendering step for a tab that isn't the visible one in its window**, and scroll
events and `requestAnimationFrame` are both dispatched from that step. So in a hidden tab:

- `window.scrollTo()` moves `window.scrollY` — and fires **no scroll event at all**.
- `requestAnimationFrame` never runs, so anything rAF-coalesced (the `?at=` tracker, and the spine's
  re-measure) never runs either.
- `setTimeout` is clamped to a 1s minimum, so a 300ms debounce and a 16ms rAF shim both become one
  second, and a driver script with a dozen short sleeps blows through a CDP timeout.

A screenshot does **not** count as making the tab visible. Often the extension captures a hidden tab
perfectly well, so you get a correct-looking picture of a page whose event loop is asleep — and
sometimes you get the black rectangle described just below. Neither reading tells you the page is
fine. Check `document.visibilityState` before believing a negative result, and before believing a
positive one.

**And what freezes is not only the animation.** Anything *computed inside* a rAF loop is gone too,
which is easy to miss when the loop's obvious job is drawing. The microphone's `quiet` flag — ten
seconds below the activity threshold — is worked out in the same tick that moves the level bars
([useAudioLevel.ts](../../src/web/useAudioLevel.ts)), so in a hidden tab it can never become true,
and everything hanging off it (the device name, the *Change* control, the microphone picker) is not
slow or flaky but **unreachable**. A subagent spent an hour on 2026-08-27 waiting past a ten-second
threshold twice before reading the source. The same goes for anything gated on `visibilityState`
directly: [useNow.ts](../../src/web/useNow.ts) stops its interval while hidden, so the dictation
timer sits at `0:00` for a perfectly good reason. **Before reporting that a delayed state never
arrived, find out what schedules it.**

What still works in a hidden tab, and is therefore what to test there: anything driven by a direct
call rather than by the rendering step — a fresh page load, a reload, `history.back()`, and clicking a
control. That is enough to cover URL→page restore, the legacy-hash rewrite, and the history
semantics. Continuous scroll→URL needs a genuinely visible tab.

#### An occluded window captures as solid black, and you cannot raise it

The case above is a tab that is not frontmost *in its window*. This is the whole **window** being
behind something else, and on macOS it produces the same `visibilityState: "hidden"` with a worse
symptom: **every capture comes back a solid near-black rectangle at exactly the right dimensions.**
The tool reports success. The image is the page's background colour, so on this app — which is dark
by design — it looks far more like a page that failed to render than like a capture that failed.

Found on 2026-08-27 while shooting the landing page ([auth.md](auth.md)). Three of four screenshots
were lost to it, and the tell was one line: `document.elementFromPoint()` returned the *right*
paragraph of the article at the coordinates the screenshot showed as empty. The DOM was fine; only
the picture was black.

**The expensive part is that an agent cannot fix it.** Nothing in the extension's API raises a
window, and the obvious escapes do not work either:

- `resize_window` succeeds, and changes `innerWidth`, without raising anything.
- Creating a new tab, or a whole new tab group and window, does not bring it forward.
- `open -a "Google Chrome"` raises *a* Chrome. If two instances are running — one is, whenever
  somebody has a CDP-driven copy open — AppleScript and `open` may both reach the other one, and
  `tell application "Google Chrome" to get URL of every tab` then lists tabs that are not the ones
  the extension is driving. That mismatch is the quickest way to confirm which instance you are
  talking to.

So the rule is: **check `document.visibilityState` before a capture, not after a puzzling one**, and
if it says `hidden`, ask the person to click the window rather than trying to solve it. It is one
click for them and unsolvable for you. Related: the handshake stall further down, which is the other
browser problem an agent cannot get itself out of.

#### It can also stop a component ever drawing at all

The bullets above are about *stale* values. On 2026-08-27 the same cause produced something worse in
the new Diagram mode ([diagram.md](diagram.md)): the panel measures its scroller in a layout effect
and draws nothing until it has a width, and that **first** measure went through `requestAnimationFrame`
— so in a hidden tab it never measured, never laid out, and sat on its "measuring" placeholder
forever. Two browser agents in a row reported the feature as simply broken, with correctly-sized
elements, the right controls, and a completely clean console.

Two things to take from it:

- **Never gate a *first* measure on rAF.** A layout effect already runs after layout and before
  paint, which is exactly when it is safe to read `clientWidth`; the frame buys nothing and costs the
  whole render in a hidden tab. Keep the frame for the *resize* path, where it is genuinely needed —
  `ResizeObserver` fires during layout, and setting state straight from it is the
  "loop completed with undelivered notifications" warning — and where it is safe, because a resize
  implies a visible tab. `src/web/Spine.tsx` still has the old shape.
- **Your diagnostic inherits the bug.** A snippet that resolves a Promise from inside
  `requestAnimationFrame` never resolves in a hidden tab, and the `Runtime.evaluate` behind
  `javascript_tool` then times out after 45 seconds with *"The renderer may be frozen or
  unresponsive"* — which reads like a page problem rather than a tab-visibility one. Write
  hidden-tab probes synchronously, or on `setTimeout` (remembering the 1s clamp above). The timeout
  is, in fact, a positive result: it is rAF telling you it is asleep.

**Keyboard events are a fourth thing, and they are worse than useless — they are *intermittent*.**
Driving `ArrowDown` / `ArrowLeft` through the extension's `computer` tool into a hidden tab on
2026-08-26: a bare `window.addEventListener('keydown', …)` planted in the page logged **zero** events
across ten presses, while the app's aim label moved twice over five presses in the same session —
fewer transitions than presses sent, and then nothing at all. Mouse and pointer events got through
the whole time. So a key-driven check in a hidden tab can produce a result that is neither right nor
wrong but *partly delivered*, which is the one outcome you cannot tell from a genuine failure.

Before trusting any negative from a keypress, count the keydowns:

```js
window.__keys = 0; addEventListener('keydown', () => window.__keys++);   // then press, then read
```

If that counter does not match the number of presses you sent, you have measured the tooling.

**A real wheel event is a third thing, and it works.** Driving the mouse wheel through the extension's
`computer` tool scrolled the page and fired the app's scroll listener — `?at=` updated — in a session
where `window.scrollTo()` and `scrollIntoView()` both silently did nothing. So when you need the page
somewhere specific in order to photograph it, scroll it with the wheel rather than with a script.

Which brings up the sharper trap: **`visibilityState` is a good check, not a reliable one.** In that
same session it read `"hidden"` throughout while `document.hasFocus()` was `true` and successive
screenshots showed live, correctly-updating content. Read it as "hidden means suspect everything";
do not read the converse, and do not take a `"hidden"` reading as proof that what you just saw on
screen wasn't real. Found 2026-08-25, checking the video embed's layout.

**And sometimes a tab is asleep past all of this: no click reaches the page at all.** Twice on
2026-08-26, in two separate sessions, a tab took no real click — not the thing under test, and not a
plain toggle button with no scrolling, no rAF and nothing article-specific in it. `aria-pressed` did
not move. A fresh tab, a resize and a wait all failed to revive it, and a screenshot rendered the
page perfectly while the tab stayed dead, which is the same lie described above. The workarounds
below do not help, because the problem is not the animation — it is that the page is not receiving
events.

So **probe for a live tab before spending a session on one, and probe with frames rather than with
`visibilityState`**, which lies in both directions:

```js
// Frames actually rendered in half a second. 0 means the tab is asleep.
await new Promise((done) => {
  let frames = 0;
  const tick = () => { frames++; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  setTimeout(() => { console.log('[probe] frames', frames); done(); }, 500);
});
```

Then click one control that has nothing to do with what you are testing and check its state changed.
If either says no, stop and say so: "could not test" is a real result and takes a minute, where
working round a dead tab takes half an hour and produces something worse than nothing — a detailed
report about behaviour nobody observed.

**A hidden tab does not scroll smoothly at all — it does not scroll.** Not "it jumps instead of
animating": `window.scrollTo({ behavior: "smooth" })` returns normally and `window.scrollY` is
unchanged a second later, because the animation is driven by the same rendering step. The same is now
true of our own glide ([`scroll.ts`](../../src/web/scroll.ts)), which is rAF-driven for exactly the
reason described there. So **nothing that goes through `scrollToBlock` can be verified in a hidden
tab** — not a gist click, not a spine click, not an arrow keypress
([keyboard.md](keyboard.md)) — and the failure is textbook
[silent success](../reusable/silent-success.md): the call succeeds, the page stays put, and the check
you'd naturally run (`scrollY`) agrees with the code that nothing happened.

Two ways round it, if the tab cannot be made visible:

```js
// 1. Ask for the instant path by claiming the reader wants less motion.
const mm = window.matchMedia.bind(window);
window.matchMedia = (q) => q.includes('reduced-motion') ? { matches: true, media: q, addEventListener(){}, removeEventListener(){} } : mm(q);
// 2. Or bypass the animation entirely and force `behavior: "auto"`.
```

Either verifies *where* a jump lands, which is the part with arithmetic in it. Neither verifies the
animation, so the duration and the easing are eyeball-only.

**Two things here are rAF-coalesced, and they fail differently.** The `?at=` tracker
([url-state.md](url-state.md)) goes stale — annoying, self-correcting the moment you scroll in a real
tab. The spine's re-measure ([granularity-zoom.md § the spine](granularity-zoom.md#the-spine-a-birds-eye-rail)) is
worse: it sizes its bands from measured row heights, so measuring while the rendering step is asleep
gives it wrong proportions, and a wrong-but-plausible rail is exactly the thing a screenshot cannot
tell you about. If the spine looks subtly off, check `document.visibilityState` before you go looking
at `Spine.tsx`.

## The arrow keys, and the thing that makes them hard to check

↑ / ↓ step through the article at whichever level is aimed, and ← / → move that aim across the
columns ([keyboard.md](keyboard.md)). The awkward part for testing is that **the input is
two-handed**: a ↑ / ↓ keypress alone proves nothing, because the aim usually comes from the mouse.
Set the pointer first, then press — and remember that a ← or → *locks* the aim until the pointer
moves again, so a stray `mousemove` between two presses silently changes what the second one means.

Seven checks that between them catch every wiring mistake — and note that **checks 2, 3 and 4 cannot
be done in a hidden tab at all**, because they go through `scrollToBlock` and its glide is rAF-driven
(§ A background tab will lie to you). The aim checks — 1, 6, 7 — need no scrolling and so work
anywhere; if ← / → move the label but ↑ / ↓ move nothing, that is the tab, not the code. Confirm it
with a frame count before believing otherwise:

```js
(() => { let n = 0; const t = () => { n++; requestAnimationFrame(t); }; requestAnimationFrame(t);
  return new Promise(r => setTimeout(() => r(n), 500)); })()   // 0 means the rendering step is asleep
```


1. **Slide the pointer across the columns without pressing anything.** The header underline and the
   `↑↓ …` label in the controls bar should follow it, and they should agree. Over the spine both
   should say *Parts*; over the masthead or the controls bar, *Sections*.
2. **Park in each column and press ↓.** The distance travelled should get shorter as you move right:
   a part, a section, a paragraph.
3. **Scroll to the middle of a section and press ↑.** It should go to the top of *that* section, not
   the one before — then ↑ again leaves it. Then ↓ should put you back exactly where the second ↑
   started. If that round trip doesn't close, the track-skip rule is broken.
4. **Press ↓ twice quickly.** You should advance two items. One item means the chaining in
   `keynav.ts` is measuring mid-flight instead of stepping from its own last target.
5. **Press Back.** As with scrolling, it must leave the page — arrow keys write `?at=` through the
   ordinary position listener and must never push a history entry.
6. **Walk ← to the far left and → to the far right.** The label must reach *Argument* at one end
   and *Paragraphs* (with the `Text` header lit) at the other, and stop rather than wrap. Exactly one
   header lights at a time. This is the check that catches a rung being folded into its neighbour,
   which is what the arc column was doing until 2026-08-26.
7. **Click a bottom-bar mode button with the mouse, then press ← / →.** The *columns* must move and
   the mode must not. Then Tab into that group and press ← / →: now the *mode* must move. One
   behaviour is the article's and the other is the radiogroup's, and the only thing that tells them
   apart is how focus got there ([`Dock.tsx`](../../src/web/Dock.tsx)).

And two negatives worth confirming, because both are silent when wrong: Cmd+↓ should still jump to
the end of the document, and holding a key down should do nothing after the first step (auto-repeat
is dropped on all four arrows). Note that **← / → no longer pan the table** except at the ends of
the ladder, where the key is handed back to the browser
([keyboard.md § what we gave up](keyboard.md#what-we-gave-up)).

## Do not judge colour from a screenshot

This is the one that matters. Of the three display bugs found on 2026-08-24, **two were invisible
by eye and fell straight out of computed values**. A dark palette is very good at hiding a wrong
colour: everything is low-contrast already, so "a bit murky" is indistinguishable from "correct".

Measure instead:

```js
getComputedStyle(el).getPropertyValue('--tint')     // '' means it never arrived
getComputedStyle(el, '::before').backgroundColor    // what the bar actually paints
getComputedStyle(document.documentElement).getPropertyValue('--highlight-wash')
el.getBoundingClientRect()                          // for anything sticky, always
```

Read the *resolved* value, not the declaration. Both traps below declare correctly and resolve
wrong.

**But `backgroundColor` specifically is not trustworthy while the rendering step is asleep.** Found
2026-08-26, checking the summary panel's "you are here" wash: in a tab whose rAF frame count was
zero (§ A background tab will lie to you), `getComputedStyle(el).backgroundColor` on a `.summ-body`
came back transparent — and stayed transparent after setting `background-color: red !important`
inline from JS on that very element. `border` and custom-property reads on the same element were
correct throughout, and a zoomed screenshot showed the real colour painting perfectly. So the rule
above still holds for everything else; for backgrounds in a suspended tab, the screenshot is the
reliable one and the computed value is the liar, which is the exact reverse of the usual advice on
this page. Wake the tab before believing a transparent background.

**And `opacity` is not trustworthy on anything mid-transition.** Found 2026-08-26, checking the
spine's band tooltips. `getComputedStyle(tip).opacity` — and the raw inline `style.opacity` too —
read `"0"` immediately after the hover call returned, *every time*, even after waiting; a screenshot
taken moments later showed the same tooltip fully painted with the right content. The tooltips fade
in through Floating UI's `useTransitionStyles`, so a synchronous read straight after a hover catches
the pre-transition frame. Same shape as the `backgroundColor` trap above and the same conclusion:
for an element that animates in, the screenshot is the reliable one.

## Three traps this codebase has actually hit

Each of these looked right in review and was wrong on the page.

1. **A custom property set on `<col>` never reaches `<td>`.** `<col>` is not a DOM ancestor of a
   cell — a cell's parent is `<tr>` — and custom properties inherit through the DOM tree. Only a
   fixed list (background, border, width, visibility) crosses from column to cell, by a special
   table mechanism that is not inheritance. So `--tint` on `<col class="col-depth-1">` resolves fine
   *on the col* and is empty on every cell. Symptom: every depth bar fell back to `--rule-strong`
   grey and the whole tint system was dead while looking, in the stylesheet, entirely correct.

2. **`color-mix(in oklch, …)` with an achromatic colour drags the hue to 0°.**
   `color-mix(in oklch, #DB8A45 20%, oklch(0.145 0 0))` gives hue **11.7°**, not 58.6° — a
   desaturated pink where an orange was intended. The page colour specifies hue `0` *explicitly*,
   and a present component gets interpolated. Mixing with the `white` keyword doesn't suffer this,
   because converting an achromatic colour to a polar space leaves its hue **missing**, and a
   missing component is carried over from the other colour rather than mixed. Two mixes one line
   apart, one broken and one not, for that reason alone.
   Fix by mixing `in oklab` — same lightness, same chroma, hue preserved — or by writing the
   achromatic colour with `none` for its hue.

3. **`position: sticky` is confined to its containing block, so a 100vw bar in a 100vw parent has
   zero range.** `.controls` is `width: 100vw` with `left: 0`, inside a body that is also the
   viewport width, while the table beneath it is wider. There is nowhere to slide, so the bar
   scrolls away with the document and article text draws over the toolbar strip. The column pins in
   the same stylesheet work because *their* containing block is the table, which is wider than the
   viewport — the identical declaration, a different containing block, the opposite outcome.
   `getBoundingClientRect()` catches it in one call: a bar at `[-97, 903]` in a 1000px viewport is
   not pinned, whatever `position` says. Written up on its own, because it is not specific to this
   project, in [css-sticky-containing-block.md](../reusable/css-sticky-containing-block.md).

`styles.css` also carries three structural constraints that look arbitrary until you've hit the
failure — `border-collapse: separate`, no `overflow-x` wrapper around the table, and the two-axis
sticky bars that follow. They're commented in place; read them before you tidy them.

## Two more, since Tailwind went in

Both are 2026-08-25, and both are in the same family as everything above: valid CSS, correct install,
class present in the DOM.

**A utility that does nothing means the *layer order* is wrong, not that Tailwind failed to install.**
Everything Tailwind emits sits inside a cascade layer, and unlayered declarations beat layered ones
whatever the order and whatever the specificity. `styles.css` is 1,212 lines of descendant rules
covering exactly the elements chrome components go on, so an unlayered `styles.css` outranks every
utility, silently. The guard is the `@import "./styles.css" layer(app)` in
[`src/web/tailwind.css`](../../src/web/tailwind.css)
([web-client.md § Four guards](web-client.md#four-guards-all-in-tailwindcss)). To check it, look at
the emitted CSS, not the page:

```js
// in the dev server, over the served stylesheet text
[...document.styleSheets].flatMap(s => [...s.cssRules]).filter(r => r.constructor.name === 'CSSLayerBlockRule').map(r => r.name)
// 'app' must be there, and it must contain `.controls button` — not sit empty
```

Adding `layer(app)` and finding the page unchanged is *also* what total failure looks like, so check
both halves: that the app rules are inside the layer, **and** that a temporary `tw:px-4` on something
inside `.controls` actually moves it.

**`/?text=0` is where a scanner collision shows.** Tailwind's source scanner is a plain text scan,
so before `prefix(tw)` it generated an `.outline` utility — and `TableView` uses `outline` as a
*mode* class on the `<table>`. The result was a 1px border round the whole table, in a mode you have
to opt into, that reads as a deliberate design choice. Outline mode is not the default view; check
it explicitly, every time styling changes.

Related, and worth knowing before you trust the compiled CSS at all: **`tailwind.css` sets
`source(none)` with one explicit `@source`, because v4 otherwise scans from the project root and
compiles class names out of `docs/`.** While that was happening, seven utilities were shipped that
existed only because a plan document quoted them as examples — and *"the class is in the compiled
CSS"* stopped being evidence that anything worked.

## Where the pinned columns collide, and why 736px

Worth knowing before testing narrow, because it is arithmetic rather than taste. The minimums are
`td.gist` 12rem and `td.text` 34rem, so the pinned left column is 192px and the pinned prose column
544px, whatever the viewport does. Both are pinned to opposite edges, so they overlap once

```
192 + 544 = 736 > viewport
```

Below 736px the two pinned layers are drawn on top of each other. Both carry `z-index: 15`, with no
tiebreak between them, so which one wins is settled by document order rather than by choice — the
prose paints over the gist column. Any deliberate answer here means giving them different z-indices
or stopping one of them pinning.

The practical failure starts well above that: at 860px the two pins take 736 of it, leaving 124px
for two 192px middle columns, so both are almost entirely buried. **The design has no answer below
roughly 900px**, and 700px is comfortably past the point where it stops meaning anything.

*This section is derived from the stylesheet, not observed* — see the tooling caveat below.

## The tab stops running, and the page's own polling is how you find out

**Measured twice, 2026-08-27.** An agent clicked a button, the tab stopped answering every CDP call
(`Script injection timed out`, `Input.dispatchMouseEvent timed out`, `the renderer may be frozen`),
and the obvious reading was that the click handler was blocking the main thread. It was not, and
the server log said so in one line each time:

```
  05:49:01  GET /api/library, GET /api/jobs      the page loads
  05:49:10  GET /api/jobs
  05:49:19  GET /api/jobs
  05:49:28  GET /api/jobs
  05:49:37  GET /api/jobs                        <-- the last one, ever
     …                                           <-- the click, about a minute later
  (no POST /api/uploads, ever)
```

**The page stopped running its own timers before the click, and the request that handler makes
never arrived** — so the handler never executed a line and cannot be the cause. Same signature on
the earlier attempt: polls stop, click minutes later, no request.

So the rule worth having is the diagnostic, not the theory:

> **The app's own polling is a free liveness signal.** `useJobs` asks for `/api/jobs` every eight
> seconds, so a gap in that cadence in the server log is a tab that stopped executing, timestamped
> to the second. Reach for it *before* diagnosing anything as slow code.

**What it is not**, since the first version of this section said so confidently and was wrong: it
is not simply a backgrounded tab. The second attempt was made in a foregrounded tab, kept active
throughout, verified running by two `Date.now()` calls eleven seconds apart, with no other tab
touched. Backgrounding is a real trap — see [§ scroll events in a hidden tab](#scroll-then-read-the-address-bar)
— and it is not the explanation here.

What the two occurrences do have in common is that both followed a **multi-megabyte `file_upload`**
within a minute. That is a correlation on two samples and the mechanism is unknown, so it is
recorded as an observation rather than a cause.

### The control that clears the page, and the recipe that works

Both of those wedged before the app ran anything, so neither says whether the page is sound. This
does: the same 6 MB file put into the same `<input type=file>` **from page JavaScript** — a
`DataTransfer`, then `btn.click()` — went through in about one second, PUT and all. Same size, same
input, same handler, same build. The only difference is how the bytes reached the input and how the
click was delivered.

So when a file has to be more than a megabyte or two, prefer building it in the page:

```js
const bytes = new Uint8Array(6 * 1024 * 1024);
bytes.set(new TextEncoder().encode("%PDF-1.4\n"), 0);
const dt = new DataTransfer();
dt.items.add(new File([bytes], "probe.pdf", { type: "application/pdf" }));
input.files = dt.files;
input.dispatchEvent(new Event("change", { bubbles: true }));
```

It is also faster, needs no screenshots, and lets you spy on `XMLHttpRequest.prototype` to observe
the request's URL and headers directly rather than through the network panel.

**And `file_upload` cannot carry a file over 10 MB at all.** Its own words: *"total upload size
would exceed 10 MB. file_upload sends file contents over the browser bridge in a single message."*
That is the tool, not the page — the bytes never reach the input. Which is the other reason to
build the file in the page: `evals/pdf/harder/source.pdf` at 11.5 MB is unreachable any other way.

**One caution about a long `await` inside `javascript_exec`.** The CDP evaluate has its own 45-second
ceiling, so a poll loop that runs longer than that reports `the renderer may be frozen` about a
perfectly healthy page. Keep the loop under about thirty seconds and call again.

## A browser subagent stalls silently unless the parent does the handshake first

**Measured 2026-08-27, at the cost of an hour.** Two Sonnet subagents were dispatched to check
the upload flow. Both ran for twenty-five minutes and neither reached the app *at all* — not one
request in the dev server's log — and neither said it was stuck.

The cause is a rule in Claude-in-Chrome's own tool description: before any browser action, the
agent must call `list_connected_browsers`, put **every** connected browser to the user as a
question, and then `select_browser`. **A subagent has no user to ask.** So it either loops on that
step or waits on an answer that will never arrive. Nothing errors and nothing times out, which
means from the outside it is indistinguishable from an agent doing careful work.

So the handshake belongs to whoever is talking to Greg:

1. `list_connected_browsers` in the **parent** session.
2. Ask him which one — usually a single question with one real option.
3. `select_browser` with that `deviceId`.
4. *Then* spawn the subagent, and tell it in its prompt: the handshake is done, do not call
   `list_connected_browsers`, `select_browser`, `switch_browser` or `AskUserQuestion`, go straight
   to `tabs_context_mcp`.

And there is a one-line way to tell a stuck agent from a working one, which is worth more than the
fix: **read the server log, not the agent.**

```
grep '"component":"http"' <dev-server log> | tail
```

No requests means it never arrived, whatever it is telling you. That is the same lesson as
[§ Before anything, check the server is actually up](#before-anything-check-the-server-is-actually-up),
one layer along — and it is the [silent-success](../reusable/silent-success.md) pattern with an
agent in it.

## Driving it from an agent

Claude-in-Chrome drives a real, visible Chrome. `resize_window` then `navigate`, and batch the
steps — a `navigate` may reset the window size, so resize *after* it if the width matters.
`javascript_tool` is worth more than another screenshot most of the time: one call can dump every
computed token, class and rect at once, and see § "Do not judge colour from a screenshot" for why
that's not just a speed argument.

**A caveat inherited, not reproduced:** a session working headless reported that a script-scrolled
page screenshots as entirely blank even with correct DOM and layout — suspect the compositor before
the CSS. Six screenshots through a visible Chrome, including after both script and wheel scrolling,
were all correct, so treat this as headless-only until someone sees it otherwise.

**The spine is invisible in a hidden tab, and nothing is wrong.** It measures the table's real
geometry inside `requestAnimationFrame`, and Chrome pauses rAF for a backgrounded tab — so an agent
that navigates and immediately reads the DOM finds an empty `<aside class="spine">`, no bands and no
hit targets, however healthy the article is. Take a screenshot first (which activates the tab), or
check `document.visibilityState` before believing an empty rail. Found 2026-08-25, after a promising
few minutes spent debugging a tree that turned out to be fine.

**A tooling limit worth knowing:** `resize_window` stopped taking effect partway through a session.
It kept reporting success while `innerWidth` stayed pinned at its previous value and `outerWidth`
read 0 — so the window changed and the renderer's viewport did not. Earlier resizes in the same
session had worked. **Always confirm a resize by reading `innerWidth` back**, and treat any
narrow-viewport finding taken without that check as unverified. Anything under 1000px in this repo
is currently untested for that reason.

**And resize *before* you navigate, not after.** A second session hit the same tooling failure from
the other end, 2026-08-26: the page loaded, laid out against a ~99px-tall panel, and the resize that
came afterwards silently did nothing. Every measurement downstream was then taken against a layout
nobody could see, and the summary panel looked like it was refusing to scroll to a deep-linked row
for two full seconds. Nothing about that reading was true. So: resize, read `innerWidth`/
`innerHeight` back, *then* navigate — and if a panel appears to be positioned wrongly, check the
viewport before you check the code.

### A synthetic wheel is not a wheel

`new WheelEvent('wheel', …)` dispatched from JavaScript runs your listeners and **does not scroll
anything**, because scrolling is the browser's own default action and an untrusted event does not get
one. Two consequences, opposite in sign:

- It is the *right* tool for testing a listener — `follow.ts`'s hands-off window and its
  cancel-the-slide bail-out are both listener behaviour, and a synthetic wheel exercises them exactly.
- It is the *wrong* tool for testing anything the scroll itself does. `overscroll-behavior: contain`
  reports as working under a synthetic wheel whether or not the rule exists, because nothing chained
  in the first place. Use real wheel input through the `computer` tool for those. Found 2026-08-26.

The same split applies to clicks, in the other direction: a real click through `computer` can fail to
land, while `new MouseEvent('click', { bubbles: true })` reaches the identical React handler. Prefer
the real one, and reach for the synthetic when the real one will not land — noting which you used,
since they prove different things.

### A focus ring you cannot see, on an element that is genuinely focused

The window an agent drives usually does **not** have focus — `document.hasFocus()` reads `false`
while the tab is plainly the front one and everything else about it works. Two things follow, and
both look like a broken stylesheet:

- Chrome does not paint the focus ring, so a screenshot of a correctly focused control shows nothing.
- `el.matches(':focus-visible')` reads `false`, and `getComputedStyle` therefore returns the
  unfocused values — while `document.activeElement` is the right element the whole time.

Worse, this **changes between calls**: the same check read `fv: true` and then `fv: false` a minute
later in one session on 2026-08-27, because the window had gained and lost focus in between. So a
single reading proves nothing either way. Check `document.hasFocus()` in the same evaluation as the
focus assertion, and if it is `false`, verify the rule some other way — read the declaration out of
the stylesheet, or apply the identical declaration inline and screenshot *that* to check the geometry
(where the ring sits, whether the scroller clips it), which is a picture of the rule rather than a
picture of the ring.

Related, and it bit the same session: **`computer`'s Tab key does not move focus.** The keypress is
synthetic, and focus traversal is a browser default action that an untrusted event does not get — the
same split as § A synthetic wheel is not a wheel. Six Tabs left `document.activeElement` exactly where
it started, which reads as a focus trap in the component rather than as a limit of the tool. Read tab
*order* off the DOM instead: the elements in source order, which is what the browser would follow.

### An animation shorter than your round trip is invisible <a id="short-animation"></a>

An agent driving Chrome cannot see a 200ms animation. Each screenshot or JS evaluation is a round
trip, and the round trip is longer than the animation — so every sample lands either before the
thing starts or after it has finished, and the honest report is "I saw the start state and the end
state". Found on 2026-08-26 while checking the `?note=` arrival glide, where `SCROLL_MS` is 200.

**Do not let that become "it looked fine".** A settled end state with no jump artifacts says the
animation ended in the right place; it says nothing about what it did on the way. Either drive the
animation by hand with the rAF shim below — which is what that section exists for — or say plainly
that the feel was not verified. The second is a perfectly good answer, and much better than the
first done badly.

### Driving a rAF animation by hand

A suspended tab runs no `requestAnimationFrame`, which means an rAF-driven animation cannot simply be
watched — and "it did not move" is what both a broken animation and a sleeping tab look like.

**The 2026-08-27 version of that cost half an hour**, and is worth reading as a warning about how
convincing the wrong diagnosis can get. The profile microphone's level meter
([microphone-level-meter.md](../plans/microphone-level-meter.md)) read a flat zero from an automation
tab, and every check on the way down came back clean: the `AnalyserNode` existed, the `AudioContext`
was `running`, the `MediaStreamTrack` was `live`, unmuted and enabled, and the CSS resolved to the
right resting transform. On that evidence a whole false theory got built — that Chrome's
`SpeechRecognition.start(audioTrack)` takes the track exclusively and starves every other consumer —
and it survived two experiments before a control killed it. The actual answer was
`document.visibilityState === "hidden"`, so `getFloatTimeDomainData` was never called at all.

**Check `document.hidden` before diagnosing anything that moves.** One line, and it comes first:

```js
requestAnimationFrame(() => (window.__fired = true));
// …a moment later
({ hidden: document.hidden, fired: !!window.__fired })
```

A screenshot brings the tab to the front, so taking one is both the check and the fix. It can
still be **driven**: replace `window.requestAnimationFrame` / `cancelAnimationFrame` with a
manually-pumped queue, trigger the thing that starts the animation, and step it with synthetic
timestamps. Used on 2026-08-26 to check that a wheel over the summary panel kills its slide dead
([follow.ts](../../src/web/follow.ts)): pump to the animation's halfway timestamp and watch
`scrollTop` jump, dispatch a real `WheelEvent`, then confirm the pending frame has left the queue and
`scrollTop` is frozen — and that pumping again does nothing, which is what separates *cancelled* from
*paused*. The same shim is how the column sampler was verified
([column-context.md](column-context.md)).
