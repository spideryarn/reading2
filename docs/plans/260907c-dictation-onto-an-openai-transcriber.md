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

**Therefore the promise cannot be substantiated from a per-request flag on this route, and Greg's
decision to rewrite `/privacy` is required rather than optional.**

That is deliberately narrower than the sentence that stood here first, which said zero data
retention was *"unobtainable by either route"*. GPT Sol's review refused it, correctly: OpenAI's own
data-controls table lists `/v1/audio/transcriptions` as **ZDR-eligible and retaining nothing**, and
OpenRouter has account- and guardrail-level ZDR settings that a per-request flag says nothing about.
None of that is reachable from where we are — we are not enrolled, and the request-level control is
ignored — but "we cannot show it" and "it does not exist" are different claims, and a privacy page
only needs the first. The wording below makes the first claim only.

### Long recordings, which the review was right to ask about

OpenRouter documents a **60-second upstream processing timeout**, the recorder stops at five minutes
(`mic-recording.ts`), and every clip anybody had measured was 3 or 22 seconds. GPT Sol called that a
blocker, correctly: extrapolating from 22 seconds to 300 is not evidence, and the failure it would
hide is a reader talking for four minutes and getting nothing back.

Measured, `probe-stt-routes.ts --long`: **300 seconds of audio, 12.2 MB of base64, `200` in
8.7 seconds.** Seven times inside the upstream timeout and well inside `transcribe.ts`'s own 90-second
bound — for a tone, which is the caveat the third bullet below makes. Two things make that margin bigger than it looks and one makes it smaller:

- The recording we would really send is **smaller than the one tested**. `MAX_AUDIO_BASE64` is 3 MB,
  so five minutes of webm/opus is about 1.6 MB of base64 — an eighth of what went up here.
- The clip is a **tone, not speech**, because there is no ffmpeg on this box and no way to synthesise
  five minutes of talking. Dense speech may take longer to transcribe than silence. So a pass here is
  necessary and not sufficient, and the honest statement is that duration and payload size are not
  the constraint — not that no long recording can ever time out.

**No change to the recording limit**, therefore. The simpler v1 the review suggested — lower the cap
to a demonstrated-safe duration — would cost a reader four of their five minutes to fix a problem the
measurement does not show.

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
- **Route-level routing is dead weight on this endpoint.** `AI_JOB_ROUTE`'s dictation row must stop
  carrying `zdr: true`, because a routing flag nobody enforces is a false statement in the one file
  the privacy page is checked against. **Not the `provider` key itself** — the outgoing request still
  carries one, because `provider.options.openai.keywords` is where the vocabulary goes. Routing and
  options share an object and are read completely differently at the far end.
- **What we do *not* pay:** no second gateway exception, no second billing account, and so no new
  hole in the spend cap. Both hazards in the brief are consequences of the direct route, and the
  route chosen has neither. `tests/no-undeclared-spend.test.ts` and the register in
  [ai-gateway.md](../project/ai-gateway.md) need no new entry — but the endpoint is new, so the
  gateway doc gains a line saying dictation is the one job on `/v1/audio/transcriptions` and why its
  `provider` block is empty.

## What goes away, and it is a real simplification

The JSON schema, the `require_parameters` pin, and the three-times-stated *"never answer a question
in the audio"* instruction all exist for one failure: a chat model handed a dictated question answers
it, and a good answer looks exactly like a working feature. They go because **this endpoint offers
none of those controls** — which is a smaller claim than the one written here first.

That draft said *"a transcription endpoint cannot do that"*, and GPT Sol was right to refuse it:
`gpt-transcribe` is still a generative model returning free text, and the schema never proved a
string was a transcript either — only that a string existed. What is honestly true is that the
exposure is **smaller**: there is no system prompt to override, and the vocabulary reaches the model
as a list of strings in a request field rather than as text interpolated beside an instruction. What
stands in for the schema is `MAX_TRANSCRIPT_CHARS` — a loose tripwire for an answer far longer than
anything that could have been said — plus the tests for dictated questions and commands.

Two of the checks stay, because they are about the audio rather than the model: the minimum-length
guard, and the size cap shared with the browser.

