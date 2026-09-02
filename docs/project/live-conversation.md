# Live conversation

Talking to the article, out loud, in the middle of a chat. Press **Live** in the composer and the
reader is in a spoken conversation with a companion that has the whole piece in front of it; press
Send, or Live again, and they are back to typing in the same thread.

> Now let's try and incorporate this into Chat mode as a separate button. I guess the idea is that I
> want to be able to switch into/out of Live mode, e.g. live conversation for a bit, then
> type/dictate for a while perhaps, then have a live conversation, then back to typing, etc etc.
>
> We'll want to add Live conversation in other places too later.
>
> — Greg, 2026-08-31

**One conversation with two input methods**, not two features sharing a panel. A spoken exchange is
stored as an ordinary pair of chat rows, so the typed turn after it can see what was said and the
reader can read the whole thing back a week later. That is the requirement everything below serves.

## Where the pieces are

| | |
| --- | --- |
| [`src/live.ts`](../../src/live.ts) | The server half: what the model is told, what it may call, what the transcriber is primed with. The **only** file that touches `OPENAI_API_KEY`. |
| [`src/web/live/useLiveConversation.ts`](../../src/web/live/useLiveConversation.ts) | The browser half: the peer connection, the data channel, and the three orderings named below. |
| [`src/web/live/exchanges.ts`](../../src/web/live/exchanges.ts) | Turns a stream of events into conversation turns. Read its header before touching anything about ordering. |
| [`src/web/live/wiring.ts`](../../src/web/live/wiring.ts) | The two requests a session makes of our own server *before* it has anything to write, behind one seam. |
| [`src/web/live/mic-placement.ts`](../../src/web/live/mic-placement.ts) | Where the microphone is, which is what noise reduction wants to know. |
| [`src/web/live/LiveButton.tsx`](../../src/web/live/LiveButton.tsx) | The button and the one control beside it. |
| [`src/chat.ts`](../../src/chat.ts) `withSpokenTurn` | The write: both rows, both `done`, one transaction. |

The plans are [live-conversation.md](../plans/260831g-live-conversation.md) — the wire, proven first as a
spike — and [260831l-live-conversation-in-chat.md](../plans/260831l-live-conversation-in-chat.md), which is where it
became a turn in a conversation. GPT Sol refused the first version of the second one; the design
that shipped is the one it recommended instead.

## The audio never touches our server

The browser opens a `RTCPeerConnection` straight to OpenAI with a short-lived `ek_…` token our
server minted. That is not a shortcut, it is the only shape available: relayed audio needs a
long-lived socket and a Vercel function does not have one.

Our server sees six requests and none of them carries audio: `POST /api/chat/:slug/:threadId/live`
for a ticket, `POST /api/chat/:slug/live-tool` to run a tool the model called,
`POST /api/chat/:slug/:threadId/spoken` once per finished exchange, and the three accounting
endpoints under `/api/live/:sessionId/` below.

**This is the one exception to "every paid call goes through OpenRouter"**
([ai-gateway.md](ai-gateway.md)), because OpenRouter has no realtime API at all. Two consequences
follow and both are written down rather than hoped about:

- **The meter is half built**, and until the other half lands nothing is metered — see § The meter
  below, which is where that gap now lives.
- **Nothing is capped on the server.** The browser ends its own session after five minutes of quiet
  or twenty in total — see § What is not built — which is a clock a tab can be wrong about. A
  per-reader ceiling this server could enforce does not exist.

## The meter

> we'll just use the browser to report itself for now (documenting this as untrustworthy, but good
> enough for an Alpha version)
>
> — Greg, 2026-08-31

The design is [realtime-voice-cost-tracking.md](../plans/realtime-voice-cost-tracking.md), and the
job that builds it is
[260902g-cost-tracking-that-can-set-a-price.md](../plans/260902g-cost-tracking-that-can-set-a-price.md).
**"Untrustworthy" is the wrong word for the risk.** Nobody has an incentive to under-report their
own token count — [security-map.md](security-map.md) says plainly that a signed-in reader is not one
of the untrusted parties, and there is no per-reader cap to duck under. What will actually happen is
that **the tab closes**, and a report that fires once at the end never fires at all. So the design
is not "trust the client"; it is *make the untrustworthy thing as small as possible*.

