# Phones and touch screens: the map

Up: [reading-view-overview.md](reading-view-overview.md)

**What is different on a phone, on an iPad and under a finger, what Greg has asked for, and where
the code that does it lives.** This doc is a map: each policy below is a line, or just a label, and a route to the doc that
owns it, and the two that own most of them are
[touch.md](touch.md) (what a finger does) and [narrow-windows.md](narrow-windows.md) (what a narrow
window gives up). Greg's words are copied here deliberately — the documentation policy's quotation
exception — with their source beside them.

It exists because Greg asked for it, 2026-10-03 (`spya-ub4jnc`):

> it may be worth, if we don't already, having a document for touch devices and maybe even sort of
> iPhone or portrait iPhone specifically, with signposts to where we're doing stuff that's
> iPhone-specific and what policies we're applying that are specific to touch devices and whatever,
> and capturing my intent from previous conversations and feedback reports and stuff like that.
>
> — Greg, 2026-10-03 (`spya-ub4jnc`,
> [note](../user-feedback/261003_1538-where-am-i-rail-three-lines-on-a-phone-and-a-phone-and-touch-map.md))

## There is no one phone switch

The code branches separately on available width and height, pointer and hover capabilities, physical
screen size, safe-area insets, the visual viewport and — for the installation hint — iOS. A phone in
portrait triggers several of those; a narrow desktop window or an iPad triggers only some. The table
below is the inventory. Before adding a rule, decide which condition it actually needs.
`pointer` against `any-pointer` is the choice that goes wrong most often:
[touch.md § How big a thing has to be to press it](touch.md#how-big-a-thing-has-to-be-to-press-it).

## What Greg has said

His words, grouped by the question they answer. Follow each source for the rest of what he said and
what was done.

**The phone is second to a larger screen, and the shelf should say so.**

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

> Let's make portrait and landscape consistent for small devices, because every centimetre of real
> estate in either dimension is valuable.
>
> — Greg, 2026-08-27
> ([plan](../plans/260827t-mobile-reading-view.md))

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
> — Greg, 2026-10-03 (`spya-ub4jnc`,
> [note](../user-feedback/261003_1538-where-am-i-rail-three-lines-on-a-phone-and-a-phone-and-touch-map.md))

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
> — Greg, 2026-08-26
> ([research](../research/260826f-ipad-touch-scrolling.md))

**Things have to be big enough, and far enough apart, for a finger.**

> Please, can we slightly increase the vertical gap between the icons in the gutter next to a block,
> you know, the permalink and the comment and the question. I feel like I've asked this at least once
> before. It's just a little bit hard to touch them with a finger on an iPad.
>
> — Greg, 2026-10-03 (`spya-kwgem6`,
> [note](../user-feedback/261003_0931-gutter-icons-further-apart-for-a-finger.md))

The same intent appears in the bottom-bar ask
([2026-08-28](../plans/260828av-mobile-screen-real-estate.md)), the first gutter ask
([2026-09-04](../plans/260904b-gutter-help-button-and-detached-streaming-chat.md)), and the shelf-menu
and close-cross reports
([2026-10-01](../user-feedback/261001_1920-ipad-touch-targets-shelf-actions-close-crosses-band-scrollbar.md)).

**Hover has to have a tap.**

> Make it work well for both desktop and mobile devices, i.e. hover-tooltips if there's a mouse,
> otherwise click to show, etc.
>
> — Greg, 2026-09-03
> ([plan](../plans/260903l-glossary-underlines-in-every-mode-and-the-touch-card-that-closed-itself.md))

## The policies, and who owns each

**A narrow window (a phone in portrait, or any window that small)**

- **A mode covers the article when the two will not fit side by side**, and a passage link in it
  steps the mode aside to show the passage, with a chip to come back. Some controls deliberately
  stay in the band: Skim's arrows are the first.
  [narrow-windows.md § The reading view's narrow window](narrow-windows.md#the-reading-views-narrow-window-which-is-a-different-problem),
  [touch.md § A passage link in a covering band shows the passage](touch.md#a-passage-link-in-a-covering-band-shows-the-passage).
  The mode-specific routes are [skim.md § What shipped](skim.md#what-shipped) and
  [diagram.md § Interaction](diagram.md#interaction).
- **Phone and fit notices:** why the reader and shelf ask different questions, and when each stops.
  [touch.md § One banner, once, when both will not fit](touch.md#one-banner-once-when-both-will-not-fit).
- **The headings breadcrumb runs to three lines in a taller bar**, where a wider window has one.
  The height is fixed for the width, so crossing a heading never moves the article, and it is not
  drawn while a mode covers the article.
  [experimental-features.md § What is behind it today](experimental-features.md#what-is-behind-it-today),
  [narrow-windows.md § The reading view's narrow window](narrow-windows.md#the-reading-views-narrow-window-which-is-a-different-problem),
  [261003n](../plans/261003n-where-am-i-rail-on-two-or-three-lines-on-a-phone-in-portrait-and-a-phone-portrait-doc.md).
- **Overflow in narrow rows and bars:** which surface wraps and which scrolls.
  [narrow-windows.md § Narrow windows: wrap, do not shrink](narrow-windows.md#narrow-windows-wrap-do-not-shrink).
- **The prose gutters:** what gives way when horizontal space is scarce.
  [narrow-windows.md § The reading view's narrow window](narrow-windows.md#the-reading-views-narrow-window-which-is-a-different-problem),
  and `styles/narrow-window.css` for the gutters.

**A small device, either way up**

- **The bars leave while you read forwards and come back when you scroll back.** The top bar does
  it at every width, and stays put while it holds the breadcrumb; the bottom bar does it only here.
  `styles/shell.css` § the bar that leaves owns the top bar; `styles/narrow-window.css` § a small
  device owns the bottom bar. [touch.md](touch.md) owns the finger-facing intent.
- **Short mode bands:** the order controls' press and overflow rules, and Quotes' head-row decision.
  [quotes.md § The orders, and the bar](quotes.md#the-orders-and-the-bar),
  [touch.md § And it did not reach the mode bands](touch.md#and-it-did-not-reach-the-mode-bands).

**A finger**

- **Press-target sizing:** the primary-pointer rule and the named hybrid-device exceptions.
  [narrow-windows.md § What a control owes a finger](narrow-windows.md#what-a-control-owes-a-finger).
- **Tap versus hover:** the meaning of a tap on each surface, including the cases that act at once.
  [touch.md § What happens where](touch.md#what-happens-where),
  [links.md § On a coarse pointer](links.md#on-a-coarse-pointer-the-first-tap-reveals-and-the-second-opens),
  [tooltips.md § What the card says](tooltips.md#what-the-card-says-and-why-that).
- **The prose scrolls natively, one axis at a time.**
  [touch.md § Why the prose is untouched](touch.md#why-the-prose-is-untouched).
- **Touch selections:** where their action lives when mouse-oriented events do not arrive.
  [touch.md § A finger's selection gets a button](touch.md#a-fingers-selection-gets-a-button).
- **Text fields and the soft keyboard:** Enter semantics, dismissal, and iOS's focus zoom.
  [touch.md § What the Enter key promises](touch.md#what-the-enter-key-promises).
- **Mode names without hover:** the pressed-mode announcement.
  [touch.md § A mode says its name when you press it](touch.md#a-mode-says-its-name-when-you-press-it).

**The screen itself**

- **Safe areas:** which layout tokens own the clock, notch and home indicator.
  [narrow-windows.md § The screen is bigger than the window](narrow-windows.md#the-screen-is-bigger-than-the-window-envsafe-area-inset-).
- **Installed-app navigation:** the way back after a jump and the rule for outbound links.
  [url-state.md § The way back lives until you leave the article](url-state.md#the-way-back-lives-until-you-leave-the-article),
  [links.md § Every link that leaves the app opens a new tab](links.md#every-link-that-leaves-the-app-opens-a-new-tab).

## Where the code branches

`src/web/` throughout. The breakpoints are few on purpose; before adding one, see whether an
existing question already answers it.

| What | Where | Note |
|---|---|---|
| **the reading view's narrow window** | `styles/narrow-window.css` § a narrow window; `styles/crumbs.css` § a narrow window | the query is derived from `layout.ts`'s constants and its copies carry the markers checked by `tests/spine-width.test.ts` |
| other narrow UI | `styles/feedback.css`; the width arm in `styles/dock-quick-search.css`; Chat's list of conversations in `styles/mode-band.css` | local adaptations at the reading view's boundary; quick search also asks whether the pointer is coarse, and draws nothing at all where either is true; a row of Chat's list gets three lines of title and two of preview ([261005h](../plans/261005h-narrow-window-chat-thread-list-gets-more-lines-and-no-lone-quick-search-icon-in-the-bottom-bar.md)) |
| **a small device**, narrow or short | `styles/narrow-window.css` § a small device | the bottom bar's hiding. The `max-height` half is what catches a landscape phone |
| **a mode covers the article** | `layout.ts` § `bandCoversProse`; `Reader.tsx` writes `.band-covers` | arithmetic, not a media query, because it moves with `?spine=0` |
| which columns fit | `layout.ts` § `fitView`, `fitMode`; `reader/measure.ts` § `useWindowWidth` | the width is the page's less the notch, and is re-measured on rotation |
| the bottom bar's fit | `dock-fit.ts`, `styles/dock-fit.css` | measured, not a breakpoint |
| **a phone**, as a device | `small-screen-hint.ts` § `isPhone` | a coarse pointer and a small *screen*, not window, so rotating does not change the answer |
| **iOS**, by `navigator.userAgent` | `install-hint.ts`, `InstallHint.tsx` | the Add to Home Screen hint; other engine checks use different signals (`userAgentData` or `navigator.vendor`) |
| size for a finger | `@media (pointer: coarse)` in `narrow-window.css` § a coarse pointer, and in `footnotes`, `glossary`, `citations`, `quotes`, `referee` | primary pointer only |
| rules a touchscreen laptop needs too | `@media (any-pointer: coarse)` in `narrow-window.css` (the 16px field, `touch-action` on the prose), `close.css`, `summary.css`, `gutter.css` | |
| hover-only styling and touch fallbacks | `@media (hover: hover)` / `(hover: none)` in `gutter`, `prose`, `quotes`, `glossary`, `debate`, `chat-actions` | the glossary, Quotes and gutter guards also stop iOS's post-tap `:hover` from looking selected |
| tap against hover, in JS | `useHoverCard.ts`, `useTapReveal.ts`, `Spine.tsx`, `BlockGutter.tsx` | `pointerType`, with `detail` as the fallback: since iOS 18.2 a finger's click can say `mouse` |
| a finger's selection | `TouchSelectionChip.tsx` | |
| the on-screen keyboard | `useVisualViewport.ts` (`--kb-inset`, `putKeyboardAway`); `index.html` (`interactive-widget`) | [feedback.md](feedback.md) has the `dvh` story |
| the notch and the clock | `styles/tokens.css` (`--safe-*`), `safe-area.ts`, `index.html` (`viewport-fit=cover`) | |
| the two size notices | `SmallScreenHint.tsx`, `ShelfPhoneHint.tsx`, `small-screen-hint.ts` | the installation hint is the iOS row above, not one of these two |
| long-press and scrollbar fixes | `-webkit-touch-callout` in `styles/dock.css` and `annotations.css`; `scrollbar-color` in `styles/mode-band.css` | the second is for iPadOS, whose scroll indicator was invisible on a band |
| one-line order rows | `OrderGroup.tsx`, `styles/glossary.css`, `styles/quotes.css` | |
| measuring a real phone | `ViewportProbe.tsx`, opened with `?probe=1` | a diagnostic: it records what the visual viewport does on the device |

## Checking it

A phone-width desktop window is not a phone, and emulation has no real notch or keyboard:
[browser-testing.md](browser-testing.md) and
[browser-testing-playwright.md](browser-testing-playwright.md) say what to use instead, and
[touch.md § What only a real iPad can tell us](touch.md#what-only-a-real-ipad-can-tell-us) says
what no emulation can show.

**Text that is bigger than its stylesheet says, on an iPhone in landscape only**, is Safari's text
autosizing, which no desktop browser has. `html { -webkit-text-size-adjust: 100% }` turns it off,
since 2026-10-06 ([controls.md § And a fourth](controls.md#and-a-fourth-a-phone-held-sideways)).