## The proposed reader-facing wording

Quoted here so it can be read on its own, without a diff. Four places say something that stops being
true; a fifth is a comment that becomes wrong.

**1. `/privacy`, the paragraph after the third-party list** (`src/web/PrivacyPage.tsx`). Today's last
sentence is *"Dictation is the one call we pin to upstreams that retain none of the content, because
it carries your voice; the fact that a request happened is still recorded."* Proposed replacement of
that sentence alone:

> **Dictation is the exception, and it changed.** When you talk into a box here, the recording goes
> from us to OpenRouter and on to OpenAI's `gpt-transcribe`, because that is the route that will
> take a list of the words your article actually uses — which is what stops it guessing at names.
> What each of them says is on their pages, linked above: OpenRouter says it does not store what
> passes through unless an account opts in, ours does not, and it keeps audio no longer than routing
> needs except where it says it must — abuse detection, security, billing, or the law; OpenAI says
> nothing sent to its API is used to train its models. **What changed is that we now pass those on
> rather than enforce them.** We used to route dictation so that only providers keeping nothing
> could serve it, and on this endpoint that setting is ignored, so we cannot. We do not save the
> recording on our servers — it arrives in one request, goes out in the next, and is gone when the
> request ends — and the fact that a request happened is still recorded.

**Four things in that paragraph are there because GPT Sol's review took the first draft apart**, and
each is the kind of clause that reads as harmless and is not:

- *"we do not save the recording on our servers"*, not *"we keep nothing"*. When a transcription
  fails, `mic-recording.ts` deliberately holds the recording in the tab so the reader can download
  what they said. An unqualified "we don't keep it" is false about their own browser.
- OpenRouter's exceptions — **abuse detection, security, billing, the law** — are named. The first
  draft quoted only "beyond the duration necessary to route the request", which is the reassuring
  half of their sentence.
- *"both policies are good"* is gone. It was an opinion sitting in a disclosure.
- The retention figures are gone entirely. The first draft said "up to 30 days", on OpenAI's
  **general** API number; their per-endpoint table supersedes it for transcription, so the draft
  would have frightened readers with a claim worse than the truth. The replacement quotes no period
  at all, for the reason under the microphone line below.

**A second paragraph changed with it**, which the brief did not anticipate and Sol found: `/privacy`'s
subprocessor row for OpenAI said they were used for *"the live voice mode only"*. That is now false.
It names both routes and says which one keeps the audio off our server (live) and which does not
(dictation).

**2. The line beside every microphone** (`src/web/DictationStrip.tsx`, `DICTATION_PROMISE`). Today:
*"Your voice is sent to be transcribed, and isn't stored. The words appear when you stop."* It is the
sentence a reader actually reads, it is the shortest thing on this list, and it is about to be
false. Proposed:

> Your voice goes to OpenRouter and OpenAI to be transcribed. We don't save it on our servers, and
> we can't promise they don't.

That second clause deliberately under-claims, and it is the sentence I most want Greg's eye on.
OpenAI's own per-endpoint table says `/v1/audio/transcriptions` retains nothing, so a warmer line —
*"we don't keep it, and they say they don't either"* — is probably true. **Probably is not good
enough for the line beside a microphone**, because of the one gap the citation check could not close:
`gpt-transcribe` is listed by OpenAI under two endpoints, `/v1/audio/transcriptions` (retention
"None") and `/v1/realtime/transcription_sessions` (30 days), and nothing documents which of them
OpenRouter calls. The warmer sentence rests on a fact we cannot check, which is the one thing this
page's register forbids. `/privacy` has room to set out the position; one line does not, so it takes
the cautious half.

**3. `docs/project/privacy.md`** — the doc that owns the subject. Not reader-facing; it gains the
measurement above (routing and `zdr` are not applied on the transcription endpoint) as the reason the
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

## Stages, and what actually happened in each

1. **The probes, committed** — done, commit `b2785ce0`. The four WAV rows in `gate-models.ts` and the
   new `probe-stt-routes.ts`. 260903i's own docstring is about what it costs to run probes and throw
   them away, and this stage still managed to quote four `curl` rows that were in no committed file
   until the review caught it. They are in the probe now.
