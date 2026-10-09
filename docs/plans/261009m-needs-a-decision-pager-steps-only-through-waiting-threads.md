# *Needs a decision*: Previous and Next step only through what waits on Greg

Up: [feedback.md](../project/feedback.md) · builds on
[261008i](261008i-needs-a-decision-becomes-threads-you-can-reply-to-or-defer.md) (decision 4, the
pager) · report `spya-nmt06n` (#515, SPIDERYARN-READING2-FV) · worktree `needs-decision-next-prev`

Status as of 2026-10-09: **built, reviewed by GPT Sol (plan: refused, six findings, four taken;
code: approve after three fixes, applied by the reviewer), seen in WebKit at 1280×900 and 390×740,
and on `dev`; not deployed.** The local data had no deferred thread, so skipping one was seen only
in the tests.

## What Greg asked for

> In the feedback earlier needs a decision, we've got these next and previous buttons, but actually
> I only want them to cycle through the next and previous that need a decision, rather than
> anything else. And they should, I guess, be disabled with a tooltip or something if there's no
> more.
>
> — Greg, 2026-10-09 (`spya-nmt06n`, admin suggestion, from `/changelog#release-146`)

## What is there now

One thread shows at a time (261008i decision 4), with *‹ All threads*, *N of M*, and *‹ Previous*
/ *Next ›*. The pager walks **every** thread in contents order: *Needs a decision*, then *You've
replied, being considered*, then *Deferred*, then any kept only to protect a draft
(`QuestionSection` builds `order`; `ThreadView` in
[`FeedbackEarlier.tsx`](../../src/web/FeedbackEarlier.tsx) takes the neighbours). At either end the
button is natively `disabled`, with nothing to say why.

## Decisions

1. **The pager steps only through threads whose state is `waiting`** — the *Needs a decision*
   group, the same set the shortcut's number counts (`waitingThreads`).
   - **Deferred threads do not count.** A deferral is Greg saying "not now"; it stays an open
     question (`status: open`, 261008i decision 3), but stepping onto it is exactly the "anything
     else" he wants skipped. It is reached from the contents' *Deferred* group, as now.
   - **Replied threads do not count either.** *Being considered* means the next move is an
     agent's, not his.
   - **Kept-for-a-draft threads** (no longer open) do not count.
2. **The thread you are on is always a stop, wherever it is.** The pager's list is the waiting
   threads plus the one showing, in the order the server sends them (oldest asked first, which is
   also each group's order in the contents). So:
   - after **Send reply** the thread turns *being considered* but *Next ›* still goes to the next
     waiting one, which is the flow Greg is in: read, answer, next;
   - after **Defer for now**, the same;
   - a deferred or replied thread opened from the contents can step out to its waiting neighbours.

   *Passed over:* the list of waiting threads alone. Then the thread just answered has no place in
   it, and both buttons would have nothing to step from, at the moment he most wants *Next*.
3. **The place says what is being counted.** `2 of 5 needing a decision` on a waiting thread; on
   any other thread, where it is not one of them, `5 need a decision`, or *No threads need a
   decision now* (P6: "to decide" read as "two of five remain", and "none left" as if a deferred
   question were settled).
4. **At an end, the button is unavailable and says why.** `aria-disabled`, not `disabled`, so it
   keeps its hint and its focus (tooltips.md: a natively disabled button is no reliable trigger),
   with the click refused. The hint is a native `title`, because the house tooltip portals to
   `document.body`, underneath this modal `<dialog>` in the top layer (the reason the shortcut
   beside the tabs uses `title` too, `FeedbackDialog.tsx`): *"No earlier thread needs a
   decision"* / *"No later thread needs a decision"*. A `title` does not exist on a phone, and
   Greg answers these on his iPhone (`spya-za2tse`), so **pressing an unavailable button puts the
   same sentence on the nav row** (`role="status"`), until the thread changes. When available, the
   buttons' `title` says *"Previous thread that needs a decision"* / *"Next …"*.
   *Passed over:* moving the dialog's tooltips into the top layer so `ControlTip` works here. It is
   the right fix for every hint in this dialog, and a separate piece of work; two lines of `title`
   do not make it harder.
5. **The look of `aria-disabled`.** `.fb-copy[aria-disabled="true"]`: half opacity, default
   cursor, no hover colour, matching `button.tsx`'s third edit (controls.md).

## What the plan review changed

`261009m-needs-a-decision-plan-review-sol.md`, P1–P6, verdict *refuse*:

- **P1, taken: where a kept-for-a-draft thread sits.** Membership is *live and waiting*, never
  `state` alone, because a thread kept only for its draft can still say `waiting` from the read
  that last had it. Its position is where the list already puts it: the panel's question list is
  the newest read's, in server order, with kept threads appended, so a kept thread showing sits
  after every live one (Previous goes to the last waiting thread; Next is an end). A showing id
  with no question at all already falls back to the contents. Pinned by extending the existing
  kept-draft test.
- **P2, taken: the live region is always there**, empty until an end is pressed, with
  `aria-atomic`; the words are re-keyed on each press so a second press is announced again.
- **P3, taken: the sentence goes when it stops being true.** It is shown only while the pressed
  button is still an end, so a reply, a deferral or a newer read that gives the thread a neighbour
  takes it away. Derived, not cleared by an effect.
- **P4, not here:** focus on entering a thread from the contents and on *‹ All threads*, and an
  announcement on paging. Real, older than this plan (261008i), and not what Greg asked; left for
  an accessibility pass over the dialog.
- **P5, declined:** a `title` that is not the button's name is exposed as its accessible
  description (accname), so the reason reaches a screen reader; `aria-describedby` would say the
  same thing twice.
- **P6, taken**: the wording above.

## What the code review changed

`261009m-needs-a-decision-code-review-sol.md`: **C1**, the end sentence came back after paging
away and back, and survived a reply that changed the pager; it is now tied to the pager's shape
and cleared on a successful step. **C2**, two stale sentences (the `THREAD_GROUPS` comment and
feedback.md). **C3**, the repeated-press test pressed the other end, so it could not show a second
press is announced again; it now presses the same one twice.

## Tests (first, red)

In `tests/feedback-dialog.test.tsx`, the existing pager cases change:

- a waiting thread among a replied and a deferred one: `1 of 1 to decide`, both buttons
  `aria-disabled`, each `title` the end sentence; pressing one shows it in the status line and
  shows the same thread;
- opening the replied thread from the contents: `1 to decide`, *Next ›* goes to the waiting one;
- replying to the first of two waiting threads: the place reads `1 to decide`, *Next ›* goes to the
  second.

## Stages

One stage: the pure `pagerStops` function, `ThreadView`'s place, buttons and status line, the CSS,
the tests; feedback.md's sentence on the pager. GPT Sol on the plan, then on the code, then `dev`.
