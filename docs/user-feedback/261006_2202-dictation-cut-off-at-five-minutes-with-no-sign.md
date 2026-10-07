---
reports: spya-n8cuqq
ending: shipped
---
# Dictation cut off at five minutes, with no sign

SPIDERYARN-READING2-E8, from Greg (admin, proven by `scripts/feedback-reporter.ts` on the production
row), a suggestion, filed 2026-10-06 22:02 UTC on production from `/changelog`; Overseer queue item
qi-yrmf2wcm.

> I was doing a really long, really kind of useful voice dictation here in the feedback dialogue,
> and it cut me off after five minutes. I mean, the first thing is, if you're ever going to cut me
> off like that, you should give me some kind of feedback of some kind. But more importantly, let's
> make sure if there is going to be a cap, let's make it at least 15 minutes.

**Ending: Shipped.** On `dev`, plan
[261007b](../plans/261007b-dictation-says-when-it-is-about-to-stop-and-runs-fifteen-minutes.md).
Not deployed: the Overseer deploys.

- **The cap is fifteen minutes**, in every box with a microphone. It was five.
- **It says so before it stops.** In the last minute the line under the box turns into a warning
  and counts down, *"Dictation stops in 0:45"*, and a short chime plays as that minute starts. When
  it stops there is a second chime, and the sentence saying why stays after the words arrive. There
  had been a sentence before, in small type, shown only once the microphone was already off.
- **Feedback takes 12,000 characters**, up from 4,000, so the box holds what the microphone now
  lets in: about thirteen minutes of speaking without a pause.
- **The cap was not a listed defence**, so nothing about it waited on Greg.
- **Deferred, and waiting on Greg:** taking Feedback to 20,000 characters, a full fifteen minutes
  at any pace. That means raising the database's own cap on a report, which the code describes as
  what stops a pasted article reaching Sentry, so it was written up and not built: queue item
  qi-8qvg5gwv, and a line in [awaiting-approval.md](awaiting-approval.md).
