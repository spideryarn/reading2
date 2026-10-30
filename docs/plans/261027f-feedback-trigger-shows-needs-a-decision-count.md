# The Feedback trigger shows the Needs a decision count, for an admin

Report `spya-wwyw8y` (#720), Greg as admin, 2026-10-27, from `/changelog`:

> Can you show a little number (perhaps in a subtle red) next to the Feedback button in the top
> right if "Needs a decision" > 0? Probably this is only for Admins, not regular users.

Short enough that the plan review was skipped, as the brief allowed; the code goes to GPT Sol.

## What

- `FeedbackEarlier.tsx § readWaitingCount`: the dialog's own opening read (`read` with
  `{ detail: "admin", show: "waiting" }`), counted by `waitingThreads`. One source, so the trigger
  and the *Needs a decision N* shortcut inside the dialog cannot disagree.
- `FeedbackHost` calls it once on mount **only when `isAdmin(readerId)`**, holds the number, and
  takes the dialog's `waitingQuestionCount` through a new `onWaitingCount` prop whenever the
  dialog has one — which already has the admin's own replies and deferrals laid over it.
- A second context, `FeedbackWaitingContext`, carries the number to `FeedbackTrigger`, so the
  stable `FeedbackApi` context stays stable. Every shape draws `.fb-waiting-count` after its word,
  in `--danger` text with no fill (the "subtle red"), and its `aria-label` says the count.
- No new route, no new client module, nothing admin-private imported, so the eager client graph
  is unchanged (`FeedbackEarlier.tsx` was already eager through `FeedbackDialog.tsx`).

## Simpler option passed over

Having the dialog's hook read on mount instead of on open, and lifting its whole state up, would
make it literally one read — but it would change the dialog's opening behaviour (a fresh read per
opening, decision 8 of 261008i) and braid the host into the hook. A separate one-shot read through
the same `read` function is fewer parts touching each other.

## Not done

No background refresh (polling, focus). A question published while the tab is open shows on the
next load or opening. Add it if Greg finds the number stale.

## Code review

GPT Sol, LAND WITH FIXES, fixed in place: a `dialogHasCount` ref so a slow arrival read cannot
overwrite the dialog's newer count; the dialog reports `null` once its read settles without an
admin list (failure, 404 fallback), clearing the number; the corner grows past `--feedback-w`
when it has a number; the dock's number is absolutely positioned so it cannot invalidate the fit
ladder's measurement; the accessible name says "threads". Six more tests, all four shapes covered.
