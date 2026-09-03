# Which model transcribes dictation

> For the dictation model, it says we're using gemini-3.1-flash-lite. […] what model is best
> (prioritising capability, latency, then cost). Importantly it has to take in vocabulary. I was
> thinking probably the state of the art would be OpenAI?
>
> — Greg, 2026-09-03

**The answer is that the incumbent stays, and the interesting half of that answer is why OpenAI is
not on the table.** It is not a capability judgment. `openai/gpt-audio` and `openai/gpt-audio-mini`
cannot serve this app's request at all, for two independent reasons, and both were measured rather
than read.

The reasoning behind the current setup is [260827x](260827x-dictation-two-pass.md) (which model, and
why a chat model rather than a transcriber) and [260828l](260828l-dictation-vocabulary.md) (where
the vocabulary comes from). This one asks the question neither of those actually asked.

## What the previous bake-off settled, and what it did not

[260827x](260827x-dictation-two-pass.md)'s table is the reason `gemini-3.1-flash-lite` is the
default, and it is a good table for the question it answered. It is not evidence about model choice,
for a reason visible in its own rows: **the Gemini models were given a vocabulary and everybody else
was not.** The nineteen dedicated transcribers have nowhere to put a term list — that is the finding
that chose the route — so the comparison was route against route, with the model confounded. On the
one line where the two were closest to level, `openai/gpt-transcribe` bare scored 3.6% and Gemini
bare scored 3.6–7.3%.

Two smaller things in it are worth naming before quoting it again:

- **The famous 0.0% WER is not a number about the shipped request.** It came from
  `bench-vocabulary.mjs`, which had its own system prompt, put the vocabulary in the *system*
  message, and sent no JSON schema. Under the production request, on ten clips and five runs, the
  incumbent scores **1.8–2.5% corpus WER and 90–92% hard-term recall** ([260828l](260828l-dictation-vocabulary.md)).
  That is the honest incumbent number: it misses about one hard term in twelve, on synthetic speech.
- **`gemini-3.7-flash` also scored 0.0% and was dropped on latency** — a three-run median that the
  plan itself calls "order of magnitude, not a measurement", in a file that reports the same model
  and clip at 2.4s and at 8.8s two hours apart. Under "capability first", that elimination was not
  made on capability.

So: nothing has ever scored a non-Google model on this app's own request, and the newer Gemini
generations have never been scored at all.

## The gate, which is where the OpenAI answer turned out to live

`evals/dictation/gate-models.ts` — new here, and the cheap half of the work. Every model OpenRouter
lists as taking audio input (`GET /api/v1/models`, filtered on `input_modalities` containing
`audio`, 2026-09-03), sent one clip through `transcribeWith`, which is the app's own request.

That request is not a bare chat call. It carries `provider: { zdr: true, require_parameters: true }`
(`AI_JOB_ROUTE` in [`src/ai-call.ts`](../../src/ai-call.ts)), a strict `json_schema`, and the audio
as `input_audio` in **webm/opus**, which is what Chrome's `MediaRecorder` produces. Each of those can
independently leave a candidate with no endpoint.

Fifteen candidates; **eight answered, seven did not.** The gate now takes the constraints off one
at a time for each failure, so a refusal says *what* it was refusing — which turns a list of status
codes into four quite different stories:

| Model | Refused | Because |
|---|---|---|
| `openai/gpt-audio`, `-mini` | 404 under `zdr`, 400 without | **Two blockers, independently.** Below. |
| `mistralai/voxtral-small-24b-2507` | 400 on webm, 200 on wav | The container. |
| `xiaomi/mimo-v2.5` | 400 on webm, 200 on wav | The container. |
| `thinkingmachines/inkling`, `-small` | 404 on `require_parameters` **only** | Serves webm, schema and `zdr` happily; simply does not *declare* structured-output support, and that flag exists to exclude a provider that would quietly ignore the schema. Not a capability finding. |
| `meta/muse-spark-1.3` | 403, every variant | An account setting — "18+ age confirmation" — not a model property at all. |

The last two rows are the argument for the diagnosis pass existing. Read as bare status codes they
look like five models that cannot transcribe; three of them are a routing flag and a checkbox.

### OpenAI is blocked twice, and neither blocker is about how well it hears

Both isolated by varying one flag at a time against the same clip — and this is the gate's own
diagnosis output, re-runnable, not a script that was thrown away:

```
openai/gpt-audio — one constraint at a time:
  no provider block, schema, webm       400  Provider returned error
  require_parameters only, schema, webm 400  Provider returned error
  zdr only, schema, webm                404  No endpoints found matching your data policy
                                             (Zero data retention)
  no provider block, no schema, webm    400  Provider returned error
  no provider block, no schema, WAV     200  ok
```

