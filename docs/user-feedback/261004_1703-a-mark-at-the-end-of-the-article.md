---
reports: spya-zgf8p2
ending: shipped
---
# A mark at the end of the article

`spya-zgf8p2`, from Greg (admin, proven from the production row; relayed by the Overseer), filed
2026-10-04 17:03 UTC from an article's reading page. Sentry confirmed it (event
`a569525d7e8745628baa4671705f123b`). This session did not write the Sentry status; the next feedback
sweep does.

> Add some subtle pleasant visual marker at the very end of the article in the text column to show
> that it is the end.

**Ending: Shipped.** It is on `dev` and not deployed.

What we did: after the last paragraph of every article there is now a small ornament, centred under
the text: a short hairline, a small diamond, a short hairline. It is there in every mode, for the
owner and for a visitor, stays when the last section is folded, and prints once.

Checked in a browser at desktop, iPad (both ways round) and phone widths, light and dark, on local
dev. Not checked on a real iPad or phone, in Safari, on a signed-out public page, or in a print
preview.

Plan: [261005e](../plans/261005e-an-end-of-article-mark-and-the-publication-date-on-the-shelf-card.md).
