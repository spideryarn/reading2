# Phones and touch screens: the map

Up: [reading-view-overview.md](reading-view-overview.md)

**What is different on a phone, on an iPad and under a finger, what Greg has asked for, and where
the code that does it lives.** This doc is a map. It restates nothing: every policy below is one
line and a link to the doc that owns it, and the two that own most of them are
[touch.md](touch.md) (what a finger does) and [narrow-windows.md](narrow-windows.md) (what a narrow
window gives up). Change a policy there, and add its line here.

It exists because Greg asked for it, 2026-10-03 (`spya-ub4jnc`):

> it may be worth, if we don't already, having a document for touch devices and maybe even sort of
> iPhone or portrait iPhone specifically, with signposts to where we're doing stuff that's
> iPhone-specific and what policies we're applying that are specific to touch devices and whatever,
> and capturing my intent from previous conversations and feedback reports and stuff like that.

## There are three questions, not one device

Nothing in the code asks "is this an iPhone?" to decide a layout. It asks one of three separate
questions, and a phone in portrait is simply the device that answers yes to all of them:

| The question | How it is asked | What depends on it |
|---|---|---|
| **Is the window narrow?** | the window's width, in `layout.ts` arithmetic and one media query | which columns fit; whether a mode covers the article |
| **Is the pointer a finger?** | `(pointer: coarse)`, `(any-pointer: coarse)`, `(hover: none)`, `pointerType` | how big a control is; tap-to-reveal instead of hover |
| **Is the screen cut into?** | `env(safe-area-inset-*)` | where the bars start under a notch or a clock |