**One: there is no ZDR endpoint for OpenAI's audio models on OpenRouter.** `zdr: true` is the
load-bearing flag on this route and not a preference — the copy beside the microphone tells the
reader their voice is not stored, and this app can only speak for itself unless the routing says
otherwise ([privacy.md](../project/privacy.md), and the comment on `AI_JOB_ROUTE`). Reaching OpenAI
means dropping that promise, which is Greg's call and not a benchmark's.

**Two: OpenAI's `input_audio` will not take webm.** The last two lines above are the same request
in two containers: webm 400, wav 200. There is no transcoder on this box, so the wav is a synthetic
second of 16-bit PCM tone — it carries no words, so it says nothing whatever about accuracy, and
everything about the door. This matches OpenAI's own API reference, which restricts
chat-completions `input_audio.format` to `wav` and `mp3`; their *transcription* endpoint is the
permissive one and that permissiveness does not extend here.

So the defensible statement, and it wants stating carefully:

> **`openai/gpt-audio` and `openai/gpt-audio-mini` cannot serve dictation's current
> chat-completions request under `zdr` with webm audio.**

Not "OpenAI is unreachable", which would be false — [260827x](260827x-dictation-two-pass.md)
reached `openai/gpt-transcribe` on the dedicated endpoint a week ago, and that route is the open
question below. And the webm half is a cost rather than a wall: a transcode would do it, and it need
not be `ffmpeg` on the server — the browser could encode wav directly. It would be paid in latency
in front of the one call a person is sitting and waiting for, and in a second encoder to keep
working. The ZDR half is the one that is not ours to engineer around, because it is a promise on the
page ([privacy.md](../project/privacy.md)) rather than a technical preference.

If either fact changes, `npm run eval:dictation-gate` re-asks in a minute and prints the same
diagnosis.

A by-product of the container probe is the whole feature in one line. The same clip, the same
model, the vocabulary taken away: the incumbent hears `Spideryarn` as **"speeder Ion"**. The gate
sends a vocabulary, so that came from the bare-prompt variant rather than from the output above —
and it is what the second table of the bake-off measures at scale.

## The bake-off, among what actually passes the gate

`evals/dictation/bench-models.ts` — the sibling of `bench-vocabulary-sources.ts`, which holds the
model fixed and varies the vocabulary. This one holds the vocabulary fixed at the shipped
composition and varies the model.

Three models. The two lite-tier ones because the gate put them a *second* apart from everything
else — 1.3s against 2.2–28s across two gate runs, for a person in front of a microphone button —
and `gemini-3.8-flash` as the capability probe, because "capability first" means somebody has to
check whether the lite tier is leaving accuracy on the floor. Each with the vocabulary and without,
plus the incumbent run twice byte-for-byte as a noise floor.

**That is a latency filter applied before a capability comparison, which is the opposite of the
stated priority**, and GPT Sol was right to name it. The defence is that `3.8-flash` is the newest
and largest of the five dropped, so the flash tier's ceiling is represented rather than assumed —
and, as it turned out, that ceiling is the same as the lite tier's.

Ten clips, three runs, 210 calls, no losses, every call answered by the model it was sent to.
**$0.1283**, 2026-09-03, `results-models.json` beside the script.

**This is the second run of the day**, and the first is the reason to trust it. The first produced
the same conclusion by accident of a table I read wrongly; the script was then changed to report the
split below, and re-run from scratch. Two independent 210-call runs, hours apart, agree on every
finding here — which is worth more than the `RUNS=5` a single sitting would have bought, because it
re-rolls the network and the upstream as well as the sampling.

**Three of the ten clips were scored without the vocabulary they exist to test**, which turns out to
be the most important sentence in this document. `constitution-mixed` and `short` because their
article is not in this box's Postgres store; `purpose-box` because its terms come only from the
"why you're reading this one" box and no article here has one. `vocabularyFor` returns a short list
rather than an error when a source has nothing to say — that is what makes a recipe a list of names
instead of a pile of conditionals — so the run completes and scores them anyway.

I first wrote that this "does not bias the comparison", on the reasoning that every arm saw the
identical input. **That was wrong**, and GPT Sol's review is why this paragraph now says the
opposite: identical input, different sensitivity. The bare-versus-told arms in this very table are
the proof that models respond differently to a vocabulary — so a clip nobody had the words for is
still a clip the models will disagree about, and on this run *every* apparent difference between
them lived in exactly those clips. The table below therefore comes in two halves, and the second
is the one that decides anything.

**All ten clips**, three of which nobody had the words for — so a difference here may be about
guessing rather than about hearing:

