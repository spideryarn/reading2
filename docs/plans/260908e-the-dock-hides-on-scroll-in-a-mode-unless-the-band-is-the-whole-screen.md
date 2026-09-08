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

Headless Chrome on the box, this worktree's dev server, the local copy of the article in the report
(`after-work-we-ll-have-each-other-spya-we6h75`), viewport set by hand, scrolled forwards with real
wheel events until `data-bars` flipped. The scripts are `fb2f-portrait.mts` (both orientations,
three modes), `fb2f-focus.mts` (five modes, reading `document.activeElement` back) and
`fb2f-verify.mts` (scroll down, scroll back up, focus a field) in this session's scratchpad; each
drives `signedInBrowser()` from `scripts/browser-sign-in.ts` and reports `--dock-bottom`, the
dock's measured `top`, and whether `.reader.band-covers` is present, so no row can be satisfied by
a page that rendered nothing.

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

It is spelled `:where(.reader.band-covers) .mode-band`, and the `:where()` is the specificity.
`:has()` takes its most specific *argument*, and the most specific one in that list is
`.dock:focus-within` at (0,2,0) — which with the outer `:root` is the (0,3,0) the guard has always
been. Written plainly the new argument would be (0,3,0) on its own and take the guard to (0,4,0);
`:where()` contributes zero and leaves it exactly where it was, still beating
`:root[data-bars="hidden"]`'s (0,2,0) outright.

**The first version of this plan got that arithmetic wrong** — it called `.dock:focus-within`
(0,3,0), which is the whole old selector rather than the argument, and so claimed a specificity had
been preserved when it had been raised by one. GPT Sol caught it. Nothing would have broken today;
what would have broken is the comment that tells the next reader what the number is, which in this
file is the only record there is.

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
shorter and is wrong. Where the band covers the article there is nothing else on the screen to
swipe, and several of those panels' scrollers set `overscroll-behavior: contain` (`summary.css`,
`ideas.css`, `timeline.css`, `quiz.css`, `debate.css`), so a swipe inside one does not chain to the
document. A reader in portrait whose dock had slid away would have no gesture that brings it back
and no masthead either — `.reader.band-covers:has(.mode-band) .masthead { display: none }`. That is
Greg's August complaint, restored in a worse form.

*Several*, not every: this plan said "every band scroller" until GPT Sol checked and found
`.gloss-list`, `.srch-saved`, `.srch-hits` and `.quotes-list` with no `overscroll-behavior` at all.
Several is enough for the argument — the guard has to hold for the panels that trap, and holding it
for the ones that do not costs a bar nobody was going to scroll away — but the stronger sentence was
false and is the kind that gets quoted back as established later.

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

## The same bug on the other bar, for a visitor

`shell.css` has the twin of this guard for the **top** bar, and it had the identical defect. It
looked safe: since [260908a](260908a-the-top-bar-stops-being-drawn-when-it-has-nothing-in-it.md) the
bar is not drawn at all in a band mode, so the leading `:has(:where(.reader) > .controls)` never
matches. That is true for an **owner**. `barHasContent` in [layout.ts](../../src/web/layout.ts)
opens:

```ts
if (!bar.owner) return true; // the read-only chip
```

So a **signed-out reader on a public article** has a `.controls`, and both `shell.css` rules pinned
their top bar in every band mode at every scroll position — the reported bug exactly, on the other
bar, one reader type wide. Nobody reported it because the reader who hits it is the reader least
likely to write in.

**Fixed here rather than deferred, and that reverses a call this plan made twice.** The argument for
leaving it was scope: a different bar, a different plan's surface. The arguments against won —
it is the same class named in the same session, the fix is the same word with unchanged specificity,
GPT Sol reviewed the code and said to make it, and CLAUDE.md's rule about bugs is that *"the point is
never the incident, it is the class it belongs to, named"*. Shipping a fix for owners while
knowingly leaving it broken for visitors is not a scope boundary, it is a worse bug with a tidier
diff. Greg, 2026-09-08: *"Use your judgment re decisions."*

## The 56px strip this change would have created

**The one finding that changed the code rather than the comments**, and the one nothing here could
have caught: the install hint renders only on an uninstalled iPhone, so no headless run has ever had
one.

