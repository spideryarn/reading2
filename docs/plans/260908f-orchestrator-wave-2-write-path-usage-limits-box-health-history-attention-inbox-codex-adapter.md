# Orchestrator wave 2 — write path, usage limits, box health history, attention inbox, Codex adapter

The plan doc five sessions of wave 2 share. Each session owns its own stages and appends them here
rather than keeping a private plan, so that the order of work, the seams between us and the
decisions taken are in one place.

> Oh, and borrow from Spideryarn for voice-dictation and realtime-dialog for all
> input-message-text-boxes.
>
> — Greg, 2026-09-08

**This file was created by `w2-fleet-dictation` because it did not exist yet.** Only the dictation
section below is written by that session; the other four sessions append their own. Nothing here
speaks for a stage somebody else owns.

Direction and constraints: [orchestrator-direction.md](../project/orchestrator-direction.md).
Stage list for the dashboard itself: [260907e](260907e-agent-fleet-dashboard.md).

---

## Voice dictation on the fleet's message boxes — `w2-fleet-dictation`

Owner: the `w2-fleet-dictation` session, in the `fleet-dictation` worktree.

Greg, 2026-09-08, when asked what a realtime dialog would be talking *to*:

> Let's do dictation first. The goal of realtime dialog would be to talk with whichever agent the
> input-message-text-box relates to, perhaps by feeding in a compacted summary of the conversation
> so far, and/or giving it the ability to use tool use to gather more information (e.g. by reading
> docs/code/etc, or anything else that might help it have an informed conversation) — if you feel
> unblocked enough to make progress on that, then add it as a stage and try and get it working.
> Borrow (or better still reuse) from Spideryarn.

### Which boxes, and which one is deliberately left alone

| box | file | dictation? |
|---|---|---|
| **Say something to it** — the steering message | `SessionDetail.tsx` | yes, the main one |
| **New session** — the whole prompt an agent wakes up with | `NewSessionPanel.tsx` | yes |
| **Rename** — a session's name | `SessionDetail.tsx` | **no**, and on purpose |
| Overseer message | `OrchestratorPanel.tsx` | **there is no box**, and there must not be one |

**The rename field does not get a microphone.** A misheard name is silently wrong and sticks — the
box already carries a warning that saving the same name again is not a no-op — and `looksLikeAName`
refuses most of what speech produces anyway, so the failure would be a button that appears to work
and then refuses. `claude-agents-dashboard` made the same call independently, 2026-09-08.

**`OrchestratorPanel.tsx` has no text box and this work does not add one.** Its own header says why:
there is no Overseer process, so a box there *"would swallow what you typed and look like it had
worked, which is the one thing this page is built not to do"*. Adding a microphone to a box that
does not exist is not a smaller version of that lie. When the Overseer lands and grows a box, it
gets a microphone the same way any other box does — see § Adding it to a box.

### The rule for importing from `src/`