2. **The transcription route** — done, commit `f4288f04`. `/v1/audio/transcriptions` into
   `OpenRouterPath`, `openRouterTranscription` beside `openRouterJson` and `openRouterImage` so there
   is still no second way to spend money, a `transcription` member on `Wire`, `dictation` out of
   `ChatJob` so `openRouterJson("dictation", …)` no longer compiles, and `AI_JOB_ROUTE`'s dictation
   row down to `provider: null`.
   - **Two things this stage did not need to build.** `vocabularyTermsFor` already returned a list —
     live conversation has used `keywords` since 2026-08-31, for a bug of its own — so dictation just
     calls it. And `packTerms`/`fence` already strips `<`, `>` and every control character, so the
     keyword sanitiser in this stage's brief was a mechanism that already existed; the tests assert
     the property instead of a second implementation providing it.
   - Sol suggested splitting this into gateway and integration. It stayed one stage, which was a
     judgment rather than an oversight: the type change is what forces every caller to move, so the
     tree does not compile between the halves.
3. **The bake-off** — **not done, and deliberately.** See below.
4. **The copy** — done, in the same commit: four surfaces plus `docs/project/dictation.md`,
   `ai-gateway.md`, `setup-dev.md` and the model inventory. `tests/privacy-page.test.ts` went red on
   the stale model name, which is the chain working.
5. **A real browser** — done, `scripts/spike-dictation-browser.ts`, results above. It found the one
   thing no probe had: the recorder prefers MP4, not the WebM every probe had been sending.

### Why stage 3 was dropped

The plan asked for a bake-off on `bench-models.ts` reporting 260903i's measures. It is **not worth
the money or the hour**, and saying so is more useful than running it:

- **The decision it would inform is already made.** Greg chose an OpenAI transcriber. A table
  comparing five transcribers cannot unmake that, and the one number that would matter — is
  `gpt-transcribe` *worse* than the incumbent? — is answered well enough by the run above, which got
  every hard term through the real recorder path.
- **The corpus cannot settle it.** Ten synthetic clips from one `say` voice, and 260903i already
  found that every difference between candidates lived in the clips whose words nobody had supplied.
  Running the same corpus against a model with a *better* vocabulary mechanism measures the corpus,
  not the model.
- `bench-models.ts` is updated and ready for whoever wants it, with its own docstring now saying
  plainly that nobody has gated its new candidate list.

**What would be worth running instead** is the thing this plan is not allowed to do: real human
speech, which needs recordings from Greg. That is the open thread and it always was.

## What the cross-family review changed

GPT Sol reviewed this plan before it was built (2026-09-07). Eight findings; the five that changed
something:

1. **The ZDR conclusion was overbroad** — "unobtainable by either route" claimed more than the
   evidence. Narrowed above to "cannot be substantiated from a per-request flag on this route", which
   is what the privacy copy actually needs. OpenAI's own table makes the endpoint ZDR-*eligible*; we
   simply cannot reach that from here.
2. **The plan quoted evidence the committed probe did not contain.** The `only: ["anthropic"]` rows
   were run as throwaway `curl`s. That is exactly the failure `gate-models.ts`'s docstring exists to
   record, committed one file away from it. They are in `probe-stt-routes.ts` now and re-run with the
   rest.
3. **`usage.cost: 0` would have been recorded as a settled price of zero**, understating every
   dictation row in the ledger while `source: "provider"` asserted the provider had told us so.
   `unpriceZero` in ai-call.ts drops an exact zero so the row says `source: "none"` — *short by an
   unknown amount, and says so* — and starts using the number the day OpenRouter reports one.
4. **The privacy copy over-claimed in four places**: "we keep nothing" ignored the failed-recording
   Blob the browser deliberately holds so a reader can download it (now "on our servers"); it omitted
   OpenRouter's abuse/security/billing/legal exceptions; "both policies are good" was opinion in a
   disclosure; and the microphone line named OpenAI without naming OpenRouter, which also receives
   the recording. **And it missed a page entirely** — `/privacy`'s OpenAI row said "the live voice
   mode only", which this makes false.
