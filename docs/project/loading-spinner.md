# Loading spinners

Up: [design-css-overview.md](design-css-overview.md)

The app has two, and which one a wait gets depends on what else is on the screen:

| | Where | What it is |
| --- | --- | --- |
| **The wordmark** | a whole page with nothing on it yet — the article page while it fetches | [`LogoLoader`](../../src/web/LogoLoader.tsx): the spider and the name, large and centred, never doing the same thing for long |
| **`LoaderCircle`** | inline, beside a sentence, in a page that is otherwise drawn — a button, a row, a badge | Lucide's open arc on a CSS spin; its detail stays in [icons.md § The loading spinner](icons.md#the-loading-spinner) |

> Instead of "Fetching the article and its summaries", show an animated loading spinner.
>
> Perhaps actually it would be fun to make a rich, complex, fun, ever-morphing animation of the logo
> itself as the loading spinner?
>
> — Greg, 2026-10-01 ([the note](../user-feedback/261001_1725-logo-loading-spinner.md),
> [the plan](../plans/261001q-logo-loading-spinner.md))

## Two rules both share

- **Nothing before 600ms.** A spinner that flashes and vanishes reads as breakage. Gate it on
  [`useSlow`](../../src/web/useSlow.ts), which owns the threshold; the loader is never a placeholder
  for a fast fetch, which is also why it cannot delay the first paint or the article. A response to
  a press acknowledges it immediately: for example, a model turn already on screen in a conversation
  ([`ChatPanel.tsx`](../../src/web/ChatPanel.tsx) § `Turn`): it is not gated, because the reader has
  already sent a question and the turn is drawn empty, so it acknowledges the send immediately.
  The band's immediate responses are listed below.
- **The words are kept.** Each wait still has a sentence naming what it is waiting for. Beside
  `LoaderCircle` it is visible. In `LogoLoader` it is visually-hidden text beside an `aria-hidden`
  wordmark, and it is what a reader who asked for reduced motion sees *instead* of the wordmark
  (below). It is not a live region: on the article page the tab title already announces the wait
  ([page-titles.md](page-titles.md)), and a region mounted already filled announces nothing.

## The band's wait line

