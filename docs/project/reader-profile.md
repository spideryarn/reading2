# The reader profile — telling the model who is reading

Every model call in this app used to write for a reader it knew nothing about. The glossary
explained *entropy* to a physicist; chat pitched an answer at nobody in particular. This is the box
where you say who you are, and the plumbing that carries it to the calls that should care.

Built 2026-08-26 from [reader-profile.md (the plan)](../plans/reader-profile.md), which has the
reasoning, the two reviews that reshaped it, and what was deliberately left out.

> Add a multi-line-text-input box to the Metadata for the user to describe their
> background/experience/interests/purpose in reading this. Then feed that in if non-empty as part of
> the prompt … to any relevant tasks.
>
> — Greg, 2026-08-26

**The previous version built this box twice and read it never.** `profiles.background` and a
per-document "Reading Intent" were both stored, both displayed, and neither ever reached a prompt.
So the textareas are the easy half and the least of it. That is why this doc is mostly about the
wiring.

## Two boxes, one string

| Box | Scope | Stored | Edited at |
|---|---|---|---|
| **About you** | you, always | `data/reader.json` / `reader_profiles.profile` | `/profile` |
| **Why you're reading this one** | one article | `shelf.json` → `ShelfState.purpose` / `articles.purpose` | `/read/<slug>/metadata` |

Both are **reader state**: they survive re-extraction and the pipeline cannot undo them. That is the
argument [`src/shelf.ts`](../../src/shelf.ts) already makes for the renamed title, and it holds here
word for word — a re-extraction rewrites `meta.json`, and anything of the reader's stored in there
dies quietly weeks later.

[`src/profile.ts`](../../src/profile.ts) joins the two into **one string**, and it is the only module
that knows there were two:

```
About the reader: Cognitive scientist, twenty years. Rusty on transformer internals.
Why they are reading this piece: I want the evidence, not the history.
```

Caps are **1,500 and 600 characters, refused rather than truncated** — a silently shortened profile
is one the reader believes they gave and did not. The 600 matches `MAX_GUIDANCE_CHARS` on the summary
steer, because the two boxes sit next to each other in the reader's head. **Never logged, only its
length**: this one is about the person rather than about the article ([logging.md](logging.md)).

**Normalised before rendering, and hashed from the rendering.** Trim, `\r\n` → `\n`, whitespace-only
is empty. Two spellings of one profile must be one profile, or a trailing newline from a paste marks
every artefact on the shelf stale and writes a second cache entry for the privilege.

### There is a third box, and the rule that keeps them apart

The summary panel's **steer** predates this and stays. Three free-text boxes about intent, and this
is the carve-up:

- **About you** — durable, about the person, read by all five features.
- **Why this one** — durable, about this article, read by all five.
- **Steer** — one rewrite of one artefact, read by summaries only.

**Where the steer and the purpose disagree, the steer wins**, and `SYSTEM` says so out loud. It is
the more recent and more specific act. Leaving it to the model would be two instructions about
emphasis with no ordering between them, which is how you get an answer that follows neither.