| arm | corpus WER | mean WER | hard-term recall | invented | control WER |
|---|---|---|---|---|---|
| `gemini-3.1-flash-lite` +vocab | 1.8% | 2.1% | 105/114 92.1% | 0 | 0.0% |
| `gemini-3.5-flash-lite` +vocab | 3.6% | 3.6% | 103/114 90.4% | 0 | **2.2%** |
| `gemini-3.8-flash` +vocab | 1.4% | 1.9% | 106/114 93.0% | 0 | 0.0% |
| `gemini-3.1-flash-lite` bare | 4.5% | 4.9% | 95/114 83.3% | 0 | 0.0% |
| `gemini-3.5-flash-lite` bare | 7.0% | 6.9% | 88/114 77.2% | 0 | **2.2%** |
| `gemini-3.8-flash` bare | 2.7% | 2.9% | 100/114 87.7% | 0 | 0.0% |
| `gemini-3.1-flash-lite` +vocab *(again)* | 2.3% | 4.2% | 102/114 89.5% | 0 | 0.0% |

**The seven clips that had their vocabulary.** This is the table that decides anything — a model can
only be blamed for a term it was told and still got wrong:

| arm | corpus WER | edits | hard-term recall |
|---|---|---|---|
| **`gemini-3.1-flash-lite` +vocab** | **0.0%** | **0** | **78/78 100%** |
| `gemini-3.1-flash-lite` +vocab *(again)* | **0.0%** | **0** | **78/78 100%** |
| `gemini-3.8-flash` +vocab | **0.0%** | **0** | **78/78 100%** |
| `gemini-3.5-flash-lite` +vocab | 0.5% | 3 | 78/78 100% |
| `gemini-3.1-flash-lite` bare | 3.4% | 19 | 68/78 87.2% |
| `gemini-3.5-flash-lite` bare | 4.3% | 24 | 65/78 83.3% |
| `gemini-3.8-flash` bare | 2.2% | 12 | 72/78 92.3% |

| arm | p50 | p90 | max | $/call |
|---|---|---|---|---|
| `gemini-3.1-flash-lite` +vocab | 1299ms | **1798ms** | 2047ms | $0.00026 |
| `gemini-3.5-flash-lite` +vocab | 1340ms | 1473ms | 1730ms | $0.00028 |
| `gemini-3.8-flash` +vocab | 4875ms | **8074ms** | 18079ms | $0.00135 |
| `gemini-3.1-flash-lite` +vocab *(again)* | 1171ms | 2062ms | 2196ms | $0.00026 |

### Where those errors actually are, which is the whole finding

The first draft of this section read the ten-clip table straight and concluded that `3.8-flash` is
"a better ear". GPT Sol's review asked where the errors were, and they are almost all in one clip.

**Given the words, every model gets every hard term: 78 out of 78, on all three** — and two of the
three, plus the incumbent's replicate, make no word errors of any kind. In the first run of the day,
all fourteen of the incumbent's errors and nine of its twelve hard-term misses were `purpose-box`
alone, and five of `3.8-flash`'s six were the same clip.

`purpose-box` is **unanswerable by design, for every arm**. Its four terms — `Vervaeke`,
`relevance realisation`, `Anjali Chaudhuri`, `Friston` — live only in the "why you're reading this
one" box, and no article on this machine has one, so nothing in the vocabulary could have supplied
them. `constitution-mixed` and `short` are thin for the duller reason that their article is not in
this box's Postgres store. What those three clips measure is how a model guesses at proper nouns it
was never told, from a synthetic voice — and models guess differently, which is exactly why the
difference between the arms lived there.

So the honest reading of this bake-off is smaller and more useful than the one I first wrote:

- **It cannot separate these models on the job the feature actually does.** With an adequate
  vocabulary they are indistinguishable — three of the four told arms are perfect.
- **It reconfirms, hard, that the vocabulary is the whole feature.** On the same well-supplied
  clips, told against bare: 100% against 87.2% recall, 0 edits against 19. The best bare arm in the
  table is worse than the worst told one. Nothing here disturbs
  [260828l](260828l-dictation-vocabulary.md); it underwrites it.
- **`gemini-3.5-flash-lite` is still the weakest**, and it is the one difference that survives the
  filter: 3 edits where the other two have 0, plus 2.2% word errors on the control clip — the
  no-jargon utterance — where every other arm is at 0.0%. Small, but on the right side of the noise
  floor, since the incumbent's own replicate pair differs by 0 edits here. Both runs of the day
  agree on it (5 edits then 3, control 2.2% both times), and it is worth knowing because a version
  bump is the change nobody benchmarks. [260827x](260827x-dictation-two-pass.md) has that model at
  0.0–3.6% and reads as a near-tie; that was one clip, three runs, and a weaker request.
