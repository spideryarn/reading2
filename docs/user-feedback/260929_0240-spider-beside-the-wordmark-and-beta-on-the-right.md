---
reports: spya-batuwx
ending: shipped
---
# The spider beside "Spideryarn Reading", and Beta on the right

SPIDERYARN-READING2-4X, from Greg (admin), in production, build `cba650a3`, on the signed-out
landing page. The time in the file name is when this session received the report from the Overseer,
not Sentry's *First Seen*, which this session could not read.

> On the logged-out landing page, include the Spideryarn logo next to "Spideryarn Reading" (in the
> top left, and bottom-left). And same for logged-in footer.
> And move the "Beta" to the right-hand-side of the Header (just before "Features") so it's a bit
> less prominent.

**Ending: Shipped** — on `dev`, not deployed. Resolve 4X (this session has no Sentry sign-in, so the
next feedback sweep does the status write).

What we did:

- **The spider now sits inside the one `Wordmark` component**, so the landing page's top bar, its
  footer and every other footer (the signed-in shelf, `/profile`, `/pricing`, …) got it at once, and
  nothing can draw "Spideryarn Reading" without it. It plays the same hover animations as the other
  copies of the logo: in the top bar on hover or a long press, in the footer on hover or a tap.
- **Beta moved** to the right of the top bar, first in the row, so it sits just before Features on
  the landing page. It is still hidden on a phone, as before.
- **One knock-on change:** signed in, `/features`, `/pricing`, `/read/public` and
  `/features/public-readable-sharing` used to draw the fixed corner logo *on top of* that same top
  bar, which would have been two spiders in one corner. The corner copy is gone from those four; the
  top bar is the way home there. GPT Sol's plan review found it.

Checked in the browser at 1440, 390 and 320 wide. Nothing overflows sideways at phone width, and the
bar stays on one row. Light and dark look the same, because the app is dark-only.

**Seen in passing, not fixed:** signed in on a phone at `/features`, the Feedback button in the
top-right corner sits over the top bar's `Home` link. It predates this change.

Plan: [260929a](../plans/260929a-logo-beside-the-wordmark-beta-to-the-right-no-shelf-tagline.md).