[orchestrator-direction.md § Principles](../project/orchestrator-direction.md#principles) says this
tool *"must not depend on the product database or on anything under `src/`… If it ever earns its own
repo, that should be a move, not a rewrite."* Greg has now also said **"better still reuse"**, and
there are ~3,000 lines of hard-won browser audio machinery in `src/web/`. Copying that would be
worse than depending on it: two copies of a state machine that took a day of debugging to get
believable, drifting from the moment the second one lands.

So the principle is narrowed rather than dropped, and this is the rule:

> **Only LEAF, BROWSER-ONLY, PRODUCT-AGNOSTIC modules may be imported from `src/`.** Nothing that
> reaches the database, an auth session, a slug, an article, or a route under `src/routes.ts`. If a
> module is nearly leaf but for one product coupling, extract the coupling behind a parameter rather
> than importing the coupling.

"If it ever earns its own repo, that should be a move, not a rewrite" survives intact, and the list
below is what that move would carry. **If that list grows past what a person would move by hand, the
answer is to say so, not to grow it quietly.**

### What the fleet now depends on, from `src/`

This is the cost of the move. Every entry is a file with **no imports of its own** except React and
the other entries here — measured, not assumed, by walking the import closure.

**Direct imports** — what fleet files actually name:

| module | lines | why |
|---|---|---|
| `src/web/useDictation.ts` | 1,633 | the microphone: four phases, one owned track, the recorder, the two-pass transcript |
| `src/web/useDictationField.ts` | 252 | wiring it to a text box: the caret, the span, the closed box |
| `src/web/useAudioLevel.ts` | 204 | the meter, reading *the track being recorded* |
| `src/web/MicLevel.tsx` | — | drawing it; inline styles only, no product stylesheet |
| `src/dictation-limits.ts` | 122 | the size caps and the container list, shared by both ends — what this file was built for |
| `src/dictation-fillers.ts` | 312 | the ums, deleted (server half) |
| `src/vocabulary.ts` | 456 | `packTerms`, `MAX_TERM`, the angle-bracket strip (server half) |

**Pulled in transitively**, all leaves: `src/web/mic-lock.ts`, `mic-recording.ts`, `mic-devices.ts`,
`dictation-errors.ts`, `audio-level.ts`, and the new `src/web/transcriber.ts`.

**Total: 4,205 lines across 13 files, and no external package beyond `react`.**

Measured by walking the import closure — and the walker was wrong the first time, in the direction
that flatters: its regex matched `import ... from` on one line only, so every multi-line braced
import was invisible and `mic-devices.ts` went missing from a closure that imports it. It carries a
self-check now that fails loudly on exactly that file. The numbers below are from the fixed one.

#### What is deliberately NOT imported, and why

- **`src/web/DictationStrip.tsx`** (502 lines). It is the *chrome*, and its class names —
  `prof-mic-note`, `prof-listening`, `prof-interim`, `spin` — are the product's hand-written
  stylesheet, which the fleet does not load. Importing it would typecheck, build, and render an
  unstyled button: [silent-success](../reusable/silent-success.md) with a green bundle on it. The
  fleet writes its own control against the same hook state. The split is **reuse the machinery,
  write the chrome**, which is also right on the merits: the fleet page follows the device between
  light and dark and the product is dark unconditionally.
- **`src/web/dictation-upload.ts`**. The one product coupling in the client half. Its own closure is
  **21 files and 16,054 lines**,
  reaching `lib/api.ts` → `@supabase/supabase-js`, `@sentry/core`, the offline store and the billing
  plan. Cutting that single edge took `useDictation.ts` from a closure with all of that in it down to
  **8 files, 2,938 lines and `react`** — which is what makes everything above importable. See
  § The parameter.
- **`src/transcribe.ts`**. Measured: **161 files, 118,082 lines**, pulling `pg`, `drizzle-orm`,
  `stripe`, `jsdom`, `@mozilla/readability`, `pino` and `@anthropic-ai/sdk` into a tool whose whole
  claim is that it runs with the product's server absent. See § The server half.

### The parameter: `useDictation` stops knowing where the words go

`src/web/useDictation.ts` imports `sendForTranscription` from `dictation-upload.ts`, which calls
`apiFetch("/api/transcribe")` — the product's authenticated client. That is the coupling, and it is
extracted rather than imported:

- A new leaf `src/web/transcriber.ts` holds `TranscriptionResult` and
  `type Transcriber<C> = (blob, mimeType, context: C, signal?) => Promise<TranscriptionResult>`.
- `useDictation` and `useDictationField` gain a **required** `transcribe` option and become generic
  in `C`, the context type. They call `transcribe(blob, mime, where, signal)` and have no opinion
  about what `where` is or which server answers.
- `context` **stays** on the options, opaque. It is not folded into a closure, because
  `tests/feedback-dictation-vocabulary.test.tsx` exists to walk exactly that join — box hands the
  hook a `context`, the upload puts it in the body — and a closure would delete the seam that test
  watches. The hook's existing care about `context` (snapshotted per session, travelling with a kept
  recording, so a reader who navigates mid-upload is not transcribed against another article's
  glossary) is untouched.
- The six product call sites gain one line: `transcribe: sendForTranscription`. Nothing else about
  them changes.

The fleet passes its own transcriber, its own context (`{ sessionId }` or `{ kind: "new-session" }`),
and its own server.

### The server half: the fleet makes its own OpenRouter call

Two shapes were considered and one was measured out of contention.

**(a) Import `src/transcribe.ts` with an empty vocabulary.** Ruled out. `transcribeWith` is
genuinely free of the database at runtime — `ai-spend.ts` writes through a *sink* that is `null`
unless the product's server installs one — but that is not the cost. The cost is the closure: 161
files, 118,082 lines, `pg` and `stripe` and `jsdom` among them, plus `loadEnvLocal()` reading the
product repo's `.env.local` and `src/log.ts`'s pino configuration. A tool that must work with the
product absent cannot import the product's Postgres driver to transcribe a sentence. Even a
hypothetical `transcribeWith` extracted to its own module still reaches `ai-call.ts`, which measures
20 files and 20,344 lines.

*And a second finding, which is the honest half of ruling (a) out:* going through `ai-call.ts` would
not have metered the spend anyway. The sink is `null` outside a collector box, so the fleet's
transcription calls would have left no `ai_calls` row and `npm run cost` would not have seen them.
Either way the fleet's OpenRouter spend is invisible to the product's ledger. That is a real gap and
it is named here rather than discovered later — see § What is not built.

**(b) The fleet calls OpenRouter's `/v1/audio/transcriptions` itself, with its own vocabulary.**
Chosen. ~150 lines in `tools/fleet/transcribe.ts`, importing the three true leaves above. Still
through OpenRouter — [ai-gateway.md](../project/ai-gateway.md)'s rule is not weakened, and no second
gateway is added.

**The vocabulary is the whole reason this is worth doing properly.** The finding from 2026-08-27 is
that the second pass *"is not a better ear, it is a vocabulary"* — every dedicated speech-to-text
model mangled this app's own words until it was handed a list. A fleet dashboard whose transcriber
has never heard the word **worktree** would mangle every message Greg dictates. And our vocabulary is
better defined than an article's, because we know it exactly rather than inferring it:

