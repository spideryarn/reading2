---
reports: spya-u264yb
ending: shipped
---
# Marginalia's "needs a wider window" line cannot be dismissed and does not fade

`spya-u264yb`, filed as a suggestion by Greg (admin; `feedback-reporter.ts` exit 0 on the
production row), 2026-10-06 14:15 UTC, from `/admin/costs` (where the dialog was opened; the line
is in the reading view). Sentry `SPIDERYARN-READING2-DV`. Overseer queue item `qi-tdwvz53m`. This
session has no Sentry sign-in and did not write the Sentry status; the next feedback sweep does.

> It's fine that it shows the "The note need a wider window - press Marginalia again to swap them in for the panel" - that's helpful. But there's no way to dismiss it, and it doesn't fade after a few seconds.

**Ending: Shipped.** It is on `dev` and not deployed.

What we did, in
[261006i](../plans/261006i-marginalia-narrow-notice-fades-and-can-be-dismissed.md):

- **The line goes by itself after about five seconds**, fading, and not while a mouse is over it
  or the keyboard's focus is on it.
- **It has a ×** that sends it away at once.
- **Nothing is remembered.** It shows again each time Marginalia newly ends up on with no room for
  the notes, so the mode still says why it drew nothing. Remembering the dismissal on the device
  was passed over for that reason; the plan says how to turn it the other way.
- The toast after a Feedback report shares the same clock now, and with it one fix: a tap from a
  finger or a Pencil can no longer stop either clock for good.

Seen in a browser on the box at 800px with a band and at 590px without. The report's screenshot was
not read.
