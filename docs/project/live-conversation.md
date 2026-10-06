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

> I should be able to use that button to start a new conversation, or resume an existing one, and when I hang up I should be able to resume or switch to typing/dictation.
>
> — Greg, 2026-09-06

## The controls must say what is happening

The Live button starts a conversation from Chat's list or carries on the open thread out loud. **Its
label is Live either way, never "Resume"**: beside a thread that had only been typed in, "Resume"
read as picking up a call the reader had never made (Greg, 2026-09-12, SPIDERYARN-READING2-3G). The
difference is in its accessible name and tooltip — "Continue this conversation live" or "Start a
live conversation" —
[260912d](../plans/260912d-live-button-label-says-resume-on-a-thread-with-no-live-history.md). Its
tooltip explains two-way speech. Connecting can be cancelled. Hang up releases the microphone and
saves the final exchange before the typed path continues.

> I click the live button, and then nothing seemed to be happening for a minute, and I couldn't tell
> if it was connecting or if it was listening to me or recording. … it was sort of showing the words
> streaming in, but in one place, but then they'd show up in the chat in another place. I mean,
> could those not be the same place …
>
> — Greg, 2026-09-29 (`spya-f4eq7p`; [261002j](../plans/261002j-live-voice-chat-cleanup.md))

So since 2026-10-03 **one state pill says what the session is doing** — Connecting, Listening,
Thinking, Speaking, Saving, Stopped or Error — and while connecting, **which step it is on**
(ticket, microphone, transport, loading this conversation). **The words appear once, in the
thread**: `LiveTail` renders the unsaved exchanges after the saved turns, grouped by the ledger's
exchange rather than by arrival (ordering rule 1 applies to the screen too), and an exchange leaves
the tail in the same commit as `speak` installs its rows — so there is never zero copies or two. A
failure is a red Error state with its sentence and **Try again**. Everything else — the microphone
device, noise reduction, Reconnect — is under a closed **Advanced** disclosure; Reconnect is also
offered beside a stall notice, where it is the answer, and **Cancel reconnect** stays visible
during a reconnect's teardown because Live is disabled while closing. There is no dictation or
"continue typing" button in the panel: the composer's own are beside it.

The microphone is the same remembered input dictation uses, named from the acquired track. **The
level meter reads an enabled clone of that track** (`track.clone()` — the same capture, no second
permission), so it moves from the moment the microphone opens, while the original is still held
disabled behind the seeding barrier (ordering rule 2): a disabled track is silence to every
consumer, the meter included. The clone is stopped on every teardown. **Auto, Headphones and
Laptop mic describe noise reduction, not which device to open.** The device picker answers the
other question. Both live in Advanced, which exists only while a session is on screen, so noise
reduction is chosen during a call (changing it saves and reconnects) rather than before one. A
missing saved device falls back with a visible explanation. A quiet meter is an observation, not a
claim that the reader's microphone is broken.

Failures belong in the Chat panel, with a retry. Browser-blocked
playback gets an explicit **Enable sound** action. If a write cannot be confirmed, retain its words
locally when retrying the same conversation, with an honest uncertainty notice. A valid session ticket is not proof that a
microphone opened, a response event is not proof that sound played, and the preview's transcript is
not proof that Chat displayed or stored it. The repair and its evidence are in
[260906f](../plans/260906f-repair-realtime-chat.md).

Keep the existing Live control in an open Recall conversation too; it shares this reading
companion. Recall-specific spoken reply stances are not implemented. The earlier claim below
that this control was not built was stale: `94ddccd42` deliberately labelled it in that composer,
and `028676677` preserved it through the Review-to-Remember rename. New list-level spoken
conversations start in Chat.

**A live conversation started in Recall's empty conversation is stored as a `learn` thread.** Recall
opens straight into a conversation that exists only in the tab, so pressing Live there makes the
first spoken exchange the write that creates it. The spoken append names the kind the tab has for
it (`SpokenTurn.kind` in [`src/chat.ts`](../../src/chat.ts)), used only when creating the thread.
Until 2026-09-30 it always created a Chat, and Remember's arrival rule then hid it behind a fresh
empty conversation — SPIDERYARN-READING2-70,
[260930d](../plans/260930d-a-live-conversation-started-in-remember-is-saved-as-a-remember-conversation.md).