**The server half is built** (2026-09-02, Stage 2A).

| | |
| --- | --- |
| `spideryarn.realtime_sessions` | One row per **issued** session, written when the client secret is minted and *before* the token reaches the browser. If the insert fails the token is never released. |
| `POST /api/live/:sessionId/connected` | The data channel opened. A minted token is not a conversation — a reader can press the button and change their mind — so "issued" and "connected" are separate facts. |
| `POST /api/live/:sessionId/usage` | One paid event. The server prices it; the browser never sends a cost. |
| `POST /api/live/:sessionId/close` | The conversation ended, best-effort. A closed laptop says nothing, so a session with no `closed_at` is ordinary and **must not** be read as one still running. |
| `acceptRealtimeUsage` in [`src/live.ts`](../../src/live.ts) | Parse, validate, price, project — pure, and tested without HTTP in [`tests/realtime-usage.test.ts`](../../tests/realtime-usage.test.ts). |

Four decisions in it are worth knowing before touching any of them:

- **"Not expired" is the server's twenty-minute session limit plus tolerance, never the ephemeral
  client secret's expiry.** Those are different clocks — the token admits one connection and lasts
  about ten minutes — and using the wrong one silently drops the reports from the longest, and so
  the most expensive, conversations. The deadline is stored on the session row, so a session keeps
  the rule it was issued under.
- **The usage report is a discriminated union: token detail *or* seconds.** `gpt-live-transcribe` is
  billed per audio **minute**, so a token-only shape could not price half the feature.
- **The row keeps the modality splits**, not just the totals. Audio in is $32/Mtok against $4 for
  text and audio out $64 against $24, so a row with only totals can be priced once and never
  repriced or audited. [sql.md](sql.md): columns, not JSON.
- **No cumulative tokens-per-minute ceiling.** Realtime rebills the whole conversation context every
  turn, so cumulative input legitimately outgrows wall-clock — a rate ceiling would start refusing
  true reports exactly as a conversation got long.

**The browser half is not built** (Stage 2B), so every session currently shows as *issued, reported
nothing*. That is the honest state and it is the whole reason the session row exists: without it a
conversation that reported nothing would be an absence rather than a gap, and a total that was short
by an unknown amount would look healthy. `npm run cost` still names live conversation as unmetered
spend by name every run — [`src/spend-declarations.ts`](../../src/spend-declarations.ts)
`UNMETERED_SPEND` — and that line comes out with Stage 2B, not before.

**Accepted loss, permanently:** the final turn can vanish on a crash or an instant tab close, so the
aggregate is biased low by a probably-small unknown. GPT Sol: *"Add the durable outbox before usage
affects an allowance, an invoice, or a promise made to users."*

## The three orderings, and why each is a rule

Every one of these fails **silently**: no error, nothing in a console, a transcript that is merely
wrong. That is why each has a test that has been watched to fail.

**1. The transcription of what you said arrives after the answer to it.** Not an edge case — the
ordinary case whenever anybody talks over the model. So order comes from OpenAI's own item ids, and
an exchange is written only once everything belonging to it is terminal, and a finished turn waits
behind an unfinished one. Anything keyed on arrival order stores an answer with no question, or two
questions in the wrong order. [`exchanges.ts`](../../src/web/live/exchanges.ts).

**2. The microphone stays off until the session has been told the history.** The track is created
disabled and enabled only once every seed item has come back *and* the conversation's tail is still
what the ticket said. A session that hears before it has been seeded answers the first question with
amnesia about the last five minutes.

The barrier counts **distinct item ids, not events**, and it keeps them for the whole session. Two
reasons, and the second is the one that bites: the API has two spellings for the acknowledgement
(`conversation.item.created` and `conversation.item.added`) and this hook handles both, because the
spelling has moved once already — so a session that sent both would lift a counted barrier at half
the seeds. The surplus events would then reach the ledger, where a **seeded user item is
indistinguishable from a turn the reader has just taken** and its transcription is never coming; and
because a finished turn waits behind an unfinished one, every exchange of that session would become
silently unwritable. If the acknowledgements never arrive at all the session **fails with a
sentence** rather than opening the microphone anyway, because a barrier that never lifts is a
microphone that never opens and the alternative is the amnesia it exists to prevent.