- **`3.8-flash` is not a better ear.** Its apparent edge was `purpose-box`. Outside the
  under-supplied clips it ties the incumbent at zero — and its bare arm being better (92.3% against
  87.2%) says it guesses better *without* help, which is not what this feature asks of it.

### The latency finding, which stands on its own

Worth keeping even though the accuracy case for `3.8-flash` evaporated, because it closes the
question rather than leaving it open:

```
3.8-flash, as production sends it   4402/5371/3974ms   reasoning tokens 122/113/142
3.8-flash, reasoning off            400  Reasoning is mandatory for this endpoint
                                         and cannot be disabled.
3.1-flash-lite, as production       1228/1210/1231ms   reasoning tokens 0/0/0
```

**The flash tier thinks for about 120 tokens before it transcribes, and that endpoint refuses to
stop.** There is no configuration that buys the flash tier at the lite tier's speed. Since it also
buys nothing measurable here, that is now an argument nobody has to have.

It is the only tier with a tail worth the name, too: `3.8-flash` p90 8.1s and a worst call of 18.1s
told, 16.5s and 29.0s bare, against a lite tier whose worst call all day was 2.3s.

### The decision

**`google/gemini-3.1-flash-lite` stays** — and the grounds are weaker than "it won", which is worth
saying plainly. Given its vocabulary it is perfect on every clip that had one, nothing reachable is
measurably better at that, and the tier that might be costs four times the wait structurally.

**What would change it** is evidence this benchmark cannot produce, and the shape of that evidence
is now clear: clips where a *told* model still gets a term wrong. There are none here. Real
recordings — a person, an accent, a room, a fan, a one-word dictation — are where those would come
from, and they are still not on this machine. Until then, "which model" is not the question that
limits this feature's quality; the vocabulary is, and that is
[260828l](260828l-dictation-vocabulary.md)'s subject.

### Open, and deliberately not taken today

**The dedicated-transcriber route, with each provider's own biasing parameter.** OpenRouter
documents Groq's `prompt` and Deepgram's `keyterm` (up to 100 terms for `nova-3`) under
`provider.options` — mechanisms the 2026-08-27 sweep never exercised, because it sent OpenAI's
generic `prompt` field to all nineteen models uniformly. So `deepgram/nova-3`'s 18.2% may be an
untried lever rather than a ceiling, and Deepgram is listed as a zero-retention provider, so the
route is not obviously blocked the way OpenAI's chat models are.

Not taken here because it is a different route with different failure modes rather than another row
in this table: no JSON schema, so the structural defence against a model answering the reader's
question instead of transcribing it would have to be rebuilt, and a 100-term cap against a
2,000-character multi-source vocabulary needs measuring rather than assuming. It is worth its own
gate and its own afternoon. **What must not survive until then is the claim it falsifies:** the
statement that a dedicated transcriber "cannot be told" its vocabulary was only ever tested against
the generic `prompt` field, and both `models.ts` and `transcribe.ts` now say exactly that instead.

## What changed in the code

- **`transcribeWith` takes an optional `model`.** It defaults to `DICTATION_MODEL` and nothing in
  `src/` sets it. It is there because the alternative silently lies: `bench-vocabulary-sources.ts`
  had a `MODEL` constant at the top which was a *label* — the call went through `transcribeWith` to
  `DICTATION_MODEL` regardless, so its results file could name one model and have measured another.
  Same class as an eval that reimplements the request it measures
  ([silent-success.md](../reusable/silent-success.md)), and the same fix.
- **`Transcription` carries `answeredBy`.** `zdr` routing means OpenRouter picks an upstream under a
  constraint, so a bake-off that reports the slug it *sent* can score a fallback and call it a
  candidate. The benchmark counts mismatches and says so at the end.
- **Scoring moved to `evals/dictation/score.ts`**, shared by both benchmarks. Two files with two
  copies of a word error rate are two definitions, and the day they drift is the day a table
  compares a lenient WER against a strict one.

## The simpler option, and why not

**Change nothing and answer from the research.** The desk research alone would have said "keep the
incumbent, OpenAI has a format risk" — which is the same conclusion, reached without knowing that
the actual blocker is a privacy promise rather than a container, and without a re-runnable gate for
the day OpenRouter's catalogue changes. Roughly an hour and $0.20 bought the difference between a
guess that happens to be right and a measurement, on a question Greg will ask again.

**Nothing here is real speech, and that is still the standing gap.** Ten `say` clips, three
synthetic voices, no accent, no room, no real microphone. What this measures well is whether a model
takes a term list and spells this app's own words. Recordings of a person — an iPad, a fan, a
one-word dictation — remain the thing that would settle the rest, and they are still not here.
[260827x](260827x-dictation-two-pass.md) said that a week ago and it is no less true.
