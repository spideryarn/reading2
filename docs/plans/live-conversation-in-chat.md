# Live conversation inside chat mode

**Status: reviewed and rewritten, 2026-08-31. Not built.** GPT Sol reviewed the first version and
returned **BLOCKED** — [the review](live-conversation-in-chat-review-sol.md), nine findings, three
critical. It was right about all three, and about a comment in shipped code that was simply false.
The design below is the one it recommended instead: **turn-boundary switching**, which is both safer
and smaller than what I first proposed.

The wire is built and proven — see [live-conversation.md](live-conversation.md). This is about
putting it in the chat panel, beside the microphone, so a reader can talk for a while and then type
for a while in the same conversation.

> Now let's try and incorporate this into Chat mode as a separate button. I guess the idea is that I
> want to be able to switch into/out of Live mode, e.g. live conversation for a bit, then
> type/dictate for a while perhaps, then have a live conversation, then back to typing, etc etc.
>
> We'll want to add Live conversation in other places too later.
>
> — Greg, 2026-08-31

## What that sentence actually demands

Read literally it is a button. Read properly it is **one conversation with two input methods**, and
that is a much stronger requirement than a mode toggle, because it forces three things:

1. **Spoken turns must land in the thread**, or the typed turn that follows has no idea what was
   just said out loud.
2. **The live session must start already knowing the thread**, or the reader hangs up, types a
   follow-up, comes back, and is talking to something with amnesia about the last five minutes.
3. **Both halves must agree about what a turn is.** The typed path is `beginTurn` → stream →
   `finishTurn` ([`src/chat.ts`](../../src/chat.ts)). The spoken path has to *assemble* an exchange
   out of events that do not arrive in conversation order — which is harder than it looks, and is
   the first thing the review took apart.

Anything less and it is two features sharing a panel.

## What the first version got wrong

Worth keeping, because two of these are mistakes anybody would make from the spike.

**"The spoken path has both halves of the exchange in hand before it writes anything."** It does not.
A committed user item, its *later* transcription, one or more responses, tool calls and continuation
responses, and truncation events are all separate asynchronous events — and a tool-using answer spans
several responses. Question 1's transcription can land after response 1 and after question 2 has
started. Anything written in arrival order can persist an answer with no question, or two questions
in the wrong order.

**Typing during a live session is not a free extra.** If the composer also runs its normal `onSend`,
two models answer and two paths write. If it only injects into the session, the operation model is
bypassed. And the spike has *already seen* the collision: `response.create` while a response is
active returns "Conversation already has an active response in progress".

**`beginTurn` + `finishTurn` is the wrong write shape**, and not only on taste. The Postgres store's
`finish` refuses without the attempt token that `begin` returned
([`src/store/pg-chat.ts:354`](../../src/store/pg-chat.ts)) — verified — so the pair is not a
free-function call away. Two transactions and a temporary `pending` row buy nothing when both halves
are already known, and a crash between them leaves a false unfinished answer.

## The shape

```
   ┌─ ChatPanel ─────────────────────────────────────────┐
   │  thread: the same ChatThread either way             │
   │                                                     │
   │  typed:   composer → runTurn → SSE → reduce         │
   │  spoken:  live session → exchange ledger ───────────┼──▶ appendCompletedTurn
   │             (ordered by item id, not by arrival)     │      (ONE transaction, both rows)
   │                                                     │
   │  Send while live: end gracefully, flush, then typed  │
   │  composer:  [ textarea ] [send] [mic] [◉ Live]      │
   └─────────────────────────────────────────────────────┘
```

### 0. An exchange ledger, before any of this

Keyed by OpenAI's own item and response ids, not by arrival. Order comes from the item lifecycle;
an exchange is persisted only once its user transcription **and** its whole response/tool chain are
terminal; completed exchanges commit serially in conversation order. The hook today accumulates
global `lines`, `tools` and `pointers` with nothing associating them to an exchange, so it cannot
produce a safe `{ question, answer, tools, pointers }` at all. **This is the piece to build first**,
and nothing downstream is safe without it.

### 1. `POST /api/chat/:slug/:threadId/spoken`, and an atomic append

Body `{ exchangeId, expectedTail, question, answer, pointers?, tools?, interrupted? }`.

A new store operation, `appendCompletedTurn`, doing all of it in **one** transaction: check
ownership, check the expected tail, de-duplicate on `exchangeId`, insert both `done` rows at
adjacent ordinals, return the canonical rows. Not `beginTurn` + `finishTurn` — see above.

`exchangeId` and `expectedTail` are not belt-and-braces. Without the first, a retried POST appends
the exchange twice; without the second, a live session can append a turn after an edit has truncated
the history that turn was answering.

**It must be an operation in the existing controller**, with a client id, canonical server rows, 409
repair and session-epoch fencing, not a second writer beside it. `src/web/chat/` holds one invariant
— every asynchronous action has an identity and exclusive permission to update a projection — and a
spoken POST outside it is that invariant quietly ending.