**3. Hanging up gives the device back first and the words second.** Stop stops the track and
resolves the microphone lock's `released` at once — the next claimant is a dictation button somebody
just pressed — and *then* holds the channel open for a moment, because the last sentence's
transcription is still coming. Closing at once keeps the answer and loses the question.

The window ends early when nothing is outstanding, and "outstanding" is two things rather than one:
an unfinished turn in the ledger, **and a sentence the reader is part way through saying**. Between
the voice detector opening and the conversation item being created, the ledger has nothing pending
and the words exist only in the audio going up — so a window watching the ledger alone ended
instantly on exactly the press that most needed it.

### And nothing the model produced is attributed by "the newest turn"

Transcript, tool receipts and passage pointers are filed by **response id** and **call id**, because
the reader can interrupt — which creates a new turn while the previous answer's own words are still
arriving. Attributed by "current", R1's answer lands on U2: the first turn is stored with a question
and no answer, the second with an answer to something nobody asked.

This was wrong for a day and every test in `live-exchanges.test.ts` agreed with it, because the one
covering this ordering delivered R1's transcript *before* U2 was created — the single order in which
the bug does not show. GPT Sol found both, reviewing the built code.

## The write, and the one guard that is also the idempotency

A finished exchange goes through `speak` on [`useChat`](../../src/web/useChat.ts), which is an
operation in the chat controller — an id, a projection it alone may update, a 409 that repairs. Not
a second writer beside it: `src/web/chat/` holds one invariant and a POST outside it is that
invariant quietly ending.

When the write comes back, the server's copy of the conversation is laid **under** what this tab
already had rather than over it — the rule `repair.succeeded` follows — so an optimistic row from a
send in flight survives, and the stored title is taken only when this write is what named the
conversation and the reader has not renamed it in the meantime. One modality at a time should make
that overlap impossible; "should" is the word this repo keeps having to retract, and merging costs
one `Set`.

`expectedTailId` is **required**, where the same guard on `/cancel` is optional. There it is a safety
net over a destructive operation; here it is the only thing between a replayed request and a
duplicated turn, so a caller with no opinion must not be able to skip it by omission. It may be
`null`, meaning "I believe this conversation is empty", which is what a reader pressing Live before
typing anything actually claims.

**There is deliberately no exchange-id column.** A POST retried after succeeding presents a tail the
first attempt has already moved, so it conflicts rather than appending twice — which is also what
makes the retry in `effects.appendSpoken` safe. Two different exchanges racing get ordered and the
loser looks again.

Appends are therefore **serial**: exchange two claims exchange one's *stored* answer id, which does
not exist until exchange one has landed. And an append that fails stops the ones queued behind it —
a second exchange stored with the first missing is worse than losing both, because nothing about it
looks wrong.

**The guarantee is Postgres's, not the filesystem's.** On Postgres the article row lock serialises
the read, the tail check and the insert inside one transaction, so two tabs and a replayed request
are both safe. The filesystem store is safe within one process, under its mutex. **Two processes
sharing `data/` are not**: both read the same tail, both pass the check, both write a whole
snapshot, and the last rename wins with no 409 anywhere. That is the filesystem store's standing
limitation rather than this feature's, and it is named here because the sentence above would
otherwise read as a promise it cannot keep.

## What a spoken row carries that a typed one does not

- **`passages`** — what the answer pointed at. A spoken answer never cites in its text, because it
  is forbidden to say `spya-k3m9qt` aloud and is given `show_passage` instead. Without a stored
  field these would be uncited claims, which is what the chat contract exists to prevent.
- **`interrupted`** — the reader talked over it. Not `stopped`: that means "what is stored is what
  they read", and this means the opposite — the server truncated the audio and kept the transcript
  whole, so the text may run *past* what was heard. It is kept out of `recentHistory`
  ([`src/converse.ts`](../../src/converse.ts)) so unheard words are never fed silently into the next
  typed turn.
- **`model`** — set server-side to `LIVE_MODEL`, never taken from the browser. It is what lets the
  citation instruments tell a spoken answer from a typed one that happened to cite nothing.

