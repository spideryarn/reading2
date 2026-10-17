# The Needs-a-decision pager at the foot of the dialog, and Send told apart from Close

Report `spya-bvzavw` (#590, `SPIDERYARN-READING2-JB`), from Greg as an admin, 2026-10-17, queue item
`qi-fx6s4ezn`:

> When responding to Needs-Input in Feedback, add Next/Previous buttons at the bottom of the box as
> well (since often that's where I am when I finish responding). Or some other way to make it easy
> for me to get to/deal with the next thing.
>
> P.S. In the bottom right of Feedback/Write, the "Send" button submits. But in the bottom-right of
> Needs-Input, the Close button effectively cancels. How can we signal the difference to the user?
> Colour? Position? Something else?
>
> — Greg, 2026-10-17

"Needs-Input" is the Earlier tab's *Needs a decision* view, one thread at a time
([feedback.md § Questions for an admin](../project/feedback.md#questions-for-an-admin-and-replies-to-them-since-2026-10-07)).
Its pager (*‹ Previous* / *Next ›*, stepping only through threads that need a decision, plan
[261009m](261009m-needs-a-decision-pager-steps-only-through-waiting-threads.md)) is only at the top
of the thread, above the question; the reply box is at the bottom.

## What we will do

1. **The pager again, in the dialog's footer, while a thread shows.** The footer (`.fb-actions`) is
   outside the scroller, so it is under the reader's hand however long the thread is and wherever
   the panel is scrolled — on a phone with the keyboard up too. The footer reads

   ```
   Write:                      [Cancel] [Send]        ← Send green
   Earlier, a thread showing:  [Close] [‹ Previous] [Next ›]
   Earlier, anything else:                  [Close]
   ```

   The same buttons as the top row (`fb-copy`), the same stops (`pagerStops`), the same hints and
   `aria-disabled` ends, and the same end sentence on its own row when an end is pressed. One
   component, `ThreadPager`, drawn twice, each with its own end sentence, so a press at the foot
   speaks at the foot. The top row stays: Greg said *"as well"*.
2. **A new thread starts at its top.** Paging leaves the panel's scroll where it was, so *Next*
   pressed from the foot of a long thread would land mid-way down the next. Opening a different
   thread, from the contents or either pager, scrolls the Earlier panel to the top. Coming back to
   the same thread after closing the dialog keeps your place in it, as it keeps your draft.
3. **Send told apart from Close: colour, and the forward action rightmost.**
   - **Write's *Send* turns green** (`--positive`, text and border, hover included), exactly as
     *Send reply* is since [261011h](261011h-feedback-dialog-bigger-still-and-green-send-red-defer.md).
     Both send what you wrote to us; controls that do the same job look the same
     ([controls.md](../project/controls.md#controls-that-do-the-same-job-look-the-same)). *Cancel*
     and *Close* stay the neutral grey. The words still carry the meaning, so nobody who cannot
     see green loses anything.
   - **Position:** the app's dialogs put the way out to the left of the action (annotate,
     `dialogs.css`), and we keep that convention rather than move *Close* to the far left in this
     dialog alone. With a thread showing, item 1 puts *Next ›* in the bottom-right — the slot that
     sends on Write now moves you on, and *Close* sits where *Cancel* does. Outside a thread *Close*
     is the only button and grey, so there is nothing for it to be mistaken against.

## The simpler options passed over

- **Repeat the pager under the reply box, inside the scroller.** One fewer component boundary, but
  it is only "at the bottom" once you have scrolled there, and it doubles a nav landmark with the
  same name inside the thread. The footer is always the bottom.
- **Jump to the next thread automatically after Send reply / Defer.** Fewer presses, but it takes
  away the sent reply before the reader has seen it land, and an accidental send moves you on. Not
  asked for; *Next ›* one press away is enough.
- **Move Close to the far left.** Signals by position alone, but breaks the convention every other
  dialog here keeps.

## Tests (red first)

`tests/feedback-dialog.test.tsx`:
- with a thread showing, the footer holds *‹ Previous* and *Next ›*; *Next ›* there opens the next
  waiting thread; at an end it is `aria-disabled` and pressed says the end sentence in the footer,
  not at the top; with no thread (contents, Write) the footer has none;
- opening a thread scrolls the panel to its top;
- Write's *Send* carries the green class; *Cancel* and *Close* do not; the stylesheet rule uses
  `var(--positive)`.

## Docs

feedback.md § Questions for an admin (where the pager is) and § the dialog's buttons; the note in
`docs/user-feedback/`.

## GPT Sol's plan review, and what we did

[261017c-plan-review-sol.md](261017c-plan-review-sol.md), prompt beside it. Verdict *revise*.

- **F1, the same thread reopened keeps its scroll:** declined. Returning to the same thread after
  closing the dialog should find you where you were, as the draft does; § 2 now says "a different
  thread" rather than "by any route".
- **F2, a footer press announces nothing:** taken. Focus stays on the footer, so Next can be pressed
  again, and the foot's copy says *Showing: <title>* in a visually hidden status; the top copy does
  not, because its focus already sits just above the new thread.
- **F3, touch targets under 40px:** taken. The house `.tap-target` (an invisible 40px `::after`
  under a coarse pointer) on both pagers' buttons and on the footer's Close, Cancel and Send.
- **F4, one condition for the thread and the footer pager:** the dialog draws the footer pager on
  `threadShowing` plus a loaded list, which with the footer hidden off Earlier is the condition
  `EarlierThreads` uses; a test now holds the two together, including while a reopened read is out.
- **F5, two nav landmarks:** named apart, *Threads* and *Threads, at the foot*, tested.

## GPT Sol's code review, and the browser check

[261017c-code-review-sol.md](261017c-code-review-sol.md): *approve*, with three fixes it made in
the worktree, read and kept. Stale end and *Showing:* sentences are cleared when a copy is hidden or
the thread stops needing a decision. The scroll reset waits until the thread is on screen, so paging
while Earlier is hidden does not move it, and a reopened same thread keeps its place. And under a
coarse pointer a wrapped pager row is 18px apart, so the 40px targets do not reach over the row
above.

A Sonnet browser run (Playwright, the box, 1280×900 and 390×740, local data with five waiting
threads) found the footer on one row at both sizes, Next stepping and starting at the top, the end
sentences in the footer, and Send green with Cancel and Close grey. It found one flaw: with an end
sentence showing, the footer's default stretch drew Close 53px tall. Fixed with
`align-items: flex-start` on `.fb-actions`.
