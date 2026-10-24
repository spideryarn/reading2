---
reports: spya-w5yavh
ending: shipped
---

# The author lookup tries harder: it reads the author's page and proposes likely addresses

Report #686, `spya-w5yavh` (Sentry SPIDERYARN-READING2-NJ), Greg as admin, a suggestion on
`/admin/vouchers?tab=drafts`, 2026-10-23 22:39 UTC:

> When trying to find an email for an author gift, it'd be great if you could try slightly harder.
> So, for example, you know, I did a bit more Googling myself, and I found an email address listed
> as an image here that I feel like you could have spotted.
>
> https://tinlizzie.org/~awarth/
>
> Or alternatively, maybe you could have tried to guess, based on other Incan Switch people, what
> the email address might be. And so you could list a few with tooltips for me with a level of
> confidence for each or something, just to save me Googling around myself.

**Ending: shipped**, on `dev`.

Why it missed: that page writes `alexwarth`, an image of an `@`, and `gmail.com` in three table
cells, and the search engine's text drops images, so no address existed in anything the lookup read.

When no address is found now, the lookup fetches the author's homepage and contact page itself,
reads an `@` or a dot drawn as an image and the usual disguises (`name [at] host [dot] com`), and
lists the addresses it did **not** apply under the card — found on a page, seen in a search result,
or guessed from a colleague's address at the same institution (Ink & Switch, here) — each marked
*likely*, *possible* or *long shot*, with a tooltip saying where it came from. Nothing on the list
reaches the draft until Greg presses *Use this address*. On his own example it finds
`alexwarth@gmail.com` and marks it *likely*. Plan, reviews and decisions:
[261024j](../plans/261024j-author-lookup-tries-harder-reads-the-author-s-page-and-proposes-likely-addresses.md).
