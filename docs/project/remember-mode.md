# Remember mode — say what you took from it, and find out

**Built 2026-08-27, and named *Remember* since 2026-09-01** — the rename and its reasoning are in
[260901d](../plans/260901d-rename-review-mode-to-remember-mode-everywhere.md). The reader talks — or
types — about what they got from the article, and the model helps them find where their account and
the piece come apart. Four **stances** control how much it says: Balanced, Respond, Socratic,
Signposts.

Greg, 2026-08-27, when it was still called Review:

> I want to add a Review mode where the user types or talks … about what they've taken from the doc,
> and then the agent responds plainly but concisely with any corrections/misunderstandings/
> refinements/gaps. The prompt for this should be delicately written, because we don't want to be
> annoying/patronising/superior, but at the same time the user is earnestly looking to deepen/correct
> their understanding.

Code: [`src/converse.ts`](../../src/converse.ts) § `REMEMBER_SYSTEM`, `systemFor`, `stanceLine` (the
prompt and where each piece of it lands), [`src/chat.ts`](../../src/chat.ts) (`withTurn`,
`withRetry`, `withEdit` — who owns a stance), [`src/routes.ts`](../../src/routes.ts) § `streamChat`
(validation, the 409, `MAX_REMEMBER_CHARS`), [`src/web/ChatPanel.tsx`](../../src/web/ChatPanel.tsx)
(one panel, parameterised by kind),
[`src/web/modes/conversation/ConversationModes.tsx`](../../src/web/modes/conversation/ConversationModes.tsx)
§ `ConversationBand`.
Tests: [`remember-prompt.test.ts`](../../tests/remember-prompt.test.ts),
[`remember-store.test.ts`](../../tests/remember-store.test.ts),
[`remember-route.test.ts`](../../tests/remember-route.test.ts),
[`remember-panel.test.tsx`](../../tests/remember-panel.test.tsx).
Eval: [`evals/remember-stances.ts`](../../evals/remember-stances.ts) — **read this before editing
the prompt.**
The plan, the reasoning and the cross-family review:
[260827ah-review-mode.md](../plans/260827ah-review-mode.md).

```
   CHAT                                 REMEMBER
   ────                                 ────────

   reader ──── question ────►           reader ──── what I think ────►
                                                                       model
   reader ◄─── answer + ────── model    reader ◄─── where to look ─────
               block ids                            + block ids

   the article answers the reader       the reader answers, and finds out
                                        where they were off

   can be used to avoid reading         CANNOT be — there is nothing to
                                        say until you have read it
```

## Why this one is not the anti-goal

[vision.md § Anti-goals](vision.md#anti-goals) names *"a chatbot with the article stuffed in the
context window"*, and [260826a-chat-mode.md § Say the awkward thing
first](../plans/260826a-chat-mode.md#say-the-awkward-thing-first) is a long apology for building one anyway.
Remember needs no such apology, and the reason is structural rather than a promise: **the reader has to
have read the piece before they can use it at all.** There is nothing to say otherwise, and the
output is a set of paragraphs to go back to. vision.md's *recall* entry is the nearest thing already
written down; this is that idea with the direction reversed, the reader supplying the answer first.

## The four stances

The reader picks one per turn, from a `<select>` under the box.

| Stance | What the reply is |
|---|---|
| **Balanced** (default) | The model decides, per point, whether to tell or to ask. Always gives the ids |
| **Respond** | Direct: what comes apart, what the article says instead, quoted and cited |
| **Socratic** | A question with a hint and somewhere to look — unless they ask to be told |
| **Signposts** | Three or four passages worth re-reading, ids and a few words each. Nothing else |

Greg on Balanced, when offered four definitions and declining all of them:

> I don't know. Maybe it should leave it up to the LLM. If the reader is genuinely confused or stuck,
> it should help more. If the confusion is more minor/subtle/manageable, lean more towards Socratic.
> And also include links too as an option if the user prefers those.

So Balanced is **not a blend**; it is per-point triage on his rule — *stuck → tell; nearly there →
ask* — with the block ids given either way. What the cross-family review changed is where the model
is allowed to get "stuck" from: not from reading the reader's mind, but from stated evidence (they
say so, they contradict themselves, they cannot get from one of their own steps to the next). And
when it cannot tell, it **tells**, because a plain answer to somebody who was nearly there costs a
few seconds and a riddle at somebody lost costs the session.

**The reader's own words beat the stance.** Say "just tell me" into a Socratic conversation and you
are told. That is a prompt rule, and it exists because Socratic's escape hatch was otherwise a
promise the code broke — the picker was still on Socratic, so the next turn was another question.

