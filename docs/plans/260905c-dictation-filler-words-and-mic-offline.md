# Dictation: the ums, and the `[mic-offline]` that was two errors

Two feedback reports, both from Greg, both about
[dictation](../project/dictation.md) — so one plan and one worktree, because
they land in the same six files and two agents would have fought over them.

- **SPIDERYARN-READING2-1J** (problem) — the filler words.
- **SPIDERYARN-READING2-1K** (suggestion) — `[mic-offline]`, a disabled button and a Retry.

Both are from an admin, so per
[feedback-reports.md § Who sent it](../project/feedback-reports.md#who-sent-it) the question is
not *whether* but *how much*. What is deferred is named in § What we are not doing.

## The two reports, verbatim

**1J:**

> The microphone input (eg for Feedback dialog box) sometimes includes superfluous ums and ahs. Can
> we tweak the prompt or otherwise to ignore/remove these? Use Sonnet to search the web for best
> practices.

**1K:**

> I tried using the microphone input in Feedback and got a [mic-offline] error. If it's offline
> before, we should disable the mic input button. If the error appears afterwards, we should add a
> Retry button. And/or any other improvements you can think of, including perhaps offering a
> fallback to on-device models if available (eg Apple Speech)

## What `[mic-offline]` actually is — and the thing nobody was looking for

Reproduced by reading rather than by clicking, because both paths are one grep. **There are two of
them, with two different sentences, sharing one code**:

| where | sentence | when |
|---|---|---|
| [`dictation-errors.ts`](../../src/web/dictation-errors.ts) `MESSAGES.network` | *"Speech recognition needs an internet connection, and the connection failed…"* | the browser's `SpeechRecognition` emits `error: "network"`, **while the reader is still talking** |
| [`dictation-upload.ts`](../../src/web/dictation-upload.ts) | *"We couldn't reach the server to transcribe that."* | `fetch("/api/transcribe")` threw, **after** the reader pressed stop |

[copy.md § A code names a branch, not a status](../project/copy.md#the-bracketed-code) says it
outright: *"What must never happen is two different sentences sharing a code"*. The test that
enforces that — [`tests/messages.test.ts`](../../tests/messages.test.ts) — only reads
`src/messages.ts`, and the whole `mic-` family lives outside it by design. So the one family
exempted from the file was also exempted from the check, and a collision sat there unseen.

**That is also why Greg could not tell us which one he hit**, and it is the reason his report has
two halves with an "if" in front of each. The code exists so somebody can quote four characters and
have those characters pick a branch. These four picked two.

### The recogniser's `network` error is not a failure of dictation

The bigger finding. [dictation.md](../project/dictation.md) is emphatic that **the live text is
decoration** — the words that get saved come from the tape, `POST /api/transcribe`, and a model
with this box's vocabulary. Safari and Firefox run the whole feature with no recogniser at all and
get a *better* transcript for it.

But [`useDictation.ts`](../../src/web/useDictation.ts) § `r.onerror` treats any non-`keepGoing`
verdict as the end of the session:

```ts
const verdict = verdictFor(e.error, s.stopRequested);
if (verdict.keepGoing) return;
setError(verdict.message);
finish(s);
```

`finish(s)` does still drain the tape and upload it, so the transcript is not lost. What *is* lost
is **everything the reader had not said yet**: a `network` blip on a decoration ends a recording
mid-sentence, and the reader is shown a message telling them to check their connection and press the
microphone again — about a path that, by then, has usually worked perfectly.

So the fix is not a better sentence. It is that **the decoration failing must degrade the
decoration**, which is exactly the state Safari has shipped in since day one. That is fewer moving
parts, not more: one code path where there were two.

## 1J: how to take the ums out without rewriting what was said

A Sonnet subagent searched the web (the report asked for it). The conclusion, with sources:

- The industry treats this as a **first-class ASR parameter**, not a prompt: Deepgram
  `filler_words` (defaults to stripping), AssemblyAI `disfluencies` (defaults to stripping),
  Speechmatics `remove_disfluencies` (defaults off), and Gemini's own transcription API has
  `transcription_config.mode: "smart" | "verbatim"`
  ([ai.google.dev/gemini-api/docs/transcribe](https://ai.google.dev/gemini-api/docs/transcribe)).
  It is a word-level classification inside the model, which is why it is dependable.
- Whisper's `prompt`/`initial_prompt` **is not** that lever — it biases decoding, misses
  occurrences, and can induce words that were not said
  ([openai/whisper#949](https://github.com/openai/whisper/discussions/949)). The community's own
  answer is a post-hoc script.
- Asking a chat model to *clean up* a transcript has two documented failure modes: hallucination
  (Koenecke et al., FAccT 2024 — ~1% of Whisper transcriptions hallucinated, ~40% of those harmful,
  [arXiv:2402.08021](https://arxiv.org/abs/2402.08021)) and **role confusion**, where the model
  answers the content instead of transcribing it.

**None of those levers is reachable from here.** This app talks to
`google/gemini-3.1-flash-lite` through OpenRouter's *chat* completions API
([ai-gateway.md](../project/ai-gateway.md)), because the dedicated transcription route ignores the
vocabulary and the vocabulary is the whole reason this feature works
([dictation.md](../project/dictation.md)). A chat completion has nowhere to put
`transcription_config`. So we have two levers: **the system prompt**, or **deterministic
post-processing**.

### We are taking the deterministic one, and leaving the prompt alone

The decision, and it goes against the report's own first suggestion, so here is the reasoning.

The `SYSTEM` prompt in [`src/transcribe.ts`](../../src/transcribe.ts) is not a neutral place to add
an instruction. Its entire design is *"you are a transcriber, do not be helpful"* — the word
**verbatim**, three separate sentences forbidding the model from answering the audio, a strict JSON
schema with `require_parameters: true`, and a comment saying the failure mode is that it *"returns a
perfectly good answer to a question nobody asked it"*. Adding *"remove the filler words"* to that is
adding an **editing** instruction to a prompt whose one job is to refuse to edit — which is the
precise direction of the role-confusion failure the research names, and which no test can detect,
because a fluent paraphrase looks exactly like a good transcript.

Deterministic stripping cannot do that, by construction:

- it only ever **deletes** tokens from a closed, hand-written list;
- it never adds, reorders, or rewords anything;
- and the invariant is **checkable**, so a test asserts it rather than a comment claiming it: the
  output's words are the input's words with filler occurrences removed, each survivor byte for byte
  bar one allowed initial capital. That is the "verify the output is a subsequence of the input"
  guard the research flagged as best practice, tightened after Sol pointed out that a subsequence
  check on its own permits deleting *any* word.

It is also free: no second model call, no extra latency on a request a person is sitting in front
of, and no re-measurement of model behaviour we have no filler-word audio to measure with.

**How this stays conservative**, in one place so a reviewer can check it:

1. Only a closed list — `um`, `uh`, `er`, `erm`, `ah` and their doubled-letter spellings. Not
   `like`, not `you know`, not `I mean`, not `so` — those are real words doing real work, and a
   reader who says them meant them. **Not `err` either**: it is a verb, and it was on the first
   draft's list.
1b. **Capitals are matched exactly, never case-insensitively.** A filler is written lower-case, or
   capitalised because it opened a sentence. `ER` is a hospital and `UM` is an initialism, and a
   case-insensitive match took both.
1c. **`ah` only counts mid-sentence.** *"Ah, now I see"* is a reaction and deleting it changes what
   the sentence does; *"it was, ah, difficult"* is hesitation. Position is the only signal available
   without asking a model what the reader meant.
2. `uh-huh` and `uh-uh` are yes and no. The pattern refuses to match a token joined by a hyphen or
   an apostrophe at either end, so those and `Ahmed`, `umbrella`, `her`, `were` are untouched.
3. **If stripping would empty the transcript, the original is returned.** Somebody whose whole
   dictation was "um" said "um", and an empty transcript means something else in this codebase (no
   speech — the box is left alone and the audio is offered back).
4. The words that survive are in the order they were said, unchanged. Asserted by test on every
   case in the table, not just claimed.

Punctuation left behind by a deletion is tidied — a doubled comma, a comma at the very start, a
double space, a space before a full stop — and the first letter is re-capitalised only if it was
capitalised before. Those are the only transformations, and each has a test.

## Three codes, not one

The scan written for stage 1 — [`tests/dictation-codes.test.ts`](../../tests/dictation-codes.test.ts)
— found **three** collisions, not the one this plan started from:

| code | the two sentences |
|---|---|
| `[mic-offline]` | the recogniser's connection, and the upload's |
| `[mic-upstream]` | *"could not transcribe that"* (a service that said no) and *"could not be reached"* (one that did not answer) |
| `[mic-too-long]` | the browser's sentence and the server's, for one branch |

All three are fixed. `[mic-too-long]` was the interesting one, because the right answer was not a
rename: the two ends were computing the same megabyte figure separately and wording it differently,
so `tooLongMessage()` in [`src/dictation-limits.ts`](../../src/dictation-limits.ts) now writes it
once for both — one fewer place for the number to go wrong, which is what that file already exists
for.

And two recogniser sentences had **no code at all** — `phrases-not-supported` and `bad-grammar`,
written as literals beside the one that did. The test that should have caught that was iterating a
hand-written list of error names which did not include them. It iterates `KNOWN_CODES` now.

## The stages

| | what lands | done looks like |
|---|---|---|
| **1** | The code collision. A test over every `[mic-…]` sentence in the tree, red first; then the recogniser's `network` code renamed. | `npm test` green, the new test provably red before the rename |
| **2** | 1J. `src/dictation-fillers.ts`, wired into `transcribeWith`. | The table of cases passes, and so does the subsequence invariant |
| **3** | 1K(a). The button is disabled when the browser says it is offline, and says why. | Disabled, with a `title`; re-enables on `online` |
| **4** | 1K(b). A recogniser error stops the decoration and not the recording. A failed transcription offers **Try again** on the audio it kept. | Red-first tests for both; the `armed` guard still respected |
| **5** | Docs, GPT Sol review of the code, commit, push, the two notes, Sentry. | |

## What we are not doing, and what it would cost

- **On-device speech (Apple Speech / the Web Speech API as a transcriber).** Deferred, and the
  report scoped it as *"and/or"*. It is a **second transcription path**, not a setting: its own
  permission (separate from `getUserMedia`, and on Safari a second one the reader must grant), its
  own failure modes, its own quality floor — and critically **it cannot be given this app's
  vocabulary**, which [dictation.md](../project/dictation.md) measured as the entire reason the
  current design beats nineteen dedicated transcribers. `Spideryarn` came back as *Spaderion*. So
  the fallback would be a path that fails at exactly the thing the feature is for, reached only when
  the good path is already broken, and needing its own eval to know whether it was worth having.
  Call it two days plus a permanent second code path. If it is wanted, the cheaper first step is to
  measure what Web Speech's own transcript is worth on this app's words — the harness is
  `evals/dictation/`.
- **Stutters and false starts** — *"I— I think that…"*, *"the, the thing"*. A deterministic pass
  cannot tell a stutter from an emphatic repetition, and the only tool that can is a model editing
  the reader's words. Not without asking.
- **`like`, `you know`, `I mean`, `sort of`.** Real words. Removing them is editing, not
  transcribing.
- **A second, delete-only LLM pass with a subsequence check.** The research's fallback for when no
  provider flag exists. It would catch the stutters — but it doubles the cost and the latency of a
  call a reader is waiting on, and stage 2 has to ship first so we find out how much is left over.
- **The prompt experiment, which is the named next step.** Add a filler rule to `SYSTEM` and measure
  it against the current prompt on a small corpus of real speech: hesitations in several positions,
  and controls for `err`, `ER`, `uh-huh`, a deliberate "Ah", a non-English passage, and a dictated
  question that neither prompt may answer. Score filler removal, surviving-word preservation, and
  paraphrase. `evals/dictation/` is the harness; what is missing is the audio.
- **A locale gate on the stripper.** German `er` and `um` and Portuguese `um` are ordinary words,
  and nothing here knows what language a transcript is in. Named as a known limit rather than
  guarded, because the only real guard is a language signal this app does not have.
- **Retry when the recogniser's rough words are already in the box.** The transcript would land
  *beside* them rather than replacing them, because `onEnd` has closed the span. Making it safe
  means keeping a first-class attempt — the span, a snapshot of the box to check it against, and the
  session's context — which is real machinery. The audio is kept in that case now, so nothing is
  lost; there is simply no button.
- **A `transcription_config`-style mode.** If OpenRouter ever exposes Gemini's native
  `verbatim`/`smart` switch on the chat route, that is strictly better than any of this and stage 2
  should be deleted in its favour.
- **Making Retry work when the recogniser already put rough words in the box.** A retry after
  `onEnd` has cleared the span would *append* the good transcript beside the rough one rather than
  replace it. So Retry is offered exactly where the audio is offered today — when nothing landed in
  the box at all — which is also the only case where the reader has lost anything.

## Greg offered a way round the constraint. It does not help, and here is why

Greg, 2026-09-05, unprompted, on reading that the ASR-level filler parameters are unreachable
through OpenRouter's chat route:

> If it will help, switch out to using either GOOGLE_API_KEY or to an OpenAI model (we also have
> OPENAI_API_KEY)

Both keys are in `.env.local`. It was offered rather than instructed — *"if it will help"* — so the
job was to find out. It was checked against the actual API surfaces rather than assumed, and the
answer is **no, keep what we have**, for two independent reasons either of which would be enough.

**1. Google's filler removal is bundled with rewriting, which is the thing we are trying not to do.**
Gemini's transcription surface is a separate API family — the Interactions API,
`gemini-3.5-transcribe` — and its `mode: "smart"` does strip disfluencies. It also, per Google's own
description, applies *"inline self-corrections: resolves spoken corrections directly"* and
*"automatic structured formatting: automatically structures spoken thoughts into paragraphs,
numbered lists, bullet points"*. Their own worked example turns a dictated sentence into a numbered
list. **You cannot have the disfluency removal without the restructuring** — it is one mode, not a
set of flags. That is a long way past *"removing um is fine, paraphrasing is not"*, and it is the
documented behaviour rather than a risk. The good news buried in it: `custom_vocabulary` (up to
1,000 terms) is **not** listed as incompatible with smart mode — only diarisation and word
timestamps are — so the vocabulary would survive, in a reshaped form. It is the mode itself that is
wrong for us.

**2. Neither vendor gives zero data retention to an ordinary paid API key.** OpenAI lists
`/v1/audio/transcriptions` as ZDR-eligible but *"subject to prior approval… contact our sales
team"*, with 30-day abuse-monitoring retention by default. Google's paid tier does not train on
prompts but retains logs for up to 55 days unless *"your request for ZDR for a particular project is
approved"*. Today this app sends `provider: { zdr: true }` through OpenRouter, and that flag is what
lets the sentence on the button say a reader's voice is not stored — a **published promise**
([privacy.md](../project/privacy.md)). A direct call would break it. `dictation.md` already records
that reaching a non-ZDR model *"means dropping a published promise, which is Greg's call and not a
benchmark's"*; nothing here changes that, and this is not a call to make inside a feedback ticket.

**And OpenAI would not have bought the thing anyway.** There is no filler or disfluency *parameter*
on `whisper-1`, `gpt-4o-transcribe`, or `gpt-transcribe` — only prompting, which is exactly the
lever this plan already declined, for reasons that do not change with the vendor. (It has gained a
structured `keywords` array for vocabulary biasing, which is a real improvement on Whisper's
224-token prompt, and is worth remembering if the route is ever revisited for other reasons.)

**The cost that would have come with it, so it is on the record rather than inherited:** a direct
call is a second billing account, outside the cap set on the OpenRouter account, and
[ai-gateway.md § The exception that arrived](../project/ai-gateway.md) records that as a real
consequence of the first exception rather than a formality. Not paid, because nothing was switched;
`ai-gateway.md` is therefore unchanged.

**If Greg wants to revisit it**, the order is: decide the privacy promise first (it is the blocker,
and it is his), then measure `gemini-3.5-transcribe` smart mode against the current request on the
audio corpus this plan already says is missing — checking specifically whether the restructuring can
be lived with, and whether `custom_vocabulary` as a flat 1,000-term list holds up against the
prose-and-phrases vocabulary we send today.

## What GPT Sol found, and the two places it was overruled

The plan went to `gpt-5.6-sol` before anything was built and came back **not ready**, with three
P0s. All three were real and all three are fixed; the review is the reason this plan's stage 4 looks
nothing like the one that was sent.

| | what it was | what happened |
|---|---|---|
| **F1** P0 | Disabling the button when offline also disables **Stop** — so a connection dropping mid-dictation would trap the recording, especially now that a recogniser error no longer ends one. | Fixed. The guard is `!armed && !transcribing`; a test presses Stop while offline. |
| **F2** P0 | The audio is kept only when the recogniser confirmed nothing — but with the tape now running past a dead recogniser, the rough words are the first half and the tape is all of it. | Fixed. Kept on **every** failed upload. The test that pinned the old rule had started passing while checking nothing, and is rewritten with its converse. |
| **F3** P0 | The filler list ate real English: `err` ("to err is human"), `ER`, the initialisms `UM`/`AH`, and a deliberate "Ah, now I see". | Fixed three ways: `err` off the list; capitals matched exactly rather than case-insensitively; `ah` stripped only mid-sentence. Sixteen of Sol's cases are in the test table. |
| **F4** P1 | A retry lands after `onEnd`, which had cleared the caret position. | Fixed: `onEnd` keeps `pressedAt` and clears only the span. They answer different questions and only one had gone stale. |
| **F5** P1 | Retry was offered for failures that can never succeed — a bad container, a recording over the cap — which is exactly what copy.md says never to do. | Fixed: `TranscriptionResult` carries `retryable`, set from the HTTP status rather than read out of the prose. |
| **F6** P1 | "Stop the decoration" was incomplete: late results, an `onend` restart loop, and a recogniser dying *before* `audiostart` leaving a session armed and recording nothing. | Fixed, all three. The last one now takes over the timer and arms the tape — which is Firefox's code path verbatim, because it is Firefox's situation. |
| **F8** P1 | The punctuation tidy-up missed five shapes and, being global, could change text that was already fine. Capitalising the first word corrupts `eBay`. | Fixed. The five shapes have tests, the tidy-up runs **only** on a transcript something was removed from, and a word carrying its own capitals is left alone. |
| **F9** P1 | The subsequence invariant as written was too weak and, literally stated, false. | The implementation already had the second half Sol asked for; a third test now pins surviving words byte for byte. |
| **F11** P1 | More collisions than this plan recorded, and code-less verdicts a source scan cannot see. | Both above. |
| **F13** P2 | Stray tool-artefact tags at the end of this file. | Removed. |

### The second round, on the code, and it was the one that mattered

[engineering-manager.md](../reusable/engineering-manager.md) says to weight the code review higher
than the plan review, because a plan-stage review can only find what the prose says. That held here.
Verdict: **do not ship**, four P0s, and Sol had *reproduced* three of them by calling the code
rather than reasoning about it.

| | what it was | what happened |
|---|---|---|
| **D1** P0 | `start()` cleared the displayed recording but not `retryable`, so a **second** dictation that failed offered a Retry which re-transcribed the **first** one's audio. And an in-flight retry was guarded only by `session.current`, which `finish()` clears while a newer upload is still running — so a stale retry could publish into it. | Fixed. `start()` invalidates the offer and bumps `retryGeneration`. Two tests, both red without it; the second needed a **gate on the fake `fetch`**, because without one the retry always resolved while the new dictation was still armed and was caught by a different guard — the test passed and proved nothing. |
| **D2** P0 | `recordTrack` returns null when no container will start, and `armTape` discarded that. After a recogniser error there would then be *no* source of words, no cap, and a strip promising words on Stop. | Fixed: no tape ⇒ `finish(s)`, which says `[mic-no-tape]`. |
| **F1** P0 | `Ah` is the ampere-hour and `Er` is erbium. Reproduced: *"The battery stores 100 Ah"* → *"stores 100"*, *"Er is erbium"* → *"Is erbium"*. And `He replied (Ah, now I see)` lost its `Ah`. | Fixed by a sharper rule: **a capitalised spelling is only a filler when it opens a sentence *and* a comma follows it**. A capital mid-sentence is a unit or a symbol. With the existing `ah`-is-mid-sentence-only rule this means a capitalised `Ah` is never a filler at all. |
| **F2** P0 | The punctuation tidy-up was still global. Reproduced: `Um, run --help to see it.` → `Run -help to see it.`, and `Um, what?—No, wait.` lost its dash. | **Rewritten rather than patched**, because no list of rules fixes a global rewrite triggered by a local deletion. Each deletion now widens over its *own* neighbours only — the whitespace, one orphaned `,;:`, an emptied bracket pair, one of two dashes — and nothing else in the transcript is reachable. |
| **R1** P1 | A retry's caret had no validity proof: `span` is null by then, so a reader editing the box while reading the error moved every offset under a number nobody re-checked. | Fixed: the box's value is snapshotted at `onEnd`; if it has changed, the remembered caret is abandoned and the words go in at the current one. |
| **R2** P1 | A failed retry called `setCanRetry(true)` unconditionally; and `transcribe.ts` flattened 401/402 into 502, so a dead key and an exhausted balance were offered a Retry. | Both fixed. 401, 402 and 429 keep their own status now. |
| **E1** P1 | An unplugged headset fires both `track.ended` and `r.onerror`; whichever won decided whether the reader was told to reconnect a device or check their wifi. | Fixed: a dead track is a microphone problem whatever the recogniser said. |
| **E2** P2 | `onsoundstart`/`onsoundend` ignored the give-up. | Fixed — and the first attempt guarded them on `!s.live`, which broke an unrelated meter test, because `live` is *also* false during the opening second. "Not yet" and "not any more" are two states; `liveGaveUp` is the second one. |
| **T1** P2 | The source scanner silently skips a message it cannot parse. | A skip is now a reported failure rather than an excused message. |
| **R3** P2 | An unmount did not cancel a retry request. | Fixed; a retry belongs to no session, so it is aborted separately. |

Sol confirmed two things it had been asked to attack and could not: the offline guard preserves Stop
in both `opening` and `listening`, and the track/error race does not double-release the microphone.

**Sol still objects to two things, and they are overruled here rather than quietly dropped:**

1. **F10 — which branch keeps `[mic-offline]`.** Sol would keep it on the recogniser, whose event is
   literally called `network`, and rename the upload's, on the grounds that a thrown `fetch` can
   mean DNS, CORS or an extension rather than being offline. That is a fair reading. Overruled
   because a code exists for **the reader who quotes it**: after this change the recogniser's
   sentence is nearly unreachable — a recogniser that dies while the tape runs says nothing at all —
   while the upload's is the one somebody actually loses a dictation to, and "we couldn't reach the
   server" is what being offline produces. The code should live on the path that gets hit. Both
   branches acquired it in the same commit, so no support conversation is more orphaned either way.
2. **The 1J decision itself.** Sol thinks the prompt change is worth trying first, and that the
   existing prompt already sets a non-verbatim convention ("sensible punctuation and
   capitalisation"), so a narrow filler rule would not push it toward paraphrase. It may well be
   right. Overruled **for now, and on sequencing rather than on the merits**: settling it needs the
   audio corpus Sol itself specifies — real hesitations, plus `err`/`ER`/`uh-huh`/a deliberate "Ah",
   plus a non-English control, plus dictated questions to check neither prompt answers them — and
   that corpus does not exist. Building it is the named next step below. The deterministic pass is
   the version whose safety can be asserted today, and it is not in the prompt's way.

## Questions for Greg, recorded rather than asked

1. **Is deterministic-only enough for the ums?** It gets `um`/`uh`/`er`/`ah` and nothing else. If
   the transcripts still read badly, the next step is a judgement call about editing a reader's
   words, and it is yours.
2. **Was your `[mic-offline]` the recogniser's or the upload's?** Both are fixed, so it does not
   block anything, but if you remember whether it appeared *while* you were talking or *after* you
   pressed stop, that says which.
3. `[mic-offline]` now names one branch: the upload. The recogniser's connection failure is
   `[mic-no-connection]`. Renaming a shipped code orphans support conversations
   ([copy.md](../project/copy.md)) — accepted here because leaving two sentences on one code
   orphans them worse.

## Progress

- **Plan written**, reviewed by GPT Sol (verdict: *not ready*, three P0s), and rewritten. 2026-09-05.
- **Stage 1 landed** — `tests/dictation-codes.test.ts` red on three collisions, then green;
  `tooLongMessage()` shared by both ends; `[mic-no-connection]` and `[mic-no-upstream]` split out;
  the two code-less verdicts fixed.
- **Stage 2 landed** — `src/dictation-fillers.ts` and 46 tests, including every case Sol's F3 and F8
  produced.
- **Stage 3 landed** — the button is disabled when the browser reports no network, and is *not*
  disabled while armed (F1).
- **Stage 4 landed** — a recogniser error degrades the live words instead of ending the recording;
  a failed transcription keeps its audio and offers **Try again**.
- **Stage 5** — docs, the code review, the notes, Sentry. The code review returned **do not ship**
  with four P0s; all ten findings are addressed above, each with a test, and the ones worth proving
  were confirmed red without their fix.
