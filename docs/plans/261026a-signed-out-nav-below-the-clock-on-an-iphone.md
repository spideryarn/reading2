# The signed-out nav sits below the clock on an iPhone

Report `spya-tfsjvq` (Greg, admin, 2026-10-25), on `https://www.spideryarn.com/`:

> The links at the top of the screen is blocked when I'm using it on an iPhone in a web browser.
>
> The tricky part is that if I have shared it to my home screen, then I want that stuff to be at the
> top Because there won't be any of the iPhone OS UI. Is there a best of both worlds?
>
> — Greg, 2026-10-25 (`spya-tfsjvq`)

## What blocks them

The screenshot he attached is a real iOS capture of the signed-out landing page. The phone's clock,
signal, wifi and battery are drawn **on top of** the bar: "S21:04yarn Reading" on the left, the
battery on top of "Sign in" on the right. The page is laid out from screen y=0 with nothing between
the bar and the status bar.

`index.html` asks for `viewport-fit=cover` and, once installed, `black-translucent`, so the document
runs under the status bar and every piece of fixed or sticky chrome has to add `--safe-top`
(`styles/tokens.css` § safe areas, [narrow-windows.md § The screen is bigger than the
window](../project/narrow-windows.md#the-screen-is-bigger-than-the-window-envsafe-area-inset-)).
The reading view's chrome does. **The signed-out bar does on only one of its two routes:**
`styles/site.css` gives `padding-top: var(--safe-top)` to `.site-document-nav > .site-nav`, the
wrapper `DocumentPage` puts round it (Privacy, Contact, Open source, Changelog…), and nothing to the
bare `.site-nav` that `LandingPage`, `FeaturesPage`, `PricingPage`, `SignInPage`,
`PublicLibraryPage` and `PublicReadableSharingPage` render directly. The bare bar has been sticky at
`top: 0` with no inset since the redesign that made it (`f3b8861d4`, 2026-09-03); 261007h
(`32be0fb09`) caught the same gap for the document shell only, and left the other six behind.

So wherever iOS draws the page under the status bar, those six bars sit under the clock:

- **Installed (home screen):** certainly. `black-translucent` starts the web view at y=0, and
  `--safe-top` is about 59px there.
- **A Safari tab:** the tokens comment says the top inset is "reliably zero" in a tab, because
  Safari's own strip holds it. That was true of Safari before iOS 26. Greg's report and screenshot
  say the page reached the status bar in what he calls the browser, and iOS 26's Safari draws page
  content under a translucent status bar. What `env(safe-area-inset-top)` reports in that state is
  not something this box can measure (WebKit has open bugs on exactly this: 274773, 300523), so
  that half rests on the phone.

## The fix: the best of both worlds is the inset itself

`env(safe-area-inset-top)` is already the conditional Greg is asking for: it is the clock's height
where something is drawn over the top of the page, and `0px` where nothing is. So the bar stays at
the top in both, and only moves down by exactly what covers it:

```
 a tab, inset 0                 installed, inset ≈59px
┌──────────────────────┐       ┌──────────────────────┐
│ Safari's own strip   │       │ 21:04          ▂▄ ▮  │ ← bar's padding, its own background
├──────────────────────┤       ├──────────────────────┤
│ 🕷 Spideryarn  Sign in│       │ 🕷 Spideryarn  Sign in│
```

Move the `padding-top: var(--safe-top)` from `.site-document-nav > .site-nav` to `.site-nav`, so
all seven routes share one rule. The bar is `position: sticky; top: 0`, so its background (with the
blur) is what covers the status-bar strip once the page scrolls, as the document shell's comment
already says. `DocumentPage` keeps its own inset arithmetic (floor height, `scroll-mt`) — that is
about the bar it renders and is unchanged.

**The option passed over:** a different placement in the browser only, with
`@media (display-mode: browser)` — say, not sticky in a tab. It adds a second layout to keep right
for a case the inset already handles, and it would not help if iOS 26's tab reports a non-zero inset
(then the padding does it) or a zero one under a translucent bar (then the bar is still at y=0 at
rest, sticky or not). If the phone shows the tab still blocked after this, the next step is to
measure that inset on the device, not to guess a media query.

## How we will know

- **A test that goes red first:** `tests/site-nav-safe-area.test.ts` reads `site.css` and fails
  unless the base `.site-nav` rule carries `padding-top: var(--safe-top)`. Cheap, and it is the
  regression that happened.
- **The class, checked in a browser:** `scripts/safe-area-check.ts --site` opens the signed-out
  pages with `--safe-top` forced to 59px on a 390 × 844 touch context, at rest and scrolled, and
  fails unless every link in the bar starts below the inset. The pages are the six bare callers
  (`/`, `/features`, `/pricing`, `/login`, `/read/public`, `/features/public-readable-sharing`, the
  last added on Sol's review) and `/privacy` for the document shell. `--break` removes the padding
  and must fail.

  *As built:* before the CSS change it failed 6 of 7 (links at y 16–18, `/privacy` already fine);
  after, 7 of 7 pass; `--break` fails 7 of 7. A second, painted half — "is the top-most thing at
  `y = inset/2` the bar?" — was written and dropped: the sticky bar's own row covers that strip
  with or without the padding, so it passed on the broken build too.
- **A Sonnet subagent** runs it with Playwright's iPhone emulation and screenshots the before and
  after. Emulation cannot show Safari's toolbars, the real status bar, or what iOS reports as the
  inset; it can only show that the rule moves when the inset is non-zero.
- **Greg on his phone**, after the next deploy: the landing page in a Safari tab and from the home
  screen, at rest and scrolled.

**What stays open (Sol's plan review, finding 1).** The home-screen half is certain: there the
inset is non-zero by construction. The Safari-tab half is not, because nothing proves a portrait
tab reports a non-zero top inset, and a WebKit engineer has called zero the expected value there.
If the tab still shows the bar under the clock after the deploy, this change was a no-op in that
state, and what follows is a real product choice: a reserve gated on iOS in browser mode, giving
up `viewport-fit=cover`'s edge-to-edge page, or a different phone bar. That choice is Greg's, and
it waits for the measurement rather than being guessed now. The way to measure is to open any
article with `?probe=1` in the tab: the probe's trace records `--safe-top` (`ViewportProbe.tsx`).

The postmortem is
[261026a-a-fix-on-one-caller-of-a-shared-bar-leaves-the-others-broken.md](../postmortems/261026a-a-fix-on-one-caller-of-a-shared-bar-leaves-the-others-broken.md).
