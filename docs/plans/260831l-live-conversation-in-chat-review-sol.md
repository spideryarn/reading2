# Verdict: BLOCKED

Do not build from this plan as written. The WebRTC spike is reusable, but the persistence and ownership design is not yet specified tightly enough to protect the thread.

## Blocking findings

### 1. Critical — there is no causal exchange assembler

> “The spoken path has both halves of the exchange in hand before it writes anything.”

It does not. It has unrelated asynchronous events:

- a committed user item;
- that item’s later transcription;
- one or more Responses;
- assistant transcript events;
- tool calls and continuation Responses;
- interruption/truncation events.

A tool-using “answer” can span several Responses. Transcription for question 1 may finish after response 1 and even after question 2 starts. Barge-in can begin question 2 before response 1 reaches its terminal events.

A plausible failure is:

1. User item U1 is committed.
2. Assistant response R1 starts.
3. Reader interrupts with U2.
4. R1’s full transcript event arrives.
5. U2’s transcription finishes.
6. R2 finishes.
7. U1’s transcription finally finishes.

Anything based on arrival order can persist U2/R1, R2 without a question, or U1 after U2.

Build an exchange ledger keyed by OpenAI item and response IDs. Establish conversation order from item lifecycle events, then persist only when the user transcription and the entire associated response/tool chain are terminal. Commit completed exchanges serially in that order.

The existing hook only accumulates global `lines`, `tools`, and `pointers`; none is associated with an exchange ([useLiveConversation.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/live/useLiveConversation.ts:158)). That cannot produce `{ question, answer, tools, pointers }` safely.

### 2. Critical — Live is being proposed as a second chat writer outside the operation model

> “spoken: `useLiveConversation` → POST spoken turn”

That violates the existing client’s central invariant: every asynchronous action has an identity and exclusive permission to update a projection ([model.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/chat/model.ts:1)).

The plan does not say how a spoken POST:

- appears optimistically in `ChatThread`;
- receives canonical server IDs;
- survives remount;
- retries without duplication;
- loses to delete/edit;
- is admitted or refused after switching threads;
- merges with a typed operation already drawing that thread.

Worse, an old live session can append a turn after an edit has truncated the history it was based on. `beginTurn` has no expected-tail check for appends.

A spoken append needs to be an operation in the same controller, with:

- a client exchange/idempotency ID;
- an expected thread tail or revision;
- canonical rows returned by the server;
- 409 repair behaviour;
- session-epoch fencing so events from a dead session cannot write.

### 3. Critical — typed input during Live is underspecified and unsafe

> “a typed turn during a live session goes in as `conversation.item.create` + `response.create`”

This is not equivalent to the existing typed path.

If the composer also invokes its normal `onSend`, two models answer and two persistence paths write. If it invokes only `say()`, the existing operation model is bypassed.

There is also a Realtime collision:

- If an assistant response is active, `response.create` may be refused. The spike has already observed exactly this error: “Conversation already has an active response in progress” ([useLiveConversation.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/live/useLiveConversation.ts:191)).
- If the reader is currently speaking, the typed item can be inserted between the audio item and its automatically triggered Response. The next Response may answer both inputs, while persistence expects two turns.
- A later VAD-triggered response can race the manually created response.

There must be one response scheduler. The cheaper answer is to forbid simultaneous modalities: typing a draft is fine, but Send gracefully ends Live, flushes it, then uses the proven typed path.

### 4. High — `beginTurn` + `finishTurn` is the wrong write shape

> “Calls `beginTurn` then `finishTurn`”

Both halves are already known, so two transactions and a temporary pending row buy nothing. A crash between them leaves a false unfinished answer; retrying the POST can append the exchange twice.

There is also a concrete implementation mismatch: the Postgres store’s `finish` requires the attempt token returned by `begin` and refuses calls without it ([pg-chat.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/pg-chat.ts:307), [pg-chat.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/pg-chat.ts:341)). Calling the older free functions is not the deployed store path.

Add an atomic `appendCompletedTurn` store operation. In one transaction it should:

- check ownership and expected tail/revision;
- deduplicate an exchange ID;
- insert both `done` rows at adjacent ordinals;
- return the canonical rows and new tail.

“`finishTurn` never appends” is correct, but irrelevant here. This exchange does not need `finishTurn`.

### 5. High — interrupted speech cannot be stored as an ordinary stopped answer

> “The `chat.ts` `stopped` flag is the existing vocabulary…”

It is the wrong vocabulary. `stopped` means the stored text is what the reader deliberately stopped after reading, and that text is retained as model history ([types.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/types.ts:2071)). In Live, the stored transcript may contain words never heard.

