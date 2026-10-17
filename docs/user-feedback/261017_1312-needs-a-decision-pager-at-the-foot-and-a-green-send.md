---
reports: spya-bvzavw
ending: shipped
comment: In a Needs a decision thread the dialog's footer now reads Close · ‹ Previous · Next ›, so the next thread is one press from where you finish replying; and Write's Send is green, like Send reply, while Cancel and Close stay grey.
---
# Needs a decision's pager at the foot of the dialog, and a green Send

A suggestion from Greg (an admin; `scripts/feedback-reporter.ts` exit 0 on the production row),
filed 2026-10-17 13:12 UTC from the reading view (#590, `SPIDERYARN-READING2-JB`, queue item
`qi-fx6s4ezn`). Plan and both GPT Sol reviews:
[261017c](../plans/261017c-feedback-needs-a-decision-pager-at-the-foot-and-send-vs-close.md).

> When responding to Needs-Input in Feedback, add Next/Previous buttons at the bottom of the box as
> well (since often that's where I am when I finish responding). Or some other way to make it easy
> for me to get to/deal with the next thing.
>
> P.S. In the bottom right of Feedback/Write, the "Send" button submits. But in the bottom-right of
> Needs-Input, the Close button effectively cancels. How can we signal the difference to the user?
> Colour? Position? Something else?
>
> — Greg, 2026-10-17 (`spya-bvzavw`, #590)

**Ending: shipped**, on `dev`.

- **Next and Previous at the foot.** While one thread shows, the dialog's footer — the bar with
  Close, outside the part that scrolls, so it is there however long the thread and with a phone's
  keyboard up — reads *Close · ‹ Previous · Next ›*. The same pager as the thread's top row, which
  stays: the same stops (only the threads that need a decision), the same hints, the same sentence
  when an end is pressed, said where it was pressed. Moving to a different thread now starts it at
  its top, so *Next* from the foot of a long thread does not land half-way down the next; coming
  back to the same thread keeps your place.
- **Send told apart from Close: colour, and what sits bottom-right.** Write's *Send* is green, the
  `--positive` green *Send reply* already is, because both send what you wrote; *Cancel* and *Close*
  stay grey. And in a thread the bottom-right is now *Next ›*, which moves you on, rather than
  *Close*. Close was not moved to the far left: every other dialog here puts the way out just left
  of the action, and this one keeps that.
- Passed over: jumping to the next thread by itself after *Send reply* or *Defer* — it would take
  your sent reply away before you saw it land.

Sentry: this session has no Sentry sign-in; the next feedback sweep marks it resolved.