## The prompt is the feature

Everything else here is plumbing around a page of instructions about tone, so
[`evals/remember-stances.ts`](../../evals/remember-stances.ts) came **first** and runs again after every
prompt change: eight readers × four stances against a real article, read by a person. Each of the
eight is a way the prompt has misbehaved rather than a spread of inputs — a reader who is right, one
whose reading the piece genuinely permits, one who understood it and disagrees, one whose dictation
mangled a term, one who says they are lost, one who left half the article out, one asking about
something the piece genuinely leaves open, and one who says only *"just tell me"* into a Socratic
conversation.

The three faults that draft had are worth knowing before editing the prompt, because all three are
the obvious thing to write. They are recorded in full on `REMEMBER_SYSTEM` in
[`src/converse.ts`](../../src/converse.ts); in short:

1. **It treated the model's reading as ground truth.** Socratic makes that worse than Respond does —
   a leading question smuggles in a premise the reader cannot argue with. Hence the long
   *what you are and are not entitled to say* section, which is the one to leave alone.
2. **Balanced asked the model to infer a mental state** from one compressed spoken paragraph.
3. **It forbade grading and then listed the ingredients of a grade.**

A second review, of the built code and the eval's real output, found three more — all of them things
the prompt *said* correctly and the model did not do:

4. **A correction can be built out of the model's own inference.** The sharpest case: the article
   lists analogue and neuromorphic computing as things that "might yet be" up to the job, a reader
   said exactly that, and the model reasoned from a *different* argument to tell them they were
   wrong — contradicting the sentence it had just quoted. So the quoted sentence now has to
   contradict them **by itself**; anything reached by reasoning is offered as the model's own view
   or not at all.
5. **"Their words beat the stance" was contradicted** by Socratic's *"ask, do not tell"* and
   Signposts' *"and nothing else"*, both of which read as absolutes — and the model was visibly
   half-obeying both. There is now an explicit ranking, stated once: **the entitlement rules, then
   the reader's own words, then the stance.**
6. **Confirming and grading were not distinguished.** "Yes, that's his move" points at a claim;
   "that reading holds up well" is a verdict on the reader wearing a friendly face. The first is
   wanted, the second is the sentence to delete.

### What the first run showed

`evals/results/remember-stances.md`, 2026-08-27, Sonnet 5, 28 answers. The cases that were meant to be
hard came out right: the reader who disagreed was engaged with as an interlocutor rather than
corrected; the defensible reading was confirmed and then made more precise; the garbled dictation was
read straight through to its meaning with the mangled words never mentioned; and Balanced **told**
the reader who said they were lost rather than questioning them.

One real gap, and it is fixed: seven of the twenty-eight answers quoted the article and bracketed no
block id — the app's central contract, missed in exactly the place it matters most. One line
(*"every quotation carries the id of the block it came from"*) took that to two.

**The second review read the same transcript and found what the counters could not**, which is the
argument for a person reading it: the invented correction in the `defensible` case, the summative
openers, and a Socratic reply still asking a question of somebody who had said they were lost. The
prompt was revised against all three and re-run: the `defensible` reply now reports where the essay's
*weight* falls rather than asserting the reader is wrong, `lost` is explained in plain words before
anything is asked, and a new `justTellMe` case — a second turn saying only that, into a Socratic
conversation — is answered plainly by all four stances.

It also found two faults in the **eval itself**. It discarded `truncated`, so a reply that hit
`max_tokens` mid-word was reported as an ordinary answer and would have been scored for an ending the
model never wrote; that is now surfaced loudly. And the `ambiguous` case was not ambiguous — the
article settles it in the word "necessary" — so it tested the wrong thing and has been replaced.

The banned-phrase counter in the eval is deliberately over-broad and is **a prompt to look, not a
verdict**: both remaining hits are the phrase applied to a claim rather than to the reader, which is
fine. A green count with a patronising answer under it is the failure
[silent-success.md](../reusable/silent-success.md) is about, so the report prints every answer in
full and the pass condition is a person reading them.

## A Remember conversation IS a chat thread

Greg's own reading — *"this is effectively a Chat"* — taken literally, which is where nearly all of
the reuse comes from. Same table, same store, same streaming route, same citation contract, same
tools, same stop / retry / edit / recovery. Untouched: `converse`'s loop, the tool loop,
`openRouterStream`, the frame protocol, `useChat`'s optimistic rows and stream recovery,
`citations.ts`, `Turn`, `Answer`, `ToolStrip`, the sweep, `inTurnOrder`.

