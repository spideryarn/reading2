# Testing it in a browser, with Playwright

[browser-testing.md](browser-testing.md) is **what to look at** — the URLs, the widths, the checks
worth running, and the many ways the eye lies to you. Almost all of it is true whatever is driving
the page. But its recipes are written in the Claude-in-Chrome extension's tools, because that is what
you have on Greg's laptop, and **the extension cannot follow you to the remote box**
([browser-control.md](browser-control.md)). This page is the other half: the same checks in
Playwright, and — more usefully — which of that doc's traps stop existing when you drive a headless
Chrome you own instead of Greg's visible one.

The Playwright API itself is not here. It is in
[playwright-browser-control.md](../reusable/playwright-browser-control.md): locators, auto-waiting,
screenshots, console and network capture, and the trap that the action timeout is 0 rather than 30
seconds. Read that for the how; read this for what is different *about this app on that box*.

## The skeleton

System Chrome, named explicitly. A bare `chromium.launch()` asks for Playwright's bundled build,
which provisioning no longer downloads — [browser-control.md](browser-control.md#on-the-remote-box)
has the whole story, including the 651MB of stale cache that a rebuild will not clear.

```js
import { chromium } from "playwright-core";       // a pinned devDependency of this repo

const browser = await chromium.launch({ headless: true, executablePath: "/usr/bin/google-chrome-stable" });
const ctx = await browser.newContext({ viewport: { width: 1000, height: 900 } });
const page = await ctx.newPage();
await page.goto("http://localhost:5273/?at=spya-k6fpme", { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => document.querySelector("aside.spine"));   // not a sleep
```

Two of `browser-testing.md`'s opening checks still apply exactly as written, and they are the ones
most likely to waste your afternoon: **the dev server must actually be up**, and **it may not be on
5273**, because `npm run dev` moves silently to 5274 when another agent in this tree already has it
— [§ check the port](browser-testing.md#and-check-the-port-not-just-the-server). And **a status code
is not the check here**: the dev server is an SPA fallback, so a path that does not exist still
answers 200 with a perfectly good shell — verified on `/definitely-not-a-real-path-zzz`. Wait for
something only the real page has, as the skeleton does.

**Say `localhost`, never `127.0.0.1`.** Vite binds `[::1]` only, and this box resolves `localhost`
IPv6-first, so `localhost:5273` works while `http://127.0.0.1:5273/` is refused outright — measured
2026-09-02. Anything that forces IPv4 gets a connection error that reads as "the server is down".

### In a worktree, 5273 is somebody else's server

5273 belongs to the **primary checkout**. A browser check run from a worktree against it exercises
none of that worktree's changes — not the client, because the primary's vite deliberately excludes
`.claude/worktrees/**` from its watcher and serves its own files, and not the server, because the API
middleware was imported when the primary booted. It returns a perfectly good `ok`.

This is not hypothetical: on 2026-09-02 **no worktree on this box was running a dev server at all**,
so every browser check ever run from one had tested the primary. `scripts/browser-sign-in.ts` now
refuses to default from inside a worktree rather than doing that quietly. Start your own server and
name it:

```bash
npm run dev                                                    # prints the port it took
SPIDERYARN_BASE_URL=http://localhost:<port> npx tsx scripts/browser-sign-in.ts
```

`SPIDERYARN_BASE_URL` is the one knob, and it is read from the environment only — nothing loads
`.env.local` for it.

## Signing in

Every route past the gate needs a session (src/auth.ts), so the skeleton above can look at the
landing page and very little else. This is the rest of it, and it needs no human:

```js
import { signedInBrowser } from "./scripts/browser-sign-in.ts";   // tsx, from the repo root

const { browser, page, who } = await signedInBrowser();
//   → signed in as dev-admin@spideryarn.local in 1728ms, GET /api/library → 200
await page.goto("http://localhost:5273/read/fowler-phrenology", { waitUntil: "domcontentloaded" });
```

Or as a check on its own, which is the quickest way to find out whether this machine is ready:

```
npx tsx scripts/browser-sign-in.ts --at /read/fowler-phrenology --shot /tmp/x.png
```

**The credential is already on the machine.** `npm run db:seed-owner` writes
`dev-admin@spideryarn.local` with a password generated per machine into
`~/.config/spideryarn/local-admin-password`, and `npm run db:admin-password` prints it — no Google,
no dashboard —
[supabase-local.md § Signing in](supabase-local.md#signing-in-with-no-google-and-no-browser-you-cannot-reach).

Three things about it are worth knowing before you write your own:

- **It types into the real form** rather than writing a session into `localStorage`. The SDK's
  storage shape is a private detail that has changed between versions, so guessing it gives you a
  browser that looks signed in to us and is signed out to the app — the
  [silent-success](../reusable/silent-success.md) pattern with a login on it.
  [`scripts/seed-local-session.ts`](../../scripts/seed-local-session.ts) wrote that down first, and
  its magic-link route is still the right shape for a browser you did not launch.
- **It waits for the server, not for a rendered shelf**, and asks it three things: that `GET
  /api/library` answered 200, that the body is really the shelf (a 200 alone is satisfied by the dev
  server's SPA fallback), and that the password grant's own token carries the `sub` in
  `src/admin.ts`. That last one is the difference between *"a session got in"* and *"this session is
  Greg's"* — the first version printed the second sentence having checked only the first.
- **`--at` asks the same question of the page you opened.** It fails on any failing `/api/` call,
  because `--at /read/a-slug-that-does-not-exist` renders `NotSharedPage`, which has a `<main>`, a
  title, and a perfectly successful `/api/jobs` next to a 404 on the article. Waiting for a landmark
  said `ok` to that.
- **A wrong password is reported in a second, not in thirty.** The form's own `role="alert"` is
  raced against the success, so `Invalid login credentials` comes back as itself rather than as a
  timeout on a response that was never coming. If you see it, the account and the password file have
  drifted: `npm run db:seed-owner` sets it and says what it did.

**Signing in shows you an empty shelf unless `SPIDERYARN_OWNER_ID` is set** to the id in
`src/admin.ts`. Everything the CLI and the pipeline ingest belongs to a row-owner nobody signs in
as, and nothing about that looks wrong — the ingest succeeds and the library is simply empty.
`npm run setup` says which state the machine is in; the fix, and the row move an existing database
needs first, are
[supabase-local.md § One shelf](supabase-local.md#one-shelf-and-how-to-get-there).

## The translation

| browser-testing.md says | On Playwright |
|---|---|
| `navigate` | `page.goto(url)` — and it does **not** reset the viewport, so the resize-after-navigate dance is unnecessary |
| `resize_window` | `ctx` `viewport` option, or `page.setViewportSize()` |
| `find` then click the reference | `page.getByRole(...)`, `getByText(...)` — locators are references, so this is the only way |
| `computer.click` / `computer.hover` at a coordinate | `locator.click()` / `locator.hover()`; `page.mouse` only when you truly mean a coordinate |
| real wheel input through `computer` | `page.mouse.wheel(0, 900)` — a trusted event; see below |
| `javascript_tool` | `page.evaluate()` |
| taking a screenshot to wake a tab up | not a thing; see below |

## The traps that go away

Measured on the box on 2026-09-01, headless Chrome 152 through `playwright-core` 1.62.1. Each of
these is a section of `browser-testing.md` that does not apply here.

- **[A background tab will lie to you about scrolling](browser-testing.md#a-background-tab-will-lie-to-you-about-scrolling)
  — gone, and with it the largest trap in that doc.** Every page in a Playwright context reads
  `document.visibilityState === "visible"` and `document.hasFocus() === true` **whether or not it is
  frontmost**, and `bringToFront()` changes nothing measurable. Two pages in one context, the second
  never raised: both fired their scroll event on `scrollTo`, both ran ~73 rAF ticks in 1.2s (i.e.
  60fps), and both had a 50ms `setTimeout` fire at 51ms rather than being clamped to a second. So the
  rAF-coalesced `?at=` tracker, the spine re-measure, and everything hanging off `useAudioLevel`'s
  `quiet` flag all run in a page you are not looking at. There is nothing to raise and no reason to.
- **[An occluded window captures as solid black](browser-testing.md#an-occluded-window-captures-as-solid-black-and-you-cannot-raise-it)
  — gone.** Headless has no window to occlude, and no compositor to give up. A screenshot of a
  non-frontmost page captured a live change: the banner text was edited between two shots and the
  PNG hashes differ (`64fcbbe7fce0` → `800f1441815a`).
- **[Click by reference, not by pixel](browser-testing.md#click-by-reference-not-by-pixel) — the
  reason is gone, the advice survives on its own merits.** There is no screenshot-to-CSS-pixel
  scaling factor here to be 6% or 52% wrong, because you never supply a coordinate: a locator is a
  reference. The part that still bites is the last paragraph of that section —
  `elementFromPoint` must be given the position the page actually saw, and that is true in any
  browser.
- **`resize_window` reporting success while doing nothing — gone.** `setViewportSize` was read back
  at exactly what was asked, 700×757 and then 1300×1000, in the same session. Read it back anyway.
- **[A phone-width window does not exist, so use an iframe](browser-testing.md#a-phone-width-window-does-not-exist-so-use-an-iframe)
  — gone.** That 605px floor is macOS Chrome refusing to make a *window* smaller. A headless viewport
  has no such floor: 390×844 was granted exactly, and `(max-width: 400px)` matched. For touch, set
  `hasTouch: true` on the context and `(pointer: coarse)` matches — **but `"ontouchstart" in window`
  is still `false`** (`maxTouchPoints` is 1), so a feature-detect written that way will not see it.
  Check the media query, which is what the stylesheet uses anyway.
- **[There is no `file://` shortcut — serve it](browser-testing.md#there-is-no-file-shortcut-serve-it)
  — gone.** That is the extension refusing the scheme. `page.goto("file:///…")` returned 200 and read
  the heading back. This is the one that matters for
  [write-tutorial.md](../reusable/write-tutorial.md): checking a tutorial's diagrams on the box needs
  no local web server.
- **`computer`'s Tab key not moving focus — gone.** `keyboard.press("Tab")` moved `activeElement`
  from the input to the button, and the newly-focused element matched `:focus-visible` — so the
  keyboard-navigation checks in
  [§ a focus ring you cannot see](browser-testing.md#a-focus-ring-you-cannot-see-on-an-element-that-is-genuinely-focused)
  can be done by asserting on the selector, which is better evidence than a screenshot of a ring.
- **[A synthetic wheel is not a wheel](browser-testing.md#a-synthetic-wheel-is-not-a-wheel) — you
  get both halves.** `page.mouse.wheel(0, 900)` is a trusted input event, so it does what a hand
  does: one `wheel` listener call, one `scroll` event, `scrollY` at 900. Keep dispatching a synthetic
  `WheelEvent` from `page.evaluate` when what you mean to test is the listener, exactly as that
  section says — the split it describes is real here too, you just have both tools in one place.
- **[Work in your own tab](browser-testing.md#work-in-your-own-tab) — free.** A `newContext` is its
  own profile and its own cookies. No other agent's stray auto-scrolling tab can reach it.

## The traps that stay

- **A browser that renders nothing still produces a perfectly valid screenshot.** Right magic bytes,
  right dimensions, every time, on both mechanisms. Assert on something that *changed* —
  [browser-control.md § the trap both halves share](browser-control.md#the-trap-both-halves-share),
  and [silent-success.md](../reusable/silent-success.md). While writing this page a first draft of
  the probe "proved" a screenshot was live by comparing two PNGs that were identical for a good
  reason, and reported a pass.
- **[Do not judge colour from a screenshot](browser-testing.md#do-not-judge-colour-from-a-screenshot).**
  Unchanged, because the reason is unchanged: read the computed value.
  `getComputedStyle(...).backgroundColor` returns `oklch(0.145 0 0)` as authored.
- **[An animation shorter than your round trip is invisible](browser-testing.md#short-animation).**
  A round trip over CDP is still a round trip. Drive the animation by hand, as that section says.
- **Everything about what the reading view should look like** — the URLs, the widths, the 736px
  collision, the three traps this codebase has actually hit. That is the whole point of the other
  doc and none of it is mechanism-specific.
- **`page.evaluate` throws `ReferenceError: __name is not defined`, and it is `tsx`, not you.**
  esbuild compiles with `keepNames`, which wraps every function it can see in a `__name(fn, "…")`
  helper it defines at the top of the *module* — and the function you hand `evaluate` is serialised
  and run in the page, where that helper does not exist. It fires on the first `evaluate` containing
  any named function, including a `const f = () => …`, and the error names nothing you wrote. One
  line, before you sign in:

  ```js
  await context.addInitScript({ content: "globalThis.__name = globalThis.__name || ((f) => f);" });
  ```

  `addInitScript` with a **`content` string**, not a function, or the helper's own body goes through
  the same compiler and needs what it is defining.

### Two that make a check pass for nothing

Both found on 2026-09-10 while checking the fleet dashboard against fixtures served by `page.route`
([260910c](../plans/260910c-session-continuity-protect-drafts-and-keep-context-current.md), Stage 5).

- **`context.setOffline(true)` does not touch a request `page.route` answers.** A route that calls
  `route.fulfill()` bypasses Playwright's network layer entirely, so "going offline" changes nothing
  and the page goes on receiving its fixtures — a check for the offline banner then fails, or worse,
  a check for recovery passes having never been offline. Drive the outage from the handler instead:
  have it call `route.abort()` while a flag is set, and clear the flag to come back.
- **A scripted `.focus()` does not trigger `:focus-visible`.** Chrome's heuristic shows the focus
  ring, and opens anything keyed on it such as a focus-driven tooltip, only for keyboard focus. A
  test that calls `element.focus()` and looks for the ring or the tooltip sees neither and reports a
  defect that is not there. Press `Tab` to reach the element (`page.keyboard.press("Tab")`) when the
  question is what a keyboard user sees.

### Under `isMobile: true`, three things lie to you

All three cost a browser pass an hour on 2026-09-03, checking the glossary card at 390×844
([260903l](../plans/260903l-glossary-underlines-in-every-mode-and-the-touch-card-that-closed-itself.md)).

- **`window.innerWidth` misreports** — 423 for a 390px viewport, on the reading view.
  `document.documentElement.clientWidth` and `visualViewport.width` are right. Anything branching on
  the window's own width is measuring the emulator.
- **Raw `page.touchscreen.tap(x, y)` and `page.mouse.move(x, y)` land somewhere else**, with a large
  non-uniform vertical offset between the coordinates you pass and the `clientY` the page receives —
  confirmed by comparing `elementFromPoint` against the delivered event. `locator.tap()` and
  `locator.hover()` resolve coordinates correctly; **coordinate pairs do not**. When you need the
  exact event sequence rather than the gesture, dispatch synthetic `pointerdown`/`pointerup` on the
  element, as `tests/hover-card-touch.test.tsx` does.
- **`locator.tap()` scrolls first, and this app's prose re-renders when it does.**
  `scrollIntoViewIfNeeded` — and a bare `element.scrollIntoView()` — swaps a row in and out of
  `.prose` about 300–400ms later, which correctly trips `useHoverCard`'s "the anchor left the
  document" guard and closes any open card. So a naive tap-then-assert reports a false negative on a
  feature that works. Separate *scroll and let it settle* from *then tap*.

  Whether a reader who scrolls and immediately taps hits the same thing is **an open question nobody
  has chased**; it reproduced 5s after page settle, which is longer than it should need.

## The insets are zero here, and a phone's are not

`index.html` carries `viewport-fit=cover`, so on a phone the document runs under the notch and the
home indicator and every piece of fixed or sticky chrome adds back the edge it faces. The four
`env(safe-area-inset-*)` tokens are **`0px` on this box, in headless Chrome, and in every screenshot
anyone has ever taken of this app** — so any rule that reads one has a term that is always the
identity here, and a rule that should read one and does not looks perfect.

That is not hypothetical: it cost the mode band its top edge for six days, and no screenshot from
this box showed it —
[260903f](../postmortems/260903f-the-mode-band-stopped-short-of-the-notch.md).

**[`scripts/safe-area-check.ts`](../../scripts/safe-area-check.ts)** is the check. It injects the
insets as an *unlayered* rule (styles.css lives inside `@layer app`, so unlayered wins whatever the
specificity — that is the only reason four lines can stand in for a device), opens every band mode
on a 390 × 844 touch context, and walks `elementsFromPoint` down the screen asking *is the top-most
thing here the article?* — painted, not geometric, because in that bug every box was the right size.

```
npm run dev                                    # read the port off Vite's own line
SPIDERYARN_BASE_URL=http://localhost:<port> npx tsx scripts/safe-area-check.ts
SPIDERYARN_BASE_URL=http://localhost:<port> npx tsx scripts/safe-area-check.ts --break
```

**Run the second one too.** Nothing on this box can make this check fail on its own — that is the
whole point of it — so `--break` switches the defect back on and it must print FAIL and exit 1.
[silent-success.md](../reusable/silent-success.md).

Run it when you touch [`styles/narrow-window.css`](../../src/web/styles/narrow-window.css)
§ a narrow window, § a band with no room, § a small device, or
any rule naming a `--safe-*` token. Exit code 1 on a leak. `--top`, `--bottom`, `--width`,
`--height`, `--modes`, `--scroll` and `--shots` are all flags; the defaults are an installed iPhone,
scrolled, so the article is genuinely moving behind the panel.

It samples a **settled** page, so it says nothing about the frames just after a mode opens — the
other half of that bug was a 450ms window in which the bars had not arrived yet, and it was found
by reasoning about the CSS rather than by any harness.

## What this page has not checked

The measurements above are browser mechanics, taken against synthetic pages and the app's landing
page. **The reading view was driven on 2026-09-01** — signed in, `/read/fowler-phrenology`, spine
and dock and prose all on screen — so the sentence that used to be here, saying it had not been, is
gone. What was checked is that it renders; the `?at=` recipes and the scroll and spine measurements
in [browser-testing.md](browser-testing.md) have still not been run on this mechanism.

Also untested: headed Chrome over noVNC, where the visibility findings above may well go back to
behaving like the laptop, since then there is a real window again.

---

Up: [code-quality-overview.md](code-quality-overview.md)
