---
reports: spya-x6qjbn
ending: awaiting
comment: There's no clean-up prompt to tweak, and the transcriber ignores a paragraph instruction (tested). Paragraph breaks would need a new second step, so that's a question to you (q-a0qp3x).
---
# Paragraph breaks in dictation

An admin report from Greg (`scripts/feedback-reporter.ts` exit 0), `spya-x6qjbn`
(SPIDERYARN-READING2-HF), filed 2026-10-11 at 01:50:33 UTC from `/` (build `2c38ec32`). Queue item
`qi-6n5th4qh`, session `fbm2pyfq-dictation-mic-error`, with
[261011_0109](261011_0109-microphone-error-never-reached-sentry.md).

> When I use the voice dictation button, for example in the feedback reports like this one, it seems
> to have two stages. It seems to have a kind of quick stage and then to have an LLM afterwards tidy
> things up. I don't know if that's right, but if it is, can we make a minimal tweak to that LLM
> prompt to ask it to add paragraph breaks where appropriate?

**Ending: awaiting Greg**, question [q-a0qp3x](questions/q-a0qp3x.md).

There is no LLM tidy-up step. The quick stage is the browser's own recogniser (Chromium only, a
preview that is thrown away), and the second is `openai/gpt-transcribe`, whose request carries the
audio and a vocabulary and no prompt
([dictation.md § It transcribes twice](../project/dictation.md#it-transcribes-twice)).

Measured 2026-10-11, with a synthesised 42-second clip of three separate points with two-second
pauses between them: one paragraph every time. That held for a plain request, a paragraph
instruction as `prompt` at the top level and under `provider.options.openai` through OpenRouter, and
the same instruction **sent to OpenAI directly**, so the model ignores it, not just OpenRouter.
`verbose_json` (phrase timings, which simple code could split on) is refused by the model. The probe
scripts were throwaway and are described in
[261011i § What we are doing](../plans/261011i-dictation-failures-reach-sentry.md#what-we-are-doing),
item 3.

So paragraph breaks need a new second model call. That adds a wait to a call the reader is
watching, and gives a model the reader's words. That makes it a product choice, and it is put to
Greg with a guarded design: the call may only add line breaks, and code checks it.
