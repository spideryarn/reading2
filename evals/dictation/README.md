# Which transcriber, does telling it the words help, and which words?

Five benchmarks, checked in because GPT Sol's review of
[the first plan](../../docs/plans/260827x-dictation-two-pass.md) asked for it: the numbers in these
documents chose the model and then chose the vocabulary, and a number nobody can re-run is a number
nobody can argue with.

```
node  evals/dictation/bench-transcribers.mjs         # 16 models, OpenRouter's transcription endpoint
node  evals/dictation/bench-vocabulary.mjs           # Gemini chat, with a vocabulary prompt and without
npm run eval:dictation-vocab                         # which sources, and how much is too much
npm run eval:dictation-gate                          # which candidates can serve our request at all
npm run eval:dictation-models                        # and which of those transcribes best
node  evals/dictation/make-clips.mjs                 # regenerate the ten clips (needs say + ffmpeg)
```

All of them read `OPENROUTER_API_KEY` out of `.env.local`. The first two cost a few cents; the
vocabulary one cost **$0.1833** at five runs (`RUNS=5`, 650 calls) and defaults to two; the gate is
a minute and pennies; the model bake-off cost **$0.1283** at three runs (210 calls) on 2026-09-03,
and defaults to three.

## Run the gate before the bake-off

`gate-models.ts` is the cheap half of a model comparison, and the reason it is separate is that a
candidate which cannot be *routed* looks exactly like a candidate having a bad hour. Dictation sends
`provider: { zdr: true, require_parameters: true }` plus a strict `json_schema` plus webm/opus audio
(`AI_JOB_ROUTE` in [`src/ai-call.ts`](../../src/ai-call.ts)), and each of those four can leave a
model with no endpoint. `require_parameters` in particular turns "this upstream does not do
structured outputs" into a 404, which the harness would otherwise retry five times and record as
lost. Finding that out in the gate costs a minute; finding it out in the bake-off costs an hour.

It is also where the answer to "should we use OpenAI?" actually lives — see
[260903i](../../docs/plans/260903i-which-model-transcribes-dictation.md). Both `openai/gpt-audio`
models 404 under `zdr`, and 400 on webm even without it.

## The bake-off, and its noise floor

`bench-models.ts` holds the vocabulary at the shipped composition and varies the model — the mirror
of `bench-vocabulary-sources.ts`. Every arm goes through `transcribeWith` with a `model` option, so
the request is the app's; before that option existed the other benchmark's `MODEL` was a *label* and
the call went to `DICTATION_MODEL` regardless, which is a results file that can name one model and
have measured another.

**The incumbent is in the table twice, byte for byte.** The gap between those two rows is the only
thing here that says anything about its own precision — 0.2 points of word error and 0.9 of recall
in the 2026-09-03 run — and nothing smaller than it is a finding. One replicate pair is a sample of
the noise, not a bound on it.

It also checks `answeredBy` and prints a mismatch loudly. `zdr` routing means OpenRouter is picking
an upstream under a constraint, so an arm named after the slug we *sent* can be scoring a fallback.

## Scoring is one file

`score.ts`: the normaliser, the word-level Levenshtein, the hard-term matcher, the invented-terms
detector and its self-test. Both benchmarks import it, so their word error rates are the same
measurement rather than two definitions that agree until they don't.

## The third one is the interesting one

`bench-vocabulary-sources.ts` (`npm run eval:dictation-vocab`) asks where a vocabulary should come
from — the app's own words, the reader's "why you're reading this one" box, their profile, the
article's glossary, the article's own proper nouns — and, the part nobody measures, whether a big
list starts putting words in the reader's mouth.

It **sends the app's own request**: `transcribeWith` from `src/transcribe.ts`, which is the function
the server calls once it has a vocabulary, so the system prompt, the JSON schema,
`require_parameters`, the truncation and refusal checks and `tidy()` are shared rather than
described twice. One condition — `production (vocabularyFor)` — builds its vocabulary through the
shipped composition too.

That was not true at first. The harness had its own `fetch`, its own weaker system prompt and no
schema, while this file claimed it "imports the real builder"; every number it produced was about a
request the app never sends. GPT Sol found it by reading the two side by side. An eval that
reimplements the thing it measures can only tell you about the reimplementation, and its number then
goes on to justify shipping the other one.

Four columns:

- **WER**, twice — **corpus** (total edits over total reference words) and the **mean** of the ten
  per-utterance rates. They disagree, and the disagreement is the point: the mean lets a five-word
  dictation weigh as much as a thirty-word one.
- **Hard-term recall** on the terms the utterance exists to say.
- **Invented** — vocabulary terms that turn up in a transcript of an utterance that did not contain
  them. Narrow on purpose and narrow in fact: it matches whole normalised phrases, so it sees a term
  *inserted* and cannot see a term's influence. In the three-run round the wrong-article vocabulary
  turned `principal hierarchy` into `principle hierarchy` on every run and this column stayed at
  zero; in the five-run round that same arm cost 0.8 points of word error and 7.3 points of
  hard-term recall over having no vocabulary at all, and this column was still zero. Read it as "no exact vocabulary term was inserted", never
  as "no harm".
- **Control WER** — the word errors on the clip that says nothing hard, under each condition's
  vocabulary. This is the harm number that does not depend on the detector above.

All of it normalises away case, punctuation and diacritics before comparing, which is lenient in one
way worth knowing: `Muller Lyer` scores as a hit for `Müller-Lyer`. So recall here means *the model
found the word*, not *the model spelled it exactly*. It is not lenient about `-ise` against `-ize`,
and the `purpose-box` clip is where that shows: the model wrote `realization` in 54 of 55
transcripts, including the five where `relevance realisation` was sitting in the prompt with an `s`.
A term list settles which word, not which spelling of it.

