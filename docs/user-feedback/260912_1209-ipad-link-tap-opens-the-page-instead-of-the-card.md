# A tap on a link sometimes opened the page instead of the card

**[SPIDERYARN-READING2-3Y](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-3Y)** · reported
2026-09-12 12:09 UTC · kind: problem · from an admin (Greg) · *shipped*

## What the reader said

> Sometimes when I click on a hyperlink to an article, it opens the external article. I'm on an iPad
> and I've shared the app to the home screen. So this is sort of annoying and disruptive. I thought
> we had a mechanism that when you click on a hyperlink, it opens a little panel and gives you
> options, actions. Why isn't that reliably intercepting the click?

Slug `noema-mythology-of-conscious-ai`, Structure mode, build `d358f773`, home-screen iPad.

## What we did

**The mechanism was there; it guessed at the click instead of deciding it.** The card was opened at
the moment the finger lifted, and the click that follows was then cancelled. But the click is what
opens the page, and iOS decides it on its own terms. There are six ways the two disagreed, and each
opened the page with no card:
- a finger that landed just beside a short link, where iOS moves the click onto the link
- a small sideways drift
- a press held a little long
- an Apple Pencil
- the tap that cleared a leftover selection
- a click that arrived late

Two of these were measured in Chrome, the Pencil is documented by Apple, and the first was read in
WebKit's source. Structure mode was not a factor: the prose is the same in every mode.

**Shipped on `dev`:** a tap on anything inside a link is now decided at the click itself. The first
tap shows the card and the second opens the page, however the tap arrived. A click can only open the
page if that link's card was already showing when the finger went down, so a first tap can never
leave the app. A tap that only clears a selection now does nothing, where before it opened the page.
Mouse, trackpad and keyboard are unchanged. GPT Sol reviewed the plan (and turned down the first
design for this one) and then the code.

**Not changed:** links in a chat answer still open on the first tap. That was decided for them
earlier ([links.md § The links chat writes](../project/links.md#the-links-chat-writes)), and they
print the destination's host in the answer instead. Say if you want them to behave the same way.

Not yet on production, which is Greg's to deploy. It needs a real iPad to confirm: tap just beside a
link, drift a little, and use the Pencil.

[The plan](../plans/260915a-ipad-link-taps-that-escape-the-link-card.md) ·
[the postmortem](../postmortems/260915a-a-tap-judged-at-pointerup-and-acted-on-at-click.md) ·
[links.md](../project/links.md#on-a-coarse-pointer-the-first-tap-reveals-and-the-second-opens) is
the doc.

**Decided 2026-09-24, on Greg's delegated judgment (Fable arbitrating): chat links keep opening on
the first tap.** A chat link is sparse and tapped on purpose, already prints its real host beside the
label, and its card has no fetched preview, so a card-first tap would be a second tap to see less.
What would change it: a report of a chat link escaping by accident, or chat links gaining a fetched
preview.
