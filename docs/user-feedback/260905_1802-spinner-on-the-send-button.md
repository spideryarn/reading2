# A spinner on the feedback Send button

**[SPIDERYARN-READING2-23](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-23)** · reported
2026-09-05 18:02 UTC · *already built — pinned, and the question left open*

## What Greg said

> When I click the send button in the feedback dialog, show a loading spinner while it's sending.

## It was already there, and it was already in production

`<LoaderCircle className="cmt-spinner" size={14} /> Sending` has been on that button since
**2026-09-01** (`54ec2d2c`), and `git diff origin/main -- src/web/FeedbackDialog.tsx` was empty, so
the deployed site has it. It is the app's one spinner ([icons.md](../project/icons.md)), on the same
four-way label that says *Adding the picture* and *Writing that down*. The button is also `disabled`
throughout, with a `sending` ref latch behind it, so it is not double-submittable.

**So this report is not "build a spinner". It is "I pressed Send and saw nothing", and that is still
unexplained.**

## What was actually missing: the test

Nothing pinned the spinner. The latch was tested; the spinner was not — so a refactor of that
four-way label could have dropped it with every test in the file green. Now pinned, and proved by
deleting the `<LoaderCircle>` and watching it red (*"expected null not to be null"*) before restoring
it.

## The theory that looked right and is not

Everything between `setStage({ kind: "sending" })` and the first `await` runs on one task —
`collectFeedbackDiagnostics()` and `JSON.stringify` over a body that can carry a base64 screenshot —
so React cannot flush and the browser cannot paint until it finishes. On a heavy consented report the
spinner is present, correct and invisible. One `await` closes it.

**It was written, and reverted, because it is not this report.** Greg's own event carries
`consented: false` and `has_screenshot: false`, so that branch collected nothing and the body was
small. Changing the send path — it reds four tests there — to fix a gap the reporter did not hit is
the wrong trade. The finding is recorded at the line instead, in
[`FeedbackDialog.tsx`](../../src/web/FeedbackDialog.tsx) and
[feedback.md](../project/feedback.md), so the next person meets it where it lives.

## What is left, and it is Greg's to answer

The likeliest remaining explanation is that **the send was simply too fast to see** — a small body on
a good connection, and a 14px spinner beside a word.

Two ways to answer it, and neither should be guessed at:

1. **Nothing is wrong** — he saw a brief flicker and wanted to be sure it was deliberate. Then this
   note is the answer.
2. **A minimum visible duration.** If a spinner that flashes for 80ms reads as no spinner, the fix is
   to hold it for ~300ms. That is deliberate added latency on a path that currently has none, which
   is exactly the kind of thing to decide rather than slip in.

Recorded in
[260905f](../plans/260905f-socratic-summaries-eval-admin-page-gating-short-selections.md).

## Answered 2026-09-06: nothing changes

Greg was shown both readings above and chose the first — *"Nothing — close it"*. So this note is the
answer, the spinner stays exactly as it shipped on 2026-09-01, and the row comes off
[awaiting-approval.md](awaiting-approval.md).

**No minimum visible duration.** Holding a spinner for ~300ms when the response beats it is
deliberate added latency on a path that has none, and there is no evidence yet that anyone needs it —
the one report is compatible with having simply seen a fast send work. If it comes up again, the
useful report is *"I pressed Send and nothing happened"* on a **slow** connection, which would be a
different bug from this one and would have evidence behind it.