Two fields were added, and both are the kind that goes wrong quietly.

### `kind` belongs to the thread

`ChatThread.kind` is **required**, not optional — an optional field means a `?? "chat"` at every read
site and one of them would eventually be missed, which is a Remember turn answered with chat's prompt
and nothing on screen disagreeing. Stored threads that predate the field are normalised to `"chat"` once
on load, in each store (`normaliseKind` in [`src/chat.ts`](../../src/chat.ts), and `threadsFor` in
[`src/store/pg-chat.ts`](../../src/store/pg-chat.ts)). Making it required is what turned this from a
question of discipline into four compiler errors.

- **The prompt is chosen from `begun.thread.kind`**, never from the request body. Those agree only
  when the request was right, and it comes from a tab that may be several navigations out of date.
- **Written on insert only** — absent from `upsertThread`'s `onConflictDoUpdate.set`, beside
  `created_at` and the anchor columns.
- **A contradicting kind is refused**, in two places: the route answers 409 with a sentence a person
  can act on, and `withTurn` refuses it again inside the Postgres transaction, because the route
  reads under `inTurnOrder` and that is only per-process.
- **Retry and edit send no kind at all** — their thread already has one, and the route 400s one that
  arrives. That refusal happens *before* `settleThread`, because a request rejected after it has
  already aborted the answer another tab's reader was watching.
- **A Remember thread cannot be anchored.** No gesture starts one from a selection, so an anchor
  with `kind: "remember"` is a 400. That is worth more than tidiness: it means every mark in the prose
  belongs to a chat, which is what lets the floating `ChatDialog` go on being chat's.
- **A stance on a chat is refused**, because the check constraint can only say "assistant rows
  only" and the invariant is "Remember threads only". An invariant the database cannot express is one
  the route has to.
- **The length cap resolves the thread's kind too.** Reading only the request's was a bug: an edit
  sends no kind, so every edit was measured against chat's 4,000 and a 4,001-character Remember
  message could be created and then never rewritten.

### The stance belongs to the turn

`ChatMessage.stance` is written when the **pending** assistant row is created, never on finish.
Otherwise every answer that crashed, errored, was stopped or was swept would have no stance — and a
retry of one would have nothing to inherit.

| Turn | Stance used |
|---|---|
| New question | The reader's picker |
| **Retry** | **The stance stored on the answer being replaced** |
| **Edit** | **The stance stored on the answer being replaced** |

Retry is the one worth stating out loud. "Have another go at that" has to mean another go at the same
question asked the same way; taking the picker's current value instead would silently rewrite the
instruction attached to a stored turn. `withRetry` rebuilds its reply field by field precisely so
that nothing stale leaks through, so the stance is carried across **by name** — the one field that
must cross that line. Edit is sharper still: editing an early question discards later turns whose
stances differed, and the picker at that moment is seeded from the last of them.

**And the client's optimistic rows carry it too**, which the first version did not. Getting the
server right is not enough: the optimistic reply is what the reader looks at while the answer
arrives, and a row that lost its stance there seeded the picker with `balanced` on the next load and
made the *following* turn change voice with nothing on screen saying why. Each answer shows its
stance as a small tag — except `balanced`, which most answers are, because a tag on nearly every row
distinguishes nothing.

## Where each piece lands in the prompt, and why it costs what it does

```
   ┌────────────────────────────────────────────────────────┐
   │  system:  SYSTEM  or  REMEMBER_SYSTEM                  │  ← the KIND
   ├────────────────────────────────────────────────────────┤
   │  user:    the whole article, with block ids            │
   │           ▒▒▒▒▒ cache_control: ephemeral ▒▒▒▒▒         │  ← THE BREAKPOINT
   ├────────────────────────────────────────────────────────┤
   │  assistant: "I've read it. Tell me what you took…"     │
   │  … the last 20 turns …                                 │
   │  user:    position · profile · anchor                  │
   │           Stance for this turn: SOCRATIC.              │  ← the STANCE
   │           what the reader said                         │
   └────────────────────────────────────────────────────────┘
```

Everything above the breakpoint must stay byte-identical for the life of a conversation or the whole
article is written to the cache again every turn — the bug in
[260826h-chat-cache-automatic-breakpoint.md](../postmortems/260826h-chat-cache-automatic-breakpoint.md). So:

- the **stance** goes below it. Switching stance mid-conversation is the *expected* use — ask
  Socratically, get stuck, press Respond — and in the system prompt that gesture would cost a cold
  write of the article every time.
