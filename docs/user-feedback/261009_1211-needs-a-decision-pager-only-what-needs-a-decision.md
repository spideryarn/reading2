---
reports: spya-nmt06n
ending: shipped
---
# *Needs a decision*: Previous and Next step only through what needs a decision

One admin suggestion from Greg (`feedback-reporter.ts` exit 0), 2026-10-09 12:11 UTC, #515,
SPIDERYARN-READING2-FV, filed from `/changelog#release-146`. This session had no Sentry sign-in
and did not write the Sentry status. The next feedback sweep does that.

> In the feedback earlier needs a decision, we've got these next and previous buttons, but actually
> I only want them to cycle through the next and previous that need a decision, rather than
> anything else. And they should, I guess, be disabled with a tooltip or something if there's no
> more.
>
> — Greg, 2026-10-09 (`spya-nmt06n`)

**Ending: Shipped.** It is on `dev` and not deployed.

What we did, in [261009m](../plans/261009m-needs-a-decision-pager-steps-only-through-waiting-threads.md):

- **‹ Previous and Next › step only through threads in *Needs a decision*.** Threads you have
  replied to, and threads you deferred, are skipped. A deferred question is still open, but
  deferring means "not now", so it is not a stop. Both kinds are still in the contents.
- **The thread you are on is always a stop.** So after you reply to one, or defer it, *Next ›*
  still takes you on to the next one that needs a decision.
- **The counter says what it counts**: *2 of 5 needing a decision*. On a thread that is not one of them it
  says *5 need a decision*, or *No threads need a decision now*.
- **At either end the button is greyed and says why** on hover: *No later thread needs a
  decision*. An iPhone has no hover, so tapping the greyed button puts the same sentence under the
  buttons.
