---
reports: spya-pd9fnc
ending: shipped
parts: 2
comment: Both halves are on dev. Dictation: the microphone button no longer moves when you press Stop, so a quick second tap lands and sends once the words arrive. The Chat half: a "‹ Chats" button and the model in the (i).
---
# The dictation button moved at Stop, so a double tap could not land

Report `spya-pd9fnc` (SPIDERYARN-READING2-ER), a suggestion from Greg (an admin, proven by
`scripts/feedback-reporter.ts` exit 0), filed 2026-10-08 07:32 UTC from Chat on
`2608-13566v1-spya-yurten`. Overseer queue item `qi-t6tn7q4y`, session
`fbbtjtbb-dictation-mic-grant-double-tap`, batched with `spya-btjtbb`
([its note](261008_0716-iphone-asks-for-the-microphone-again.md)).

**This note is part 2 of 2**: the dictation half. Part 1, the Chat half, is
[261008_0732-chat-back-to-the-list-on-a-phone-and-the-model-in-the-i.md](261008_0732-chat-back-to-the-list-on-a-phone-and-the-model-in-the-i.md).

> Finally, I was trying to use the voice dictate button, and I was hoping to double-click to save
> what I just said and send in one go. But the button moves as soon as it gets pressed because it
> switches to "turning into text", and so I couldn't double-press it fast enough.

**Ending: shipped.** On `dev`, not deployed. The next feedback sweep should mark the Sentry issue
`resolved`; this session has no Sentry sign-in.

## What we did

The double press already existed (plan 261005a): within 600 ms of Stop, a second press means "send
when the words arrive". It could not land because the button moved. Measured in a browser: in Chat
the button dropped 28.7 px at Stop, because the "Microphone: … Change" line under it disappeared
and the composer grows upwards from the bottom of the screen. The words "Turning that into text…"
were what changed in sight, but they moved it by 0.6 px.

- The strip under a dictating box now keeps its lines (the microphone's name with Change switched
  off, the "Couldn't use" warning, an open picker) until the words land, so nothing moves at Stop.
  Re-measured: Chat at 390 and 1440 px wide, Learn at 390, Feedback; the button stays within 0.6 px
  and a double tap at the same spot sends exactly once.
- Learn's and Quiz's "Listening…" / "Writing it down…" word holds its width, so it cannot re-wrap
  the row under the button.
- Found on the way: in Learn the microphone line pushed the microphone (which is also Stop)
  off the right edge of the band at 320 px; every strip line now has a row of its own. The comment
  follow-up drew the strip inside its one row; it now wraps the strip below.

Plan and evidence:
[261008d](../plans/261008d-dictation-button-holds-still-and-why-the-iphone-asks-again.md). The
class of mistake: [a control moved by its own press](../postmortems/261008b-a-control-moved-by-its-own-press.md).
Not tried on a real iPhone.
