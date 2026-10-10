---
reports: spya-t9qu3v, spya-exhqqr
ending: shipped
comment: The hang wasn't reproduced, so the three ways Send could do nothing are closed instead: Send now works while the microphone is on, and a send gives up after a minute. And an unsent report now survives a reload.
---
# Feedback's Send after dictation, and a draft that survives a reload

Two admin reports from Greg (`scripts/feedback-reporter.ts` exit 0 on both), filed three minutes
apart on 2026-10-09 from the home page on an iPad (Safari 17, build `5f6d3d5f`). Queue item
`qi-mzvstkdy`, session `fbt9qu3v-feedback-dialog-hang`. Plan, both GPT Sol reviews and the browser
check: [261010f](../plans/261010f-feedback-dialog-send-after-dictation-and-a-saved-draft.md).

> Dialogue hung again. It was after I'd done a couple of voice messages, and I think there was, I
> could see the send button, but when I tried to press it, nothing happened. I tried switching away
> and back. Yeah, there was definitely something going on.
>
> — `spya-t9qu3v` (#538, SPIDERYARN-READING2-GK), problem, 23:55 UTC

> Feedback dialog just somehow the whole page got hung. I guess I wonder if it's worth auto-saving
> the feedback dialog every few seconds after a debounce, so that if it, if the page does get lost or
> blocked, it can reload. I don't know, that might then make it complicated if you try and open a
> feedback dialog in multiple tabs. So I don't know, it might be overcomplicated and overreacting.
>
> — `spya-exhqqr` (#536, SPIDERYARN-READING2-GH), suggestion, 23:53 UTC

**Ending: shipped**, both. On `dev`, not deployed.

## What we did

- **Not reproduced.** Both reports were filed from a fresh page load, so the hung session left no
  diagnostics. A browser run (fake microphone, two dictations, a double Stop, hide/show mid-dictation,
  a failing and a slow transcription) never left Send dead or the page frozen, and a code trace
  found nothing that could freeze the whole page. It did find three ways Send could look live and
  do nothing, and all three are closed:
  - **Send while the microphone is on now stops it and sends once the words land.** It was disabled
    then, greyed only faintly and still reading "Send" — the likeliest fit for what Greg saw.
  - **A quick second tap on Stop no longer restarts the microphone** when the words came back
    inside the double-tap window; it sends instead.
  - **A send gives up after a minute** with the usual "couldn't send" panel, so a request stuck when
    the iPad suspends the page no longer locks Send. A retry that was edited is filed as a new
    report, so the edit is not dropped.
- **The draft survives a reload** (the suggestion): words and kind saved in the browser a second
  after they change, per reader, and offered back when the page loads. Greg's multi-tab worry, the
  simple answer: last write wins, and a tab only ever removes a copy it saved itself. Gone when sent,
  on Sign out, or after a week.
- **One sentence added to `/privacy`**, in its paragraph on what the browser keeps, after the
  dictation copy's: *"A Feedback report you have started and not sent is kept the same way, so a
  page that reloads doesn't lose it; it is deleted once you send it or sign out, and is not offered
  back after a week."* Greg, worth a glance before it deploys.

Passed over: stopping the microphone when the page is hidden (it would change every dictation box;
with Send now working while the microphone is on, a microphone left on is one press from sent).

Sentry: this session had no Sentry sign-in; the next sweep marks both issues resolved.
