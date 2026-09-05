# A more appreciative thank-you, and a Close with no delay

**[SPIDERYARN-READING2-1N](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-1N)** · reported
2026-09-05 07:43 UTC · kind: suggestion · *shipped*

## What the reader said

> After submitting a bit of feedback in the feedback dialogue, it says something like thank you that
> is filed. Can we make that slightly more appreciative? If they marked it as a problem, maybe
> something say something like okay, sorry to hear you've been having a problem, we'll look into it.
> If it's a suggestion, something like thank you for the suggestion. We really appreciate it, or
> yeah thanks for the feedback, and when I click close on the thank you that is filed, there
> shouldn't be a delay, it should happen instantly.

## What we did

**Three sentences instead of one**, keyed on what the reader called it — sympathetic for a problem,
appreciative for a suggestion, and a third for the reader who picked neither, which the toggle's
`null` default makes the common case. The kind rides on the `sent` stage rather than being read out
of the form, so the sentence is a fact about the report that was filed.

**The delay was something extra being drawn, not something slow.** The Close button called
`discard()` and `onClose()` in one commit, so React rendered the *emptied form* back into a dialog
that was still open, the browser painted that, and only then did the passive effect shut it — a blank
feedback form flashing up in place of the thank-you being dismissed. The button now only closes; the
clearing happens once the dialog is shut; and the show/close sync became a `useLayoutEffect`. That
also fixed something nobody had reported: Escape and the ✕ used to leave the stage at *sent*, so the
next press of Feedback opened on a stale thank-you.

The diagnosis, the test that had to be thrown away because jsdom cannot see a paint, and the one that
replaced it are in [the plan](../plans/260905c-contact-page-and-a-warmer-feedback-thank-you.md) and
in [feedback.md § The thank-you, and getting out of it](../project/feedback.md).