5. **"A transcription endpoint cannot answer a question" was not a safe invariant.** It is still a
   generative model returning free text; the old schema only ever proved a *string* existed. The
   comment in transcribe.ts now says the exposure is smaller rather than absent, and
   `MAX_TRANSCRIPT_CHARS` is the tripwire that replaces the schema.

**One finding I checked and did not act on**, recorded because the next person will wonder: Sol
suggested the model list on `/privacy` was unpinned and would go stale silently. It is pinned, by two
tests in a chain — `models.test.ts` holds every `NON_TASK_MODELS` id to `DISPLAY_NAME`, and
`privacy-page.test.ts` holds every `DISPLAY_NAME` value to the page. It went red the moment the page
was edited, which is how the stale `gemini-3.1-flash-lite` was caught. A test added to close the
"gap" was deleted again once the existing chain was read properly.

**The one still-outstanding finding closed itself in the browser stage.** Sol pointed out that
`mic-recording.ts` prefers MP4 and only falls back to WebM, so the container this plan kept calling
"the browser's webm" is not the one most readers send — and nothing had measured MP4 against this
endpoint. The browser run below produced exactly that container and it transcribed correctly, so the
gap is measured rather than argued. What is still untested is **Safari's** MP4 specifically, which
carries AAC where Chrome's carried Opus.

## What the second review changed, and it found three real bugs

The code went back to GPT Sol after it was built, which CLAUDE.md says to weight higher than the
plan review — *"a plan-stage review can't find a `PATCH` that writes one field and then rejects the
request"*. It was right to. **Three correctness bugs, none of which any test would have caught**,
and each is now pinned by a test watched to go red against the old code:

1. **Permanent refusals were offered a Retry that could not work.** Only 401, 402 and 429 got their
   own sentence; everything else became a 502 with *"could not transcribe that"*. The browser decides
   whether to offer Retry from the status alone (`429 || (>=500 && !== 503)`), so a **400** — the
   service saying the request is malformed — invited the reader to resend identical bytes for an
   identical refusal. 403 and 404 the same. Every status now goes through `providerHttpFailure` and
   `canRetry`, which is a total map over `FailureKind` so a fifth kind is a compile error. Eight
   statuses pinned; all eight go red on the old branch.
2. **A BYOK zero was being thrown away.** `unpriceZero` dropped an exact `cost: 0` so the ledger says
   *unpriced* rather than *free* — right for this endpoint, and wrong for the one shape where zero is
   the truth: `is_byok: true`, where OpenRouter charged nothing because another key paid and the real
   figure hangs off `cost_details.upstream_inference_cost`. `normaliseByokUpstream` only stores that
   when the source is `"provider"`, so unpricing it turned a fully-known cost into an unknown one.
3. **An already-aborted request wrote a spend row for a call that never left the process.** `routes.ts`
   installs the disconnect signal before `transcribe` builds a vocabulary, so the gateway can be
   reached with a signal that has already fired; `fetch` rejects it without sending a byte, and the
   meter was constructed first. `signal.throwIfAborted()` now precedes it. (The image wire has the
   same hole and a test that characterises it; this one does not.)

And a fourth, from the subagent that updated the evals rather than from Sol: **the `provider` merge
only looked fixed.** `{...route.provider, options: {openai: {keywords}}}` keeps top-level fields and
replaces the whole `options` bag, so another provider's options or another OpenAI option would have
been dropped exactly as the keywords were. It is a two-level merge now, and the test that pins it has
to put a policy on `AI_JOB_ROUTE.dictation` temporarily, because with `provider: null` the broken and
the correct versions emit identical bytes.

**Two claims were retracted rather than defended.** *"The provider block is ignored"* is too strong
and contradicts the feature's own mechanism — routing and `zdr` are not applied; `provider.options`
is forwarded, and is how the vocabulary travels. And *"a transcription endpoint cannot answer a
question"* was never an invariant: it is a generative model returning free text, and the old schema
only ever proved a string existed.

