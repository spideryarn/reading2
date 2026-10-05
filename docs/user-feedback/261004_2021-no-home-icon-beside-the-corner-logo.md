---
reports: spya-gqj660
ending: shipped
---
# No Home icon beside the corner logo

`spya-gqj660`, from Greg (admin; relayed by the Overseer as his own report), filed 2026-10-04 20:21
UTC from `/changelog#release-127`. Sentry confirmed it (event `97d1b40930ca48249b966406c6c3a26c`).
This session did not write the Sentry status; the next feedback sweep does.

> We don't need a Home icon on /changelog, because we have the logo right next to it. Look for
> anywhere else that has a superfluous link back to home at the top and remove that too.

**Ending: Shipped.** It is on `dev` and not deployed.

What we did, for a signed-in reader:

- `/changelog`, `/privacy`, `/contact`, `/opensource` and `/help` no longer show the house icon above
  the heading. The logo in the corner is the way home.
- `/profile` and the admin index no longer show the arrow back to the library, for the same reason.
  An admin page's *Back to Admin* stays: that is not a way home.

Signed out, those five pages have no corner logo, so the house is the only way home there and it
stays.

Left alone, and a question for Greg (**Q-masthead-arrow** in the plan): the back arrow above an
article's title. The logo there is in the bottom bar, not beside it.

Checked in a browser at phone, iPad and desktop widths on local dev. Not checked on a real iPad or
phone, or in Safari.

Plan: [261005a](../plans/261005a-no-home-icon-beside-the-logo-and-a-first-open-default-of-summary-and-marginalia.md).
