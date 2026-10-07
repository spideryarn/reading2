---
reports: spya-ar65p3
ending: shipped
comment: Shipped: a sideways iPhone no longer enlarges a band's text. Still waiting on you: should the same kind of line be the same size in every mode? Three choices, from lining up the five or six kinds that recur to leaving it.
---
# Skim's text is bigger than the article's, and a quick review of fonts and sizes

`spya-ar65p3`, filed as a suggestion by Greg (admin; `feedback-reporter.ts` exit 0 on the
production row), 2026-10-06 14:16 UTC, from `/admin/costs` (where the dialog was opened; the
subject is the reading view). Sentry `SPIDERYARN-READING2-DW`. Overseer queue item `qi-d4c5w4fe`.
This session has no Sentry sign-in and did not write the Sentry status; the next feedback sweep
does.

> Why are the fonts in this different? Probably the ones in the Skim mode are too big?
>
> Do a quick review of fonts and font sizes more generally.

**Ending: Shipped.** It is on `dev` and not deployed. The design question the review raised is a
deferred half with its own queue entry (`qi-f8h393sb`), and is on
[awaiting-approval.md](awaiting-approval.md).

What we did, in
[261006k](../plans/261006k-text-size-adjust-for-a-landscape-phone-and-a-quick-review-of-fonts-and-sizes.md):

- **Read the screenshot** from the production row. It is an iPhone held sideways, with Skim's band
  beside the article. Skim's quote and section line are drawn about 1.5 times the size the
  stylesheet asks for; the article and the short one-line labels are at their own size.
- **The cause is, as far as can be told from here, Safari's text autosizing on a landscape iPhone**, which the app never turned off.
  It is not Skim's own sizes, which are smaller than the article's. One rule on `html` turns it
  off for every band, and a test now keeps a decision for each thing Tailwind's reset sets there.
- **The faces differ on purpose**: the quote is the author's serif, the section line is a model's
  title in the monospace ([fonts.md](../project/fonts.md)).
- **The quick review** is in the plan. The faces are in order. The sizes are not on a scale: about
  65 different values, and the same kind of line is a different size in each mode.

**Not seen on a phone.** Nothing on the box has this autosizing, so the fix rests on the
measurement and the documented behaviour. Greg: when a build with it is live, Skim on a phone held
sideways should show the quote smaller than the article text. If it does not, say so and this
reopens.
