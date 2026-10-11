---
reports: spya-tfp3zw, spya-zjsqe6
ending: shipped
comment: The Feedback dialog is bigger again on a large window (56rem wide from 1280px, taller from 900px), and in a Needs a decision thread Send reply is green and Defer for now red.
---
# The Feedback dialog bigger still, a green Send reply and a red Defer

Two suggestions from Greg (an admin; `scripts/feedback-reporter.ts` exit 0 on each production row),
filed 2026-10-11 from `/admin/vouchers`, both about the same dialog. Plan and reviews:
[261011h](../plans/261011h-feedback-dialog-bigger-still-and-green-send-red-defer.md). The dialog
was made bigger once already, on 2026-10-08
([261008_1612](261008_1612-needs-a-decision-threads-reply-defer-and-a-bigger-dialog.md)); this is
the step after it.

> Make the feedback dialog box taller and wider still when the window is large enough.
>
> — Greg, 2026-10-11 01:09 UTC (`spya-tfp3zw`, #552)

> When replying in feedback needs a decision, can we have send reply button in green perhaps and the
> defer in red?
>
> — Greg, 2026-10-11 01:24 UTC (`spya-zjsqe6`, #553)

**Ending: shipped**, on `dev`, for both.

- **Bigger still.** From a 1280px-wide window the dialog is up to 56rem wide (it was 46rem), and on
  a window at least 900px tall it is at least `min(90%, 56rem)` tall (it was 44rem). A 1024–1279px
  window keeps the 46rem step, and a phone is unchanged; 90% of the visible window stays the cap
  everywhere. The cost: at the dialog's small text a 56rem line is long for prose. If it reads
  badly, capping the width of the prose inside is the fix.
- **Green Send reply, red Defer for now**, in a *Needs a decision* thread: the text and the
  border, hover included. Red is `--danger`, the measured error-text red. Green is a new token,
  `--positive`, with a dark and a light value, both held at 4.5:1 on every surface by
  `tests/appearance-palette.test.ts`; the only green before it was a data scale, which no contrast
  floor holds as text. A faint wash behind was tried and dropped: it took the light theme under
  that 4.5:1. *Bring back* on a deferred thread stays neutral, because it undoes a
  deferral, and so does the addendum box's send. The words still say what each does, so a reader
  who cannot tell red from green loses nothing.

Sentry: this session has no Sentry sign-in; the next feedback sweep marks both resolved.
