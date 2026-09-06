# The mode band stopped short of the notch

**Found 2026-09-03**, by Greg, on the installed iPhone app:

> Most of the modes don't display correctly any more on mobile. When activated, they occlude the
> text (which you can see scrolling behind, peeking out at the top and bottom.

Every mode that opens a band — eleven of the thirteen — left a **59px strip of the article visible
along the top of the screen**, above the panel that was supposed to be covering it, scrolling as the
reader scrolled. On every machine we develop on the same code renders perfectly, and did, in every
screenshot taken of it.

## The real cause

Not the band. **The bar above it.**

`index.html` carries `viewport-fit=cover`, so on a phone the document is laid out across the whole
physical screen and each piece of fixed or sticky chrome adds back the edge it faces
([styles/tokens.css § tokens](../../src/web/styles/tokens.css)). The controls bar does that with
`top: var(--safe-top)` — it starts at the *bottom* of the status-bar strip, which is right, because
that is where a bar belongs on a notched phone.

What sits in `[0, --safe-top)` is then somebody else's job, and on the reading view it was the
masthead's: `padding: calc(1.25rem + var(--safe-top)) …`, the article's title block painting itself
up into the inset.

And `styles/narrow-window.css § a band with no room` — the section that makes a mode a full-screen panel once the
band and the prose cannot share a screen — **hides the masthead**:

```css
.reader.band-covers:has(.mode-band) .masthead { display: none; }
```

That rule is right and stays. But it took away the only thing painting the strip, and put nothing in
its place. Behind the strip is `.reader`, which is the article. So the band covered `[--bar-bottom,
dock]`, the bar covered `[--safe-top, --bar-bottom]`, and `[0, --safe-top)` showed the prose.

The comment sitting directly above that rule says the masthead can go because *"with it gone the
controls bar sticks at zero immediately"*. **On every machine we develop on that sentence is true.**
It is false on exactly the devices the section exists for.

## Which commit

The two halves were written a day apart and neither was wrong on its own:

| | |
|---|---|
| `676c9371`, 2026-08-27 | *On a phone every line was cut in half…* — the covering-band section, including hiding the masthead. At this point `--safe-top` did not exist and the bar really did stick at zero. |
| `4eede51e`, 2026-08-28 | *The address bar is Chrome's…* — `viewport-fit=cover`, the four inset tokens, `.controls { top: var(--safe-top) }`, and the masthead's inset padding. |

The second commit moved the bar down by the inset and gave the masthead the job of covering what it
vacated. It had no reason to look at a section a thousand lines away that deletes the masthead. So
the defect was **introduced by `4eede51e` and is invisible in either commit read alone** — it lives
in the join.

## The class: a rule whose only failing value is zero on every machine we own

`env(safe-area-inset-*)` is `0px` on a laptop, in headless Chrome, in every CI runner, and in every
screenshot any agent on this project has ever taken. Any rule that reads one has a term that is
*always* the identity here. It cannot be got wrong in a way that shows, and its correctness is
unfalsifiable by looking.

The stylesheet already knew this and said so in § tokens — *"Every one of them is `0px` on every
machine we develop on, which is the hazard… There is nothing to see until it is on the phone. To
check one, set the token to `40px` here and watch the chrome move"* — and named the risk as a
mis-typed `env()` name. The instruction was right and the diagnosis was one case too narrow: the
failure here is not a rule that reads the wrong inset, it is **a rule that reads none while standing
where one is needed**, which no amount of reading the rule itself can reveal.

This is [silent-success](../reusable/silent-success.md) with the check built into the hardware: the
obvious verification (open it, look at it, screenshot it) shares its blind spot with the code,
because both are running on a machine with no notch.

Same shape as `260828av`'s own warning and as
[the chat button that was never in the gutter](block-chat-was-never-in-the-gutter.md): a layout fact
that no test asserted, held true only by somebody looking, at something that could not be seen.

## The second half, at the bottom

Greg said *"top and bottom"*, and the strip above only accounts for the top. The bottom is a
different mechanism, and it is transient — **GPT Sol predicted it from the CSS while reviewing the
first attempt at a fix, before it had been measured.**

The two `data-bars="hidden"` guards in § a small device bring both bars back the instant a
`.mode-band` exists. The band is `position: fixed` and takes its final bounds on the same frame; the
bars have `transition: transform 0.18s`, so they travel back from off-screen. For that window the
band is the right size **with nothing above or below it**, and the article is painted at the top and
the bottom of the screen.

Measured at 390 × 844 with the installed app's insets — scroll until `data-bars="hidden"`, press
Glossary, sample every frame:

| t | top-most at `y: 2` | top-most at `y: innerHeight - 2` | `.controls` bottom | `.dock` top |
|---|---|---|---|---|
| 181ms | `p` in `div.prose` | `p` in `div.prose` | 0 | 844 |
| 410ms | `p` in `div.prose` | `p` in `div.prose` | 0 | 844 |
| 472ms | `.controls` | `.dock` | 103 | 758 |

**180ms is the floor, not the number**: mounting a panel costs frames, and those were real layout
reads rather than dropped ones.

## The fix

Two rules, and neither is the one this was first written as. The first attempt made the bar itself
taller in the covering state (`top: 0; height: var(--bar-bottom); padding-top: var(--safe-top)`).
That worked and was mechanically sound — Sol checked the box model, the hide transform, the flex
centring, the logo and `stickyOffset()` and found no regression — but it was scoped to covering
modes, left Plain and Hierarchy leaking, and grew the document for no visual reason.

**A backstop is better on all three counts**, and Sol's is the version that shipped:

```css
.reader::before {
  content: "";
  position: fixed;
  top: 0; left: 0; right: 0;
  height: var(--safe-top);
  background: var(--page);
  z-index: 39;
}
```

Zero-height everywhere the insets are zero. It changes no layout, it does not need to know whether a
sticky element is currently stuck — which CSS cannot ask — and it is **outside `.controls`**, which
is `overflow: auto hidden` at ≤731px and would clip a pseudo-element of its own. z-index 39 is the
whole of its correctness: over the article and the table head, under the bar (40), the band (44),
the spine (45), the dock (96) and every dialog. It fixes Plain and Hierarchy in the same breath.

An offset `box-shadow` was the other candidate, and is wrong for an arithmetic reason worth keeping:
it leaves a gap whenever `--safe-top > --bar-h`, which is 59 against 44 on the device in question. A
spread `box-shadow` paints over the band below.

And for the transient, the bars arrive rather than slide:

```css
:root:has(.mode-band) .controls,
:root:has(.mode-band) .dock { transition: none; }
```

A slide is how a bar announces that it is *getting out of the way*. A bar coming back because the
reader opened a panel is announcing nothing, and there is nothing to see through in the meantime.

## What would have caught the class

**[`scripts/safe-area-check.ts`](../../scripts/safe-area-check.ts), added with this fix.** It does
what § tokens already told anyone to do by hand and turns it into a red/green run: it injects
`:root{--safe-top:59px;--safe-bottom:34px}` as an *unlayered* rule (styles.css is inside
`@layer app`, so unlayered wins whatever the specificity), opens each of the eleven band modes on a
390 × 844 touch context, and walks `elementsFromPoint` down two columns of the screen asking *is the
top-most thing here the article?*

It asks what is **painted**, not where the boxes are, and that is the half that matters: the boxes
were all the right size in this bug. A geometric check is equally satisfied by a paragraph running
under an opaque bar and by one showing above it. It scrolls first by default, because at the top of
the article the strip may be holding blank page: the same broken build leaked over 12px of screen
unscrolled and 56px scrolled.

**And it carries its own defect, because nothing on this box can make it fail otherwise.**
`--break` switches the backstop off, which is exactly the state Greg reported:

```
SPIDERYARN_BASE_URL=http://localhost:<port> npx tsx scripts/safe-area-check.ts --break
  FAIL glossary  article painted on top at y 1..57 (29 rows) — bar [59, 103] band [103, 758] dock [758, 844]
  FAIL — 3 of 3 mode(s) leave the article visible behind the panel          (exit 1)

SPIDERYARN_BASE_URL=http://localhost:<port> npx tsx scripts/safe-area-check.ts
  ok  glossary  bar [59, 103] band [103, 758] dock [758, 844]
  ok — no mode leaves the article visible behind the panel                  (exit 0)
```

**What it does not cover: the transient above.** It samples a settled page, so the 450ms in which
the bars have not arrived is invisible to it. That was measured by hand, once, and the rule that
fixes it is a `transition: none` — cheap to keep right and not worth a second harness.

Ranked, if only one thing is done:

1. **Run that script when you touch anything in § a narrow window, § a band with no room, § a small
   device, or any rule naming a `--safe-*` token.** It is the only check on this box that can fail
   for this reason. [browser-testing-playwright.md](../project/browser-testing-playwright.md).
2. **Treat "the bar sticks at zero" and its like as claims to be measured**, not as background. The
   sentence that hid this bug was a correct observation about a laptop written into a section about
   phones.
3. A tripwire in the spirit of [`tests/css-tokens.test.ts`](../../tests/css-tokens.test.ts) could
   ask whether every rule that sets `display: none` on an element carrying a `--safe-*` padding is
   accompanied by something else taking that inset. It would be a text scanner over a semantic
   question, and it would have caught this one; it is third because the browser check above is
   strictly stronger and already exists.

---

Up: [AGENTS.md](../../AGENTS.md)