## Where the pieces are

| | |
| --- | --- |
| [`src/live.ts`](../../src/live.ts) | The server half: what the model is told, what it may call, what the transcriber is primed with. The **only** file that touches `OPENAI_API_KEY`. |
| [`src/live-gpt.ts`](../../src/live-gpt.ts) | What a GPT-Live session is told: the two prompts, the outline budget, the seed, the data-channel allowlist. Pure; the request and the key stay in `src/live.ts`. |
| [`src/web/live/useLive.ts`](../../src/web/live/useLive.ts), [`engine.ts`](../../src/web/live/engine.ts) | Which engine a call uses, and the one `LiveApi` the page sees. Both go when an engine is deleted. |
| [`src/web/live/useLiveConversation.ts`](../../src/web/live/useLiveConversation.ts) | Realtime's browser half: the peer connection, the data channel, and the three orderings named below. |
| [`src/web/live/gpt-live/`](../../src/web/live/gpt-live/useGptLive.ts) | GPT-Live's browser half: `useGptLive.ts`, kept thin over three pure reducers — [`segments.ts`](../../src/web/live/gpt-live/segments.ts) (fragments to chat rows), [`delegations.ts`](../../src/web/live/gpt-live/delegations.ts) (the tool loop), [`stall.ts`](../../src/web/live/gpt-live/stall.ts) (is a reply owed) — and [`meter.ts`](../../src/web/live/gpt-live/meter.ts). |
| [`src/web/live/session-shared.ts`](../../src/web/live/session-shared.ts) | The clocks and sentences both hooks use. |
| [`src/web/live/exchanges.ts`](../../src/web/live/exchanges.ts) | Realtime only. Turns a stream of events into conversation turns. Read its header before touching anything about ordering. |
| [`src/web/live/wiring.ts`](../../src/web/live/wiring.ts) | The requests a session makes of our own server *before* it has anything to write, behind one seam. |
| [`src/web/live/mic-placement.ts`](../../src/web/live/mic-placement.ts) | Where the microphone is, which is what noise reduction wants to know. |
| [`src/web/live/LiveButton.tsx`](../../src/web/live/LiveButton.tsx) | The one button: Live, Cancel or Hang up — and, with Experimental on, the engine choice beside it. |
| [`src/web/live/LiveStatus.tsx`](../../src/web/live/LiveStatus.tsx) | The state pill, connecting steps, input level, notices, errors with Try again, and the Advanced disclosure (device, noise reduction, Reconnect). |
| [`src/web/live/LiveTail.tsx`](../../src/web/live/LiveTail.tsx), [`tail.ts`](../../src/web/live/tail.ts) | The unsaved words, in the thread after the saved turns, grouped by exchange. |
| [`src/web/live/stall.ts`](../../src/web/live/stall.ts) | Which stall a live session is in, if any — the pure rules behind the notice and **Reconnect**. |
| [`src/web/live/tap.ts`](../../src/web/live/tap.ts) | `TalkMode`, and the pure rule for what a refused tap-to-talk event leaves behind: the mode, the microphone, whether the turn is forgotten, the sentence. A refusal can arrive late, after Done's commit has gone, and then must not undo that turn. The hook keeps the effects. |
| [`src/web/live/tool-responses.ts`](../../src/web/live/tool-responses.ts) | Realtime only. One continuation after a response's tool results settle; a newer spoken turn supersedes the old continuation. |
| [`src/web/PassageLinks.tsx`](../../src/web/PassageLinks.tsx) | Shared live and saved passage references, using stable block ids. |
| [`src/chat.ts`](../../src/chat.ts) `withSpokenTurn` | The write: both rows, both `done`, one transaction. |

The plans are [live-conversation.md](../plans/260831g-live-conversation.md) — the wire, proven first as a
spike — and [260831l-live-conversation-in-chat.md](../plans/260831l-live-conversation-in-chat.md), which is where it
became a turn in a conversation. GPT Sol refused the first version of the second one; the design
that shipped is the one it recommended instead. The second engine is
[261003a](../plans/261003a-gpt-live-alongside-realtime-for-live-conversation.md).

