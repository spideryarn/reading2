# Review: live conversation inside chat mode

You are reviewing a **plan**, before it is built, for Spideryarn — an AI-assisted reading app whose
stated purpose is to *augment* reading rather than replace it. Be adversarial. I want the things
that will bite, not encouragement.

## Context you need

**What already exists and is proven working** (committed, browser-tested):

- Live voice conversation with OpenAI's Realtime API (`gpt-realtime-2.1`), WebRTC straight from the
  browser to OpenAI. Our server only mints a short-lived `ek_…` client secret and runs tools. The
  audio never touches our server, and cannot: we deploy on Vercel serverless, which has no
  long-lived socket.
- The session is created with the whole article in `instructions`, eight tools (the seven existing
  chat tools plus a new `show_passage` that highlights blocks while the model talks), and the
  reader's jargon vocabulary as `keywords`.
- It runs on a throwaway preview page today. Nothing is in the real app.

**The existing typed chat**, which this must merge with:

- `ChatThread { id, kind, title, messages: ChatMessage[] }`,
  `ChatMessage { id, role, text, createdAt, status: "pending"|"done"|"error", tools?, citations?, stopped?, ... }`
- Server: `beginTurn(slug, turn)` appends a user row plus a `pending` assistant row and returns
  both; the route then streams `converse()` and calls
  `finishTurn(slug, threadId, messageId, patch)` to write over the pending row. `finishTurn` never
  appends — the row is already there.
- Client: an operation-model state machine in `src/web/chat/` (controller/effects/model/reduce).
  Every async thing chat does is an operation with an id, admitted or refused at one gate. It is
  ~150KB of carefully-reasoned code with a documented history of races.
- `ChatPanel` is keyed by thread id and remounts when the reader switches conversation.
- `mic-lock.ts` enforces one microphone per page: a second claimant asks the current holder to stop
  *properly* (keeping its words) and waits for `released` before touching `getUserMedia`. It exists
  because WebKit supports one microphone source at a time and two hooks on `/profile` each opened a
  capture.

**Known unclosed holes in the live feature** (accepted by the user for now): no metering at all —
`npm run cost` is structurally blind to it because the spend happens on a wire our server never
sees; no session cap; a forgotten tab bills audio indefinitely.

## The plan to review

```markdown
# Live conversation inside chat mode

**Status: a plan, 2026-08-31.** The wire is built and proven — see
[live-conversation.md](live-conversation.md). This is about putting it in the chat panel, beside the
microphone, so a reader can talk for a while and then type for a while in the same conversation.

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
   `finishTurn` ([`src/chat.ts`](../../src/chat.ts)). The spoken path has both halves of the
   exchange in hand before it writes anything.

Anything less and it is two features sharing a panel.

## The shape

```
   ┌─ ChatPanel ─────────────────────────────────────────┐
   │  thread: the same ChatThread either way             │
   │                                                     │
   │  typed:   composer → runTurn → SSE → reduce         │
   │  spoken:  useLiveConversation → POST spoken turn ───┼──▶ beginTurn + finishTurn
   │                                                     │      (one write, both halves known)
   │  composer:  [ textarea ] [send] [mic] [◉ Live]      │
   └─────────────────────────────────────────────────────┘
```

### 1. `POST /api/chat/:slug/:threadId/spoken`

Body `{ question, answer, tools?, pointers? }`. Calls `beginTurn` then `finishTurn` — the same two
functions the streaming path uses, so a spoken turn is not a new kind of row, it is an ordinary turn
that happened to arrive complete.

**Not a new message type, and not a `spoken: true` flag on the row.** The transcript *is* the
message. A flag would have to be honoured by the renderer, the retry path, the edit path and the
prompt builder, and the answer in every case is "treat it exactly like the typed one".

The one thing that may deserve a flag is display — a rough spoken transcript reading as though the
reader typed it is slightly dishonest. Open question below.

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

### 4. Where the button goes

Beside `DictationButton` in the composer. Three states: idle, connecting, live. While live, the
composer stays usable — typing does not end the conversation, and a typed turn during a live session
goes in as `conversation.item.create` + `response.create`, which is exactly what `say()` already
does on the spike page.

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

```

## What I want from you

1. **The race conditions.** Transcripts arrive asynchronously and out of order relative to the
   speech. Where does writing spoken turns into a shared thread go wrong? Be specific about
   interleaving, and about what happens when a typed turn and a spoken turn overlap.
2. **Whether the write shape is right** — `beginTurn` + `finishTurn` for an exchange whose halves
   are both already known, versus something else. Note `finishTurn` is documented as "never
   appends".
3. **The mic lock.** Is claiming it from a WebRTC session actually sufficient, given `stop()` is
   specified as "end your dictation the ordinary way, keeping its words"? What does "keeping its
   words" mean for a live conversation, and does the `released` contract hold when the track is
   owned by an `RTCPeerConnection`?
4. **Lifecycle.** `ChatPanel` remounts on thread switch. What owns the peer connection? What happens
   on unmount, navigation, tab backgrounding, sleep/wake?
5. **The barge-in/truncation problem.** The server truncates unplayed audio on interruption, so the
   stored assistant transcript may be longer than what the reader actually heard. What should be
   stored, and does the existing `stopped` flag fit or mislead?
6. **Anything that makes this feature actively worse than the spike**, or that I should refuse to
   build until metering and a session cap exist.
7. **Cheaper alternatives to the whole design** that I have not considered.

Please rank findings by severity and say plainly which are blocking. If a section of the plan is
fine, say so briefly rather than padding. Quote the plan where you disagree with it.