`:root:has(.install-hint) { --hint-h: 3.5rem }`, and both `.mode-band` and the table's overflow fade
sit at `calc(max(var(--dock-bottom), var(--safe-bottom)) + var(--hint-h))` — already following the
bar down, because a panel stopping at the bar's *resting* height would show a strip of article
through the gap. But `--hint-h` follows nothing. So with the dock now leaving in a side-by-side band
mode, the hint slid away with it and **the band went on stopping 3.5rem above the bottom of the
screen**: reclaiming 40px of dock at a cost of 56px of nothing. Strictly worse than the bug.

It is the same defect as `-2E` — room reserved for furniture that is not there — at the other end of
the page, and it was already reachable in Plain for the table's fade before any of this. The fix is
the pair the dock already has, given to the hint:

| | resting, reserves document space | current, furniture positions against |
|---|---|---|
| dock | `--dock-space` | `--dock-bottom` |
| hint | `--hint-h` | **`--hint-now`** (new) |

`--hint-now` is `var(--hint-h)` by default and `0px` in the same rule that translates the hint away;
`.mode-band` and `table.css`'s fade read it instead. **`--hint-h` deliberately does not move** — it
is what `.reader`'s `padding-bottom` reserves, and document padding that changed on scroll would
resize the document underneath `stepBar` while it is deciding whether the reader scrolled.

## The half-measure, and the state model that replaced it

The first attempt at the section above added `--hint-now` and left the hint's two rules keyed on
`:not(:has(<covering band>))`, with a comment claiming the old mismatch "predates this change and is
not widened by it". **That claim was false, and GPT Sol's second code review is what caught it.**

Before this plan those rules read `:not(:has(.mode-band))`, so *any* open band stopped the hint
moving. Narrowing `<band>` to a covering one made a state reachable that never had been: in a
side-by-side band mode with `data-bars="hidden"`, anything that brings the dock home — a drawer, a
dialog, dock focus — left the hint translated off the screen and its room unreserved, because the
hint's rules excluded only a covering band while the dock's guard has six arms.

The sharpest form is `.install-hint:focus-within`, which is *in* that guard: the bar is held still
so a keyboard reader does not lose the control they are on, while the strip **containing that
control** slides out from under them.

So the three rules became two, and the fix is the one Sol proposed in the first review:

```css
:root[data-bars="hidden"] {            /* the bar leaves */
  --dock-bottom: 0px;
  --hint-now: 0px;
  --install-hint-transform: translateY(calc(100% + var(--dock-space)));
}
:root:has(…six arms…) {                /* and whatever brings it back */
  --dock-bottom: var(--dock-space);
  --hint-now: var(--hint-h);
  --install-hint-transform: translateY(0px);
}
```

`.install-hint` in `dock.css` reads `--install-hint-transform` with a `translateY(0px)` fallback for
every width where nothing sets it. **Three conditions became one**, the hand-kept negation of a
six-armed guard is gone, and the two rules that used to duplicate it are deleted. Measured at
844 × 390 with a hint injected, across four transitions:

| | `--dock-bottom` | `--hint-now` | gap under band | hint on screen |
|---|---|---|---|---|
| scrolled down | `0px` | `0px` | 0 | no |
| focus inside the hint | `calc(2.5rem + 0px)` | `3.5rem` | 96 | **yes** |
| blurred | `0px` | `0px` | 0 | no |
| a drawer opens | `calc(2.5rem + 0px)` | `3.5rem` | 96 | **yes** |

96 is 40px of dock plus 56px of hint, which is what the band should clear when both are there.

**Nothing about the install hint is deferred any more.** The one thing this plan says it left alone
and then did not is worth naming as a pattern rather than a one-off: twice the cheap fix looked
separable from the expensive one, and twice it was not, because the cheap fix moved a condition that
something else was quietly negating.

**A measured "the keyboard is up".** § The second argument, above.

## The plan review