1. **The fleet's own words** — `worktree`, `tmux`, `gjd-remote`, `Overseer`, `vitest`, `Supabase`,
   `Vercel`, `Postgres`, `OpenRouter`, `Hetzner`, `Tailscale`, `Drizzle`, `Playwright`, `typecheck`,
   `Spideryarn`, `Greg Detre`, `origin/dev`, and the model names (`Opus`, `Sonnet`, `Haiku`,
   `Fable`, `GPT Sol`, `Codex`).
2. **The live fleet** — every session's handle and title, every worktree name, every repo directory,
   read off the snapshot the server already holds in memory. This is the part an article can only
   guess at: the words Greg is about to say into this box are the names on the page in front of him.

Capped and sanitised by `src/vocabulary.ts`'s `packTerms` and `MAX_TERM`, which already strip angle
brackets and cap each term — the same guards, for the same reason, since a session title is text
this tool did not write.

### The seam with the other sessions

- **`claude-agents-dashboard`** owns `tools/fleet/`. Agreed division, 2026-09-08: `OrchestratorPanel.tsx`
  and `NewSessionPanel.tsx` are this session's to edit now; **`SessionDetail.tsx` is theirs first**,
  and their declutter lands before the microphone does.
- **`tools/fleet/wire.ts`** is where the transcribe request and response types are declared. Types
  only, no runtime values, **no imports ever** — the client's tsconfig compiles its whole transitive
  closure under DOM-only libs, so one `import type` turns `npm run typecheck` red. The client
  derives with `Omit<…>` rather than restating, so a new wire field stops the parse compiling.
- **Every write route goes through the Origin check** (`tools/fleet/origin.ts`), and the transcribe
  route is a write route.

### Three things the audio makes different from every other route on this server

Asked for by `claude-agents-dashboard`, and right:

1. **Nothing about the audio is logged** — not its bytes, not its transcript, and not a size that
   accumulates into a picture of when somebody was talking. The product's rule
   ([logging.md](../project/logging.md)) is the same one; this server logs with `console.log` and
   the rule is the destination, not the function name.
2. **The failure path says which of three things happened**, in words: the microphone gave us
   nothing, the upload failed, or the model refused. On a phone those are indistinguishable and all
   read as *"the button does nothing"*. The bracketed codes come with `useDictation` already.
3. **This tool has spent 2026-09-08 fixing four features that were silently dead.** A dictation
   button that fails quietly would be the fifth.

### Stages

| | | |
|---|---|---|
| **D1** | `src/web/transcriber.ts`, the parameter, and the six product call sites. Nothing in `tools/` yet. | |
| **D2** | `tools/fleet/transcribe.ts` + `POST /api/transcribe` on the fleet server, with the fleet vocabulary. Verified against the real gateway with a real clip. | |
| **D3** | `tools/fleet/web/src/DictationControl.tsx` — the fleet's own chrome over the reused hook — and the microphone on `NewSessionPanel.tsx`. | |
| **D4** | The microphone on `SessionDetail.tsx`'s message box, **after** `claude-agents-dashboard` has pushed its declutter. | |
| **D5** | A test that pins the import allowlist above, so the list cannot grow without somebody deciding to. | |
| **D6** | Stage 2 — realtime dialog — **gated**: only if D1–D5 are solid. See below. |

### Stage 2, and the misreading that would be expensive

**The conversation partner is not the agent itself.** An agent in a tmux pane has turn latency in
tens of seconds, and `steer.ts` already reports that a delivered message can be `partial` — the text
landed and the Enter did not. Audio must not be piped at a pane.

What Greg described is a realtime model **briefed about** that agent: a compacted summary of the
conversation so far, plus tool use to read docs and code, so he can talk through what the session is
doing and then hand it a message. `src/web/live/useLiveConversation.ts` and `src/live.ts` are what
would be reused. OpenRouter has no realtime API, so this path does not go through the gateway and
the audio never reaches our server —
[live-conversation.md](../project/live-conversation.md#the-audio-never-touches-our-server).

**Gated honestly.** If stage 1 is not solid, this stops and says so. An unfinished stage 2 on top of
a shaky stage 1 is worse than stage 1 alone.

### What can and cannot be verified from this box

> A valid session ticket is not proof that a microphone opened, a response event is not proof that
> sound played.
>
> — [live-conversation.md](../project/live-conversation.md)

**There is no audio input device on this box, and Chrome's fake-microphone flags do not work
headless here — measured, not assumed.** So the real `getUserMedia` path cannot be exercised from
here at all. What a browser pass on the box can show is the page rendering, the button changing
state, the failure sentence appearing, and — by driving `MediaRecorder` from Web Audio — the upload,
the server, the model call and the transcript landing in the box. What it cannot show is a
microphone opening.

Everything past that needs Greg, on his own device, and the report says so rather than implying
otherwise.

### What is not built

- **The fleet's OpenRouter spend is not in the product's ledger.** No `ai_calls` row, so `npm run
  cost` does not see it. True of shape (a) as well as (b) — see above — so it is a property of the
  fleet being a separate tool, not of this choice. A dictation costs about $0.0005.
- **Nothing streams**, for the same reason the product's dictation does not: a partial transcript is
  not a prefix of the final one.
