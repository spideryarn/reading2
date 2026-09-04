# Links on iPad should preview, then open in a new tab

**[SPIDERYARN-READING2-10](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-10)** · reported
2026-09-04 12:40 UTC · resolved 2026-09-04 · *shipped*

## What the reader said

> Clicking on web links seems broken somehow on iPad. What I wanted was for it to first show me a pop
> up about the web link. And then perhaps if I click again it should open it in a new page or
> browser. So I'm using Spideryarn, shared to home page, and so if I click the link I certainly don't
> want it to open instead of Spideryarn, so then I have to click back. I wanted to open in a new
> blank tab or whatever.

**"Shared to home page" is the whole report.** He runs Spideryarn as a standalone home-screen web
app, so a link that navigates in place replaces the app itself — and there is no browser chrome to
come back with.

## What shipped

Every cross-origin `http(s)` link in the prose gets `target="_blank" rel="noopener noreferrer"`, on
desktop too, so there is one behaviour to explain rather than two. On coarse pointers the first tap
reveals the link card and the second opens the tab — the reveal-then-commit pattern the spine bands,
glossary terms and footnote markers already use.

It is written at ingress, by a client-only pass that runs on every load, which means **it reaches
every article already on the shelf** rather than only newly-ingested ones — and every place
`block.html` is later injected, the note preview card and the figure lightbox included. Deliberately
*not* in the shared sanitiser policy: that governs what is *stored* — the export, the public payload,
the model prompts — and none of those should carry a browser-targeting attribute.

*It shipped as a client-only DOMPurify **hook**, and that part was wrong: it made the browser
sanitiser stop being byte-for-byte the server one, and `tests/sanitize-client.test.ts` went red the
same day. Moved to [`src/web/external-links.ts`](../../src/web/external-links.ts), applied by
`sanitizeArticle` immediately after the sanitiser, 2026-09-04 — same behaviour, same timing, and the
security seam back to one policy.*

## The measurement that inverted a comment

`TableView.tsx` had claimed since August that DOMPurify **keeps** an author's `target`. It does not;
it drops it. That was measured rather than assumed, and it matters both ways: it is what makes this
rule safe, because now only our own pass can write a `target`, so there is no author-supplied one to
collide with — and it is why the order is sanitise first, rewrite second.

## The collision, and why it cost no code

About 13% of article links contain a glossary term, and the existing composed-card rule gives the
*term* priority — its second tap opens Glossary, not the link. "Second tap opens the tab" would have
silently reversed a rule the reader has already learned.

**Decision: the existing rule wins.** The glossary term is what this app is *for*; a link is what
every other app has. And it turned out to need no code at all — `closest` returns the innermost
match, so a tap on a term inside a link finds the term and the link is never the hit. Verified in the
browser rather than argued from the source.

## How it was verified, which is the point

This stage was flagged as the riskiest in the batch for a specific reason:
[touch.md](../project/touch.md) records this exact machinery already failing on **every real touch
device while 24 synthetic-event tests stayed green**, because `pointerup` generates the leave events
that closed the card.

So it was driven through Chrome DevTools Protocol `Input.dispatchTouchEvent` at 834×1194 with
`hasTouch` — **genuine browser-generated touch, not synthetic events** — against the real reported
article, with `matchMedia("(pointer: coarse)")` confirmed true:

- 97 external links, all `_blank` + `noopener noreferrer`; 0 in-page fragments given a target.
- Tap 1 reveals and navigates nothing. Tap on a *different* link reveals that one instead.
- Tap 2 opens **exactly one** tab, at the right URL, with `window.opener === null`.
- A 140px drag opens nothing and reveals nothing.
- Term-inside-link, second tap → glossary, no tab.
- Desktop: plain, middle, ⌘-click and Enter each opened one tab and left the reading view in place;
  an in-article fragment still jumped in-app.

The native behaviours were left to the browser rather than reimplemented, which is why modified
clicks and long-press still do what the reader expects.