Every mode's band draws its wait with one component,
[`BandWaiting`](../../src/web/BandWaiting.tsx): nothing for 600ms, then a 13px `LoaderCircle`
(`.cmt-spinner`, `aria-hidden`) and the sentence, *"Looking for the timeline…"*. Its `role="status"`
container is mounted at once and carries the caller's class (`gloss-quiet`, `diag-wait`, …), so the
words are announced when they arrive and the band does not jump; `.band-waiting` in `mode-band.css`
adds the row and one line's height at zero specificity. Mount it only while waiting, and a wait
that ends inside 600ms never shows. It began as Chat's `ChatListLoading` and now draws that one too,
and the Glossary, Ideas, Timeline, Skim, FAQ, Citations, Tweets, Quiz, Debate, Criteria, Claims,
Quotes and Simple waits, Sketch's, Illustrated's (and each plate's), Diagram's projection, Candidates'
first read, the dock's comments and Search's saved searches — Search with its own
hue through `spinnerClassName` (plan
[261007h § F1](../plans/261007h-design-system-refresh-controls-that-do-the-same-job-look-the-same-in-every-mode.md)).
`delayMs={0}` draws it at once: `/design` passes it to show the line, and so do Referee's two
"Reading the paper…" lines, Search's first "Reading the article for you…" answer and Learn's
"Starting over…" (plan [261007m § S1](../plans/261007m-design-consistency-follow-ups-five-queued-items.md)),
because they answer a press the reader has just made — the same
exception as a chat turn already sent, since a press followed by 600ms of nothing reads as a press
that did nothing. A wait for a read leaves it.

**Only waits.** A sentence saying nothing has been made yet (*"Nobody has read the chronology out of
this one yet"*) is the page, not a wait, and is drawn at once without it. **Not here either:** a
spinner beside something the reader can already use — Search's partial-results count and its
"thorough" upgrade, Diagram's "Reading the article for related passages…" over a drawn picture, the
`sk-busy`/`ill-busy` job lines over a picture — keeps its own fixed place and shows at once.
Illustrated keeps its confirmed "Nobody has painted this one yet" sentence immediate while a
separate delayed line names its lookup for a Sketch to paint from.

## The wordmark loader

**It is not a new animation.** It is [the wordmark's hover set](design-logo.md) run on two tracks
at once on one host: one track draws from the animations that move only the spider, the other from
the ones that move only the letters, never the same twice in a row, and the spider's starts 1.1s
after the letters', so the two are out of step and something is changing most of the time. The
restrained ones — *Warm Drift* above all — would look stalled alone and read as texture beside a
partner, which is why one track was passed over.

**Each draw is held for complete runs of itself.** A keyframe animation whose class is removed
mid-loop jumps home from wherever it was, and nothing can ease it — so `LOADER_HOLD_MS` holds
ordinary loops to a boundary and one-shots until they finish. Pluck is staggered, so the loader
runs it exactly twice and waits through the last letter's delay; its hover version remains an
infinite loop. The Settle, a transition, gets a 300ms rest after it so its exit can ease. The
durations and delays live in the stylesheet, so
[`tests/logo-loader.test.tsx`](../../tests/logo-loader.test.tsx) reads them from there — including
computed staggers, pseudo-elements and conditional rules — and fails if a hold stops agreeing.

**Five of the twenty-seven are left out**, each with its reason in `LOADER_EXCLUDED`: `spya-strain`
and `spya-dawn` reach both halves (the first holds the letters while the spider hauls; the second
masks the whole host) and would override the other track; `spya-seam` and `spya-i` hold a pose
whose transition is scoped to their class, so leaving them snaps; and `spya-dead` (2026-10-10)
turns the spider grey on its back, which on an empty loading page reads as an error. The
fourteenth, *Dew on the Thread* (2026-10-02), joined the letters track: a bead of orange along a
white word is texture by nature. Of the thirteen added on 2026-10-10, twelve joined a track — six
each ([261010p](../plans/261010p-more-logo-animations.md)) — so the loader now draws from ten
spider animations and twelve letter ones. **A new hover animation fails the test until it is put in
one list or the other**, and the same test reads the stylesheet's selectors and fails if anything
in a track touches the other half.

**It is the corner's wordmark, scaled up, not a big one.** The spider's moves are fixed pixels
tuned for the 20px mark (only the letters' are in `--logo-px`), so a wordmark drawn at 36px ran
Dragline and The Settle at about half strength; the first browser check called it "a gentle
jiggle". So it is drawn at the corner's size and the wrapper is `scale: 2.2`, which scales every
move exactly as it was tuned. `scale` is its own property, so it cannot fight an animation's
`transform`.

**Reduced motion gets the sentence, not the spider.** The global guard collapses every one of these
to a still, so a cycling wordmark would be a still logo twitching between poses — neither motion nor
information. `LogoLoader` follows the media query live, so turning it on mid-wait stops the timers
at once.

**Not free, but nothing before the wait is real.** No new asset (the spider is already on the
page), nothing that changes layout, and nothing at all before the 600ms threshold. Three of the
animations repaint rather than composite — Misregistration's `text-shadow`, Warm Drift's filter,
Radius Sweep's conic gradient — which is fine for a page with nothing else on it.

**It is the only wordmark on the page.** The article page's wait used to keep the corner
`HomeLogo` beside it, as the page's other bar-less states do; with the loader up that was two of
the same mark on an empty page, so the wait draws no corner mark at all, before the threshold or
after. Greg, 2026-10-09: *"we don't need both."* The cost is that a wait which never ends has no
in-page way home; a failed fetch becomes the error page, which does
([261009b](../plans/261009b-one-wordmark-while-an-article-loads.md),
[`tests/article-loading-one-wordmark.test.tsx`](../../tests/article-loading-one-wordmark.test.tsx)).

**Live on `/design`**, in the Wordmark animations section, since a fast local fetch never shows it.

## Using it elsewhere

`<LogoLoader label="…" />`, inside a `useSlow` guard, with the label a sentence without its ellipsis.
It sizes itself; the caller decides where it sits (the article page centres it in 70dvh). Reach for
it when the whole page is the wait; anywhere something else is already drawn, the wordmark would
outshout it and `LoaderCircle` is the one.