- the **kind** goes above it, because one prompt carrying both sets of rules would ask the model to
  hold two contradictory sets of instructions about tone. One more prompt is one more prefix, paid
  on entering the mode rather than per turn.
- the **canned assistant line** differs by kind and is free, because it sits below the breakpoint.
  "What would you like to know?" is the wrong sentence to put in the mouth of a conversation where
  the reader is the one about to talk.

"Two prefixes, paid once" is the normal path rather than an invariant: a cold first use earns nothing
back unless a second request lands inside the TTL, concurrent cold requests can both write, and a
change of model or tool set makes its own entry. `tests/remember-prompt.test.ts` proves the bytes are
identical and **cannot** prove the provider read them; the eval run above reported
`cacheReadTokens: 25226` against a 25k-token article, which is the half that costs money.

## On screen

The mode band, the eighth value in `MODES`, last in the dock — the order runs outward from the
article's own words to the conversation about it, and Remember is one step further out again as the
only mode whose content comes from the reader.

**The list of conversations is shared.** Greg's call, 2026-08-27: both modes show every thread for
this article, and a Remember thread carries a small `remember` tag. Opening a thread of the other
kind moves `?mode=` and `?thread=` together, in one navigation, or the Back stack gets an entry
pairing chat mode with a Remember thread. Auto-start ("if there are none, start one") counts threads
**of this kind**, or a reader with three chats and no Remember threads would press Remember and be
shown three chats.

The floating `ChatDialog` opens only for a thread whose summary says it **is** a chat — a positive
test. `!== "remember"` was the first version and had its default backwards: an unknown thread (a
stale id, or summaries not yet fetched) came out as a chat, so a Remember URL flashed the chat dialog
on every load and a missing thread sat on "Starting…" forever.

**One panel, parameterised by kind, not two panels.** The transcript, the scroll-follow, the citation
chips, the tool strip, the retry, the editor and the stream recovery are identical in both; what
differs is an empty state, a box six rows tall instead of one, and one `<select>`. Likewise one
`ConversationBand` in `modes/conversation/ConversationModes.tsx` with one `useChat`, rather than a
second chat state machine.

The composer's microphone is **the existing** `useDictationField` ([dictation.md](dictation.md)) —
same hook, same two-pass transcription, same priming with this article's glossary — with a label
beside it and first place in the row. Greg:

> the input box should be much larger for Review mode, and probably emphasise the microphone UI,
> because talking will be much less annoying than typing.

Because talking is the expected input, a Remember turn has **its own length limit**
(`MAX_REMEMBER_CHARS`, 20,000) rather than sharing chat's 4,000: that number is a considered cap on a
typed question and an accident applied to a spoken paragraph, and a reader who talked for four
minutes would have hit it after paying for the transcription. Same mistake `MAX_QUOTE_CHARS` had to
be rescued from.

The stance picker is a native `<select>`. The dock already owns a roving-tabindex radiogroup, and a
second one inside a composer — where arrow keys are already the caret's, and the article's ↑/↓ is a
third claimant — is a keyboard problem nobody needs.

## What is deliberately not here

- **No `?stance=`.** It changes nothing on screen, which is the rule [url-state.md](url-state.md)
  keeps. The picker is seeded from the last answer's stance so the choice survives a return to the
  conversation.
- **No no-spoilers rule keyed on `?at=`.** That parameter is where the reader is *now*, not how far
  they have read, and the likeliest reader here has finished the piece and scrolled back to the
  paragraph they want to talk about. Using it as a progress marker would suppress exactly the
  corrections the mode exists for. The prompt honours an *explicit* request instead.
- **No "retry as a different stance".** Retry preserves the stored stance, which is the right
  default; an explicit control can arrive later.
- **No model-written title.** A thread is named from the reader's first 60 characters, which for
  speech will regularly be *"Um, so I suppose what I took from this was…"*. Rename works.

## See also

- [quiz.md](quiz.md) — the band's other half, where the questions come the other way. Not a
  conversation, and deliberately: *"it's just a question then answer"*
- [260826a-chat-mode.md](../plans/260826a-chat-mode.md) — the mode band, the citation contract, the panel this reuses
- [chat-tools.md](chat-tools.md) — the tools, and the rule about never claiming one you did not run
- [dictation.md](dictation.md) — the microphone
- [prompt-caching.md](prompt-caching.md) — the breakpoint this is careful about
- [vision.md](vision.md) — *recall*, the nearest thing already written down
