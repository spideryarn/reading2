# Which transcriber, and does telling it the words help?

Two scripts and one sample, checked in because GPT Sol's review of
[the plan](../../docs/plans/dictation-two-pass.md) asked for it: the numbers in that document
chose the model, and a number nobody can re-run is a number nobody can argue with.

```
node evals/dictation/bench-transcribers.mjs   # 16 models, OpenRouter's transcription endpoint
node evals/dictation/bench-vocabulary.mjs     # Gemini chat, with a vocabulary prompt and without
```

Both read `OPENROUTER_API_KEY` out of `.env.local` and cost a few cents a run.

## What the sample is, and what it therefore cannot tell you

`sample-long.webm` is **22 seconds of `say -v Daniel`** — synthetic speech, one voice, one
sentence — encoded the way `MediaRecorder` encodes it, Opus in WebM at 32 kbps.

Say plainly what that supports:

- **Latency, roughly.** And only roughly: the run that produced the plan's table had
  `gemini-3.1-flash-lite` at a 2.4s median, and a re-run two hours later on the same machine
  gave 8.8s with a 3.5–16.9s spread. Same code, same clip. Treat a single figure from this as
  an order of magnitude, not a measurement.
- **Whether a vocabulary prompt recovers proper nouns.** This is the one thing the sample is
  actually good for, because the two words it exists to test — `Spideryarn` and the block id
  `spya-k3m9qt` — are exactly the kind a transcriber has never seen. That result has been
  stable across every run: 0.0% word errors with the vocabulary, 3.6–7.3% without.

And what it does not support, whatever the table says:

- **Nothing about human speech.** No accents, no mumbling, no fan in the room, no two people.
  A synthetic voice is the easiest input an ASR model will ever get, and the models that scored
  badly here scored badly on *jargon*, not on hearing.
- **Nothing about short utterances**, which is what most dictation actually is.
- **Nothing general about the models.** One clip, three runs.

The honest summary is that this eval chose between candidates on the one axis it can measure
well, and the rest of the choice rests on price and on the model being on a gateway we already
use. Real recordings — a person, an iPad, a noisy room, a one-word dictation, silence — are
what would settle it, and they are not here yet.

## The cost figure

`usage.cost` from OpenRouter, and it disagrees with itself across the two routes: the
transcription endpoint reports `0` for several models that are definitely not free, while the
chat route reports a real number. The chat route's is the one the plan quotes —
**$0.00040 for 22 seconds, which is $0.0011 a minute**, about a tenth of a cent. The plan
originally said a twentieth; GPT Sol did the arithmetic and it was wrong.