### 1b. Pointers need somewhere to live

`ChatMessage` has no field for them. `citations` are web citations. A typed answer carries block ids
in its text and [`Cited.tsx`](../../src/web/Cited.tsx) makes them pressable; a spoken answer
deliberately has none, because `show_passage` carries them instead.

So persisting only the transcript produces **uncited assistant claims** — precisely the failure the
chat contract exists to prevent. A stored `passages` field, rendered as block references, is the
minimum. "No different row shape" was untenable.

### 1c. Interrupted answers are not `stopped` answers

`stopped` means *the reader had read enough and the stored text is what they read*, and that text is
kept as model history. Here the stored transcript may contain words **never heard** — the server
truncates the unplayed audio but does not hand back a corrected transcript.

So a distinct `interrupted` state: keep the transcript for the human to look at, label it as
possibly longer than what was heard, and keep it out of `recentHistory` (or reduce it to an
interruption marker). Feeding unheard words silently into the next typed turn is the one outcome to
refuse.

### 2. Seeding the session with the thread

The realtime session is created with `instructions` (article + rules) and then the **conversation**
is seeded over the data channel with `conversation.item.create` per prior message, before the first
response. Not in `instructions`: the article there is byte-stable per article, and appending the
history to it would mean a different instructions blob per turn, which throws away the session
cache — and cached text input is a tenth the price of uncached.

`recentHistory` already exists in [`src/converse.ts`](../../src/converse.ts) and caps at
`HISTORY_TURNS`. Reuse it rather than inventing a second window.

### 3. The microphone lock

**This is the part most likely to be got wrong, and it is not optional.**
[`mic-lock.ts`](../../src/web/mic-lock.ts) exists because two hooks on one page each opened a
capture, and WebKit supports one microphone source at a time. A live session that takes
`getUserMedia` without claiming the lock is a third claimant that the other two cannot see.

So `useLiveConversation` must `claimMicrophone({ stop, released })` before `getUserMedia` and
`releaseMicrophone` on hang-up — meaning pressing the dictation mic mid-conversation politely ends
the live session rather than fighting it, which is also the right behaviour for a reader.

### 4. Where the button goes, and what Send does

Beside `DictationButton` in the composer. Three states: idle, connecting, live.

**One modality at a time, and Send is the switch.** The composer may hold a draft while live —
typing is fine — but pressing Send *gracefully ends the live session, flushes its exchanges, and
then uses the proven typed path*. There is one response scheduler because there is only ever one
speaker.

That is Greg's sequence exactly — "live for a bit, then type/dictate, then live again" — and it
costs only the thing nobody asked for: talking and typing *simultaneously*.

### 5. Who owns the connection

Not the keyed `ChatPanel`, which remounts on every thread switch. A stable article-level controller
that the UI subscribes to, with each session bound immutably to `{ slug, threadId, sessionEpoch }`
so events from a dead session can never write. Thread switch, edit, delete, leaving chat mode,
unmount, `pagehide`, a hidden tab, sleep/wake, a failed ICE — each has a defined behaviour, and the
default on any doubt is: close, release the microphone, reload the thread, start a fresh seeded
session. Never resume an old one.

### 6. The seeding barrier

"Sent before the first response" does not prove "accepted before VAD created one". The microphone
track stays **disabled** until the data channel is open, every seed item is acknowledged, the seed
snapshot's tail still matches the thread, and the controller has entered `live`.

## What I would get wrong without a review

Written down because these are the decisions I am least sure of, and a plan review is cheaper than
finding out.

- **Whether a turn is written per exchange or per session.** Per exchange means the thread is
  correct if the tab dies mid-conversation, and means N round trips. Per session means one write
  and a total loss on a crash. I lean per exchange.
- **What counts as an exchange** when the reader interrupts. Barge-in truncates the assistant's
  audio, so the stored answer is longer than what was heard. The `chat.ts` `stopped` flag is the
  existing vocabulary for "this answer is short on purpose", but here the row would be *longer* than
  the truth.
- **Ordering.** Transcripts arrive out of order relative to speech: the user's `…transcription.completed`
  can land after the assistant has started replying. Writing on arrival could interleave turns
  wrongly.
- **Two panels, one session.** The dock can be reopened; `ChatPanel` is keyed by thread id and
  remounts. A live session surviving a remount is a connection nothing owns.
- **Cost.** Nothing caps a session, and this puts it one click from every reader.

## What is deliberately not in this plan

Adding live conversation to the comment dialog or the review composer — Greg's "other places too
later". The point of doing chat first is that it is the hardest one: it is the only surface with a
thread to keep in step.

## See also

[live-conversation.md](live-conversation.md) · [dictation.md](../project/dictation.md) ·
[chat-tools.md](../project/chat-tools.md) · [comments.md](../project/comments.md)
