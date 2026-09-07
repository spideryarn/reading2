# Which transcriber, does telling it the words help, and which words?

Five benchmarks, checked in because GPT Sol's review of
[the first plan](../../docs/plans/260827x-dictation-two-pass.md) asked for it: the numbers in these
documents chose the model and then chose the vocabulary, and a number nobody can re-run is a number
nobody can argue with.

```
node  evals/dictation/bench-transcribers.mjs         # 16 models, OpenRouter's transcription endpoint
node  evals/dictation/bench-vocabulary.mjs           # Gemini chat, with a vocabulary prompt and
                                                     #   without — the route dictation left on 2026-09-07
npm run eval:dictation-vocab                         # which sources, and how much is too much
npm run eval:dictation-gate                          # which candidates can serve our request at all
npm run eval:dictation-models                        # and which of those transcribes best
npx tsx evals/dictation/probe-stt-routes.ts          # OpenRouter against OpenAI direct, and what
                                                     #   a `provider` block does on this endpoint
npx tsx scripts/spike-dictation-browser.ts           # a real Chrome MediaRecorder blob, end to end
node  evals/dictation/make-clips.mjs                 # regenerate the ten clips (needs say + ffmpeg)
```

All of them read `OPENROUTER_API_KEY` out of `.env.local`. The first two cost a few cents; the
vocabulary one cost **$0.1833** at five runs (`RUNS=5`, 650 calls) and defaults to two; the gate is
a minute and pennies; the model bake-off cost **$0.1283** at three runs (210 calls) on 2026-09-03,
and defaults to three.

**Every one of those figures came off the chat endpoint and no run since 2026-09-07 can produce
another**, because `openai/gpt-transcribe` through OpenRouter answered `usage.cost: 0` on both calls
anybody has measured — 3 seconds of audio and 22, on 2026-09-07. That is an observation about this
model on this route, not a property of the protocol: OpenRouter documents per-request costs on the
transcription endpoint, so another model may well price properly and the day this one starts to,
`unpriceZero` in src/ai-call.ts uses the number. Both benches
have dropped their `$` column rather than printing a zero; § *The cost figure* at the foot of this
file is where the arithmetic went.

## Run the gate before the bake-off

`gate-models.ts` is the cheap half of a model comparison, and the reason it is separate is that a
candidate which cannot be *routed* looks exactly like a candidate having a bad hour. Finding that out
in the gate costs a minute; finding it out in the bake-off costs an hour.

**What the gate sends changed on 2026-09-07**, and the paragraph that used to be here is worth
keeping as the record of what it sent before: *"Dictation sends `provider: { zdr: true,
require_parameters: true }` plus a strict `json_schema` plus webm/opus audio, and each of those four
can leave a model with no endpoint."* All four are gone. Dictation is now a **transcription**
request — `openai/gpt-transcribe`, no routing policy at all, and the vocabulary as
`provider.options.openai.keywords` — so the gate probes that endpoint, and the four-constraint
diagnosis survives further down the same file as the record of why the chat endpoint was abandoned.
[260907c](../../docs/plans/260907c-dictation-onto-an-openai-transcriber.md).

It is also where the answer to "should we use OpenAI?" actually lives — see
[260903i](../../docs/plans/260903i-which-model-transcribes-dictation.md). **On the chat endpoint**,
both `openai/gpt-audio` models 404 under `zdr`, and 400 on webm even without it. That is what sent
dictation to the transcription endpoint rather than to a transcode, and it is why the `diagnose`
half of `gate-models.ts` still probes a path the app no longer uses.

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

It also checks `answeredBy` and prints a mismatch loudly. **The reason changed on 2026-09-07 and
the check did not.** It used to be `zdr` routing: OpenRouter was picking an upstream under a
constraint, so an arm named after the slug we *sent* could be scoring a fallback. There is no
routing policy on the transcription request at all now — so we have said even less about which
upstream answers, and an arm named after what we sent can still be scoring something else.

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
the server calls once it has a vocabulary, so whatever that request is made of is shared rather than
described twice. One condition — `production (vocabularyTermsFor)` — builds its vocabulary through
the shipped composition too.

What that list used to name is worth keeping, because it is most of what the move to
`/v1/audio/transcriptions` deleted: a system prompt, a strict JSON schema, `require_parameters` so
no upstream could drop the schema, and a truncation check. All four went on 2026-09-07
([260907c](../../docs/plans/260907c-dictation-onto-an-openai-transcriber.md)). What is shared now is
the model, the `keywords` array, the size and length guards, `MAX_TRANSCRIPT_CHARS` and `tidy()` —
and the point of the sentence is unchanged: the harness must not be a second implementation of it.

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
transcripts, including the five where `relevance realisation` was sitting in the vocabulary with an `s`.
A term list settles which word, not which spelling of it.

A call that will not come back after five attempts is **recorded as lost and the run continues**,
and the count is printed and stored. It used to throw: on 2026-08-28 one 502 at call 369 of 650
ended a fifty-five-minute run with nothing written down. A thinned table and a full one must not
look alike, which is why the lost calls are named rather than merely survived.

Both benchmarks close on a **coverage** block from [`coverage.ts`](coverage.ts) — what came back
against what was sent, per arm — and **exit 1 if any arm answered nothing at all**, so a run that
measured nothing cannot be `&&`-chained as if it had. `calls` in either results file is
`{ attempted, answered, lost }` for the same reason: it used to be the *planned* product, under a
name that claimed to say what happened.

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

`usage.cost` from OpenRouter disagrees with itself across the two routes: **the transcription
endpoint reports `0`** for models that are definitely not free, while the chat route reports a real
number. That used to be a footnote about the benches, and since 2026-09-07 it is a fact about the
product, because dictation ships on the route that answers zero.

- **The chat-route figure the plans quote is history**: $0.00040 for 22 seconds, which is $0.0011 a
  minute, about a tenth of a cent, on `gemini-3.1-flash-lite`. (The first plan said a twentieth;
  GPT Sol did the arithmetic and it was wrong.) It is what dictation used to cost, not what it costs.
- **Nothing on the wire prices the current route.** `openai/gpt-transcribe` is listed at $0.0045 a
  minute — [260907c](../../docs/plans/260907c-dictation-onto-an-openai-transcriber.md) — and that is
  a published rate rather than something a run here measured.
- **The zero is not recorded as a price.** `unpriceZero` in `src/ai-call.ts` drops an exact zero, so
  a dictation row in the ledger says its cost came from nowhere — short by an unknown amount, and
  saying so — instead of asserting the provider told us it was free. Both benches dropped their `$`
  column for the same reason: a column of zeroes that sums to a number the run did not cost is worse
  than no column.
- **What to ask instead**: `npm run cost -- --reconcile`, which asks the account rather than the
  response body.