## Which model, and why not GPT-Live yet

`gpt-realtime-2.1` (`LIVE_MODEL` in [`src/live.ts`](../../src/live.ts)) at **low reasoning
effort**, with a spoken prompt that asks for one or two sentences, no pleasantries, and thinking
only when the question needs it — Greg's "instant mode" and "quick back and forth" (2026-09-29).

OpenAI's newer `gpt-live-1` (GA 2026-09-10) is a different architecture rather than a newer model:
a voice front end that hands thinking and tools to a separate backend model, with a 16k-token cap
on its own instructions (too small for most articles), no turn ids, and per-minute billing. Measured
on 2026-10-02 it was about a quarter of the cost per turn and much quicker on follow-ups, but a real
answer about the article came about two seconds *later*, usually behind "Checking." — and moving to
it rewrites the three orderings below, the meter and the browser handshake. Not now; the numbers
and the four conditions that would change the answer are in
[261002r](../investigations/261002r-gpt-live-spike.md).

**That is the answer for the default engine, and it stands**: a reader who has not switched
Experimental features on gets Realtime and nothing else. The question is re-asked in use rather than
on paper — GPT-Live is built beside it as a second engine, behind that switch:
[§ The second engine](#the-second-engine-gpt-live-behind-experimental).

The same measurement found where today's wait actually is, and it is not reasoning (low effort was
no faster than the default): the model calls `show_passage` before its first word (~1.2 s, and
telling it not to changed nothing), and `semantic_vad` waits up to several seconds after a hesitant
question. Neither is fixed yet.

## The audio never touches our server

The browser opens a `RTCPeerConnection` straight to OpenAI with a short-lived `ek_…` token our
server minted. That is not a shortcut, it is the only shape available: relayed audio needs a
long-lived socket and a Vercel function does not have one. GPT-Live has no such token, so there our
server passes the browser's SDP offer to OpenAI once and hands the answer back; the media still
goes browser to OpenAI.

