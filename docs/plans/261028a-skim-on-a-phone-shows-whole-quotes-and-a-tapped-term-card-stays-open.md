# Skim on a phone: every quote whole, and a tapped term's card stays open

Report `spya-r246pf` (Greg, admin, suggestion, 2026-10-28, Skim on an iPhone in portrait):

> I'm using skim mode on an iPhone. As you know, it shows the mode but not the text. Or I can look at
> the text but not the mode; it only shows one of them at a time. That's fine. As a result, though, I
> think it would probably be helpful if skim mode actually showed the full quotes, because otherwise
> what I keep having to do is click on a quote to be taken to the text and then back to skim mode to
> see the next one. (Although I suppose I could keep just clicking next step in the text. That would
> probably work too.)
>
> The other thing I noticed is that I tried clicking on one of the glossary entries in skim mode on
> my phone, and it didn't seem to show the entry. So I guess that's a bug.
>
> — Greg, 2026-10-28 (`spya-r246pf`)

Up: [skim.md](../project/skim.md), [phone-and-touch.md](../project/phone-and-touch.md).
Postmortem: [261028a](../postmortems/261028a-a-touch-guard-named-one-of-hover-s-two-close-reasons.md).

## 1. The whole quote on every row, where the band covers the article

**What was there.** A row's quote is cut at about 100 characters with the rest in a tooltip; the
current row is whole ([plan 260928e](260928e-trajectory-rows-show-the-quote-words.md)). That plan's
answer for touch was *"a tap makes the row current, and the current row is whole"*. Since 2026-10-03
that is not true where the band covers the prose: a row press goes to the article
([skim.md § On a phone, the head's controls stay in Skim](../project/skim.md)). So on a phone the
rest of every other stop's quote could not be read from Skim at all — which is the loop Greg
describes.

**What we do.** Where the band covers the prose (`covers`, the app's one test for "band and prose
cannot both be seen"), every row's words are drawn whole and none has a tooltip. `SkimView` gains
`wholeWords`, set from `covers` in `useSkimMode`; `rowWords` takes it. Nothing else changes: the
row press still goes to the article, the ‹ › still stay in Skim, a wide window still cuts.

**Why this is not a question for Greg.** His words ask for exactly this on a phone; the change is
one boolean, keyed on an existing condition, and costs a longer list only where the alternative was
unreadable. The options passed over:

- *Whole quotes at every width* — changes the desktop, where the hover tooltip works and a long list
  costs scrolling for no gain. Not asked for.
- *A toggle* — a control and a setting for one case the condition already identifies.
- *Rely on the door's Next stop in the text* — exists already, and Greg names it as a workaround;
  it does not let the reader scan the route's quotes, which is what the list is for.

The Figures walk is untouched: its captions are never cut (`FiguresWalk.tsx` has no cut).

## 2. A finger's term card closed by a hover reason the guard did not name

**Reproduction.** A Sonnet subagent tapped Skim term chips with Playwright on the box
(`fowler-phrenology`, stop 1): Chromium at 390×844 with `hasTouch` and with `isMobile`, Chromium at
1024×768 touch, and Playwright's Linux WebKit at 390×844 `isMobile`. **The card opened and stayed
in every one.** So the failure is in an event sequence only a real iPhone produces, and no harness
here can produce it.

**Diagnosis**, GPT Sol reading the code against WebKit's source, then checked against
`@floating-ui/react`'s own code:

- `TermChip`'s card is a controlled, interactive `Tooltip`. A finger's click pins it (`snippet`);
  any `onOpenChange(false)` from the Tooltip calls `close()`, which unpins.
- `Tooltip.tsx § changeOpen` ignores a close of a finger-opened controlled card only when the
  reason is `"hover"` (`byTouch`).
- An interactive card's hover close goes through `safePolygon`, whose reason is
  **`"safe-polygon"`**: floating-ui's `onReferenceMouseLeave` installs a document `mousemove`
  handler and closes with that reason when the pointer is outside the corridor. That handler is
  not gated by `mouseOnly`, and because the card was opened by the prop rather than by floating-ui,
  `isClickLikeOpenEvent()` is false and does not stop it either.
- So any compatibility `mouseleave` on the chip followed by a `mousemove` elsewhere closes a card a
  finger pinned. The same function already treats the two reasons as one when focus is inside the
  card, a line above.

Ruled out, with reasons in Sol's answer: iOS's content-change observer suppressing the click (no
hover timer is installed for a touch under `mouseOnly`, and a colour change does not count); iOS not
focusing a tapped button (the pin is on the click); clipping (the card is portalled, capped and
scrollable). **Confidence is moderate, not high**: the exact post-tap leave-and-move on Greg's
phone has not been captured. The hole is real either way, and closing it costs one condition.

**What we do.** `changeOpen` ignores `"safe-polygon"` as it ignores `"hover"`, for a controlled
card a finger opened. Escape, a press elsewhere, focus-out, the parent and the delay group still
close it; a real mouse arriving still clears `byTouch`. Test first, red then green
(`tests/skim-panel.test.tsx`, *keeps a tapped card open through a mouseleave and a move away*).

**And one cosmetic iOS fix found on the way:** `.skim-chip:hover` was not behind
`(hover: hover)`, so on iOS a tapped chip kept looking pressed after its card closed. It now is, as
glossary.css's are.

**Verifying it on the device** is the step no harness can do; the note asks Greg to tap a term in
Skim on his iPhone after the next deploy, and an Overseer queue entry holds it until he has.
