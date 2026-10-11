---
reports: spya-m2pyfq
ending: shipped
comment: The error couldn't be found: it happened in your browser before anything was uploaded, and nothing there reported to Sentry. Now every dictation failure does, and a refused microphone says so instead of "press it again".
---
# The microphone error that never reached Sentry

An admin report from Greg (`scripts/feedback-reporter.ts` exit 0), `spya-m2pyfq`
(SPIDERYARN-READING2-H0), filed 2026-10-11 at 01:09:05 UTC from `/admin/vouchers` (build
`00081085`). Queue item `qi-6n5th4qh`, session `fbm2pyfq-dictation-mic-error`, with
[261011_0150](261011_0150-dictation-paragraph-breaks.md). Plan, both GPT Sol reviews and the
measurements: [261011i](../plans/261011i-dictation-failures-reach-sentry.md).

> I was on the microphone input button. I think it was in a chat, but I'm not sure. And there was
> some kind of error so the microphone input didn't work. It was about three hours ago. See if you
> can find that error in Sentry, in the logs or anywhere like that. If you can't, let's improve the
> logging and Sentry error monitoring around microphone input. And if you can, try and fix it.

**Ending: shipped.**

## What the search found

- **Vercel runtime logs**, production, 2026-10-10 12:00 to 2026-10-11 01:10 UTC: one
  `POST /api/transcribe` at 17:36 (200), then **none until 00:56**, and no `error` or `warning`
  line from any route between 20:00 and 00:30. So in the hours Greg names, no recording was ever
  uploaded: the dictation failed **in the browser**, before the upload. Every dictation that did
  arrive that day was `m4a`, which is what Safari records, so most likely an iPhone.
- **Sentry**: the sweep found nothing, and could not have. `useDictation` showed every failure as a
  sentence on screen and told nobody else. Sentry's automatic reporting only sees uncaught throws.
- **The production database** keeps nothing about a dictation that never reached the server.

Which sentence Greg saw cannot be recovered. One strong candidate: every refusal to open the
microphone, a refused permission included, said *"The microphone could not be started. Press it
again, or type instead. [mic-no-start]"*. On an iPhone the prompt comes back after ten minutes idle
([dictation.md § failure 10](../project/dictation.md#the-ways-it-fails)), and pressing again after a
refusal cannot work.

## What we did

- **Every dictation failure now reaches Sentry**, one issue per code, named `DictationFailure`. It
  says which box, the browser's reason when the microphone would not open, whether a chosen
  microphone was the one that opened, and the browser engine and whether it is a phone. Never the
  words on screen, never an article. The next report like this one can be answered by searching
  Sentry for `DictationFailure`.
- **A refused microphone says so**: *"This page wasn't allowed to use the microphone. Check the
  microphone permission for this site in your browser, and in your device's privacy settings, then
  try again. [mic-refused]"*. No microphone at all gets `[mic-none]`. Anything else keeps
  `[mic-no-start]`.

Not built: a report when a permission prompt is never answered, so the microphone stays "Opening…"
for ever. No sentence is shown in that case, and it needs a timer and its own sentence.
[dictation.md § Every failure reaches Sentry](../project/dictation.md#every-failure-reaches-sentry)
says so.

**For the sweep (this session has no Sentry sign-in):** resolve SPIDERYARN-READING2-H0.
