# Dictation onto an OpenAI transcriber

> I think we need to switch to a different speech-to-text model, probably from OpenAI. […] Optimise
> for accepts-vocabulary, then correctness, then latency, then cost. I think there was some issue
> with file formats previously, so that might require some Sonnet web research for best practices
> etc. Ideally this would be a model available through OpenRouter, but failing that you can use the
> OPENAI_API_KEY that we already have setup for the realtime conversations.
>
> — Greg, 2026-09-06

**⚠ The reader-facing privacy wording in this plan needs Greg's sign-off before the next deploy: it
removes a published zero-data-retention promise about a reader's voice, and until it is approved
`dev` carries a `/privacy` page whose dictation paragraph is false.**

Dictation moves from `google/gemini-3.1-flash-lite` on the chat endpoint to **`openai/gpt-transcribe`
on OpenRouter's transcription endpoint**. It stays on OpenRouter, it keeps sending the browser's webm
unchanged, and it loses zero-data-retention routing, which is the half of this that is copy rather
than code.

The two documents that set the table are [260903i](260903i-which-model-transcribes-dictation.md) (why
OpenAI was ruled out four days ago) and
[the reader's report](../user-feedback/260904_1259-something-better-than-whisper.md). This plan
overturns one specific finding in the first of them, and the rest of it stands.

## What the gate returned, which is the first thing Greg asked

`npm run eval:dictation-gate`, 2026-09-07, 11:38 — the answer to "has OpenAI gained a ZDR endpoint on
OpenRouter since 2026-09-03?" is **no, and not nearly**:

```
openai/gpt-audio — one constraint at a time:
  no provider block, schema, webm            400  Provider returned error
  zdr only, schema, webm                     404  No endpoints found matching your data policy
  no provider block, no schema, webm         400  Provider returned error
  no provider block, no schema, WAV          200  ok
```

The last two rows are the only pair that differ in one thing, and they say the blocker is the
container. So I added four WAV rows to `diagnose` in
[`gate-models.ts`](../../evals/dictation/gate-models.ts), because the existing five could not
separate "will not take webm" from "will not take a schema", and because a `zdr` row over a container
known to work is worth a penny:

```
  no provider block, schema, WAV             400  Provider returned error
  require_parameters only, schema, WAV       400  Provider returned error
  zdr only, schema, WAV                      404  No endpoints found matching your data policy
  zdr only, no schema, WAV                   404  No endpoints found matching your data policy
```

So for `openai/gpt-audio` on the **chat** endpoint there are two independent refusals, not one:
`zdr` is a 404 whatever the container, and a strict `json_schema` is a 400 whatever the container.
Only *no schema, WAV* answers. Everything 260903i says about the chat endpoint is confirmed and
sharpened.

## The finding that changes the answer

260903i ruled the dedicated transcribers out on one sentence, and it is the sentence that is no
longer true:

> The nineteen dedicated transcribers have nowhere to put a term list — that is the finding that
> chose the route.

**`gpt-transcribe` has a `keywords` array.** From OpenAI's own API reference: *"Words or phrases to
guide transcription of the input audio. Supported by `gpt-transcribe`."* The guide adds *"Use
`keywords` for literal terms you expect to hear"* and *"Keywords are hints, not required output"*,
with a documented example of product names and IDs — which is exactly "Spideryarn and a block id".
That is a first-class biasing parameter, not the `prompt` field that 260903i measured answering
*"200 and changing nothing"*.

And the transcription endpoint **takes webm**. OpenAI's chat `input_audio.format` is a closed enum of
`wav` and `mp3` in their published OpenAPI schema, which is why no amount of routing gets a browser's
recording through it; `POST /v1/audio/transcriptions` lists `webm` explicitly, 25 MB cap. OpenRouter
carries the same endpoint and its own STT guide names webm as *"common in browser recordings"*.

**So the file-format problem Greg remembered is real, and the fix is not to convert the file — it is
to stop using the door that refuses it.** No transcode, no client-side recorder change, nothing about
MediaRecorder changes at all.

## What was measured, 2026-09-07

[`evals/dictation/probe-stt-routes.ts`](../../evals/dictation/probe-stt-routes.ts), the `site-terms`
clip, which says *Spideryarn* and the block id `spya-k3m9qt`:

| route | status | ms | Spideryarn | block id | transcript |
|---|---|---|---|---|---|
| OpenAI direct, no keywords | 200 | 1945 | **no** | no | "Add this to **Spiderrion**, please…" |
| OpenAI direct, keywords | 200 | 867 | yes | yes | "Add this to Spideryarn please…" |
| OpenRouter, no keywords | 200 | 1034 | **no** | no | "Add this to **Spiderrion**, please…" |
| OpenRouter, keywords via `provider.options.openai` | 200 | 779 | yes | yes | "Add this to Spideryarn please…" |

The point of the run is the `Spiderrion` column, not the statuses. OpenRouter documents that
*"unrecognized keys are silently dropped"*, so a 200 on a request carrying `keywords` is not evidence
that `keywords` arrived — the evidence is that the spelling changes when they are sent and reverts
when they are not, identically through both providers.

`gpt-4o-transcribe` returns 400 to `keywords`; it is `gpt-transcribe`'s parameter alone.

### The `zdr` row is a trap, and it cost the privacy promise

`provider: {zdr: true}` returns **200** on the transcription endpoint. That looks like the good news
Greg's brief hoped for, and it is not news at all:

```
provider: {"only":["anthropic"]}                  200  {"text":"Ask about the principal hierarchy."…}
provider: {"zdr":true,"only":["anthropic"]}       200  {"text":"Ask about the principal hierarchy."…}
provider: {"order":["anthropic"],"allow_fallbacks":false}  200  …
```

Anthropic serves no transcription model, so `only: ["anthropic"]` is a request that cannot be
satisfied. It answers 200 with a transcript. OpenRouter documents this in the STT guide's parameter
table, in a sentence that names three of the keys and not the fourth:

> Provider-specific options under `provider.options`. **Routing preferences (`order`, `only`,
> `ignore`) are not applied to transcription requests.**

`zdr` is not in that list, so the doc does not settle it. **This pair does:**

- `openai/gpt-transcribe` is **absent from OpenRouter's own ZDR endpoint list**
  (`GET /api/v1/endpoints/zdr`, checked 2026-09-07 — 846 entries, and it is not one of them), while
  other transcribers are on it: `openai/whisper-large-v3` on Groq and DeepInfra,
  `mistralai/voxtral-mini-transcribe`, `microsoft/mai-transcribe-2`, `fish-audio/transcribe-1`.
- `provider: {zdr: true}` on `openai/gpt-transcribe` returns **200**.

Both cannot be true of an enforced flag. A model with no ZDR endpoint asked for ZDR must 404 — which
is exactly what `openai/gpt-audio` does on the chat endpoint, four times over, in the gate output
above. So the 200 is not a route that satisfied the constraint; it is a constraint nobody read.
`GET /models/openai/gpt-transcribe/endpoints` returns an empty `data_policy`, so the metadata cannot
settle it either. This is [silent-success](../reusable/silent-success.md) exactly: the reassuring
answer and the meaningless one are the same 200.

**There was a way to keep the promise, and it loses on Greg's first priority.** Those ZDR-listed
transcribers are real, and `openai/whisper-large-v3` on Groq is even an OpenAI model. But biasing on
the Whisper family is the `prompt` field, capped at 224 tokens, which OpenAI's own guide describes as
providing *"less control than the recommended transcription model"* — and
[260903i](260903i-which-model-transcribes-dictation.md) measured that field through this very
endpoint *"answering 200 and changing nothing"*. Keeping zero data retention therefore means giving
up the vocabulary, and the vocabulary is the top of Greg's list and the reason the feature exists.
That is the trade, and it is the shape of the decision he already took.

**Therefore zero-data-retention is unobtainable for dictation on any OpenAI transcriber, by either
route, and Greg's decision to rewrite `/privacy` is required rather than optional.**

## The route, and the simpler options passed over

**OpenRouter's transcription endpoint, `openai/gpt-transcribe`, keywords through
`provider.options.openai`.** It satisfies Greg's priority order in his order:

1. **Accepts a vocabulary** — the hard gate, and it passes it better than the incumbent does. A
   dedicated parameter beats a term list pasted into a prompt.
2. **Correctness** — to be measured in stage 3 against the incumbent on the same harness. The row
   above is one clip.
3. **Latency** — 779–817 ms against the incumbent's 1432–1543 ms in the same gate run. Roughly halved.
4. **Cost** — $0.0045/min, against $0.00025 for the incumbent on a ~6 s clip. Dearer per call; both
   are rounding errors at this readership, and cost is last on the list.

Three alternatives, each rejected for a reason rather than on taste:

- **Direct on `OPENAI_API_KEY`**, which is what Greg's brief expected to be necessary. Rejected
  because the OpenRouter route works and the direct one costs two things the brief itself names as
  hazards: a second exception to *every paid call goes through OpenRouter*
  ([ai-gateway.md](../project/ai-gateway.md)), and a per-reader paid endpoint on a billing account
  outside the only spend cap we have. Same model, same `keywords`, same webm, measured side by side
  above — the direct route buys nothing here.
- **`openai/gpt-audio` on the chat endpoint plus a transcode**, which is what the brief anticipated
  building. Rejected because it is the expensive way to reach a worse place: the research found no
  verified webm/opus→WAV recipe for Node without ffmpeg (`@ffmpeg/ffmpeg`'s core is ~65 MB and
  reportedly does not deploy on Vercel; `opus-decoder` is small but explicitly does not demux
  Matroska), and 16 kHz WAV base64 hits Vercel's 4.5 MB body cap at about 105 seconds, cutting the
  five-minute recording limit to under two.
- **Recording WAV in the browser instead.** Same 105-second ceiling, plus an AudioWorklet capture
  path on every browser we support including iPad. A client-side format change is not the cheaper
  option, and this is the trade Greg asked to have named.

## What it costs us, stated plainly

- **Zero-data-retention on a reader's voice, gone.** This is the whole of the privacy work below.
- **`keywords` is a passthrough, and passthroughs fail silently.** OpenRouter normalises a handful of
  transcription fields and drops the rest without comment; if they ever stop forwarding
  `provider.options.openai`, dictation gets quietly worse at the one thing it exists to do and
  nothing goes red. Guarded in stage 2 by a test that asserts the *transcript changes* — the
  `Spiderrion`/`Spideryarn` pair above — rather than that the request succeeded.
- **The `provider` block is dead weight on this endpoint.** `AI_JOB_ROUTE`'s dictation row must stop
  carrying `zdr: true`, because a routing flag nobody enforces is a false statement in the one file
  the privacy page is checked against.
- **What we do *not* pay:** no second gateway exception, no second billing account, and so no new
  hole in the spend cap. Both hazards in the brief are consequences of the direct route, and the
  route chosen has neither. `tests/no-undeclared-spend.test.ts` and the register in
  [ai-gateway.md](../project/ai-gateway.md) need no new entry — but the endpoint is new, so the
  gateway doc gains a line saying dictation is the one job on `/v1/audio/transcriptions` and why its
  `provider` block is empty.

## What goes away, and it is a real simplification

The JSON schema, the `require_parameters` pin, and the three-times-stated *"never answer a question
in the audio"* instruction all exist for one failure: a chat model handed a dictated question answers
it, and a good answer looks exactly like a working feature. **A transcription endpoint cannot do
that.** It returns `{text}`, it has no conversational capacity to hijack, and the vocabulary reaches
it as a list of strings rather than as text interpolated near an instruction. The prompt-injection
surface that `transcribe.ts` is careful about mostly closes.

Two of the checks stay, because they are about the audio rather than the model: the minimum-length
guard, and the size cap shared with the browser.

## The proposed reader-facing wording

Quoted here so it can be read on its own, without a diff. Four places say something that stops being
true; a fifth is a comment that becomes wrong.

**1. `/privacy`, the paragraph after the third-party list** (`src/web/PrivacyPage.tsx`). Today's last
sentence is *"Dictation is the one call we pin to upstreams that retain none of the content, because
it carries your voice; the fact that a request happened is still recorded."* Proposed replacement of
that sentence alone:

> Dictation used to be the one call we pinned to upstreams that keep nothing, and it no longer is.
> Your recording goes to OpenAI's transcriber by way of OpenRouter, because that is the route that
> will take a list of the words your article actually uses. Both of them publish a policy, and both
> policies are good: OpenRouter says it does not store prompts or responses unless an account opts
> in, which ours does not, and that it does not keep audio "beyond the duration necessary to route
> the request"; OpenAI says nothing sent to its API trains its models, and its published
> per-endpoint table gives transcription no retention at all. **What changed is that we are now
> passing those on rather than enforcing them.** We are not enrolled in OpenAI's zero-data-retention
> programme, OpenRouter does not list this endpoint as zero-retention, and on this one endpoint it
> ignores the setting that used to let us insist. We still store nothing ourselves — the audio
> arrives in one request, goes out in the next, and is gone when the request ends — and the fact
> that a request happened is still recorded.

**2. The line beside every microphone** (`src/web/DictationStrip.tsx`, `DICTATION_PROMISE`). Today:
*"Your voice is sent to be transcribed, and isn't stored. The words appear when you stop."* It is the
sentence a reader actually reads, it is fourteen words, and it is about to be false. Proposed:

> Your voice is sent to OpenAI to be transcribed. We don't keep a copy; we no longer promise they
> don't.

That second clause deliberately under-claims, and it is the sentence I most want Greg's eye on.
OpenAI's own per-endpoint table says `/v1/audio/transcriptions` retains nothing, so a warmer line —
*"we don't keep it, and they say they don't either"* — is probably true. **Probably is not good
enough for the line beside a microphone**, because of the one gap the citation check could not close:
`gpt-transcribe` is listed by OpenAI under two endpoints, `/v1/audio/transcriptions` (retention
"None") and `/v1/realtime/transcription_sessions` (30 days), and nothing documents which of them
OpenRouter calls. The warmer sentence rests on a fact we cannot check, which is the one thing this
page's register forbids. `/privacy` has room to set out the position; fourteen words do not, so they
take the cautious half.

**3. `docs/project/privacy.md`** — the doc that owns the subject. Not reader-facing; it gains the
measurement above (the `provider` block is ignored on the transcription endpoint) as the reason the
claim went, so the next person to wonder whether we can put it back finds the probe rather than the
conclusion.

**4. `src/web/PublicReadableSharingPage.tsx`** — the brief expected a repeated claim here and there
isn't one. Line 38 is a comment recording that "zero-data-retention models" was *rejected* as a claim
for that page, and `tests/public-readable-sharing-page.test.tsx:92` asserts the page never says it.
Nothing reader-facing changes. The comment's supporting clause — *"`zdr: true` is set on dictation
and on nothing else"* — becomes false and gets corrected to say `zdr` is now set on nothing.

**Where an earlier draft of this plan was wrong**, kept because it is the mistake the next person
will make too: it proposed *"they may keep it for up to 30 days"* in both places, on OpenAI's
**general** API retention figure. The per-endpoint table supersedes that for transcription, so the
number would have frightened readers with a claim worse than the truth. Neither sentence quotes a
retention period now.

**Every factual clause above traces to a quotation**, collected in the citation pass and recorded in
[privacy.md](../project/privacy.md) with its URL, so the next person to edit these sentences can
check them without re-doing the research. The two that carry the most weight: OpenAI's *"data sent to
the OpenAI API is not used to train or improve OpenAI models"*, and OpenRouter's *"We do not persist
image, audio or video files beyond the duration necessary to route the request, except as required
for abuse detection, security, billing, or legal compliance."*

## Stages

1. **The probes, committed.** The four WAV rows in `gate-models.ts` and the new
   `probe-stt-routes.ts`. This is the evidence every claim above rests on, and 260903i's own
   docstring is about what it costs to run probes and throw them away. → GPT Sol.
2. **The transcription route.** `/v1/audio/transcriptions` into `OpenRouterPath`, a
   `openRouterTranscription` beside `openRouterJson` so spend recording and refusal handling stay one
   implementation, `vocabularyFor` gaining a list form, keyword sanitising for `<`, `>`, CR and LF
   (documented to reject the whole request), `AI_JOB_ROUTE`'s dictation row losing `zdr`, and the
   keywords-really-arrived test. `DICTATION_MODEL` becomes `openai/gpt-transcribe`. → GPT Sol.
3. **The bake-off**, on `bench-models.ts` rather than a second harness, reporting 260903i's measures
   so the numbers sit beside its numbers: corpus WER and hard-term recall over the ten clips, three
   runs. Incumbent against `gpt-transcribe` with and without keywords. → GPT Sol.
4. **The copy**, all four places plus `tests/privacy-page.test.ts` and
   `tests/profile-mic-button.test.tsx`, which pin the sentences. → GPT Sol.
5. **A real browser**, Playwright against system Chrome on the box: record actual audio through
   `MediaRecorder` and watch words come back. A transcription path that passes tests and fails on a
   real recorder blob is the failure this whole job is about.

## Open questions for Greg

- **The sign-off above.** Nothing deploys until the wording is yours.
- **Going direct after all would buy a stronger sentence, and it is the one argument for it that the
  gateway rule does not answer.** Calling OpenAI ourselves, we would *know* the request lands on
  `/v1/audio/transcriptions`, whose published retention is "None" — so `/privacy` and the microphone
  could both say so plainly instead of hedging. Through OpenRouter we cannot know which upstream
  endpoint is called, and that gap is the only reason the wording above is cautious. It is still not
  worth a second billing account outside the spend cap and a second exception to the gateway rule,
  **for a hedge in a sentence** — so this plan stays on OpenRouter. But it is Greg's page and Greg's
  billing, and if he would rather have the plain sentence, the change is a day's work and the plan
  says so here rather than deciding it quietly.
- **Or ask OpenAI for zero data retention.** They grant it on application to eligible API customers,
  and it would restore the old promise exactly. A conversation with them rather than a code change,
  and it would only help on the direct route — OpenRouter's list, not OpenAI's grant, is what decides
  the routed one. Not pursued here.
- **Real human speech is still unmeasured**, and it is still the honest residual from
  [-11](../user-feedback/260904_1241-dictation-misspells-spideryarn.md). The corpus is synthetic; a
  person on an iPad in a room is not. Out of scope by instruction, and this switch does not close it
  — it only makes the vocabulary a parameter instead of a suggestion.
- **A Sonnet subagent was not used** for the research, against the brief's instruction: Sonnet
  subagents on this account are inside a weekly rate limit until 2026-09-12 and die mid-task. The
  research and the browser pass ran on Opus subagents instead.
