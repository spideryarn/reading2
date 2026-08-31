# Driving a browser with Playwright

A cheatsheet for **controlling a real browser from a script** — open a page, click things, read
state back — aimed at an agent that cannot see the screen and has to work from artefacts.

**Playwright is not installed in this repo**, and nothing here is a description of our setup. Browser
work here goes through the Chrome extension —
[browser-testing.md](../project/browser-testing.md) is the doc that matters for that, and
[claude-in-chrome.md](../project/claude-in-chrome.md) is where to start when the extension is not
connected. This file exists so that the day someone wants scripted, repeatable browser control, the
research is already done and the traps are already written down.

Researched 2026-08-31 against `playwright@1.62.1` and `@playwright/mcp@0.0.79`, from
[playwright.dev](https://playwright.dev) plus issue trackers. Claims are marked where the source is a
blog or a GitHub issue rather than the official docs. **Run `npx playwright --version` and check the
option you care about before trusting any default below** — the defaults have moved, and one of them
moved in a direction most of the internet has not caught up with (see
[The action timeout is 0, not 30 seconds](#the-action-timeout-is-0-not-30-seconds)).

## The two Playwrights

Same browser drivers, two packages, and picking the wrong one costs an afternoon.

| | `playwright` | `@playwright/test` |
|---|---|---|
| What it is | a library you call | a test runner with fixtures |
| Import | `import { chromium } from "playwright"` | `import { test, expect } from "@playwright/test"` |
| Setup | you call `launch` / `newContext` / `newPage` | injected as `{ page }` |
| Assertions | bring your own | auto-retrying `expect()` |
| Run with | `tsx script.ts` | `npx playwright test` |

The docs push everyone at `@playwright/test`, and for a test suite they are right. **For ad-hoc
control — one script, written now, thrown away after — the bare library is the better fit**: no
config file, no test file, no runner, and it runs under `tsx` like everything else here.

The catch is that `expect()`'s auto-retrying assertions live in `@playwright/test`, and they are the
single most useful thing in the whole product (see
[Assert, don't read](#assert-dont-read)). Installing both and importing `expect` alone is
allowed and is what you usually want.

```bash
npm i -D playwright @playwright/test
npx playwright install chromium        # downloads the browser binary, once
```

## The whole thing, in one script

```ts
import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
page.on("console", (m) => console.log(`[console:${m.type()}]`, m.text()));
page.on("pageerror", (e) => console.log("[pageerror]", e.message));

await page.goto("http://localhost:5273/");
await page.getByRole("button", { name: "Sign in" }).click();
await page.screenshot({ path: "/tmp/step.png", fullPage: true, animations: "disabled" });

await browser.close();
```

Top-level `await` works under `tsx`, so the `(async () => {})()` wrapper every blog post uses is
not needed.

**Browser → context → page.** A `Browser` is one process; a `BrowserContext` is an isolated
session with its own cookies and storage, like an incognito profile; a `Page` is a tab. `newPage()`
on the browser makes a context implicitly. Anything that needs its own login, viewport or storage
gets its own context.

## Locators, not handles

A locator is a *description* of how to find an element. It resolves nothing until you act on it, and
it **re-queries the DOM on every retry** — so it survives a React re-render. The old
`page.$()` / `ElementHandle` API pins a node the moment you fetch it and goes quietly stale the next
time the component re-mounts. Use locators.

```ts
page.getByRole("button", { name: "Sign in" });   // prefer: matches how a person finds it
page.getByLabel("Password");
page.getByPlaceholder("name@example.com");
page.getByText("Welcome", { exact: true });
page.getByTestId("directions");                  // data-testid by default
page.locator(".card");                           // CSS — last resort, tied to markup
```

Chain and narrow rather than reaching for an index:

```ts
page.getByRole("listitem")
  .filter({ hasText: "Product 2" })
  .getByRole("button", { name: "Add to cart" });

page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: "X" }) });
page.getByRole("listitem").filter({ hasNotText: "Out of stock" });
page.locator("button").first();                  // works, but breaks when order changes
```

Built-in locators pierce **open** shadow roots automatically. XPath does not, and closed shadow roots
are not supported at all.

### Strict mode is the feature, not the error

An action on a locator matching more than one element **throws immediately** — no retry, no timeout:

```
strict mode violation: locator('button') resolved to 3 elements
```

The reflex is `.first()`. Resist it: it makes the script depend on DOM order, so it passes today and
clicks the wrong button next week. The fix is a locator that describes the one element you meant.

## Actions

```ts
await loc.click();                       // { button: "right" }, { modifiers: ["Shift"] },
                                         // { position: { x, y } }, { force: true }
await loc.dblclick();
await loc.fill("Peter");                 // sets the value in one go — the normal case
await loc.pressSequentially("Hello");    // real per-character keys, for autocompletes etc.
await loc.press("Enter");                // or "Control+ArrowRight"
await loc.check(); await loc.uncheck();
await loc.selectOption("blue");          // or { label: "Blue" }, or ["red", "green"]
await loc.hover();
await loc.dragTo(page.locator("#drop"));
await loc.setInputFiles("/path/file.pdf");           // [] to clear
await loc.setInputFiles({ name: "a.txt", mimeType: "text/plain", buffer: buf });
await loc.focus();
await loc.scrollIntoViewIfNeeded();      // rarely needed; actions auto-scroll
```

`type()` is deprecated — `fill()` for the normal case, `pressSequentially()` when the page listens
to individual keystrokes.

### What auto-waiting covers, and what it does not

Before most actions Playwright waits for the element to be **attached**, **visible**, **stable**
(bounding box unchanged for two animation frames), **receiving events** (it is the real hit target,
not covered by an overlay), **enabled**, and for `fill` also **editable**.

That list is the whole guarantee. It says nothing about your application. It does **not** wait for a
fetch to come back, for a store to settle, for a spinner to go away, or for anything the app calls
"ready". An element can be attached, visible, stable and enabled while the click handler that gives
it meaning has not been bound yet. See
[goto resolves before the app is alive](#goto-resolves-before-the-app-is-alive).

`{ force: true }` skips these checks. It is occasionally correct and usually a sign you are fighting
the page instead of describing what a person would do.

## Assert, don't read

```ts
import { expect } from "@playwright/test";

await expect(page.getByTestId("status")).toHaveText("Submitted");
await expect(page.getByRole("alert")).toBeVisible();
await expect(page.locator("li")).toHaveCount(5);
await expect(page).toHaveURL(/checkout/);
```

These **poll** until the condition holds or the assertion timeout expires. That is the difference
that removes most waiting code from a script.

The trap is the obvious-looking alternative:

```ts
const text = await loc.textContent();   // one snapshot, taken now
expect(text).toBe("Submitted");         // zero retries
```

That reads the DOM once. If the update lands ten milliseconds later the script fails, and it fails
intermittently, which is worse than failing. **Assert on the locator, not on a value you pulled out
of it.**

For anything that is not a DOM assertion, `expect.poll` gives the same retrying behaviour:

```ts
await expect.poll(async () => (await page.request.get("/api/status")).status(),
  { timeout: 10_000 }).toBe(200);
```

## Waiting, when you really must

```ts
await page.waitForURL("**/login");
await page.waitForLoadState("domcontentloaded");   // "load" | "domcontentloaded" | "networkidle"
await page.waitForFunction(() => window.myApp?.ready === true);
await page.locator(".status").waitFor({ state: "visible" });
```

- `page.waitForSelector()` is **deprecated** — `locator.waitFor()` replaces it, and returns nothing
  stale.
- `networkidle` is discouraged for SPAs. Something is always talking. Wait for a specific element or
  a specific response instead.
- `page.waitForTimeout()` is a fixed sleep and a flakiness generator: too short on a loaded machine,
  too long everywhere else. Every use of it is a missing signal you could have waited on.

### Register the wait before the action

```ts
const res = page.waitForResponse("**/api/save");   // FIRST
await page.getByRole("button", { name: "Save" }).click();
await res;
```

Click first and a fast response arrives before the listener attaches, so the wait hangs until timeout
even though the request succeeded. The failure looks like a broken endpoint and is a broken script.
[community]

## Running JS in the page

```ts
const href = await page.evaluate(() => location.href);
const rows = await page.evaluate(() =>
  [...document.querySelectorAll(".product")].map((el) => ({
    name: el.querySelector(".name")?.textContent?.trim(),
  })));

await page.evaluate((d) => window.app.use(d), data);   // args must be passed, not closed over
await page.exposeFunction("mySum", (a, b) => a + b);   // Node function callable from the page
await page.addInitScript(() => { Math.random = () => 0.5; });  // runs before any page script
```

`evaluate` returns a JSON-serialisable copy. `evaluateHandle` returns a live reference when you need
the actual object.

## Reading state back without drowning in tokens

This is the part that matters most for an agent, and the ranking is roughly:

```ts
await page.locator("h1").textContent();        // cheapest, one element
await page.locator(".card").allTextContents(); // array of strings
await page.locator("main").ariaSnapshot();     // YAML tree of roles and names — usually the sweet spot
await page.evaluate(() => /* build exactly the JSON you need */);
await page.content();                          // whole HTML — expensive, rarely worth it
```

`ariaSnapshot()` is the one worth knowing. It returns the accessibility tree as YAML: roles, names,
values, structure. Far smaller than the HTML, and unlike raw text it tells you what is a button and
what is a heading, which is what you need to decide the next click. It arrived in **1.49**; **1.50**
added it on `Page` as well as `Locator`, plus a `boxes` option that appends each element's bounding
box — added explicitly for agents. `expect(locator).toMatchAriaSnapshot()` is the assertion form.

`page.accessibility.snapshot()` was the old way. It is **gone** from the current API reference —
verified against
[class-page](https://playwright.dev/docs/api/class-page), which no longer documents an
`accessibility` property at all. Do not reach for it.

## Seeing what happened, with no eyes

### Screenshots

```ts
await page.screenshot({ path: "/tmp/s.png", fullPage: true, animations: "disabled" });
await page.locator(".header").screenshot({ path: "/tmp/h.png" });
await page.screenshot({ path: "/tmp/s.png", mask: [page.locator(".timestamp")] });
```

Always pass an explicit absolute `path` rather than relying on the runner's failure-screenshot
location. `animations: "disabled"` freezes CSS and Web Animations first — without it, a capture taken
mid-transition shows an element at 30% opacity and reads as "not there". `caret: "hide"` removes the
blinking cursor, which is otherwise a one-pixel diff on every comparison.

### Console, errors, dialogs

```ts
page.on("console", (m) => console.log(`[console:${m.type()}]`, m.text()));
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
page.on("requestfailed", (r) => console.log("[failed]", r.url(), r.failure()?.errorText));
```

**Attach these before `goto()`.** Anything logged during navigation is gone otherwise, and the early
errors are the interesting ones.

**Dialogs have two failure modes, and neither one looks like an error.** By default Playwright
**auto-dismisses** every `alert`, `confirm`, `prompt` and `beforeunload`. So a flow that depends on
`confirm()` returning true silently takes the "cancel" branch, and the click appears to have done
nothing. Register a listener and it flips: if a `page.on("dialog")` handler exists and does not call
`accept()` or `dismiss()`, **the page hangs forever** and the next action times out with no clue why.

```ts
page.on("dialog", async (d) => { console.log("[dialog]", d.type(), d.message()); await d.accept(); });
```

### Network

```ts
await page.route("**/api/data", (r) => r.fulfill({ status: 200, body: JSON.stringify(fake) }));
await page.route("**/*.{png,jpg}", (r) => r.abort());
await page.route("**/*", (r) => r.request().resourceType() === "image" ? r.abort() : r.continue());
```

Forcing a response with `fulfill` is far more reliable than getting a real backend into the state you
need.

### Tracing, video, HAR

```ts
await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
try { /* ... */ } finally { await context.tracing.stop({ path: "trace.zip" }); }
```

A trace holds DOM snapshots either side of every action, a screenshot filmstrip, full network traffic
with bodies, console output, and the source line of each call. `npx playwright show-trace trace.zip`
opens it — **in a browser window, so it is for a human, not for you**. A trace zip is just JSONL
inside: unzip it and read `.trace` and `.network` directly if you need it yourself. [community]

Stop tracing in a `finally`. A trace saved only on the happy path is a trace of the run you did not
need to debug.

```ts
const context = await browser.newContext({
  recordVideo: { dir: "videos/" },
  recordHar: { path: "network.har", urlFilter: "**/api/**" },
});
```

**Both video and HAR are written on `context.close()`, not before.** Kill the process and you get
nothing at all.

### The debug tools that need a human

`PWDEBUG=1`, `--debug`, `page.pause()`, `npx playwright codegen`, `--ui` mode, the VS Code extension
and `npx playwright show-report` all **open a GUI and block until a person clicks something**. Every
one of them will hang an automated run. `page.pause()` left in a script is an indefinite stall with
no error.

The one that is genuinely useful without a screen is `DEBUG=pw:api`, which logs every Playwright call
to stdout as text. That plus tracing, screenshots and the event listeners above is the whole
observable surface.

For a test run, `--reporter=json` is the reporter to pick — it parses, where the others are scraped.

## The traps

### The action timeout is 0, not 30 seconds

Playwright has several timeouts and they do not share a default. Verified against
[test-timeouts](https://playwright.dev/docs/test-timeouts) and
[class-page](https://playwright.dev/docs/api/class-page) on 2026-08-31:

| | Default |
|---|---|
| test timeout (`@playwright/test`) | **30 000 ms** |
| `expect()` assertion | **5 000 ms** |
| action (`click`, `fill`, …) | **0 — no timeout** |
| navigation (`goto`) | **0 — no timeout** |
| `browserType.launch()` | 30 000 ms |

Most of the internet — and one of the research agents that produced this doc, confidently, while
"correcting" the right answer — says actions default to 30 seconds. The current docs say `0`, meaning
no independent limit. **Under the test runner that is survivable**, because the 30-second test
timeout bounds it. **In a standalone script there is nothing above it**, so a click on an element
that never becomes actionable waits forever, and an agent driving it hangs with no output.

Set them yourself, first thing, every time:

```ts
page.setDefaultTimeout(10_000);
page.setDefaultNavigationTimeout(15_000);
```

### `goto` resolves before the app is alive

`page.goto()` resolves when the document has loaded, which for any SSR or SPA page is before the
client JS has hydrated and bound its handlers. A click immediately afterwards passes every
actionability check — the element is there, visible, stable, enabled — and does nothing, because
nothing is listening yet. Or the input is filled and then wiped by the hydration pass.

This is a [silent success](../reusable/silent-success.md): the action reports that it worked, and it
did press the right pixel. Wait for a signal the app itself sets — an element that only exists once
interactive, a response, a data attribute — not for `goto` and not for a sleep. [community]

### "Execution context was destroyed"

A navigation replaces the document, and anything you were holding across it — an `ElementHandle`, an
in-flight `evaluate` — dies with it. `page.waitForNavigation()` is deprecated for this reason; use
`page.waitForURL()`, or better, a locator assertion, which re-queries the current document on each
retry and so heals across the navigation by itself. [community]

### Iframes need `frameLocator`

`page.locator()` never reaches into an iframe. An element you can see on screen and cannot find is
usually this:

```ts
await page.frameLocator("#my-iframe").getByRole("button", { name: "Submit" }).click();
```

### Parallel workers share the machine, not the memory

Each `@playwright/test` worker is a separate OS process. They cannot share globals, and they *do*
share ports, files and database rows. A suite that assumes isolation because contexts are isolated
will collide on the app under test. Give each worker its own data, or run `workers: 1`.

`test.describe.configure({ mode: "serial" })` keeps a block in order in one worker, and when one test
fails **the rest are skipped, not failed**. One red plus nine greys is one root cause, not one bug.

### Headless is not quite headed

Since **1.42** Chromium's default headless mode is `--headless=new`, sharing the renderer with headed
Chromium, which closed most of the historic gap. The old lightweight `chromium-headless-shell` is now
a separate optional install, and it is where the remaining differences live — weaker WebGL, different
font metrics, some missing CSS. Fine for DOM scraping; not fine for anything visual.

On Linux, headed mode needs an X server (`xvfb-run …`), and `npx playwright install --with-deps` is
what pulls the shared libraries — a plain `install` on a CI image fails later with cryptic linker
errors instead of a useful message.

## Reusing a logged-in session

Three mechanisms, and they are not interchangeable.

**`storageState`** — cookies and localStorage as a JSON file. Cheapest and most portable. Misses
IndexedDB and anything tied to a live service worker.

```ts
await context.storageState({ path: "auth.json" });               // save, once
const context = await browser.newContext({ storageState: "auth.json" });  // reuse
```

**`launchPersistentContext`** — a real profile directory. Log in by hand once with
`headless: false`, then reuse forever; cookies, localStorage, IndexedDB and extensions all persist.
Returns a `BrowserContext` with no separate `Browser`.

```ts
const context = await chromium.launchPersistentContext("/tmp/pw-profile", { headless: false });
const page = context.pages()[0] ?? await context.newPage();
```

Playwright's docs say plainly that **automating your default Chrome profile is not supported**. Point
it at a fresh directory.

**`connectOverCDP`** — attach to a Chrome someone already started.

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-automation
```
```ts
const browser = await chromium.connectOverCDP("http://localhost:9222");
const page = browser.contexts()[0].pages()[0];
```

This is the only route to tabs that are already open. Two caveats worth stating flatly. The docs
describe a CDP connection as **significantly lower fidelity** than Playwright's own protocol, and
Chromium-only. And it cannot hijack the browser you actually use: Chrome locks a profile directory to
one process, so this means "a dedicated automation Chrome you keep alive and logged in", not "the
user's window".

**Closing a CDP-connected `Browser` closes the Chrome process** out from under every later call.
Close the page, leave the browser alone.

## Keeping a browser alive between tool calls

An agent's tool calls are separate processes, so a `launch()` inside one dies with it. Two patterns
that work:

1. **Long-lived Chrome + CDP.** Start Chrome once with `--remote-debugging-port`, then each step is a
   short script that attaches, acts, and closes only its page.
2. **A driver process.** One long-running Node process holds the `Page`; each step writes a command
   to a file or a local HTTP endpoint and reads the result back. More plumbing, full protocol
   fidelity, works for Firefox and WebKit too.

## Playwright MCP, and when it beats a script

`@playwright/mcp` (0.0.79) is Microsoft's own MCP server: the agent calls typed tools —
`browser_navigate`, `browser_click`, `browser_type`, `browser_snapshot`,
`browser_console_messages`, `browser_network_requests`, `browser_evaluate`, `browser_tabs` — instead
of writing Playwright code.

```json
{ "mcpServers": { "playwright": { "command": "npx", "args": ["@playwright/mcp@latest"] } } }
```

Its design point is that it drives **the accessibility tree, not pixels**: `browser_snapshot` returns
the aria-snapshot YAML described above, so clicking a button needs no vision model and no
coordinates. Coordinate clicking exists behind an opt-in vision mode. `--cdp-endpoint` attaches it to
a running Chrome, `--isolated` versus `--user-data-dir` chooses throwaway or persistent.

Use MCP when the agent itself wants a stable tool per step. Write a script when several steps should
happen as one atomic pass without a round trip each, or when you need an API MCP does not expose. The
exact tool names came from an AI-summarised fetch of the README rather than a byte-exact quote —
check `npx @playwright/mcp@latest --help` before hardcoding any of them.

## Against the alternatives

| | Playwright | Puppeteer | Selenium | Chrome extension (what we use) |
|---|---|---|---|---|
| Protocol | CDP plus native Firefox/WebKit | CDP | WebDriver | extension APIs over CDP |
| Browsers | Chromium, Firefox, WebKit | Chromium-first | broadest | Chrome family |
| The user's own logged-in browser | only via a dedicated CDP profile | same limit | no | **yes — the whole point** |
| Ad-hoc script setup | `npm i playwright`, run with `tsx` | similar | driver binary, version matching | nothing to install |
| Structured readback | `ariaSnapshot()`, locators, MCP | `evaluate` only | DOM queries | its own read tools |
| Best at | repeatable, isolated, scriptable runs | Chromium-only scripting | existing WebDriver estates | acting in the real session |

The last column is why this repo uses the extension: our browser work is nearly always "look at the
dev server in the session I am already signed into", and the session-transfer step is exactly what
Playwright would add. Playwright earns its place when a check needs to be repeatable and unattended —
which, per
[testing.md](../project/testing.md), is not something we have decided we want yet.

## Sources

- [Library](https://playwright.dev/docs/library) ·
  [Locators](https://playwright.dev/docs/locators) ·
  [Actionability](https://playwright.dev/docs/actionability) ·
  [Input](https://playwright.dev/docs/input)
- [Assertions](https://playwright.dev/docs/test-assertions) ·
  [Timeouts](https://playwright.dev/docs/test-timeouts) ·
  [Navigations](https://playwright.dev/docs/navigations)
- [Screenshots](https://playwright.dev/docs/screenshots) ·
  [Trace viewer](https://playwright.dev/docs/trace-viewer) ·
  [Videos](https://playwright.dev/docs/videos) ·
  [Dialogs](https://playwright.dev/docs/dialogs) ·
  [Network](https://playwright.dev/docs/network)
- [ARIA snapshots](https://playwright.dev/docs/aria-snapshots) ·
  [v1.49](https://github.com/microsoft/playwright/releases/tag/v1.49.0) ·
  [v1.50.1](https://github.com/microsoft/playwright/releases/tag/v1.50.1)
- [Auth](https://playwright.dev/docs/auth) ·
  [BrowserType](https://playwright.dev/docs/api/class-browsertype) ·
  [Browsers](https://playwright.dev/docs/browsers) ·
  [CI](https://playwright.dev/docs/ci)
- [playwright-mcp](https://github.com/microsoft/playwright-mcp) ·
  [MCP docs](https://playwright.dev/docs/getting-started-mcp)
- Issues cited for community claims:
  [#33566 headless changes](https://github.com/microsoft/playwright/issues/33566) ·
  [#27759 hydration](https://github.com/microsoft/playwright/issues/27759) ·
  [#10611 strict mode](https://github.com/microsoft/playwright/issues/10611) ·
  [#36851 execution context destroyed](https://github.com/microsoft/playwright/issues/36851)
