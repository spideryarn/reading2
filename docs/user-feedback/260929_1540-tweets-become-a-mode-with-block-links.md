---
reports: spya-v6rjvy
ending: shipped
---
# Tweets become a mode, with a wide band and a link from each post to its passage

SPIDERYARN-READING2-5A (report `spya-v6rjvy`), from Greg (admin), sent from `/read/<slug>/tweets`.
The time in the file name is roughly when this session received it; it could not read Sentry for
First Seen.

> In the past, we'd set up the tweet thread mode as kind of its own page, but actually I'm realizing
> that it would work to have it as a normal mode with its own left-hand column alongside the text.
> So let's do that. So instead of it having its own page, it's just going to be a normal mode with a
> left-hand column. It could be quite a wide left-hand column if that will help to make it be
> readable. And let's also add block links for each tweet item to relevant place in the text for
> that tweet item, so that if I'm reading the tweet item, I can see where in the text it came from.
> And if you can see any other minor ways to improve the interface, feel free to, yeah, make small
> further improvements.

**Ending: Shipped** — on `dev`, not deployed. Resolve 5A (the next feedback sweep does the Sentry
status write).

What we did:

- **Tweets is a mode**, `?mode=tweets`, in the bar's first group after Summary. Its band is wide: it
  grows up to 34rem (544px at the usual font size) where the window has room, beside a full prose
  column. The old `/read/<slug>/tweets` address redirects to it.
- **Each post links to the passages it came from** — one to three per post, with the same block
  links the other modes use. A click scrolls the text to the paragraph and flashes it. That needed a
  prompt change (`tweets/5`): threads written before today have no links, and say so in one quiet
  line pointing at Metadata's *Re-run AI processing → Thread*.
- **Small improvements:** the posts are a list with hairlines between them rather than a stack of
  boxes; each post leads with its number; the "posts over 280 characters" line is quieter, since each
  post's own count already turns red.
- **Unchanged on purpose:** opening Tweets with no thread still writes one straight away (your
  2026-09-12 request), but restoring the last view from the shelf no longer does.

Browser-checked at 1440, 1100 and 390px wide. On a desktop, four of five links checked landed on
the matching paragraph, and the fifth on a related one.

**Left for you, not done:** on a phone the band covers the article, so tapping a passage link scrolls
text you cannot see until you leave the mode. Every mode behaves this way (FAQ, Quotes, Glossary), so
a fix — closing the band when a link is tapped on a phone, say — is an app-wide choice.

Plan: [260929f](../plans/260929f-tweets-become-a-mode-with-a-wide-band-and-block-links.md).