A call that will not come back after five attempts is **recorded as lost and the run continues**,
and the count is printed and stored. It used to throw: on 2026-08-28 one 502 at call 369 of 650
ended a fifty-five-minute run with nothing written down. A thinned table and a full one must not
look alike, which is why the lost calls are named rather than merely survived.

Conditions are **interleaved**, rotating by clip and by run, so a slow half-hour upstream is spread
across all of them rather than landing on whichever condition was in the loop. The first two rounds
ran in blocks and nothing in the output would have said so.

### One clip only one condition can answer

`purpose-box` says four things — `Vervaeke`, `relevance realisation`, `Anjali Chaudhuri`, `Friston`
— and none of them is anywhere on this machine except in the "why you're reading this one" box the
`+purpose` condition supplies. Grepped against every `blocks.json` and every `glossary.json` in
`data/` before it was written. So every other row scores what the model can do from the sound alone,
and the gap is the whole value of that box.

The box's text is written into the harness rather than read from the store, because no article here
has one. Reading the store would have produced a row of zeroes that looked like a finding about the
source rather than a fact about the fixtures.

### Six things in it exist only to be controls

- **`control-no-hard-terms`** — ordinary English, no jargon, dictated against an article whose
  vocabulary is loaded. Every vocabulary term in its transcript was invented by a model that had
  been told to expect it. Without this clip the invented column cannot be non-zero.
- **`short`** — four words. Most dictation is short, and this file used to say plainly that nothing
  here settled that.
- **`wrong article`** — a full-size vocabulary made almost entirely of terms from articles no clip
  mentions. *Almost*: the extractor's two-character floor let the word `In` through, and two clips
  say it. It shares no scored hard term with any clip, and `in` is now in `NOT_NAMES`, but the
  earlier flat claim that "nothing in it was said in any clip" was false twice over. It was built from `fowler-phrenology` for two rounds, which two clips *are* about, and
  it carried the site terms, which a third clip says aloud — so it scored partly as a right
  vocabulary while the file claimed nothing in it was ever said. GPT Sol found that by reading the
  condition against `utterances.json`.
- **`+names(40) + irrelevant`** — the correct vocabulary, byte for byte and in the same order, plus
  the terms above. The only difference from the row it doubles is bulk that is wrong, which is the
  question `whole library` was being asked and could not answer: that one contains the clips' own
  articles, so it adds coverage as well as size.
- **`site+glossary`** — so that the profile is one step rather than one third of a step. Without it,
  `shipped` → `site+profile+glossary` changes three things at once.
- **`+names(40) again`** — byte-for-byte the same condition as the row above it. **The gap between
  those two rows is one observation of what this measurement cannot tell apart**, and it is the only
  row that says anything about its own precision. It arrived by accident and is kept on purpose. One
  replicate pair is a sample of the noise, not a bound on it.
- **`+names(10)`** — a limit that actually binds. `MAX_NAMES` is 40 and these articles produce
  20-25, so the shipped number is a ceiling nothing has ever touched; ten is the row that makes
  "some of the names" against "all of them" a real comparison.

And the invented-terms detector refuses to run until it has been made to fire on a planted
transcript, because a zero from a detector nobody has watched work is the same shape as a zero from
a broken one ([silent-success.md](../../docs/reusable/silent-success.md)). It counts terms of three
characters and up; six was the first floor, and six is precisely the rule that would have let
`Gall`, `Ava` and `LLM` through — the short names a biasing list is most likely to insert.

## What the clips are, and what they therefore cannot tell you

`utterances.json` holds ten things a reader might plausibly dictate, using terms out of four real
articles in `data/`. `make-clips.mjs` speaks each one with `say` in one of three voices and encodes
it with `ffmpeg` as Opus-in-WebM at 32 kbps, which is what Chrome's `MediaRecorder` produces.
`sample-long.webm` is the older single clip the first two benchmarks use: 22 seconds of
`say -v Daniel`.

Say plainly what that supports:

- **Whether telling a model the words fixes the spelling of them.** This is the one thing the clips
  are properly good for, and it is a decision rather than an acoustic problem: `Spideryarn` versus
  `Spider Yarn` is not something a clearer recording would settle. The result has been stable across
  every run since 2026-08-27.
- **Latency, roughly.** And only roughly: the run that produced the first plan's table had
  `gemini-3.1-flash-lite` at a 2.4s median, and a re-run two hours later on the same machine gave
  8.8s with a 3.5–16.9s spread. Same code, same clip. Order of magnitude, not a measurement.
  `bench-models.ts` reports p90 and the maximum as well as the median for exactly that reason — a
  median is the call that felt fine — but all three come from one sitting on one network, so a
  *difference* between arms measured in the same run is worth more than any of the numbers.

And what it does not support, whatever the table says:

- **Nothing about hearing.** No accents, no mumbling, no fan in the room, no two people. A synthetic
  voice is the easiest input an ASR model will ever get, and the models that scored badly here
  scored badly on *jargon*.
- **Nothing about a real microphone.** These are files, not a recording made through
  `getUserMedia` in a browser on a laptop in a room.
- **Nothing general about the models.** Ten clips, three voices, one model on the third benchmark.

The honest summary is that these evals chose between candidates on the one axis they can measure
well. Real recordings — a person, an iPad, a noisy room, a one-word dictation, silence — are what
would settle the rest, and they are still not here.

## The cost figure

`usage.cost` from OpenRouter, and it disagrees with itself across the two routes: the transcription
endpoint reports `0` for several models that are definitely not free, while the chat route reports a
real number. The chat route's is the one the plans quote — **$0.00040 for 22 seconds, which is
$0.0011 a minute**, about a tenth of a cent. The first plan originally said a twentieth; GPT Sol did
the arithmetic and it was wrong.
