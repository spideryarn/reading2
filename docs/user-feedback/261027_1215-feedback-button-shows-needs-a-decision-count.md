---
reports: spya-wwyw8y
ending: shipped
comment: For an admin, every Feedback button now shows a small red number when threads need a decision, the same number as Needs a decision inside. Readers see nothing new and make no extra request.
---
# The Feedback button shows the Needs a decision count, for an admin

Greg (admin, `feedback-reporter.ts` exit 0), 2026-10-27 12:15 UTC, a suggestion filed from
`/changelog#release-198` (build `fa912abf`). Report #720, Sentry SPIDERYARN-READING2-PM. Session
`fbwwyw8y-feedback-decision-badge`. No addenda when re-read before acting and before this note.
Plan: [261027f](../plans/261027f-feedback-trigger-shows-needs-a-decision-count.md).

> Can you show a little number (perhaps in a subtle red) next to the Feedback button in the top
> right if "Needs a decision" > 0? Probably this is only for Admins, not regular users.

**Ending: shipped**, on `dev`.

**What changed.** For an admin, each of the four Feedback triggers (the corner, the reading view's
dock, the shelf's masthead, the site nav) draws the number of threads waiting on a decision after
its word, in the error-text red with no fill, and nothing when there are none. It stays when the
word is hidden on a narrow window. The count is the dialog's own opening read of *Needs a decision*,
counted the same way, so it always matches the shortcut inside the box. Once the box has been opened,
its count takes over, so a reply or a deferral changes the button at once. A non-admin's page makes
no extra request. [feedback.md § Questions for an admin](../project/feedback.md#questions-for-an-admin-and-replies-to-them-since-2026-10-07).

**What it gives up.** It is not refreshed in the background. A question published while a tab sits
open shows on the next page load, or when the box is next opened.

**Review.** GPT Sol's code review said LAND WITH FIXES and made them: a slow page-load read can no
longer overwrite the dialog's newer count, a failed or old-server read clears the number rather than
leaving a stale one, the corner button grows rather than squeezing it, the dock's number sits outside
the bar's measured width, and the screen-reader label says "threads". Checked in a browser at 1280
and 390 wide on all four shapes, as admin (8 waiting locally, matching the box) and as a reader
(no number, no request).
