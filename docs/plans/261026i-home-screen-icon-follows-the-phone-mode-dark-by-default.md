# The home-screen icon follows the phone's mode, dark by default

Report `spya-shpsvx` (SPIDERYARN-READING2-P9), question `q-q5da5a`, queue item `qi-8yqe3ztx`.
Greg, in dark mode on his iPhone, saw the home-screen icon's cream square. Asked whether it
should be dark for everyone (A), follow the phone's mode when the icon is added (B), or stay cream
(C), he replied:

> Maybe we can try and offer a switch between light and dark mode, but if in doubt, default to dark
> mode for the icon
>
> — Greg, 2026-10-26 (`spya-e50wvz`)

Read as B, with dark wherever the choice cannot be made or is uncertain.

## What "a switch" means here

**The phone's own light/dark setting, read when the page loads, not a new setting in Spideryarn.**
The home screen is the phone's, so the phone's mode is the thing the icon has to sit well against;
the app's own Appearance choice (`spya.appearance`, default dark) says how the *page* looks, and a
reader who keeps Spideryarn dark on a light phone still has a light home screen. A setting would
be a control, a stored value and a doc for a picture iOS takes once — more parts for no gain we can
see. If Greg wants the app's choice to drive it instead, that is a one-line change of the condition.

## How iOS picks the icon (what was verified, and how)

Read in WebKit's own source, `Source/WebCore/html/LinkIconCollector.cpp` (main, fetched
2026-10-26): `iconsOfTypes` walks the **direct children of `<head>` in the live DOM** at the moment
it is called, takes each matching `<link>`'s current `href`, sorts by `sizes` with an unstable sort,
and **does not evaluate `media`** — attributes are passed on to the caller unread. Safari's own
code that consumes that list is closed, so:

- **A `media="(prefers-color-scheme: …)"` pair of touch icons is not something we can rely on.**
  Whether Safari reads the passed-through `media` is unknown; if it does not, two same-size links
  are ordered by an unstable sort. Rejected.
- **One link whose `href` a script sets is read as set**, because the collector reads the live
  attribute. This matches the 2024 forum report that a script-chosen icon works. It is the design.
- **Not verified on a phone, by anyone here:** whether Safari's *Add to Home Screen* uses the
  snapshot WebKit takes after parsing (which the inline swap already covers) or re-collects the
  live DOM through its `appleTouchIconURLs` SPI (which would also pick up the change listener's
  swap); how iOS 26's own tinted or clear treatments handle the chosen picture. Greg's re-add is
  the test (below).

## The change

```
<head>
  <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png?v=2">   ← dark, static default
  <script id="touch-icon-boot">                                                     ← right after it
    phone in light mode?  href = /apple-touch-icon-light.png?v=2
    otherwise (dark, no matchMedia, matchMedia throws or matches neither)  → stays dark
    and again on a change of mode while the page is open
  </script>
```

1. **Generator** (`scripts/generate-brand-assets.ts`): `apple-touch-icon.png` and both
   `android-chrome-*` go `DARK` (#242321); a new `apple-touch-icon-light.png`, 180px, `LIGHT`. Same
   padding as now. `npm run brand:update`, `brand:check`.
2. **`index.html`**: the link points at the dark file with `?v=2` (a defensive buster for Safari's
   own icon caches; that they are keyed by URL is likely, not shown), and the `touch-icon-boot`
   script. It matches `light`, so anything that cannot answer lands on dark. By the spec a
   browser with no expressed preference matches `light`, so that case gets cream; an iPhone is
   always in one mode or the other, so this is moot there.
3. **Android** (`site.webmanifest`): unchanged paths, dark pixels. A manifest icon cannot follow
   the mode, so it takes the default.
4. **Emails** (`src/email-frame.ts`, `supabase/templates/*.html`): unchanged — they already name
   `/apple-touch-icon.png`, which becomes dark, and their header is `#0a0a0a`. An email cannot know
   the reader's mode, so it takes the default; a charcoal tile on the near-black header reads as a
   soft square rather than a bright one.
5. **Tests**, first and red: the script in JSDOM with a stubbed `matchMedia` (light → light file;
   dark, no preference, no `matchMedia` → dark; a change event flips it); the corner colours in
   `tests/brand-assets.test.ts`; the head's icon links still match their files' sizes.
6. **Docs**: `main-icon.md § Dark mode on an iPhone` says what we did and the WebKit reading; the
   note, the question file, the queue item.

**Simpler option passed over: A, dark for everyone.** No script, no second file. Greg asked for the
switch, and it costs one 180px file and a dozen lines.

## How Greg sees it

After the next deploy: press and hold the Spideryarn icon, remove it, then in Safari open
spideryarn.com, Share, Add to Home Screen. With the phone in dark mode it should be charcoal; switch
the phone to light, remove and re-add, and it should be cream. An icon already on the home screen
never changes by itself — iOS keeps the picture it took.

## Reviews

- **Plan, GPT Sol** ([findings](261026i-home-screen-icon-plan-review-sol.md)): agreed on one
  script-swapped link and no media pair; all five findings taken — "no preference" is `light` by
  the spec (wording and test fixed, and a `try` around `matchMedia`), the listener's effect at
  share-sheet time marked unverified, the cache claim softened, robots and the extension tile
  rightly left alone, the brand test's lists all updated.
