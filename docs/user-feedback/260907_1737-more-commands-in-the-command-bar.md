# More commands in the command bar, and the button beside the logo

**Sentry:** `SPIDERYARN-READING2-2D` · reported 2026-09-07 17:37 UTC, from
`/read/after-work-we-ll-have-each-other-spya-rqztkp?mode=structure&at=spya-fvuu5k`, build `c0fb04a4`.
From Greg, so [feedback-reports.md § Who sent it](../project/feedback-reports.md#who-sent-it) says
*build it*, simplest version first, without stopping to ask whether it is worth doing.

**Ending: shipped**, on `dev`. Both halves.

> Add Library, Feedback, Metadata, Tweets, Homepage, Profile, and a few more likely/useful commands
> to Command Bar. And move Command bar to the left of the Dock, just after the logo.

The plan, with the three decisions that were not obvious, the rows that were considered and left out,
and what GPT Sol changed before and after it was built, is
[260908e-more-commands-in-the-command-bar-and-the-button-beside-the-logo.md](../plans/260908e-more-commands-in-the-command-bar-and-the-button-beside-the-logo.md).

## What shipped

**Seven rows below the fourteen modes**, where there had been one. Metadata and Tweets (this
article's other two pages), Comments (the drawer), Library, Profile, Public shelf, What's new, and
Feedback. Two of Greg's six needed a decision rather than typing in:

- **Homepage is an alias on Library, not a second row.** `LIBRARY_HREF` is `/`, and for a signed-in
  reader `/` *is* the shelf — so two rows would have been two names for one place, and would have
  shared a row id, which is what a screen reader and the arrow keys tell rows apart by. Typing either
  of his words gets you there.
- **Feedback is not a place**, so the command bar grew a third kind of row — an `action`, which runs
  something instead of going somewhere. It is the first new *verb* the bar has taken since it was
  built, and the reasoning for admitting one is in the plan.

**Comments and Public shelf** are the *"few more likely/useful"* half. `Add an article` was in the
first draft and came out: a bare `/add` is not a page, it redirects to the shelf, so the row would
have carried a name its destination does not have.

**The Tweets row arms the thread run** on its way to the page, exactly as the Dock's own Tweets
button does — and wears the `generates` marker for it. That closes a hole a comment in `CommandBar.tsx`
had been predicting since 2026-09-07: the marker used to be drawn off *is this a mode*, so the first
spending page would have shipped unmarked with no test able to see it.

**And the button moved** to the left-hand end of the bar, just after the wordmark. The ⌘/Ctrl-K chord
did not move with it and could not — it is bound to the window, not to the button.

## What was deliberately not done

**The bar is still only on the reading view.** Now that it offers Library, Profile and Feedback it
would be useful on the shelf and on the metadata page too — but the gate is there because the mode
rows need a band to change, and lifting it means deciding what fourteen of them do on a page that has
none. Named as its own plan rather than done on the way past.

Admin, Design, sign out and the experimental switch were each considered and declined, with the
reason written down in the plan.
