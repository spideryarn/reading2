# Scrolling rewrote every paragraph in the article, sixty times a minute

**Status:** built and measured, 2026-09-03. Awaiting the second (built-code) GPT Sol review.

Greg asked for lower CPU while scrolling the text. This is what was found, and it is a one-line
cause with a thirty-line fix: **React rewrote the `innerHTML` of all 551 prose blocks on every
`TableView` render, with byte-identical HTML.** A plain scroll did that 34 times. Production main-thread
CPU while scrolling falls **77% → 49% of one core**, and the layout and style recalculation that
dominated it fall to almost nothing.

## The number

A 551-block, 66,123px article (`replication-crisis-spya-hrjamq`), 25 seconds of real wheel events,
**production build** (`vite preview`), two matched runs before and three after.

**Only the first row is CPU.** It is `ThreadTime`, as a percentage of one core. The three below it
come from `ScriptDuration` / `LayoutDuration` / `RecalcStyleDuration`, which Chromium reports as
**wall-clock time inside main-thread tasks** — read them for the shape, never as CPU. This page's
own [§ The last column is not CPU](../project/performance.md#the-last-column-is-not-cpu) says so,
and the first draft of this table got it wrong anyway; GPT Sol caught it.

| | before | after |
|---|---:|---:|
| **main thread CPU**, % of one core | 77.3 / 77.0 | **49.1 / 48.9 / 49.1** |
| script, % of the window | 22.2 | 17.9 |
| **layout**, % of the window | 17.1 | **0.8** |
| **style recalc**, % of the window | 10.6 | **0.9** |
| prose subtrees rebuilt per scroll | **18,734** | **0** |

The run-to-run spread is ±0.3 on both sides — far tighter than the ±20% that
[performance.md](../project/performance.md#render-counts-beat-percentages) warns about, because this
box was quiet and the harness now launches its own Chrome. The effect is 90× the noise.

**Whole-renderer CPU is not here at all.** `ProcessTime` reads 0 under headless Chrome, so
compositor and raster — the threads no main-thread profiler can see — are unmeasured. Every claim
above is about the main thread.

## What was actually happening

`TableView` renders each paragraph with

```tsx
dangerouslySetInnerHTML={{ __html: proseHtml.get(block.id) ?? block.html }}
```

The `proseHtml` memo was already careful — it recomputes only when the marks change, and its
docstring records the earlier fix that made it so. **The string was never the problem. The object
was.**

React decides a prop changed by identity (`react-dom` § `updateProperties`, the `!==` at
`react-dom-client.development.js:21007`), and for `dangerouslySetInnerHTML` the value it compares is
the `{ __html: … }` wrapper. An object literal in JSX is a new object on every render, so the prop
is *always* "changed" — and `setProp` then runs

```js
domElement.innerHTML = key;   // line 20419, unconditional
```

with **no comparison against what is already in the element**. Writing the identical string still
destroys the paragraph's DOM and rebuilds it.

So every `TableView` render tore down and rebuilt all 551 paragraphs. That invalidates layout and
style for the whole document, which is why a 66,000px article spent more of its scroll in layout and
style than in script.

`TableView` re-renders ~34 times during a scroll because `useReadingPosition` writes `?at=` as
sections pass the reading line — a deliberate feature ([url-state.md](../project/url-state.md)), and
[performance.md](../project/performance.md) already names it as the largest remaining cause of those
renders. **The fix does not touch that.** It makes each of those renders nearly free instead of
arguing with the feature.

## The fix

The memo now hands out `{ __html }` **objects** rather than strings, one for **every** block, and
reuses the previous object whenever the html is unchanged. React then sees the same object and skips
the paragraph entirely.

Two details are load-bearing, and both are commented in the file:

- **Every block gets an entry**, not just the marked minority the old map held. A block missing from
  the map would fall back to a literal in the JSX and quietly get the old behaviour back — for that
  block only, which is exactly the kind of partial regression nothing would notice.
- **Entries survive a recompute.** When one comment arrives the memo re-runs for all 551 blocks, but
  only blocks whose html genuinely changed get new objects. So a streaming answer now rewrites the
  paragraphs it touches instead of the whole article — the **DOM half** of the first item on
  [performance.md § Still open](../project/performance.md#still-open-ranked-with-citations), as a
  side effect rather than on purpose. The rest of that item stands: every delta still re-resolves
  every anchor and rebuilds the whole HTML map, and that O(article) computation is untouched here.

The cache is a `useRef` written during render. That is safe *here* specifically because it is keyed
on value equality: every reuse is an object whose `__html` is `===` the string just computed, so a
double-invoked or abandoned render can only ever hand back something identical, and nothing reads it
for correctness.

## The simpler option that was passed over

**Render fewer times** — stop `useReadingPosition` re-rendering `TableView`, which is what the
ranked open list points at (item 4, "zero DOM reads per frame"). It was passed over because it is
strictly harder and strictly less effective: it fights a deliberate feature, GPT Sol's note on it
warns that a naive offset cache goes stale on a late image or a font swap and *points at the wrong
section*, and even a perfect version leaves each remaining render rebuilding the article. Making the
renders cheap is orthogonal to making them rarer, and it is the half with no correctness risk.

## How it was found, which matters more than the fix

Three instruments, in order, and the first two are new:

1. **A sampling profiler in `measure-cpu.ts`** (`--cpu-profile`). The existing script could say
   *how much* script/layout/style, never *which function*. It named one rAF callback at 36% of
   script self time — which turned out to be a forced layout, not the callback's own work.
2. **A production measurement at all.** `--local-sign-in` signs in by importing the app's own
   Supabase module, which only a dev server serves, so *nothing here had ever been measured on a
   production build* — a standing open item. `--sign-in-via` now carries the SDK's own stored token
   to another origin, and that changed the priorities completely: dev-mode React
   (`jsxDEV`, `validateProperty`) is ~half of script in dev and gone in production, where
   **layout + style (28%) exceeded script (22%)**. Optimising against the dev profile would have
   sent me after React re-renders, which is the wrong half.
3. **A DOM mutation census in the live page**, via Playwright — count every mutation during a
   scroll, grouped. That is what produced `childList in div.prose (+1/-1) × 18,734` and ended the
   guessing. 18,734 / 551 = 34.0 exactly, which is what turned a suspicious number into a
   mechanism.

The wrong turn worth recording: the profile's hottest frame was `apply` in
[`scroll.ts`](../../src/web/scroll.ts) at 36%, and the tempting read was "`watchBarVisibility` is
expensive". It is not. Its self time is a **forced synchronous layout** charged to whichever
function first reads `window.scrollY` after something dirtied the DOM — it was the *victim*, and
moving that read would have moved the cost, not removed it. The layout was expensive because the
article had just been rebuilt. Fixing the real cause dropped `LayoutDuration` from 17.1% to 0.8%
without touching `scroll.ts` at all.

## Also fixed here

`measure-cpu.ts` hardcoded the macOS Chrome path, so the whole instrument was unrunnable on the
remote box — where there is exactly one browser and it lives at `/usr/bin/google-chrome-stable`. It
now picks by platform, honours `SPIDERYARN_CHROME`, and goes headless when there is no `DISPLAY`
(with `--display :99` to force the box's X server, since a genuinely visible tab is the one thing
[performance.md](../project/performance.md) keeps failing to obtain).

## What is not done

- **The `?at=` re-render itself.** Still ~34 renders per scroll; each is now cheap.
- **`window.scrollY` is still read per frame by several independent rAF callbacks**
  (`scroll.ts`, `Spine.tsx`, `useColumnContext.ts`, `App.tsx`). With the article no longer being
  rebuilt these are mostly free, but the first read after any DOM write still forces a layout. A
  single shared per-frame reader would make that structural rather than incidental.
- **`ProcessTime` reads 0 under headless Chrome**, so the whole-renderer figure — compositor and
  raster, the threads no main-thread profiler can see — is unavailable on the box. Every number
  above is main-thread only. GPT Sol's route out, untried: `SystemInfo.getProcessInfo` on the
  **browser-level** CDP socket reports a cumulative `cpuTime` per process across all its threads, so
  differencing it over the window and summing the renderer processes would give the total this
  script used to get from `ProcessTime`. In a one-tab Chrome that covers the top renderer and any
  out-of-process iframes.

## The review

GPT Sol reviewed the built code
([the answer](260903l-prose-innerhtml-rewritten-on-every-scroll-render-review-sol.md)) and **verified
the React mechanism in the production bundle**, which was the claim most worth checking — I had read
only the development source, while every number here comes from a production build. It also cleared
the two things I was most worried about, with citations rather than reasoning: `markReturnPath` and
`TAP_ATTR` both have effect cleanups, so nothing was relying on the DOM churn to clear state, and
the change is if anything *better* for the hover card — an unrelated render no longer destroys the
element it is anchored to.

It found four real problems, all fixed here rather than filed:

1. **`--sign-in-via` was not fenced to localhost.** `seed-local-session.ts` guards `SUPABASE_URL`
   and nothing else, so `--url https://elsewhere/` would have copied a live bearer token into a
   stranger's `localStorage` and then run their JavaScript. Both origins are now checked, the copy
   names `spideryarn.lastUser` instead of sweeping the namespace, and the fixed 1.5s wait — which
   could expire early and write the token back into the origin it came from — is now a poll on
   `location.origin`.
2. **The profile's `src/` vs `node_modules` split is a dev-server fact.** A production bundle is one
   `/assets/main-*.js` and a raw CDP profile is not source-map-resolved, so it read "0% in src/"
   regardless of what was hot. It now says so instead of printing a meaningless number.
3. **`--cpu-profile --scroll` wrote the profile to a file called `--scroll`**, and still scrolled,
   so the only symptom was a strangely-named file.
4. **Four claims in these docs were false or overstated** — including this table calling
   `LayoutDuration` a percentage of a core, which is the exact error
   [performance.md § The last column is not CPU](../project/performance.md#the-last-column-is-not-cpu)
   was written to prevent. Fixed above.

It was explicit about what it took on trust: the code paths and the arithmetic it verified, the
77→49 figures it did not, having been given no raw run output. That is the right thing to have been
told.
