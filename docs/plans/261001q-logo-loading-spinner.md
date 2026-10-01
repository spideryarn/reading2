# The wordmark as the article's loading spinner

Status: built on dev after one GPT Sol plan review (revised below) and a code review. Report `spya-ns2v83` (Sentry SPIDERYARN-READING2-8Y),
confirmed Greg's by `scripts/feedback-reporter.ts` on 2026-10-01.

> Instead of "Fetching the article and its summaries", show an animated loading spinner.
>
> Perhaps actually it would be fun to make a rich, complex, fun, ever-morphing animation of the logo
> itself as the loading spinner?
>
> Update loading-spinner.md and signpost to it.
>
> — Greg, 2026-10-01, via the Feedback button on a reading view

## What happens now

`ArticlePage` ([ArticlePage.tsx](../../src/web/article/ArticlePage.tsx) § the `loading` branch)
draws the corner `HomeLogo`, the corner Feedback trigger, and a `.loading` div that is empty for the
first 600ms (`useSlow`) and then says *"Fetching the article and its summaries…"* in 13px mono at
the top left. `loading-spinner.md` does not exist; the app's one spinner is Lucide's `LoaderCircle`,
documented in [icons.md § The loading spinner](../project/icons.md#the-loading-spinner).

`git log origin/dev`, `docs/plans/`, `docs/user-feedback/` and `gjd-remote ls` have nothing on this
(checked 2026-10-01). The nearest is [260930j](260930j-shelf-topics-loading-spinner.md), the shelf's
topics row, which uses `LoaderCircle` and is not touched here.

## What changes

1. **`LogoLoader`** — a new, small component in `src/web/LogoLoader.tsx`. It draws the wordmark
   large and centred — `LogoMark size={36}` and `LogoLetters` in their own wrapper, the shelf's
   heading size (`ShelfWordmark` in Library.tsx is the precedent for a big animated word; the letter
   moves are in `--logo-px`, so they scale) — and puts animation classes on it on a timer:

   - **Two tracks, not one.** Every `reach: "mark"` animation that touches only `.logo-image` /
     `.logo-mark` is the *mark track*; every `reach: "letters"` animation is the *letters track*.
     Each track draws a new animation every 2.4s with the existing `pickLogoAnimation`-style
     never-repeat rule, and the two are offset by half a period. So the spider and the word are
     always doing two different things, and one of the pair changes every 1.2s: that is the
     "ever-morphing", from a fixed set of hand-made pieces rather than a fourteenth animation.
   - **Two animations are left out**: `spya-strain` (its rules move the letters as well as the
     spider, so it would fight whatever the letters track is running for the same `animation`
     property) and `spya-dawn` (it masks the whole host, so it would eat the other track). Eleven of
     thirteen remain, four on the mark and seven on the letters — 28 combinations.
   - **The partition is checked, not asserted.** A test reads `logo-animations.css` and fails if any
     selector naming a mark-track id reaches `.logo-letter`, or one naming a letters-track id
     reaches `.logo-image`/`.logo-mark`, or if either names the bare host. So a fourteenth
     animation, or an edit to one of the eleven, cannot silently start fighting its partner. Each
     pool is derived from `LOGO_ANIMATIONS` minus an explicit two-id exclusion list, so a new
     animation joins the loader by default and the test decides whether it may.
   - **The registry is reused, not copied**: `LOGO_ANIMATIONS`, `LogoMark`, `LogoLetters`, the
     stylesheet and its `.spya-anim` base class. One new export from `logo-animation.ts` (the
     pool-and-pick helper, generalised to take a pool) rather than a second picker.

2. **Accessibility.** The host is `role="status"` with `aria-label` set to the sentence the text
   said, so a screen reader is told the same thing as before. The letters are `aria-hidden` (they
   would otherwise be read as ten letters).

3. **Reduced motion: the words, not the spider.** Under `prefers-reduced-motion: reduce` the global
   guard collapses every animation to a still, so a cycling wordmark would be a still logo that
   twitches between poses every 1.2s — neither motion nor information. So `LogoLoader` reads the
   media query (`matchMedia`, once on mount) and, under reduce, draws the old line instead and runs
   no timer. A still logo with no words would say nothing is happening.

4. **`ArticlePage`'s loading branch** draws `<LogoLoader label="Fetching the article and its
   summaries" />` once `slow` is true, centred in the viewport, in place of the text.

5. **`/design`**: one live `LogoLoader` in the Wordmark animations section, because that is where a
   reviewer looks at these and the loader otherwise only shows on a slow fetch.

6. **Docs.** New `docs/project/loading-spinner.md` under
   [design-css-overview.md](../project/design-css-overview.md): the app has two loading indicators
   and when each is used — `LoaderCircle` inline beside a sentence (icons.md stays the home of its
   detail), the wordmark for a whole page waiting — plus the two-track design, the exclusions, the
   reduced-motion rule and the "not before 600ms" rule. One-line pointers from icons.md §
   The loading spinner and design-logo.md.

## What it costs, and what keeps it light

- **Nothing before first paint.** It is drawn only after `useSlow`'s 600ms, exactly where the text
  was, and unmounts the frame the article arrives. A fast fetch never sees it.
- **No new asset.** `/spideryarn-logo.png` is already on that page (the corner `HomeLogo`); the
  stylesheet is already in the bundle. The component is ~60 lines; two `setInterval`s, cleared on
  unmount.
- **Animations are transforms, opacity, filters and masks** (the stylesheet's own rule), so the
  compositor does the work and the main thread, which is busy receiving the article, is not asked
  to lay anything out.

## The simpler option passed over

**One track: cycle all thirteen on the whole wordmark, one at a time.** Less code and no partition
test. Passed over because several of the thirteen are deliberately restrained — *Only the i* raises
one letter a hair, *Warm Drift* is a colour shift "you would not notice" — and a loader that spends
2.4s on either looks stalled, which is the one thing a spinner may not look. Two tracks mean
something visibly moves at every moment. Greg asked for "rich, complex"; the two tracks are the
cheapest way to get that out of pieces that already exist.

**Also passed over:** a new animation designed for the loader (a fourteenth thing to maintain, and
design-logo.md's whole lesson is that the apparatus is the expensive part); an SVG trace of the
spider (design-logo.md § What is deliberately not here says why).

## What is not changed

- The corner `HomeLogo` stays on the loading page — it is the way home and the Feedback trigger's
  partner, and it does not animate unless pointed at. Two spiders on screen, one large and busy in
  the middle, one small and still in the corner.
- `LoaderCircle` and every other loading line in the app. Greg asked about this one; the doc says
  where the logo loader is for, so the next whole-page wait can take it.

## Checks

- Unit: the partition test (watched red by temporarily adding `spya-strain` to a pool), the
  pools are non-empty and cover the eleven, the cycling component swaps classes on a fake timer and
  clears its intervals on unmount, the reduced-motion branch renders the sentence.
- Browser (Sonnet subagent, Playwright on the box): the article route with the fetch held open —
  the loader appears after ~600ms, centred, at 1280 and at 390px, both tracks visibly change, and
  it is gone when the article lands.
- `npm test`, `npm run typecheck`, lint on touched files.

## Revised after Sol's plan review

[The review](261001q-logo-loading-spinner-review-sol.md) agreed the partition is sound and found
the cadence and the announcement wrong. What changed, finding by finding:

1. **P1, the fixed 2.4s swap snapped and stalled.** Warm Drift is a 3.2s loop, Dragline and Abseil
   were mid-loop at 2.4s, and removing a keyframe animation mid-loop jumps home. Now **each draw is
   held for whole loops of itself** (`LOADER_HOLD_MS`), so it is at its 100% frame — at rest — when
   the class goes. The test reads every loop length and delay out of the stylesheet and fails if a
   hold disagrees (watched red on four deliberately wrong holds). **Seam and Only the i are out**:
   they hold a pose whose transition is scoped to their class, so leaving them snaps. The Settle
   stays, followed by a 300ms rest so its exit eases along the resting `.logo-image` transition.
   Every hover animation is now either timed or excluded with a reason, so a fourteenth is a
   decision, not a default. Nine remain: Settle, Warm Drift, Dragline and Radius
   Sweep on the spider; Pluck, Sag, Misregistration, Retype and Abseil on the letters.
2. **P1, a first draw born with its class has nothing to transition from.** Each track starts at
   rest and draws on a timer (100ms for the letters, 1.2s for the spider), so the resting frame has
   painted first.
3. **P1, a live region mounted already filled announces nothing, and the title already announces
   the wait.** Not a live region: the sentence is visually-hidden text beside an `aria-hidden`
   glyph, so a screen reader that reaches it hears it, and the title does the announcing as before.
   This is also what the old line was.
4. **P2, reduced motion read once.** `useSyncExternalStore` on the media query: turning it on
   mid-wait stops the timers and shows the sentence at once (tested).
5. **P2, the compositor claim was too strong.** Misregistration's `text-shadow`, Warm Drift's
   filter and Radius Sweep's conic gradient repaint. What is true and enough: no new asset, nothing
   that changes layout, and nothing at all before the 600ms threshold.
6. **P2, doc ownership.** `loading-spinner.md` is under design-css-overview.md in AGENTS.md, in the
   parent's list, and ends with its `Up:` link.
