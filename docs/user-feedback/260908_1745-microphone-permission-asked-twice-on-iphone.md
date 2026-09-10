# The microphone asks for permission twice on an iPhone

**[SPIDERYARN-READING2-2R](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-2R)** · report
`spya-y8va9d` · reported 2026-09-08 17:45 UTC · build `cec18ed8`

**Ending: shipped.** On `dev`, not deployed. The next feedback sweep should mark the Sentry issue
`resolved`; this session has no Sentry sign-in.

## What Greg said

> When I use the microphone for voice dictation in the feedback dialog box, it seems to ask me for
> permission, sometimes twice in a row, even though I've given permission a bunch of times in the
> past. This is using an iPhone. I had shared the app to my home screen.

In the Feedback dialog on `temporal-context-reinstatement-spya-dhqkf9`, outline mode.

## What we did

**"Twice in a row" was very probably our bug, and that cause is removed.** On the first press of
every page load, dictation briefly started and cancelled a speech recogniser to check what the
browser could do. In Safari's engine, that start goes down the same microphone-permission path as a
real request, and cancelling it has no way to withdraw a prompt already asked for. Then our real
microphone request asked again. The check now runs only on Chrome-family browsers (those that
report a `Chromium` brand), where it costs nothing. Desktop Chrome and Edge behave exactly as
before.

**"Even though I've given permission before" is mostly Safari's.** A home-screen app on iOS forgets
the grant whenever the app is reopened from cold. It also forgets after about a minute without a
tap-started request, and after ten minutes of not recording. Nothing a web page does changes that.
So after the fix you should see **one** prompt on the first press after reopening the app, not two,
and no prompt on a second press shortly after.

**Not tested on an iPhone.** The box has no microphone and no Safari. The mechanism was traced in
WebKit's source, not observed. To check it: force-quit the home-screen app, reopen it, open Feedback,
press the microphone once. Expect one prompt.

Plan and evidence: [260910g](../plans/260910g-dictation-asks-for-the-microphone-twice-on-iphone.md).
The class of mistake:
[a cancelled request still asks the reader](../postmortems/260910e-a-cancelled-request-still-asks-the-reader.md).
