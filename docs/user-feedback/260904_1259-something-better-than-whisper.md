# Is there something better than Whisper?

**[SPIDERYARN-READING2-15](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-15)** · reported
2026-09-04 12:59 UTC · resolved 2026-09-04 · *answered, no change*

## What the reader said

> We are using Whisper, maybe, for the microphone functionality, such as in this feedback dialogue
> box, and it works okay, but I wonder if we can do better. Isn't there a later, better speech to
> text that either OpenRouter or OpenAI offer that's better than Whisper. Search the web and consider
> switching it out if you think there is a better option. Reminder, we want to optimize for being
> able to take in custom vocabulary, correctness, then latency, then cost efficiency.

## What we did

Nothing, and the reason is that the question was asked and answered a day earlier.

**We do not use Whisper.** Dictation goes to `google/gemini-3.1-flash-lite` through OpenRouter — a
*chat* model rather than one of the nineteen dedicated speech-to-text models, and that choice is the
answer to the reader's own priority list: the dedicated route has nowhere to put a vocabulary, and
the vocabulary is the whole feature.

The bake-off is [260903i](../plans/260903i-which-model-transcribes-dictation.md), 2026-09-03: fifteen
audio-capable models gated, then ten clips × three runs × three survivors — 210 calls for $0.13. On
the seven clips whose words were actually **in** the vocabulary, **every candidate got every hard
term right, 78/78, and two of the three made no word errors at all.** Every apparent difference
between models lived in the three clips nobody had supplied the words for, which measures how a model
*guesses* rather than how it *hears*.

OpenAI's audio models are off the table for two measured reasons that have nothing to do with their
ears: there is no zero-data-retention endpoint for them on OpenRouter (404 under `zdr: true`, the
flag that lets the copy beside the microphone promise a reader's voice is not stored), and
`input_audio` refuses the webm that `MediaRecorder` produces.

## The careful version of the verdict

**Current evidence does not justify a swap.** That is deliberately not the same sentence as "a swap
cannot help", which is what the first draft of this answer said and which the cross-family review
correctly called out as exceeding the evidence: the bake-off measured 1.8–2.5% WER and 90–92%
hard-term recall, and the perfect score was 78 terms over seven *synthetic* clips. That is enough to
decline a swap today. It is not enough to declare a ceiling.

Which matters, because the reader's actual complaint — [-11](260904_1241-dictation-misspells-spideryarn.md),
filed eighteen minutes earlier — turned out to have no bug behind it, and the honest residual there
is model error on real human speech. Nobody has ever measured that: the corpus is synthetic, and a
person on an iPad in a room is not a synthetic clip. That is the open thread, and it is a
measurement rather than a model swap.

`npm run eval:dictation-gate` re-asks the availability question in about a minute, so if either
OpenAI fact changes we will not have to remember why we looked.
