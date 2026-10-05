---
reports: spya-xf6m2u
ending: shipped
---
# A Marginalia card says "press it" and there is nothing to press

`spya-xf6m2u`, a problem from Greg (admin, as the Overseer relayed it), filed 2026-10-05 20:37 UTC
from `2608-13566v1-spya-yurten` with Marginalia on. Sentry event
`bea95a7f28a34e6391405a986f8531d2`. This session has no Sentry sign-in and did not write the Sentry
status; the next feedback sweep does.

> I'm looking at a citation in the Marginalia, and the tooltip says to "press it" but I don't see anything to press.

**Ending: Shipped.** It is on `dev` and not deployed.

What we did, in
[261005l](../plans/261005l-earlier-tab-links-the-page-and-marginalia-tips-say-what-to-press.md):

- **There was something to press: the line itself.** A "Cites" line is a button that opens the
  work's by-line and reference entry underneath. It was drawn as plain text with a small faint
  chevron, and the card said "Press it" without saying what.
- **The card now says "Press this line"**, for a citation, an FAQ question and a Timeline event.
- **The citation card promised something that no longer opens**: "why it is cited", which came out
  of the open line on 2026-10-03. It now promises what is there.
- **The line answers the pointer**: its words are underlined and its chevron darkens on hover or
  keyboard focus, and the chevron is a shade darker at rest.

Not checked against the article the report came from, which is only in production.
