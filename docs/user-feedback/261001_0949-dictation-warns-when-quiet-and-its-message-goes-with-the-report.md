---
reports: spya-wu265m
ending: shipped
---
# Dictation warns when it hears nothing, and its message goes with the report

SPIDERYARN-READING2-7Z, from Greg (admin), a suggestion, filed 2026-10-01 09:49 UTC on production;
Overseer queue item qi-brske4bm.

> I got this message after trying to record voice in Feedback:
>
> "We didn't catch any words in that. The audio is below if you want it. [mic-silent"
>
> Two things:
> - Warn me (both visually, and perhaps with a subtle auditory warning too) while recording if it
>   looks like this is a problem
> - I submitted the feedback report by typing, then reopened the Feedback modal again later, and it
>   was still showing that same message every time!

**Ending: Shipped.** On `dev` in a2e7c165 and b83a1196 (GPT Sol's code-review fixes), plan
[261001k](../plans/261001k-dictation-silent-mic-warning-and-a-message-that-goes.md). Not deployed:
the Overseer deploys.

- **The message that stayed.** The Feedback dialog is mounted for the life of the page, and so is
  its dictation, so nothing cleared it after a send. Now a filed report clears the message, the audio
  and its device copy — only what was showing when Send was pressed. Closing without sending still
  keeps it, as a draft is kept. The audio row's × now takes the message with it too.
- **The warning.** The existing "No sound detected yet" (ten seconds of silence) is now warm and bold
  with a warning glyph instead of faint grey, and a soft two-note chime plays once per dictation.
  Checked in Chrome at 1280 and 390 px with a silent fake microphone.
- **Deferred:** a warning for a microphone that hears sound but no words, such as a fan or the
  wrong input. The silence check cannot see that case, and it may be the one Greg hit; the plan says
  how it would be built.
- **Not changed:** the `[mic-silent]` code. Bracketed codes are house policy (copy.md); the missing
  `]` is the copy that was pasted, not the page.