OpenAI automatically truncates unplayed WebRTC audio, but explicitly does not provide a corrected truncated transcript. Therefore exact heard text is unavailable from these events. [Official OpenAI documentation](https://developers.openai.com/api/docs/guides/realtime-conversations#interruption-and-truncation)

Use a distinct `interrupted` state. For an 80/20 first version:

- retain the generated transcript for human inspection;
- label it plainly as interrupted and possibly longer than what was heard;
- exclude interrupted exchanges from `recentHistory`, or transform them into an explicit interruption marker.

Do not silently feed unheard words into the next typed model. Exact continuity would require recording and retranscribing the played remote audio, which is not cheap.

### 6. High — ordinary chat rows cannot represent Live provenance

> “treat it exactly like the typed one”

Typed assistant messages carry visible block IDs. Live deliberately removes IDs from speech and uses `show_passage`. Yet `ChatMessage` has no passage-pointer field; `citations` are web citations, and the plan does not define how `pointers` are stored or rendered ([types.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/types.ts:2050)).

Persisting only the transcript produces uncited assistant claims—the exact product failure Spideryarn’s chat contract exists to prevent.

You need either:

- a stored `passages`/`pointers` field rendered as clickable block references; or
- a canonical display transcript augmented with silent inline block citations.

That is metadata, not necessarily a new message type, but “no different row shape” is untenable.

### 7. High — the mic lock only solves device exclusion

Claiming before `getUserMedia` is correct. Adding a track to an `RTCPeerConnection` does not transfer ownership; stopping the local `MediaStreamTrack` releases it.

But:

> “pressing the dictation mic … politely ends the live session”

“Politely” means preserving the utterance currently in progress. Closing the data channel first, as the spike does, prevents late transcription and terminal events from arriving ([useLiveConversation.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/live/useLiveConversation.ts:350)). The current uncommitted comment claiming “There is no half-spoken sentence to preserve” is false ([useLiveConversation.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/live/useLiveConversation.ts:453)).

Graceful handoff should:

1. Stop or disable the microphone track.
2. Resolve `released` immediately after that track is stopped, allowing dictation to acquire the device.
3. Keep the data channel alive briefly to receive the final committed-item/transcription events.
4. Cancel/clear assistant output.
5. Persist the terminal exchange, then close the peer connection.
6. Fall back to a bounded forced close.

The claim’s `stop` must target its own session epoch. A stale claim must never stop a newer connection.

### 8. High — lifecycle ownership is missing

The peer connection should not be owned solely by the keyed `ChatPanel`. Persistence must survive the component disappearing, but the audio connection must not become ownerless.

Use a stable article-level Live controller/service, with the UI subscribing to it. Bind each session immutably to `{slug, threadId, sessionEpoch}`.

Required behaviour:

- Thread switch, edit, delete, or leaving Chat mode: graceful stop and flush before proceeding.
- Unmount/navigation: stop tracks and close the peer connection; best-effort flush of already assembled exchanges.
- `pagehide`: immediate cleanup; do not depend on an awaited request.
- Hidden tab: stop after a short grace period.
- Sleep/wake or failed ICE/data channel: close, release the mic, reload current thread, and create a fresh seeded session. Never continue the old one.
- Stop during token minting or SDP setup: abort the start. Otherwise the asynchronous start can open the microphone after the UI has returned to idle.

### 9. High — session seeding needs a barrier

> “seeded … before the first response”

With WebRTC, the microphone can deliver audio while the data channel is still opening and history items are still being created. “Sent before” does not prove “accepted before VAD created the first Response.”

Keep the microphone track disabled until:

- the data channel is open;
- all seed items have been acknowledged;
- the seed snapshot’s tail still matches the thread;
- the controller has entered `live`.

Reusing `recentHistory` is otherwise good. It already preserves only complete user/assistant pairs ([converse.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/converse.ts:1033)).

## Cost and release gate

I would allow this to be built behind the preview/dev gate. I would refuse to expose the button to ordinary readers without an app-level cap and usage reporting. The repository itself currently says the spike must not ship before metering ([no-undeclared-spend.test.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/no-undeclared-spend.test.ts:170)).

One premise should be corrected: a silent connection does not itself bill indefinitely, and current Realtime sessions have a 60-minute maximum. Responses and committed input transcription create charges; VAD normally filters empty input. Ambient noise can still create billed turns, so a forgotten open microphone remains a real cost and privacy problem. [Realtime lifecycle](https://developers.openai.com/api/docs/guides/realtime-conversations#session-lifecycle-events), [Realtime costs](https://developers.openai.com/api/docs/guides/realtime-costs#per-response-costs)

Minimum release controls:

- short wall-clock cap;
- hidden/idle timeout;
- mint-rate and concurrent-session limits per reader;
- forward usage from both `response.done` and transcription-completed events;
- reconcile browser reports against OpenAI’s organization usage, since clients can omit or forge reports.

## Recommended cheaper design

Build turn-boundary switching first:

1. Live starts only after the current thread snapshot is seeded.
2. Spoken exchanges are assembled and atomically persisted per exchange.
3. The composer may hold a draft during Live.
4. Pressing Send ends Live gracefully, flushes it, then uses the existing typed `runTurn`.
5. Pressing Live again starts a fresh session seeded from the now-current thread.
6. Editing, retrying, deleting, or switching threads also ends Live first.

That satisfies Greg’s actual sequence—“live for a bit, then type/dictate, then live again”—without solving simultaneous spoken and typed turns. It removes the worst response collision and lets the proven typed operation model remain untouched.

Per-exchange persistence is the correct choice. The extra HTTP requests are cheap; losing or corrupting a conversation is not.