Fable's review argued for cutting the per-article box entirely — its example sentence and the
steer's example sentence are, word for word, nearly the same. Greg kept both
([the plan](../plans/reader-profile.md#the-second-box-was-argued-against-and-kept-anyway) has the
argument, so nobody has to make it again). **If the per-article box goes unused, delete it** rather
than leave it as furniture.

## Where it goes in the prompt

**After the breakpoint, in the last user part, everywhere.** The obvious alternative — the system
prompt, where "who is reading" naturally belongs — buys a separate cache entry per distinct profile,
rewritten from cold every time the reader edits their box, on a prompt whose whole point is that the
article never changes. [prompt-caching.md](prompt-caching.md) records the same mistake twice already.

| Call | Article is at | Profile goes |
|---|---|---|
| `explain` | user part 1, breakpoint on it | user part 2, with the quote |
| `converse` | user message 2, breakpoint on it | the final user message, with the question |
| `glossary` | `system[0]`, breakpoint on it | the user message |
| `tweets` | `system[0]`, breakpoint on it | the user message |
| `summarise` | the user prompt — not cached, on purpose | beside the steer, near the top |

The positioning rule inside the varying part is one rule, not two: **the thing the model must
actually do goes last.** So chat and explain put the profile before the question; the batch stages
put it near the top with the other framing, where summaries already puts its steer.

**Not the structural stages.** The ToC, the arc and the section labels never see it. The tree is
[the one structure](granularity-zoom.md#the-tree) that the ToC, the zoom, the summaries and the spine
all address, and a reader-specific tree is one that shifts under a reader who edits their profile.
Structure stays shared; only the prose *about* it is personalised. **Not semantic search** either:
"where does this piece say X" has an answer that does not depend on who is asking.

**Not tool arguments — and this one is an instruction, not a boundary.** Chat and explain can call
web search, and the profile is in the same prompt as the tool. `PROFILE_RULES` tells the model not to
put it in a query, and that is all we have: a prompt is not an enforcement mechanism, and nothing in
the code inspects a search query before it goes out. Written down plainly because the first version
of this doc claimed the promise rather than the instruction, and a privacy claim that is really a
request is worse than no claim. GPT Sol's review, 2026-08-26. The real fence, if this ever matters
enough, is a check on the tool call's arguments in [`src/chat-tools.ts`](../../src/chat-tools.ts) —
not more prompt.

### The rules live in `SYSTEM`, and they are always there

`PROFILE_RULES` in [`src/profile.ts`](../../src/profile.ts) is appended to all five system prompts,
**whether or not the reader has a profile**. Two reasons, and the second decided it: `SYSTEM` sits
ahead of the article in explain and converse, so a varying one would split the cache in two and
re-write the whole article whenever the reader toggled; and a rule that only appears alongside the
thing it constrains is a rule somebody will one day interpolate the profile *into*. So every clause
is written conditionally — "if a description appears" — because it has to read correctly on the
majority of calls, which carry none.

The clause doing most of the work: **which things you spend words on is governed by the profile;
every sentence you write is still about the article.** Framing it as an input to *choosing* rather
than to *addressing* is what stops a model performing the adaptation instead of making it.

And a **forbidden example, written out verbatim** — *"As a cognitive scientist, you'll appreciate
that…"*. [glossary.md](glossary.md) learned twice that **a prompt ban relocates a register, it does
not delete one**, and its own fix was a real bad entry carried in the prompt as a negative example.
"Never flatter the reader" reliably produces flattery in a different costume; the sentences do not.

## The glossary is the case this feature is really for

Elsewhere a profile changes how a paragraph is pitched. In the glossary it changes **which terms get
an entry at all**, and what `difficulty` means. A term is hard *relative to a reader*, so under a
profile that score stops being a property of the term and becomes a property of the pair — which
makes the threshold slider a reader is already dragging ([glossary.md](glossary.md)) mean something
personal.

It is also why `profileHash` is not bookkeeping: a difficulty score written for last month's profile
is **wrong**, not merely old.

## Provenance: what was this written with, and is it still true

Every generated artefact carries one field:

```ts
profileHash?: string | null;
```

| Value | Means | Stale? |
|---|---|---|
| absent | written before this existed | **no** |
| `null` | written deliberately *without* a profile | **no** |
| a hash | written from that profile | only if it differs from now |

**`null` is never stale**, and that line is the whole design. A reader who unticked the box and paid
for a plain glossary must not then be told it is out of date — that would be a control whose result
the app immediately complains about. `undefined` is never stale for a gentler reason: nobody's
existing artefacts should light up about a profile they never had.

**Clearing your profile marks nothing stale — but only if you clear *both* boxes.** `profileIsStale`
compares against the *rendered* profile, and that is the join of the global half and the article's
purpose. Empty the global box while a purpose remains and the rendered string is still non-empty
with a different hash, so the artefact really has gone stale — which is correct, since what the model
would be told has genuinely changed. The rule is therefore about the whole profile going away, not
about either box. An earlier version of this paragraph said it without the qualification; GPT Sol's
review, 2026-08-26.

`profileIsStale` in [`src/profile.ts`](../../src/profile.ts) is the one place those rules live.
`GET /api/{glossary,summary,tweets}/:slug` answers it as `profileChanged`, a third boolean beside
`stale` and `outdated`, because it needs a third sentence: *stale* means the article moved,
*outdated* means we would write it differently now, *profileChanged* means you are not who you were.

**A hash rather than a `usedProfile: true`**, because a boolean cannot tell "written for the profile
you have now" from "written for the profile you had last week", and from every surface in this app
those two look identical.

### `existingFor` is the sharp edge

`isStale` is **not** the gate on the glossary's top-up path — `existingFor`
([`src/glossary.ts`](../../src/glossary.ts)) is. Folding the profile into `isStale` and stopping
would have left top-up untouched: new profiled terms appended to old unprofiled ones, and the whole
list then stamped with the new hash. A lie about provenance, written by us, into a file.

So `existingFor` takes the incoming profile hash and refuses on any difference, which sends the run
down the rewrite path where `idsByTerm` keeps the reader's `?term=` links alive. Note it is
**stricter than `profileIsStale`**: there, `null` never counts, because a reader should not be
nagged. Here any difference counts, because the question is not "should we warn them" but "may these
two lists be merged" — and entries written for a physicist may not be merged with entries written for
nobody in particular.

### One profile per job, frozen at the start

The profile is resolved **once**, by the route (`resolveProfile` in [`src/routes.ts`](../../src/routes.ts)),
and carried on the job exactly as `guidance` already is — `Job.profile` → `StepContext.profile` →
the step. A summary run is several batches at once, and a reader who edits their box mid-run would
otherwise get one artefact written from two profiles and stamped with whichever finished last.

It is also part of `sameWork` in [`src/jobs.ts`](../../src/jobs.ts). Unticking the box and pressing
the button again is a request for a *different artefact*, not a retry of the one already running.

Chat and explain resolve it **per turn** instead, and the difference is deliberate: a turn is one
call, so there is no window in which half an answer could be written to each.

### The client says whether, never who

The API takes `useProfile: boolean`, never the profile text. Absent means **yes** everywhere it is
offered. A client that could supply the text would be a way to spend tokens on a string of its
choosing and a way to put arbitrary text into a prompt that writes an artefact.

Note this is the mirror of `deep` on explain, and the asymmetry is on purpose: deep search is an
extra you ask for, so absent means no; the profile is the default this app now writes with.

## The two controls, and why one of them is not a control

Greg asked for *"a checkbox (default-true, with fully-explanatory tooltip) in
all the places where we're taking into account that we have done so"*. Fable's
review objected that a checkbox reads as something to *set* when what it records
is something that *happened* — the shape the glossary already solved with
[a label instead of a warning triangle](glossary.md) — and that flipping it means
regenerate-and-wait, which is a model call hidden behind the lightest control in
the interface.

So the two jobs are separated ([`src/web/WrittenForYou.tsx`](../../src/web/WrittenForYou.tsx)):

```
  ┌─ GLOSSARY ─────────────────────────── ✓ written for you ⓘ ─┐   ← a LABEL
  │  Threshold ▁▂▃▅▇                                            │
  │  ⚠ You changed your profile since these were written.        │
  │  ┌────────────────────────────────────────────────────────┐ │
  │  │  ☑ Use your profile           [ Find them again ]       │ │   ← the CHECKBOX,
  │  └────────────────────────────────────────────────────────┘ │      beside the spend
  └──────────────────────────────────────────────────────────────┘
```

Unticking the box and pressing the button is exactly the "check/uncheck and it
regenerates without this prompt" that was asked for. It just does not pretend to
be free.

**The checkbox needs no storage of its own.** It is seeded from what the
artefact on screen was written with (`profileHash != null`), so the reader's
last choice comes back off the file rather than out of a preference that could
disagree with it. With no artefact yet, it starts ticked.

**With no profile written, both are absent** — not disabled, not unchecked. "Written" means
*either* box, resolved the way the prompts resolve it: a reader with only an article purpose has a
profile as far as every prompt is concerned, and hiding the controls from them would mean they could
not opt out of something they could not see. `useHasProfile(slug)` asks the server that exact
question rather than checking the global box alone.

One thing the label does **not** do: it goes on describing an artefact that was written for a profile
after the reader clears theirs. That is deliberate — it *was* written for you, and the badge is about
the text rather than about the current state of the world. The checkbox disappears; the label stays
until the artefact is rewritten.

Where each one is:

| Surface | Label | Checkbox |
|---|---|---|
| glossary | on the head line | beside Find / Find them again |
| summaries | on the head line | beside the steer and Rewrite them |
| tweets | beside the counts | beside Write it again |
| chat | — | in the composer, per turn |
| explain | — | — |

**Chat gets the checkbox and no label**, and the asymmetry is the point: an
answer is not an artefact anybody rewrites, so there is nothing for a label to
describe and nothing to flip back to. The checkbox governs the next answer and
claims nothing more.

**Explain gets neither, deliberately.** It has no pre-flight moment — the call
fires when you select a sentence — so a checkbox in the dialog could only affect
a *re-ask*, which is a control that appears after the thing it would have
governed. And it is the call the profile helps most: a wrong pitch wastes the
whole answer, where a wrong pitch in a glossary wastes one entry. Explain always
uses the profile.

## What editing your profile costs

**One typo fix marks every artefact in the library `profileChanged` at once.** Hash equality has no
notion of a trivial edit. Nothing regenerates on its own — stale is a *sentence*, not a rewrite — but
it will look like something broke the first time it happens to a shelf with thirty articles on it.
If that ever becomes intolerable the fix is not fuzzy hashing (there is no honest version of it); it
is a "mark everything current" button, which is its own small design problem.

## The microphone, and what it took to make it believable

There is a microphone on both boxes. Why it is the browser's own Web Speech API rather than an
OpenRouter call — free, no server, live text while you talk, and Safari can run it on-device — is
argued out in [reader-profile.md § The microphone](../plans/reader-profile.md#the-microphone). This
section is about the part that was wrong for a day, because the lesson generalises well past
dictation.

**Greg pressed it and reported that "nothing seemed to happen".** Nothing was broken. Measured in
Chrome: the microphone does not open until **1.1 seconds** after the button is pressed, and no
transcript comes back for several seconds after that — while the button turned orange *immediately*,
a claim to be listening made a second before it could hear anything. The only other feedback, the
interim text, was rendered conditionally on there being interim text, so until the first transcript
the page was byte-for-byte what it had been before the press.

So the whole of the first four seconds was: a 26-pixel icon in the corner changed colour, and nothing
else in the world was different — while the reader watched the textarea, which is where the words are
supposed to appear.

Three things fixed it, and the third is the interesting one:

1. **Three phases rather than two** — `idle | opening | listening`. The orange is only worn once
   `audiostart` has fired, and `opening` says *"Opening the microphone…"* in words.
2. **A strip that exists whenever the microphone is armed**, not only when it has something to say.
3. **A live level meter** — Greg's ask, *"so that the user has a sense of whether it's working"*.

### The meter is the only thing that can answer the question

Bars moving with your voice mean the microphone works and the recogniser is merely thinking. Bars
flat while you talk mean the audio device is wrong or muted. Nothing else on the page distinguishes
those, and they are the two cases a reader most needs told apart.

**That case is not hypothetical.** During the build every reading dropped to exactly zero, because
macOS had silently switched the default input to *"Microsoft Teams Audio Device (Virtual)"*, which
delivers digital silence — while `getUserMedia`, `readyState`, `muted` and `enabled` all reported
perfect health. The feature caught its own motivating bug by accident.

Two decisions inside it are worth carrying elsewhere:

- **One capture, never two.** `SpeechRecognition` does not expose its `MediaStream`, so the obvious
  design opens a second `getUserMedia` for the meter. That is unsafe: WebKit supports one microphone
  source at a time, and a second capture can kill the first or switch the routing — the meter would
  then be drawn from a *different microphone* than the one being transcribed. Recent Chromium
  implements the spec's `recognition.start(audioTrack)`, so one track feeds both; Safari, which has
  no such overload, opens no second stream and drives the bars from the recogniser's own
  `soundstart`/`soundend` instead.
- **Nothing is invented.** Both sources are real observations of real audio — one continuous, one
  binary. A meter that moves when the microphone is dead answers the reader's question wrongly and
  confidently, which is worse than no meter at all.

### The threshold that says nothing rather than accusing

After ten seconds with nothing above the activity threshold the strip says *"Listening — no sound
detected yet"*. It said something much more useful for one draft — *"No sound reaching the
microphone. Check your input device."* — and that was removed on review. Somebody presses the button,
thinks, and then speaks; a headset with heavy noise gating delivers exact silence until the first
syllable. Both produce the accusation, and a reader told their hardware is broken goes and changes
settings that were fine. **Only `audio-capture`, a dead track or a refused `getUserMedia` earns that
sentence**, because those are facts rather than inferences. Everything else gets an observation.

### And the errors that used to vanish

The handler named four codes: two it swallowed, two it apologised for. Everything else — including
`network`, which is what a captive portal or a plane produces, and `audio-capture`, which is a
disconnected headset — **disarmed and turned the button off with no message at all**. That is
[silent-success](../reusable/silent-success.md) with the polarity reversed, and the check anybody
would naturally run ("did the button light up?") gives the reassuring answer either way.
[`dictation-errors.ts`](../../src/web/dictation-errors.ts) is now total: every code produces either a
sentence or a deliberate silence, never an accident.

The full diagnosis, the measurements, the two reviews and the traps are in
[microphone-level-meter.md](../plans/microphone-level-meter.md) — including the one that costs the
most time: **`requestAnimationFrame` does not run in a hidden tab**, so the meter reads a flat zero
when driven from browser automation that is not frontmost, with every other part of the audio graph
checking out perfectly.

## And then it was still broken, and the microphone was not

Greg pressed it again a few hours later: *"I just tried and it still doesn't seem to be working, and
doesn't show any indication of input volume."* Nothing was broken this time either. What
`getUserMedia({ audio: true })` handed the page was:

```
track = "Microsoft Teams Audio Device (Virtual)"   readyState=live   muted=false
```

A conferencing loopback. Every sample it produced was **exactly `0.0`** — not a quiet room, which
measures −70 to −51 dBFS, but digital silence. Measured against the built-in microphone in the same
minute, on the same page: `0.044` peak, −27 dBFS. The recogniser transcribed nothing because there
was nothing to transcribe; the meter drew a flat line because the line was flat. Both instruments
were correct and neither was any use, **because nothing on the page said which microphone had
produced that zero.**

That is the same failure the meter itself was built to end, one layer further down. An observation
without the thing observed is half an instrument. So:

- **The strip names the device**, at the moment it is diagnostic — on the quiet line, not all the
  time. *"No sound detected yet · Microsoft Teams Audio Device (Virtual) · Change"*: two facts side
  by side rather than one sentence joining them, because *"no sound **from** X"* turns a
  ten-second threshold into a verdict about a device, which is exactly the accusation the section
  above exists to refuse.
- **The reader can pick a different one.** [`mic-devices.ts`](../../src/web/mic-devices.ts), stored
  in `localStorage`, sent as `{ deviceId: { exact } }` — `exact` rather than `ideal`, because
  `ideal` silently substitutes another device when the named one is gone, which is this whole bug
  wearing a constraint. We deliberately do **not** guess: no preferring `'default'`, no skipping
  labels matching `/virtual|teams|zoom/`. Both would override a decision the reader made in their
  own browser settings.

### The button says what pressing it does, and for how long

Two smaller things Greg asked for in the same breath. The armed button wore `MicOff`, which is the
icon for *muted* — so the one moment the microphone was live it showed the glyph for dead. It is now
a filled **square** in both armed phases, on the rule that the icon says what the *press* does; the
phase is carried by colour, the pulse, and the strip's own words. And there is an `m:ss` timer,
whose zero is the first `audiostart` rather than the press, because the 1.1 seconds before the
device opens are not seconds of anything.

### What we heard, when nothing came back

Greg also asked for the audio to be kept on failure, with *"a button to reveal it in the OS file
explorer"*. **A web page cannot reveal a file in the OS file explorer** — no API, sandbox boundary,
not a gap. The nearest true thing is a download, after which Chrome's own downloads UI carries a
*Show in Folder*, so the reveal happens one click along and at the reader's request. The button
promises only what it does: *Save 0:14*.

The trigger is **not** "if there's an error", which is what was asked for and would have been silent
through the entire failure that prompted it — a silent device produces `no-speech`, which is
suppressed, and Chrome restarts happily. It is **"the dictation ended having transcribed nothing"**,
which covers the silence, the `network` error and the failed Safari restart alike. A recording of
Greg's session would have been fourteen seconds of digital silence, which is the proof.

The rules that keep it honest, all in [`mic-recording.ts`](../../src/web/mic-recording.ts): nothing
is offered unless the recorder started, never errored, finished, produced bytes, and ran at least
two seconds; the recorder is drained *before* the track is released, or the tail of the file goes
missing; it is dropped when the dictation produced text, on unmount, on the next press, and by hand;
it is never uploaded anywhere. And the container is AAC-in-MP4 — because bare `audio/mp4` reports
supported, records happily, and produces **Opus in MP4**, which macOS cannot play. A file the
reader's machine will not open fails the whole point while passing every check.

The measurements, both reviews and the two bugs the tests found after the reviews are in
[microphone-device-and-recording.md](../plans/microphone-device-and-recording.md).

## Where the pieces are

| | |
|---|---|
| [`src/profile.ts`](../../src/profile.ts) | render, normalise, hash, the staleness rule, `PROFILE_RULES`, `profileSection`, and the filesystem half of the global store |
| [`src/shelf.ts`](../../src/shelf.ts) | `ShelfState.purpose` — the per-article half |
| [`src/store/contracts.ts`](../../src/store/contracts.ts) | `ReaderStore`, and `ShelfStore.patch`'s third key |
| [`src/store/pg-reader.ts`](../../src/store/pg-reader.ts) | the Postgres half; `reader_profiles`, one row per owner |
| [`src/routes.ts`](../../src/routes.ts) | `GET`/`PATCH /api/reader`, `resolveProfile`, `withProfileChanged` |
| [`tests/profile.test.ts`](../../tests/profile.test.ts) | the pure rules, including the staleness table exhaustively |
| [`tests/profile-prompts.test.ts`](../../tests/profile-prompts.test.ts) | the batch prompts — which `article-prompt.test.ts` never covered |
| [`tests/article-prompt.test.ts`](../../tests/article-prompt.test.ts) | that the cached prefix is untouched by any profile |
| [`src/web/ProfileBox.tsx`](../../src/web/ProfileBox.tsx) | the textarea, its microphone and the listening strip — shared by `/profile` and the metadata page |
| [`src/web/useDictation.ts`](../../src/web/useDictation.ts) | the recogniser: three phases, the shared track, the Safari restart |
| [`src/web/useAudioLevel.ts`](../../src/web/useAudioLevel.ts) | the analyser and the frame loop, and everything that must not be mistaken for silence |
| [`src/web/audio-level.ts`](../../src/web/audio-level.ts) | pure: RMS, the decibel mapping, the measured floor, the smoothing |
| [`src/web/dictation-errors.ts`](../../src/web/dictation-errors.ts) | pure: every error code to a sentence, totally |
| [`src/web/MicLevel.tsx`](../../src/web/MicLevel.tsx) | the five bars, and the frame loop that never re-renders |
| [`src/web/mic-devices.ts`](../../src/web/mic-devices.ts) | which microphone: the list, the remembered choice, and why the constraint is `exact` |
| [`src/web/mic-recording.ts`](../../src/web/mic-recording.ts) | keeping the audio of a dictation that produced nothing, and the container that opens on a Mac |

## What is still open

- **No evidence it helps.** The same criticism [summaries.md](summaries.md) already levels at itself.
  The cheapest check is two glossaries of one article, one for a beginner and one for an expert, read
  side by side — and the sharper question is not *"are they different"* but **does the expert version
  ever mention the expertise?**
- **No counter on the register yet.** The plan proposes logging profile-echo words and second-person
  pronouns, which would turn "never mention the profile" from a rule into a number the log can
  contradict. Not built.
- **Stored answers carry no provenance.** Chat messages, comments and
  `glossary-lookups.json` all hold model output pitched at the reader, and none
  of them records a `profileHash`. So there is no badge beside a six-week-old
  answer — which is the *right* absence for now, because a badge there would
  start lying the moment the profile changed. Adding the field to those three is
  the next piece.
- **Instant switching between a profiled and a plain artefact** is not built. Flipping the checkbox
  and pressing "Write them again" is the whole feature minus the instant part; storing both copies is
  [deferred with reasons](../plans/reader-profile.md#storing-both-copies-is-deferred-and-the-deferral-now-has-teeth).
- **Two tabs.** Last write wins, which is what `shelf.json` already does.
- **Not multi-user.** One reader, one profile, which is what [auth.md](auth.md) says this app is —
  though the Postgres half is keyed by `owner_id` from the start.

## See also

- [reader-profile.md (the plan)](../plans/reader-profile.md) · [glossary.md](glossary.md) ·
  [summaries.md](summaries.md) · [comments.md](comments.md) · [prompt-caching.md](prompt-caching.md)
- [microphone-level-meter.md](../plans/microphone-level-meter.md) — the microphone's diagnosis and
  rebuild, and the two GPT Sol reviews behind it
- [microphone-device-and-recording.md](../plans/microphone-device-and-recording.md) — the device that
  emitted digital silence, the stop glyph, the timer, and the audio kept when nothing came back
- [browser-testing.md](browser-testing.md) — why a hidden tab makes the level meter read zero
- [library.md](library.md) — the shelf record `purpose` joins
- [silent-success.md](../reusable/silent-success.md) — a profile that silently stops reaching a
  prompt returns a perfectly good answer