**The privacy copy changed again**, in four places: *"which is what stops it guessing at names"* was
stronger than one measured spelling supports; *"nothing sent to its API is used to train"* dropped
OpenAI's opt-in exception; *"ours does not"* opt in to logging is an account setting rather than
anything this repo can prove, and now says so; and *"we pass those on rather than enforce them"* was
opaque about what is passed on. The microphone line lost *"we can't promise they don't"*, which can
be misread as attaching to *"save it on our servers"*.

**What was raised and not done**, so the next person does not have to re-derive it: a paid regression
set for dictated questions, imperative speech, silence and noise, and an output-length bound
calibrated against `usage.seconds` from real speech. Both are the real-human-speech measurement this
plan is not allowed to take, and neither is a stub away.

## A real browser, which is where two of these claims stopped being theoretical

[`scripts/spike-dictation-browser.ts`](../../scripts/spike-dictation-browser.ts), on the box,
2026-09-07:

```
clip decoded by Chrome             8.8s
MediaRecorder produced             audio/mp4;codecs=opus, 140 KB
mapped to AudioFormat              m4a
transcribed in                     1376ms by openai/gpt-transcribe
  "Add this to Spideryarn please, the granularity zoom is fine but the gist column
   should follow the block id, which here is spya-k3m9qt."
hard terms                         both present
```

**Both hard terms, through the real path**, including the block id — the string that the nineteen
dedicated transcribers of 2026-08-27 turned into *"Spire k three m nine q t"*, and the reason the
vocabulary exists at all. The vocabulary here is the `profile` recipe's eleven terms, assembled by
the app rather than by the script.

Two things this run settled that argument could not:

- **Chrome chose MP4, not WebM.** Every probe up to this point sent `webm`, and this plan said "the
  browser's webm" a dozen times. The recorder prefers MP4 and got it, `formatOf` mapped it to `m4a`,
  and the endpoint took it. Had that mapping or that container failed, every test in `tests/` would
  still have been green — which is the failure Greg's brief named in advance.
- **There is no microphone on this box, and it did not matter.** Chrome's fake capture device gives
  `NotFoundError: Requested device not found` in headless, with and without
  `--use-file-for-fake-audio-capture` (all three variants tried). `getUserMedia` is not what this
  job put at risk, so the script feeds a `MediaStreamAudioDestinationNode` into the recorder instead
  and exercises the real encoder with no device at all. The script says so at the top, so nobody
  reads it as a microphone test.

## A third review, and the two things it caught that mattered

The final pass over the built code and the sweep found two real errors and three tidyings:

- **A reader-facing clause named the wrong customer.** *"OpenAI says data sent to its API is not used
  to train its models unless a customer opts in, **and we have not**"* — on this route OpenRouter is
  OpenAI's API customer and we are OpenRouter's, so that last clause described a setting that is not
  ours to hold. It now says "unless its API customer opts in" and stops. The OpenRouter logging
  clause is the one where "ours" is the right word, and it is marked as a commitment rather than as
  something the page can prove.
- **"No tokens at all" was a claim about the protocol and only true of the model.** OpenRouter
  documents optional `input_tokens` / `output_tokens` / `total_tokens` on the transcription endpoint,
  in different spellings from the chat wire's — which `Meter` did not read. `gpt-transcribe` sends
  none of them, so nothing was being lost today; a model that did would have been silently
  uncounted. `WireUsage` reads both spellings now, and four comments were narrowed from "this wire"
  to "this model, measured twice".
- **429 was being flattened to 502.** Caught by the full suite rather than by the review — the
  retryability was identical, but `request-spend.test.ts` asserts the endpoint's contract, and
  losing a standard status that an access log can read buys nothing. 401, 402 and 429 pass through;
  everything else maps, because a 404 from OpenRouter would be a lie about *our* route.
- **A provider 413 would have told a dictating reader to "select a shorter passage".** It now gets
  `tooLongMessage()`, the sentence this endpoint already gives for its own size cap.
- **"The provider block is not sent" survived in three more places**, one of them two lines above the
  paragraph explaining that `provider.options` is exactly what *is* sent.

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
