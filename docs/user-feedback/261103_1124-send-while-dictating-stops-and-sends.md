---
reports: spya-gjcyq3
ending: shipped
comment: Send while dictating now stops the microphone and sends once your words are in, in every box with a Send. If the words don't come through, nothing is sent and the box says so. Illustrated's Paint again is asked about.
---
# Send while dictating stops the microphone and sends

A suggestion from Greg (admin: `feedback-reporter.ts --report-id` exit 0, re-read before this note,
no addenda), 2026-11-03 11:24 UTC, from the landing page, build `a6d2d90a`. Session
`fbgjcyq3-send-while-dictating`.

`spya-gjcyq3` (#747):

> I noticed that someone was using the voice dictate button (perhaps in a Chat), and then they tried
> to click the "Send" button while it was still recording. They got some kind of message, but the
> better thing would have been for it to automatically click the Stop Dictating button + click the
> Send button for them in one fell swoop. This should ideally be true for all existing voice
> dictate buttons (at least where it makes sense) and going forwards.

**Ending: shipped.** On `dev`, not deployed. Plan, both GPT Sol reviews and the browser check:
[261103b](../plans/261103b-send-while-dictating-stops-and-sends-in-every-box.md). How it works:
[dictation.md § Send while dictating](../project/dictation.md#send-while-dictating-stops-and-sends).

## What we did

- **One entry point in the shared field, `dictate.submit()`.** A box's Send, Enter and form submit
  go through it: idle, it is the box's own send; while recording or transcribing, it stops the
  microphone and sends once the real transcript is in the box. Before this only Feedback and
  Search did that; every other box refused, and in Chat the Send button opened its "Send · Enter to
  send" card over a press that did nothing — most likely the message Greg saw.
- **Every box with a done action**: Chat, the comment follow-up, Annotate's Save, the quiz band and
  the margin quiz, Feedback and its reply box, Help, the command bar (Enter and *Ask what you
  meant*), Search, Candidates, Referee's new criterion, Skim's purpose. The button stays live while
  dictating, empty box included, since on Safari and Firefox the words arrive only at the end.
- **When nothing goes, the box says so**: a failed or empty transcription, or words the box then
  refuses (too long, unchanged), adds "Nothing was sent." (or "Nothing was saved." / "Enter was not
  pressed.") to the strip. A second press while finishing still sends once; Stop then Send works.
- **Going forwards**: `tests/dictation-boxes-send-through-submit.test.ts` fails on a box with a
  done action that isn't wired through `submit`, and on a box without one that isn't listed with
  its reason.
- **On the way**, an older bug Sol found: a Send pressed during a Try again that failed was never
  cleared, so a later Try again that worked would have sent unasked (Feedback's Send had it too).

## Not built

- **Paint again under an Illustrated picture** — a paid repaint on words not yet read; the double
  press there already waited on Greg. Asked as `q-eqajp0`; queue item `qi-n3edc73j`.
- Left out on purpose: Annotate's Ask AI (not the box's done action, so it waits for the words), a
  command-bar row clicked mid-dictation (it names another action), and the boxes with no Send (the
  profile boxes, the add page's two, the comment's own note), which save themselves.

Browser-checked in Chat only (Playwright, fake microphone, transcription routed); Feedback and the
quiz boxes by unit test. Not tried on an iPhone. Sentry: this session has no Sentry sign-in; the
next sweep marks the issue resolved.
