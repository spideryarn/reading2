# The dock hides on scroll in a mode, unless the band is the whole screen

**[SPIDERYARN-READING2-2F](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-2F)** ·
reported 2026-09-07 17:41 UTC · kind: problem · build `c0fb04a4` ·
`/read/after-work-we-ll-have-each-other-spya-rqztkp?mode=structure&at=spya-fvuu5k`

Greg, 2026-09-07:

> The dock used to disappear on iPhone and only reappear when I scroll. That was good because then I
> mostly had a full screen, but if I wanted the bar all I had to do was scroll. But now it seems to
> be there the whole time. I'm in landscape mode on an iPhone.

## The one-line version

A guard written in August as *"a band is open"* meant *"the band is the whole screen"*, and on
**2026-09-06** those two stopped being the same thing. Nothing about the guard changed; the layout
grew a case it had never had to describe, and the guard went on answering the old question.

## Where the behaviour went

`--dock-bottom` is the dock's position, and § a small device in
[narrow-window.css](../../src/web/styles/narrow-window.css) drives it from two rules that disagree
on purpose:

```css
@media (max-height: 620px), (max-width: 731px) {
  :root[data-bars="hidden"] { --dock-bottom: 0px; }             /* the bar leaves while you read */
  :root:has(…, .mode-band)  { --dock-bottom: var(--dock-space); } /* except while a mode is open */
}
```

The second is the one in the report, and Greg asked for it himself — 2026-08-31, working
[260831a](260831ai-which-modes-are-ready-in-the-bottom-bar-and-running-one-by-clicking-it.md):

> on mobile I did find that I sometimes struggled to get back to the main text (e.g. within the
> Search mode when the keyboard was open)

**On the day it was written that guard was exactly right, because on that day a phone in a mode had
nothing else on the screen.** The crossover at which the band stops sharing the window with the
article and covers it instead was `MODE_MIN + PROSE_MIN` — 844px, and
[layout.ts § `MODE_PROSE_FLOOR`](../../src/web/layout.ts) says what that meant:

> `MODE_MIN + PROSE_MIN + SPINE_W` is 844 … no iPhone made has ever cleared it, in either
> orientation.

So in August, on any iPhone, *a band was open* and *the band is the whole screen* were the same
sentence, and a dock that slid away would have left the reader with a full-screen panel and no way
out. Pinning it was the only safe answer.

**2026-09-06 split that number in two.** Greg, that day:

> Even when my browser window is fairly wide, it still only shows the Mode column … I'd really like
> to be able to see a Mode (e.g. Outline) + Text side-by-side when viewing on a modern iPhone in
> landscape mode.

The crossover became `MODE_MIN + MODE_PROSE_FLOOR` = 700, which a landscape iPhone clears — which is
the whole point of that change, and it works. But it created a configuration the guard had never
been asked about: **a mode band with the article beside it, on a screen short enough for the dock to
hide.** The guard still reads `.mode-band`, so it goes on pinning the dock there, and 40px of a
390px viewport is spent on a bar the reader can summon by scrolling.

The regression is a week old on the calendar and one day old in Greg's experience, because
[structure mode](260907c-structure-mode-as-a-third-mode-behind-the-experimental-switch.md) shipped
on 2026-09-07 and is a mode you *read* in rather than dip into — which is what turned a pinned dock
from a detail into the thing you notice.

## Measured before the fix

Headless Chrome on the box, this worktree's dev server, the local copy of the article in the report,
viewport set by hand, scrolled forwards with real wheel events until `data-bars` flipped:

| viewport | mode | `data-bars` | `--dock-bottom` | `.dock` top | verdict |
|---|---|---|---|---|---|
| 844 × 390 | plain | `hidden` | `0px` | 390 | gone, as asked |
| 844 × 390 | outline | `hidden` | `calc(2.5rem + 0px)` | **350** | **held** |
| 844 × 390 | glossary | `hidden` | `calc(2.5rem + 0px)` | **350** | **held** |
| 390 × 844 | plain | `hidden` | `0px` | 844 | gone |
| 390 × 844 | outline | `hidden` | `calc(2.5rem + 0px)` | **804** | **held** |
| 390 × 844 | glossary | `hidden` | `calc(2.5rem + 0px)` | **804** | **held** |