## Three things that are not obvious and cost an afternoon each

**`keywords` cannot be verified by reading the session back.** It is accepted with a 200 and does not
appear in `session.created`, while `prompt` and `languages` in the same object do. Every instinct in
this repo says that is a field being ignored. It is not: `evals/live/jargon-recovery.mts` speaks a
sentence containing `spya-k3m9qt` and gets it back spelled exactly with `keywords`, and *"Spia K
three M nine Q T"* with the same list in `prompt`. The rare case where the behaviour is trustworthy
and the introspection is not.

**Seeding a voice model with typed history is a trap.** Written chat cites by putting
`[spya-k3m9qt]` in the answer, so seeding verbatim hands the model examples of its own past speech
containing block ids while its instructions forbid saying one aloud. The symptom is a companion that
starts spelling ids out with no apparent cause. `liveSeedItems` strips them, on the assistant side
only — the reader's words are theirs. Found by Fable, 2026-08-31.

**The reported hallucination was a prompt-regurgitation bug, and the obvious fix was a regression.**
The transcriber invented the whole vocabulary list during a pause with background noise. Switching
model alone fixed that and dropped jargon recovery from 4/4 to 2/4, because `gpt-live-transcribe`
ignores `prompt`. Only building the second eval caught it. Both live in [`evals/live/`](../../evals/live/).

## The lifecycle, which is the most failure-prone part

Every one of these is a session that would otherwise go on listening with nothing on the page able
to end it. The default on any doubt is: close, hand the microphone back, let the repair reload the
thread, and start a fresh seeded session if the reader wants one.

| | |
| --- | --- |
| **Send** | Ends the session and **waits** for the flush, then uses the typed path. |
| **Thread switch** | Ends it. A session is seeded from one conversation and appends to it. |
| **Leaving chat mode, or the article** | Ends it — the hook is owned by `ConversationBand`, above the keyed panel, for exactly this. |
| **`pagehide`** | Ends it. Not `visibilitychange`: a reader looking at another tab while talking is having a conversation, not abandoning one. |
| **A dead connection** | `failed` or `closed` ends it. `disconnected` does not — it is transient and recovers, and hanging up on a two-second blip is worse than the blip. |
| **The data channel closing** | Ends it. The far end hung up. |
| **An append refused or lost** | Ends it, and stops the ones queued behind it. No later tail can be vouched for. |
| **An edit, a retry or a delete in the same thread** | Not intercepted, and deliberately: the next spoken append claims a tail that has moved, gets a 409, and *that* ends the session and reloads the conversation. One mechanism instead of three, and it is the one that also covers a second tab. The cost is that the model is briefly seeded with a history that has changed under it, for the length of one answer. |
| **Leaving mid-connect** | A session epoch is bumped by every start and every stop and checked after every `await`, so an abandoned `start` never opens a connection or claims a microphone. Without it the cleanup found nothing to tear down and the abandoned attempt carried on. |

## What is not built

- **The browser does not report its usage yet**, so no spend appears in `npm run cost` — § The meter
  above has the whole of it, and what is left is Stage 2B. Greg accepted the gap on 2026-08-31 —
  *"let's accept it for now"* — and it is printed by name on every run until then. A session's spend
  is meanwhile visible only in OpenAI's own dashboard.

  The **cap** is built, because it is the half that costs money rather than visibility: a session
  ends itself after five minutes of quiet or twenty minutes in total, so a forgotten tab bills
  minutes rather than the hour OpenAI would allow. Only the reader's own voice resets the idle
  clock — a session that kept itself alive by answering its own last question would be exactly the
  case the cap is for.
- **Live conversation anywhere but chat.** Greg's "other places too later": the comment dialog and
  Remember's composer. Chat was done first because it is the hardest — the only surface with a
  thread to keep in step.

## See also

[dictation.md](dictation.md) (the other way of talking to it) ·
[chat-tools.md](chat-tools.md) (what the model may call) ·
[ai-gateway.md](ai-gateway.md) (why this is the one exception) ·
[comments.md](comments.md) · [reading-view-overview.md](reading-view-overview.md)