A call makes six kinds of request to our server and none of them carries audio: one to open it
(`POST /api/chat/:slug/:threadId/live` for a Realtime ticket, or `POST …/live-session` for
GPT-Live's SDP exchange), `POST /api/chat/:slug/live-tool` to run a tool the model called,
`POST /api/chat/:slug/:threadId/spoken` once per finished exchange, and the three accounting
endpoints under `/api/live/:sessionId/` below. Seven routes in all, six per call.

**This is the one exception to "every paid call goes through OpenRouter"**
([ai-gateway.md](ai-gateway.md)), because OpenRouter has no realtime API at all. Two consequences
follow and both are written down rather than hoped about:

- **The meter is browser-reported**, because the numbers exist in the tab and nowhere else — see
  § The meter below.
- **Nothing is capped on the server.** The browser ends its own session after five minutes of quiet
  (two on GPT-Live) or twenty in total — see § What is not built — which is a clock a tab can be wrong about. A
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

**Both halves are built** (2026-09-02, Stages 2A and 2B).

| | |
| --- | --- |
| `spideryarn.realtime_sessions` | One row per **issued** session, written when the client secret is minted and *before* the token reaches the browser. If the insert fails the token is never released. |
| `POST /api/live/:sessionId/connected` | The data channel opened. A minted token is not a conversation — a reader can press the button and change their mind — so "issued" and "connected" are separate facts. |
| `POST /api/live/:sessionId/usage` | One paid event. The server prices it; the browser never sends a cost. |
| `POST /api/live/:sessionId/close` | The conversation ended, best-effort. A closed laptop says nothing, so a session with no `closed_at` is ordinary and **must not** be read as one still running. |
| `acceptRealtimeUsage` in [`src/live.ts`](../../src/live.ts) | Parse, validate, price, project — pure, and tested without HTTP in [`tests/realtime-usage.test.ts`](../../tests/realtime-usage.test.ts). |
| [`src/web/live/meter.ts`](../../src/web/live/meter.ts) | The browser half: what to read off `response.done` and off the completed transcription event, and the queue that posts it. [`tests/live-meter.test.ts`](../../tests/live-meter.test.ts) hands what it builds to the server's own parser, because the seam is the point. |

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
- **A report whose modality splits do not account for its totals is kept and NOT priced.** The
  parse admits a short split, because OpenAI has shipped `response.done` without the nested
  breakdown and refusing the row would throw away the evidence that the turn happened. But the rate
  card is per modality, so pricing such a report multiplies the rates by a split that is short —
  and in the limiting case, every detail zero and both totals real, by a split that is entirely
  zero. GPT Sol produced exactly that (`inputTokens=1000, outputTokens=200`) and got a row claiming
  `$0`. The row now lands `cost_source: 'none'`, which `npm run cost` counts and prints as *short by
  an unknown amount*. The cached split is exempt: a short one prices that input at the fresh rate,
  ten times the cached one, so its error runs upward.
- **A cached token is an input token, so there cannot be more of them than there were.** Nothing
  related `cachedTextTokens` to `inputTextTokens` until 2026-09-03 — each was bounded only by its
  own parent — so `inputTextTokens=100, cachedTextTokens=1000` priced *minus* $0.0032. A negative
  cost is worse than a missing one: it silently subtracts from a total somebody sets a price
  against. Refused at the parse, and refused again by `ai_calls_costs_not_negative` in Postgres.

**The browser half** is [`src/web/live/meter.ts`](../../src/web/live/meter.ts), driven from
[`useLiveConversation.ts`](../../src/web/live/useLiveConversation.ts). Four things in it are
decisions rather than plumbing:

- **Two events, because there are two bills.** `response.done` carries the answering model's token
  usage; the completed input-transcription event carries `gpt-live-transcribe`'s, in **seconds**. A
  `response.done`-only meter would have priced half the feature at nothing with nothing going red.
- **Every turn is posted as it happens**, with a small in-memory retry queue and `keepalive` on
  teardown as a *hint*. Not `sendBeacon`: it cannot set an `Authorization` header, and every route
  under `/api/` takes a bearer token and no cookie.
- **Nothing is invented.** A `response.done` that arrives without its modality split
  (openai-agents-js#538) is *not reported*, because filling the gaps with zeros produces a report the
  server accepts and prices at approximately nothing — a turn that cost real money, in the ledger as
  free. The two exceptions are the cached counts and image tokens, and both can only bias the figure
  *up*; the file argues each one.
- **Never a dollar amount, a model, an owner or an article.** All four come from the session row the
  server wrote when it minted the token.

`npm run cost` no longer names live conversation as unmetered spend: it came out of
`UNMETERED_SPEND` in [`src/spend-declarations.ts`](../../src/spend-declarations.ts) the day the
browser started posting, because an entry there claims *money leaves and no row appears*. The WebRTC
connection is still a sanctioned provider bypass in the scan's `ALLOWED` map —
[ai-gateway.md](ai-gateway.md) has the distinction.

**Accepted loss, permanently:** the final turn can vanish on a crash or an instant tab close, so the
aggregate is biased low by a probably-small unknown. There is no durable outbox and no ack-based
retry, deliberately: GPT Sol cut both as what an invoice needs rather than what a pricing estimate
does. *"Add the durable outbox before usage affects an allowance, an invoice, or a promise made to
users."*

### GPT-Live's two bills

The second engine ([261003a](../plans/261003a-gpt-live-alongside-realtime-for-live-conversation.md))
is metered through the same three endpoints and the same session row, with two report kinds of its
own, read off the wire by [`gpt-live/meter.ts`](../../src/web/live/gpt-live/meter.ts).

- **`voice` — seconds, as a running total.** OpenAI reports one cumulative figure for the session,
  so two reports are not two bills. The session row holds a high-water mark
  (`voice_seconds_reported`); a report is priced as the difference from it, and a repeat or an older
  figure adds nothing. The mark and the `ai_calls` row are written under one row lock, in one
  transaction — `advanceVoiceSeconds` in
  [`src/store/realtime-sessions-pg.ts`](../../src/store/realtime-sessions-pg.ts). The seconds go in
  their own column, `voice_seconds`, not `transcription_seconds`.
- **`backend` — the text model's tokens**, one row per backend response id. Priced on the model the
  session row names, cached input at its own rate. `LIVE_BACKEND_PRICES` in
  [`src/pricing.ts`](../../src/pricing.ts) says where each number came from, and names the
  long-context tier it does not model.

**The create call is the server's own, and it bills fifteen seconds.** So
`POST /api/chat/:slug/:threadId/live-session` writes the session row *before* it asks OpenAI — the
reverse of the ticket route — and records those fifteen seconds as a priced row itself, so a call
abandoned before it connects is not free in the ledger. A create that does not yield a usable
session closes the row with no connected time, under a reason that says whether money moved
(`liveChatSession` in [`src/routes.ts`](../../src/routes.ts)): refused, lost in transit, or created
and unusable — which is still charged. A report for the other engine's bill is refused in both
directions. The cases are in
[`tests/realtime-usage.test.ts`](../../tests/realtime-usage.test.ts),
[`tests/store-realtime-sessions.test.ts`](../../tests/store-realtime-sessions.test.ts) and
[`tests/live-session-routes.test.ts`](../../tests/live-session-routes.test.ts).

**Verification, 2026-09-06:** the journal exists in local Postgres; the earlier migration blocker
is no longer current. [`tests/live-session-routes.test.ts`](../../tests/live-session-routes.test.ts)
now exercises the client's projection, HTTP route and priced Postgres rows for both bills. The
ticket, journal and spoken-turn suites passed together (27 tests). The real browser minted a
journalled ticket; the separate silent-input preview exercised provider speech and tools. These
are different checks, and neither proves physical microphone capture or audible speakers. See
the [repair evidence](../plans/260906f-repair-realtime-chat-browser-results.md). A real spoken
session remains needed to verify the transcriber's actual usage shape; token-only reports remain
explicitly unpriced rather than guessed.

## The three orderings, and why each is a rule

Every one of these fails **silently**: no error, nothing in a console, a transcript that is merely
wrong. That is why each has a test that has been watched to fail.

They are the Realtime engine's. GPT-Live has no item ids, no seed acknowledgements and no turn
boundaries, so it keeps the same three promises by other means —
[§ The second engine](#the-second-engine-gpt-live-behind-experimental).

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

**The guarantee is Postgres's.** The article row lock serialises the read, the tail check and the
insert inside one transaction, so two tabs and a replayed request are both safe. Until 2026-09-05
there was a filesystem store too, safe only within one process, under its own mutex — two processes
sharing `data/` were not: both read the same tail, both passed the check, both wrote a whole
snapshot, and the last rename won with no 409 anywhere. That limitation was the filesystem store's,
not this feature's, and it went when the filesystem store did.

## What a spoken row carries that a typed one does not

- **`passages`** — what the answer pointed at. A spoken answer never cites in its text, because it
  is forbidden to say `spya-k3m9qt` aloud and is given `show_passage` instead. Without a stored
  field these would be uncited claims, which is what the chat contract exists to prevent.
  Only ids the article has, and at most four: the browser checks each id when the model points
  (`shownPassage` in [`session-shared.ts`](../../src/web/live/session-shared.ts), both engines)
  and tells the model which were not there, because the server refuses the whole append for one
  unknown id and a refused append ends the call.
- **`interrupted`** — the spoken answer ended early, through interruption, hangup or provider
  failure. Its transcript may be incomplete or run past what was heard. The saved row says so
  without blaming the reader, and `recentHistory` ([`src/converse.ts`](../../src/converse.ts))
  excludes the pair from future model context. The existing flag carries this; no invented
  assistant text or new status is needed.
- **`model`** — set server-side, never taken from the browser: `LIVE_MODEL`, or `GPT_LIVE_MODEL`
  when the `/spoken` body names that engine. The browser names an engine, never a model. It is what lets the
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

## The second engine: GPT-Live, behind Experimental

Two engines sit behind one `LiveApi`, and **one of them will be deleted**. Asked whether to move to
GPT-Live or fix Realtime:

> My intention when I wrote this was to say move to GPT-Live, but I don't have a clear sense of what
> the tradeoffs are. I'm inclined to say we should just move over. Alternatively, we could sort of
> implement it alongside and then we'd have both and then get rid of one eventually. […] all I know
> is that WhatNext seems to be working better than Spideryarn is. So I'm open to trying to have
> both. Trying to fix the GPT real-time implementation and implement GPT Live alongside it and
> compare them. But eventually I think we only want one. […] use your judgment
>
> — Greg, 2026-10-02

So nothing is abstracted into a provider framework: each engine has its own hook and reducers, and
deleting the loser is deleting files. Which one survives is Greg's to decide, in use —
[open-questions.md § Q12](open-questions.md#q12). The design, what it passed over and GPT Sol's
findings are in [261003a](../plans/261003a-gpt-live-alongside-realtime-for-live-conversation.md);
what is below is what you would otherwise have to reverse-engineer.

**Choosing, and pinning.** With Experimental features on, a select beside the Live button offers
*Realtime* or *GPT-Live (new)*, remembered per browser. With the switch off there is no choice and
the engine is Realtime. Three things are kept apart — the remembered preference, the engine the
next start would use, and the engine that owns the call in progress — and the owner does not move
until its hang-up has finished; turning Experimental off mid-call ends a GPT-Live call by the
ordinary hang-up. The rules are the headers of [`engine.ts`](../../src/web/live/engine.ts) and
[`useLive.ts`](../../src/web/live/useLive.ts). `DEFAULT_EXPERIMENTAL_ENGINE` is the one constant
that decides what a switched-on reader gets before choosing.

**The shape.** GPT-Live is a voice model that listens and speaks, with a text model behind it (the
*backend*) that it hands questions to — a *delegation* — and which is the one that calls tools.
Our server makes one request, the SDP exchange (`createGptLiveSession` in
[`src/live.ts`](../../src/live.ts)). After that **the browser relays the backend's tool calls** over
the data channel: a call arrives, the tab runs it through the same `live-tool` route Realtime uses,
and sends the result back ([`delegations.ts`](../../src/web/live/gpt-live/delegations.ts)). There is
**no server sideband**, for the reason there is no audio relay: it would be a long-lived socket, and
Vercel has none. The cost is that tool work stops when the tab does. Reader speech cancels nothing
here — Realtime's "drop the pending continuation" would leave the backend waiting for ever.

**The article goes to only one of them.** The voice model's instructions are capped at 16,384
tokens and most articles are longer, so the voice gets the title and the outline and the backend
gets the whole article, the evidence rules and the tools, `show_passage` included. The same split
for every article, short ones too. **Anything that depends on what the article says is delegated,
always**: a claim about its content, a quotation, "where does it say that", showing a passage,
anything needing a lookup. The voice has not read the piece, and an answer that was never checked
against it is the worst failure a reading app has. The two prompts are in
[`src/live-gpt.ts`](../../src/live-gpt.ts).

**What the stored pairs promise is chronology, not ownership.** Transcripts arrive as 200 ms
fragments with no item ids and no "done", and both sides can talk at once, so nothing says which
question a stretch of speech answers and the rows do not claim to know. They read back in the order
things were said, and no word is dropped — which is why "mm-hm" in the middle of an answer becomes
a short question of its own rather than being discarded. **An exchange is written when it can no
longer change** — a later one has begun, or the call is ending — never on silence and never because
the backend finished; and **written means frozen**: handed to `speak` once, its payload and tail
fixed across retries, with a late fragment starting a new exchange rather than amending an old one.
So the last exchange of a call is written at hang-up, and a tab that dies loses it. What is stored
as the answer is what was *spoken*, never the backend's text. Rules and the reasons for each:
[`segments.ts`](../../src/web/live/gpt-live/segments.ts).

**What this engine does not have.** GPT-Live sends no voice-detector and no playback events, so:

- Listening and Speaking are **estimates** — a transcript fragment from that side in the last
  second or so — and trail the audio.
- There is **no open-turn stall**, since nothing says a turn is open, and so **no tap to talk**,
  which that notice is the only way into.
- There is **no microphone placement**: no noise-reduction setting exists to map it onto. The route
  checks the field and ignores it.
- No vocabulary `keywords`, and no seeding barrier: the history goes in the create request, and the
  microphone opens on `session.started` and the tail check.

**The reply stall is per delegation.** A delegation owes speech from the moment its final backend
response completes until the companion says something that *began* after that; filler spoken
before then pays nothing. Owed for twenty seconds shows the ordinary no-reply notice with
Reconnect. **The trap is that there are two clocks.** A backend final is timed by the tab; a
fragment is timed on the session's own timeline, which was once measured standing still for 26 s
and then stays that far behind — after which every answer looks older than the final it answers and
the notice shows over a working conversation. `timelineOrigin` in
[`gpt-live/stall.ts`](../../src/web/live/gpt-live/stall.ts) corrects for it, and says what that
gives up. Never key anything on `start_ms` alone.

**The idle cap is two minutes, not five**, because GPT-Live bills every minute a session is open,
silence included, where Realtime bills nothing while nobody speaks — and a reader reads between
questions. The clock does not run while a delegation does. `GPT_LIVE_IDLE_CAP_MS` in
[`useGptLive.ts`](../../src/web/live/gpt-live/useGptLive.ts) has what it counts and the one case
decided against the reader.

**Sounds in brackets are not words.** The transcript writes a hum as `[hum]`, split across
fragments. `SoundFilter` in `segments.ts` takes them out before a line, a question or an answer
sees them, and the idle and stall clocks run on speech only.

**What the measurements showed, and will bite.** From the spike in
[`evals/live/gpt-live-spike/`](../../evals/live/gpt-live-spike/) and
[261002r](../investigations/261002r-gpt-live-spike.md):

- **Filler.** 32 of 36 turns opened with "Checking." or a hum. The voice prompt now asks for
  nothing, or two or three words, once.
- **Thinner answers.** A median 28 spoken words against Realtime's 48, with the mechanism gone:
  the voice paraphrases a smaller model. Both prompts now ask for the reason as well as the claim.
- **A completed backend is not a spoken answer.** In one spike run both backend rounds finished
  with the right text and nothing was said. Do not treat `response.completed` as the reader having
  heard anything; the per-delegation stall exists for this.
- **Fifteen seconds are billed at create**, before a word — § GPT-Live's two bills.

**None of the prompt changes made in answer to these has been measured against the provider**, and
no part of this engine has been tried with a real microphone in a real room.

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
| **A dead connection** | `failed` or `closed` ends it. `disconnected` gets a short recovery window, then ends with a retryable error if it persists. |
| **The data channel closing** | Ends it. The far end hung up. |
| **An append refused or lost** | Ends it, and stops the ones queued behind it. No later tail can be vouched for. |
| **An edit, a retry or a delete in the same thread** | Not intercepted, and deliberately: the next spoken append claims a tail that has moved, gets a 409, and *that* ends the session and reloads the conversation. One mechanism instead of three, and it is the one that also covers a second tab. The cost is that the model is briefly seeded with a history that has changed under it, for the length of one answer. |
| **Leaving mid-connect** | A session epoch is bumped by every start and every stop and checked after every `await`, so an abandoned `start` never opens a connection or claims a microphone. Without it the cleanup found nothing to tear down and the abandoned attempt carried on. |
| **A stall** | Does **not** end it. The microphone paused by the device, a dropped connection, a turn that sound has held open for 30 s, or a reply owed for 12 s (or started and silent for 20 s) is named in the Chat panel, with **Reconnect**. Not ended automatically: deciding for the reader that a long open turn is street noise is a guess, and the thresholds are generous because a notice that fires on an ordinary conversation teaches the reader to ignore it. [260915b](../plans/260915b-live-conversation-stalls-visible-and-recoverable.md). |
| **Reconnect** | The ordinary hang-up, then the ordinary start on the same thread, re-seeded from what was saved — offered whenever the call is live, not only with a notice. It carries an intent token: any other stop, a start or an unmount cancels the restart, so a reader who presses it and then types stays typing. The ending is `reconnect-<stall>` or `reconnect`. |
| **Tap to talk** | Offered only by the `open-turn` notice, because Reconnect sends a reader in a street back into the same street. The voice detector hears other people's voices as the reader's: it answers bystanders, lets them cut the reply off, and holds a turn open for as long as they talk (measured against OpenAI's server, [`scripts/spike-live-push-to-talk.ts`](../../scripts/spike-live-push-to-talk.ts)). For the rest of that call it is OpenAI's documented push-to-talk: `turn_detection: null`, a clear and the microphone on at **Talk**, the microphone off and a commit at **Done**, and `response.create` once the commit comes back. **Ready**, **Listening**, **Sending** are `TalkMode`'s states. Talk waits while the companion answers, so it is a walkie-talkie. A provider error against one of its own `event_id`s (`spya-tap-…`) is a notice, not the end of the call. It survives a Reconnect, a start the reader makes is hands-free, and there is no way back to hands-free within the call. [261003d](../plans/261003d-tap-to-talk-when-noise-holds-the-live-turn-open.md). |
| **Startup never finishes** | One deadline covers device discovery, ticket, permission, transport and seed acknowledgements. It belongs to that attempt and is cleared on every exit; Cancel stays available throughout. |

**On GPT-Live** the table holds, with these differences. Startup has no ticket step, and the
microphone is opened *before* the request to our server, because the SDP offer needs a track — so a
reader who refuses the microphone costs nothing. Hang-up still gives the device back first; it then
waits for the fragments to stop, sends `session.close`, and waits briefly for `session.closed`,
which carries the final billed seconds. When OpenAI ends the call instead, the panel has a sentence
for each reason it gives. Of the stalls, only the microphone, the connection and no-reply exist
(§ The second engine), plus a delegation still running after a minute; there is no Tap to talk.

**Every one of those endings names itself** to the session journal; the current reasons live beside
`endedBecause` in each hook ([`useLiveConversation.ts`](../../src/web/live/useLiveConversation.ts),
[`useGptLive.ts`](../../src/web/live/gpt-live/useGptLive.ts)). Free text
with a length bound on the server rather than a union, deliberately: the list belongs to the browser, and a server-side
union that lagged it would refuse a true report about how a conversation ended. It is best-effort
either way — a closed laptop says nothing, and a session with no `closed_at` is ordinary rather than
one still running.

## What is not built

- **Nothing caps a session on the server.** The meter measures what a conversation cost; it cannot
  stop one, and a per-reader ceiling this server could enforce does not exist. § The meter above has
  what the measurement is and is not worth.

  The **cap** in the browser is built, because it is the half that costs money rather than
  visibility: a session
  ends itself after five minutes of quiet (two on GPT-Live, which bills silence) or twenty minutes
  in total, so a forgotten tab bills minutes rather than the hour OpenAI would allow. Only the reader's own voice resets the idle
  clock — a session that kept itself alive by answering its own last question would be exactly the
  case the cap is for.
- **Live conversation in the comment dialog.** Chat and the existing Recall composer share
  the thread-backed controls; comments do not yet have them.
- **On GPT-Live:** tap to talk, microphone placement, and anything that finishes tool work with the
  tab closed. Speaker segments are not stored as rows — pairs are a projection of them, and segment
  rows are the first follow-up if this engine wins. Answering first and pointing second, the first
  latency lever, is untried. Each is argued in
  [261003a § Not in this job](../plans/261003a-gpt-live-alongside-realtime-for-live-conversation.md#not-in-this-job).
- **Deleting the losing engine.** A follow-up plan once Greg has compared them, not open-ended
  coexistence.

## See also

[dictation.md](dictation.md) (the other way of talking to it) ·
[chat-tools.md](chat-tools.md) (what the model may call) ·
[ai-gateway.md](ai-gateway.md) (why this is the one exception) ·
[comments.md](comments.md) · [reading-view-overview.md](reading-view-overview.md)
