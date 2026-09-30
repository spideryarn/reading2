---
reports: spya-gubw6p
ending: shipped
---
# Back links become icons with tooltips

SPIDERYARN-READING2-50 (2026-09-29 01:42 UTC), from Greg (admin), relayed by the Overseer.

> Can you change the back button text labels at the top of some pages (e.g. "<- Back to the
> article" and "<- Library") to icons with tooltips (because there's already so much text on the
> page). If you see other places where this might be helpful, consider modifying them too.

**Ending: Shipped** — on `dev`, not deployed. Resolve 50 (this session has no Sentry sign-in, so the
next feedback sweep does the status write).

What we did: one component, `BackLink`. It draws an icon with a tooltip that opens to the right, and
an `aria-label` that gives it its name. It is now used on the reading view's masthead ("← Library"),
the Tweets page (the owner's and the visitor's), `/profile` and `/admin`, all as an arrow. On
`/contact`, `/privacy`, `/changelog` and `/opensource` it is a **house** labelled "Home", because
those pages decided on 2026-09-08 to say "Home" rather than "Back": most people arrive there sent from
elsewhere, so there is often nothing to go back to.

**Left as words:** the metadata page's "Back to the article", because another session owns that
page's buttons today (`BackLink` is ready for it to adopt), and "← Shared articles" on the
public-sharing explainer, because it names a place rather than a way back. The last line of `/add`
and the "Back to the article" button in a broken mode's error message also stay as words: there the
words are the instruction.

Plan: [260929c](../plans/260929c-back-links-become-icons-with-tooltips-and-one-animated-wordmark-reused.md).
