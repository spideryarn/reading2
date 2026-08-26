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

## The URLs and widths worth checking

The view has two modes and the second is easy to forget:

| URL | What you're looking at |
|---|---|
| `/` | reading mode: `Article L0 │ Parts L1 │ Sections L2 │ Text verbatim` |
| `/?text=0` | **outline mode** — rows collapse to natural height and the same table becomes a whole-article ToC. A leaf column of navLabels appears *here and only here*, styled by `.nav-label`. Check accents separately; it is visually a different page |
| `/?at=spya-k6fpme` | deep link, opens scrolled to that section — [block-ids.md](block-ids.md), [url-state.md](url-state.md) |
| `/#spya-k6fpme` | the old spelling. Should *rewrite itself* to `?at=` before the page paints; if you ever see the hash survive in the address bar, the migration in `main.tsx` broke |
| `/?cols=0,1&text=1` | an explicit column choice, which pins the columns and takes them off auto-fit |
| `/?spine=0` | the rail hidden by hand. Check the article **reflows into the reclaimed 208px** rather than leaving a gutter, and that the corner wordmark clears the controls bar — that padding compensation is the one thing `--spine-w: 0` is load-bearing for ([HomeLogo.tsx](../../src/web/HomeLogo.tsx)) |
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

A screenshot does **not** count as making the tab visible — the extension can capture a hidden tab
perfectly well, so you get a correct-looking picture of a page whose event loop is asleep. Check
`document.visibilityState` before believing a negative result.

What still works in a hidden tab, and is therefore what to test there: anything driven by a direct
call rather than by the rendering step — a fresh page load, a reload, `history.back()`, and clicking a
control. That is enough to cover URL→page restore, the legacy-hash rewrite, and the history
semantics. Continuous scroll→URL needs a genuinely visible tab.

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
6. **Walk ← to the far left and → to the far right.** The label must reach *The argument* at one end
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