The same table the `-2E` session took independently
([260908a § `-2F` is a different bug](260908a-the-top-bar-stops-being-drawn-when-it-has-nothing-in-it.md#-2f-is-a-different-bug-and-this-does-not-fix-it)),
so this is two measurements agreeing rather than one repeated.

**`data-bars` reaches `"hidden"` in every row**, which is the fact that makes the fix safe: the
scroll listener fires in a band mode, the document scrolls, the reader's own gesture works. It is
only the CSS that refuses to act on it.

## The fix

Say the thing the guard meant. `.reader.band-covers` is already on the page, written by `App.tsx`
from `fit.modeW === 0` — one decision in the one place that can make it, for exactly the reason
§ a band with no room gives:

> The fix is not a fourth hand-copied breakpoint … It is to stop the stylesheet deriving a fact it
> cannot see.

So the guard's `.mode-band` argument becomes `.reader.band-covers .mode-band` — the band is the
whole screen, so the dock is the only way out and stays. This is Greg's August case, unchanged, and
it is still every phone in portrait.

**It was going to be two arguments, and a browser threw the second one out** — see § The second
argument, below, which is the most useful thing this session found.

Both `.reader.band-covers .mode-band` and `.dock:focus-within` are (0,3,0), so the `:has()` keeps
the specificity it has today and goes on beating `:root[data-bars="hidden"]`'s (0,2,0) outright —
the tie the file's own comment warns about is not reopened.

Two other rules in the same query key on the bare `.mode-band` and have to move with it, or the
change is half-applied in a way nothing would notice:

- `:root:has(.mode-band) .dock { transition: none; }` — "the dock arrives rather than slides",
  because a bar coming back because a panel opened is not announcing anything. That reasoning is
  about the covering case only; in the side-by-side case the dock now hides and shows on scroll like
  any other, and killing its transition would make it snap on every direction change. → keyed to
  `.reader.band-covers .mode-band`.
- `:root[data-bars="hidden"]:where(:not(:has(.mode-band))) .install-hint` — the hint sits on the
  dock and must travel with it. → the exclusion becomes the same condition the guard uses, so the
  hint goes wherever the dock goes. The `:where()` keeps it at the specificity it was written to
  have.

Three rules, one condition, stated once in the plan and three times in the file because CSS has no
way to name it. That is the class of bug this whole report is: a rule that encodes a condition by
proxy, and a proxy that comes apart the day the layout grows a case.

## What this is not, and the simpler thing that was passed over

**Simply deleting the guard** — the dock hides on scroll in every mode, full stop — is one word
shorter and is wrong. Every band scroller in the app sets `overscroll-behavior: contain`
(`summary.css`, `ideas.css`, `timeline.css`, `quiz.css`, `debate.css`), so a swipe inside a band
never chains to the document; and where the band covers the article there is nothing else on the
screen to swipe. A reader in portrait whose dock had slid away would have no gesture that brings it
back and no masthead either — `.reader.band-covers:has(.mode-band) .masthead { display: none }`.
That is Greg's August complaint, restored in a worse form.

**Nothing here touches `--bar-bottom` or the top bar**, which is `-2E` and shipped separately.

## The second argument, and the browser that threw it out

The plan above originally had a second argument, `.mode-band:focus-within` — *"a field in the band
has focus, so a keyboard is probably up"*, kept as the direct descendant of Greg's August sentence.
It was written, shipped to the dev server, and measured, and the measurement killed it. At
844 × 390, after eight wheel events, reading `document.activeElement` back:

| mode | focus after the mode opens | `.dock` top with `:focus-within` in the guard | without |
|---|---|---|---|
| search | `input.srch-input` | **350 — pinned** | 390 |
| chat | `textarea.chat-input` | **350 — pinned** | 390 |
| glossary | `body` | 390 | 390 |
| outline | `body` | 390 | 390 |
| summary | `body` | 390 | 390 |

**Search and Chat put focus in their field when they open and nothing takes it out again**, so
`:focus-within` was not "a keyboard is up" at all — it was "this mode is open", for the whole life
of the mode, in the two modes a reader spends longest in. It would have restored the exact guard
this change removes, under a different selector, in the half of the cases that matter most. Three
of five modes were unaffected, which is what makes it a proxy rather than a condition — the same
mistake as the original bug, made twice in one afternoon.

So the guard has one argument. **The case `:focus-within` was reaching for is real and is now
uncovered**: a landscape phone, keyboard up, dock already gone. It is left alone because the article
is beside the band and scrolls, and because the dock only leaves after 24px of *downward* travel
(`BAR_HIDE_AFTER`) past the first screenful — a reader who has just tapped a field they could see
has not done that. If it bites, the version that is right rather than nearly right is a measured
one: `useVisualViewport`'s `bottomInset` already computes *"how much of the layout viewport the
keyboard is eating"* for the three dialogs, and the work is to lift it to a root attribute the
stylesheet can read. That is a hook, an attribute and a test, and it is not worth building before
something asks for it.

**The general lesson, and it is the one this report is about at both ends:** a CSS guard that names
a *thing on the page* rather than the *condition it means* is a bet that the two stay the same, and
this file lost that bet twice — once over two months, once over two hours.

## The test

`tests/the-dock-hides-in-a-mode-beside-the-article.test.ts` — a static gate in the house style
(`tests/shared-notice-hides-with-the-masthead.test.tsx` is the pattern), reading the sheets through
`readerCss()` rather than a path.

It is worth what static gates are worth: it proves the rule is *written*, not that it *applies*. The
applying half is the browser table above and the one below. What it is really for is the pairing —
the bug is that three rules describe one condition, so the test asserts all three describe the same
one, and any fourth rule that reaches for a bare `.mode-band` in this query goes red.

Red before the change (the bare `.mode-band` is in the guard), green after.

## Measured after the fix

Same script, same server, same article, the change applied by HMR:

| viewport | mode | `--dock-bottom` | `.dock` top | before | verdict |
|---|---|---|---|---|---|
| 844 × 390 | plain | `0px` | 390 | 390 | unchanged |
| 844 × 390 | outline | `0px` | **390** | 350 | **the dock leaves** |
| 844 × 390 | glossary | `0px` | **390** | 350 | **the dock leaves** |
| 844 × 390 | search | `0px` | **390** | 350 | **the dock leaves** |
| 844 × 390 | chat | `0px` | **390** | 350 | **the dock leaves** |
| 844 × 390 | summary | `0px` | **390** | 350 | **the dock leaves** |
| 390 × 844 | plain | `0px` | 844 | 844 | unchanged |
| 390 × 844 | outline | `calc(2.5rem + 0px)` | 804 | 804 | **still pinned**, as it must be |
| 390 × 844 | glossary | `calc(2.5rem + 0px)` | 804 | 804 | **still pinned** |

`.reader.band-covers` reads `false` in every landscape row and `true` in every portrait one, so the
switch is the condition doing the work rather than a coincidence of widths.

## Stages

1. The failing test, watched go red. ✅ three assertions, all red for the right reason.
2. The three rules, and the comments that carry their reasoning. ✅
3. Re-measure in the browser at both orientations, in every band mode, and check the portrait case
   is unchanged rather than merely checking the landscape case is fixed. ✅ — and it is what removed
   the second guard argument (§ The second argument).
4. `npm test`, `npm run typecheck`, GPT Sol on the built diff. ⏳ **not done** — `npm test` refused
   to start twice (*"REFUSING TO START: not enough memory on this machine"*, the admission policy in
   `vitest.config.ts`), and Greg asked for the box to be left alone for a few hours. Nothing here is
   verified beyond the browser measurements above until this stage runs.