So an iPad in portrait is a finger in a wide window, a narrow desktop window is a mouse in a narrow
one, and each gets only its own half. Before adding a rule, decide which question it answers.
`pointer` against `any-pointer` is the choice that goes wrong most often:
[touch.md § How big a thing has to be to press it](touch.md#how-big-a-thing-has-to-be-to-press-it).

## What Greg has said

His words, oldest first. Each is quoted where it was first written down; follow the link for the
rest of what he said and what was done.

**The phone is second to a larger screen, and it should say so once.**

> Spideryarn does not work that well on a mobile phone. It works, but because of the small screen
> the experience is suboptimal.
>
> — Greg, 2026-10-01 (`spya-fcbnhq`,
> [note](../user-feedback/261001_2003-a-phone-banner-on-the-shelf.md))

**A phone in portrait shows the mode or the text, never both, and that is accepted.**

> We have special behavior for portrait on an iPhone because it's just not possible to show a mode
> and the text at the same time in a sort of meaningful way. So when the mode is visible, it's
> visible, and if you click somewhere, it takes you to the article. And that's okay. It's probably
> the best compromise.
>
> — Greg, 2026-10-03 (`spya-kudr63`,
> [note](../user-feedback/261003_1514-skim-arrows-stay-on-a-phone-and-stops-shared-across-depths.md))

**In landscape it should show both.**

> If possible, I'd really like to be able to see a Mode (e.g. Outline) + Text side-by-side when
> viewing on a modern iPhone in landscape mode.
>
> — Greg, 2026-09-06
> ([plan](../plans/260906h-the-mode-band-beside-the-prose-on-a-phone-in-landscape.md))

**Every bit of the screen counts, in both directions.**

> let's make portrait and landscape consistent for small devices, because every centimetre of real
> estate in either dimension is valuable
>
> — Greg, 2026-08-27 (quoted in `styles/narrow-window.css` § a small device)

> especially on mobile we want the margins either side of the text to be minimal, to maximise the
> space we have for the text.
>
> — Greg, 2026-09-05
> ([plan](../plans/260905c-gutter-shows-as-many-icons-as-the-row-has-room-for.md))

**The bars should get out of the way and come back on a scroll.**

> The dock used to disappear on iPhone and only reappear when I scroll. That was good because then I
> mostly had a full screen, but if I wanted the bar all I had to do was scroll.
>
> — Greg, 2026-09-07 (`spya-a353as`,
> [note](../user-feedback/260907_1741-dock-always-visible-in-landscape.md))

**Where a phone cannot show Structure beside the text, the breadcrumb is how you know where you
are.**

> The rail at the top that shows where I am is especially valuable on iPhone in portrait mode
> because I can't show the structure mode and the text at the same time.
>
> — Greg, 2026-10-03 (`spya-ub4jnc`)

**A short landscape band should spend its height on the result, not on its own header.**

> I can't use the Quotes or Glossary modes very well on landscape iPhone because all the stuff at
> the top of their columns takes up the vertical real estate, and I can't see the actual result.
>
> — Greg, 2026-09-10 (`spya-gcdwps`,
> [note](../user-feedback/260910_2051-quotes-and-other-bands-on-a-landscape-phone.md))

**Rotating must not lose your place.**

> I'm still having issues where, you know, if I switch from portrait to landscape or if I click on
> things, it takes me to other bits of the article and I sort of lose my place.
>
> — Greg, 2026-09-12 (`spya-d3a7bf`,
> [note](../user-feedback/260912_1227-back-to-x-across-modes-and-after-a-rotation.md))

**The iPad is a first-class place to read.**

> We're going to want to read on an iPad a lot.
>
> — Greg, 2026-08-26 ([touch.md](touch.md))

**Things have to be big enough, and far enough apart, for a finger.** He has said this five times,
of the bottom bar (2026-08-28), the gutter icons (2026-09-04 and again on 2026-10-03, *"I feel like
I've asked this at least once before"*), the shelf's menu and the close cross (2026-10-01). All
five are in [touch.md](touch.md) and
[narrow-windows.md § What a control owes a finger](narrow-windows.md#what-a-control-owes-a-finger).

**Hover has to have a tap.**

> Make it work well for both desktop and mobile devices, i.e. hover-tooltips if there's a mouse,
> otherwise click to show, etc.
>
> — Greg, 2026-09-03
> ([plan](../plans/260903l-glossary-underlines-in-every-mode-and-the-touch-card-that-closed-itself.md))

## The policies, and who owns each

**A narrow window (a phone in portrait, or any window that small)**

- **A mode covers the article instead of sitting beside it** when the two will not fit. A link in the mode steps it aside to show the passage, with a chip to come back.
  [narrow-windows.md § The reading view's narrow window](narrow-windows.md#the-reading-views-narrow-window-which-is-a-different-problem),
  [touch.md § A passage link in a covering band shows the passage](touch.md#a-passage-link-in-a-covering-band-shows-the-passage).
  The one exception is Skim's arrows, which stay in Skim: [skim.md](skim.md).
- **One banner, once**, saying both will not fit and naming Plain as the way back; a second on the
  shelf, which asks about the device rather than the window.
  [touch.md § One banner, once, when both will not fit](touch.md#one-banner-once-when-both-will-not-fit).
- **The headings breadcrumb runs to three lines**, where on wider windows it is one:
  the ancestors on the first, the section you are in on up to two more. The bar's height is fixed
  for the width, so crossing a heading never moves the article. It is not drawn while a mode
  covers the article. Its two rows are smaller to press than the rule below asks, and
  `styles/crumbs.css` § a narrow window says why. [experimental-features.md](experimental-features.md),
  [261003n](../plans/261003n-where-am-i-rail-on-two-or-three-lines-on-a-phone-in-portrait-and-a-phone-portrait-doc.md).
- **Rows wrap rather than shrink; a bar that cannot fit scrolls sideways rather than dropping
  controls.** [narrow-windows.md § Narrow windows: wrap, do not shrink](narrow-windows.md#narrow-windows-wrap-do-not-shrink).
- **The margins beside the prose are minimal.**
  [narrow-windows.md](narrow-windows.md), and `styles/narrow-window.css` for the gutters.

**A small device, either way up**

- **The bottom bar leaves while you read forwards and comes back when you scroll back.** The top
  bar does that at every width, except while it holds the breadcrumb.
  [touch.md § How big a thing has to be to press it](touch.md#how-big-a-thing-has-to-be-to-press-it).
- **A band's order buttons are one line that scrolls sideways on a touch screen**, and Quotes
  draws no head row above them, so a short landscape band spends its height on the result.
  [quotes.md](quotes.md),
  [touch.md § And it did not reach the mode bands](touch.md#and-it-did-not-reach-the-mode-bands).

**A finger**

- **Big enough to press**, and only for a coarse *primary* pointer.
  [narrow-windows.md § What a control owes a finger](narrow-windows.md#what-a-control-owes-a-finger).
- **The first tap shows what hover would have shown; the second acts.** The left rail, the gutter,
  glossary terms, links, the shelf's actions.
  [touch.md § The gutter, and the row a finger is on](touch.md#the-gutter-and-the-row-a-finger-is-on),
  [links.md](links.md), [tooltips.md](tooltips.md).
- **The prose scrolls natively, one axis at a time.**
  [touch.md § Why the prose is untouched](touch.md#why-the-prose-is-untouched).
- **A selection made by a finger gets a button**, because iPadOS shows its own menu and no
  `mouseup` arrives. [touch.md § A finger's selection gets a button](touch.md#a-fingers-selection-gets-a-button).
- **Enter on a soft keyboard sends, and the keyboard goes away.** A text field is large enough that iOS does
  not zoom into it. [touch.md § What the Enter key promises](touch.md#what-the-enter-key-promises).
- **A mode says its name when pressed**, since there is no hover to ask.
  [touch.md § A mode says its name when you press it](touch.md#a-mode-says-its-name-when-you-press-it).

**The screen itself**

- **Nothing may assume the page starts at a safe pixel.** The bars sit below the clock and inside
  the notch. [narrow-windows.md](narrow-windows.md), last section.
- **Installed to the Home Screen there is no Back button and no browser chrome**, so every jump
  needs its own way back, and a link must not open over the app. [links.md](links.md).

## Where the code branches

`src/web/` throughout. The breakpoints are few on purpose; before adding one, see whether an
existing question already answers it.

| What | Where | Note |
|---|---|---|
| **a narrow window** | `styles/narrow-window.css` § a narrow window; the same query in `styles/crumbs.css`, `styles/feedback.css`, `styles/dock-quick-search.css` | the number is derived from `layout.ts`'s constants, not chosen, and `tests/spine-width.test.ts` pins it |
| **a small device**, narrow or short | `styles/narrow-window.css` § a small device | the bottom bar's hiding. The `max-height` half is what catches a landscape phone |
| **a mode covers the article** | `layout.ts` § `bandCoversProse`; `Reader.tsx` writes `.band-covers` | arithmetic, not a media query, because it moves with `?spine=0` |
| which columns fit | `layout.ts` § `fitView`, `fitMode`; `reader/measure.ts` § `useWindowWidth` | the width is the page's less the notch, and is re-measured on rotation |
| the bottom bar's fit | `dock-fit.ts`, `styles/dock-fit.css` | measured, not a breakpoint |
| **a phone**, as a device | `small-screen-hint.ts` § `isPhone` | a coarse pointer and a small *screen*, not window, so rotating does not change the answer |
| **iOS**, by user agent | `install-hint.ts` | the only user-agent test that changes what is drawn: the Add to Home Screen hint |
| size for a finger | `@media (pointer: coarse)` in `narrow-window.css` § a coarse pointer, and in `footnotes`, `glossary`, `citations`, `quotes`, `referee`, `crumbs` | primary pointer only |
| rules a touchscreen laptop needs too | `@media (any-pointer: coarse)` in `narrow-window.css` (the 16px field, `touch-action` on the prose), `close.css`, `summary.css`, `gutter.css` | |
| hover that must not stick | `@media (hover: hover)` / `(hover: none)` in `gutter`, `prose`, `quotes`, `glossary`, `debate`, `chat-actions` | iOS keeps `:hover` on after a tap |
| tap against hover, in JS | `useHoverCard.ts`, `useTapReveal.ts`, `Spine.tsx`, `BlockGutter.tsx` | `pointerType`, with `detail` as the fallback: since iOS 18.2 a finger's click can say `mouse` |
| a finger's selection | `TouchSelectionChip.tsx` | |
| the on-screen keyboard | `useVisualViewport.ts` (`--kb-inset`, `putKeyboardAway`); `index.html` (`interactive-widget`) | [feedback.md](feedback.md) has the `dvh` story |
| the notch and the clock | `styles/tokens.css` (`--safe-*`), `safe-area.ts`, `index.html` (`viewport-fit=cover`) | |
| the two banners | `SmallScreenHint.tsx`, `InstallHint.tsx`, `small-screen-hint.ts` | |
| long-press and scrollbar fixes | `-webkit-touch-callout` in `styles/dock.css` and `annotations.css`; `scrollbar-color` in `styles/mode-band.css` | the second is for iPadOS, whose scroll indicator was invisible on a band |
| one-line order rows | `OrderGroup.tsx`, `styles/glossary.css` | |
| measuring a real phone | `ViewportProbe.tsx`, opened with `?probe=1` | a diagnostic: it records what the visual viewport does on the device |

## Checking it

A phone-width window does not exist on a desktop browser, and an emulated one has no notch and no
keyboard: [browser-testing.md](browser-testing.md) and
[browser-testing-playwright.md](browser-testing-playwright.md) say what to use instead, and
[touch.md § What only a real iPad can tell us](touch.md#what-only-a-real-ipad-can-tell-us) says
what no emulation can show.