`260908e-plan-review-sol.md`, GPT Sol, before the build. Verdict *"build it with changes"*, and it
independently reached the autofocus finding the browser had already produced — `SearchPanel.tsx`
and Chat both park focus in their field, so `:focus-within` "recreates the original proxy bug under
a new name". Two of its findings were real errors and are fixed above (the specificity arithmetic;
the overstated `overscroll-behavior` claim), one killed an assertion in the test that would have
rejected the correct fix, and one — the install hint — is recorded as deferred rather than taken.

It also confirmed, against `layout.ts` and `Reader.tsx`, that `.reader.band-covers .mode-band` is
true exactly when the band covers the prose: `?spine=0` moves the boundary to 688 and is handled,
`?text=0` cannot break it because a band forces prose on, and Plain and Hierarchy may carry
`.band-covers` but render no band, so the descendant selector stays false. And it found no
demonstrated stranded side-by-side state, which is the fix's central safety claim.

Note that it reviewed the plan **as first written**, with the `:focus-within` arm still in it.

## The code review

`260908e-code-review-sol-1245.md`, of the built diff, and weighted higher than the plan review for
the reason CLAUDE.md gives — a plan-stage review cannot find what the code does. Verdict *"land it
with changes"*, five findings, and **the first of them was worth the whole exercise**: it is the
56px strip above, which no test and no browser run here could have seen, and which would have
shipped as a regression on exactly the device the report came from.

Of the rest: the `shell.css` visitor case (found here independently, § What was left alone); a stale
specificity paragraph from 2026-08-28 that still contradicted its own correction four lines down;
the `overscroll-behavior` list, struck a second time for being an inventory when it had already been
struck for being a universal; and two more holes in the static test.

It confirmed the things that most needed confirming: `.reader.band-covers` is written on the same
React render as the band, so there is no frame where the band exists and the class does not; and it
found no state where the semantic selector leaves the dock unreachable.

**It also named the two dimensions the measurements never covered** — an uninstalled iPhone with the
install hint, and a signed-out visitor with a controls bar. Both are now measured, and both were
hiding a bug: § The 56px strip and § The same bug on the other bar.

## The third review

`260908e-delta-review-sol-1320.md`, of the two changes made in answer to the second. Verdict *"land
it with changes"*, and it was right again: the `--hint-now` arithmetic and the visitor-bar change
were correct, and the half-measure described in § The half-measure was not. It also confirmed the
things worth confirming — that `--hint-now: var(--hint-h)` resolves from the *winning* `--hint-h`
rather than freezing at the token's `0`; that the two consumers moved are the only current-position
readers (the reader padding, the dialogs, the offline strip, the return chip and the hint's own
height all want resting geometry, and were right to be left); that `--hint-now` cannot feed document
height and so cannot reach `stepBar`; and that both shell selectors are unchanged at (0,4,0) and
(0,3,0).

It asked for one more thing, which is done: `ViewOnlyChip`'s comment claimed the chip is *"on screen
at every scroll position"*. That stopped being true on 2026-09-07 when the top bar started hiding at
every width, and this change is what makes it visibly untrue for a visitor.

## Stages

1. The failing test, watched go red. ✅ three assertions, all red for the right reason.
2. The three rules, and the comments that carry their reasoning. ✅
3. Re-measure in the browser at both orientations, in every band mode, and check the portrait case
   is unchanged rather than merely checking the landscape case is fixed. ✅ — and it is what removed
   the second guard argument (§ The second argument).

   ⚠️ **but the measured selector was `.reader.band-covers .mode-band`, and what is now in the file
   is `:where(.reader.band-covers) .mode-band`.** `:where()` changes specificity and not matching,
   so the two are the same rule and the table above should still hold — *should*, on the spec,
   which is exactly the kind of claim this project does not accept from itself
   ([silent-success.md](../reusable/silent-success.md)). Re-run
   `fb2f-portrait.mts` / `fb2f-focus.mts` against the new spelling before this lands.
4. `npm test`, `npm run typecheck`, GPT Sol on the built diff. ⏳ **not done** — `npm test` refused
   to start twice (*"REFUSING TO START: not enough memory on this machine"*, the admission policy in
   `vitest.config.ts`), and Greg asked for the box to be left alone for a few hours. Nothing here is
   verified beyond the browser measurements above until this stage runs.
