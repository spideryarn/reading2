# A live conversation started in Remember is saved as a Remember conversation

**Status:** built 2026-09-30. Feedback SPIDERYARN-READING2-70. Plan reviewed by GPT Sol (approve with
changes; both taken, § Review).

> I just had a live conversation in remember mode about what I took from it, and it was good. But
> then I went back to remember mode and it seemed to have gone. That's a problem. We would like to
> be storing that - unless it's really complex, in which case I guess just investigate and let me
> know, and we can have a discussion about it via the Overseer agent.
>
> — Greg, 2026-09-30

## What actually happened

**Most likely, the conversation was stored — as a Chat — and Remember mode then hid it.** That is
what the code does on the ordinary path (below), and no other return path loses a stored exchange.
It is the likely explanation rather than a verified fact about Greg's row: that was not read (see
the end of this section), and live conversation separately accepts that a *final* exchange can
vanish on a crash or instant tab close (live-conversation.md § The meter).

```
 enter Remember, no Remember threads
   └─ arrival rule: begin("remember")          local only, nothing stored
        └─ press Live in that empty thread
             └─ each exchange: POST …/spoken
                  └─ withSpokenTurn: thread does not exist yet
                       └─ creates it with kind: "chat"      ← src/chat.ts, "Always `chat`"
 leave Remember, come back
   └─ arrival rule counts threads OF THIS KIND: zero Remember threads
        └─ begin("remember") again → a fresh empty conversation on screen
             (the spoken one is in the shared list, untagged, one "Back" away,
              and opening it switches to Chat mode)
```

`withSpokenTurn` hard-codes `kind: "chat"` for a thread it creates, with the comment *"a spoken
Remember turn is a mode nobody has designed, so inventing one here by passing a kind through would
be deciding it by accident."* That was written before
[live-conversation.md](../project/live-conversation.md) decided to keep the Live control in an open
Remember conversation. Spoken turns into a Remember thread that **already exists** keep its kind
(the kind is written on insert only), so the gap is exactly one case: pressing Live **before typing
anything** in Remember — which is the case the arrival rule makes the common one, because Remember
opens straight into an empty conversation.

Not reproduced against Greg's own row: this box has no production database access, and the local
database does not have this article. The code path is unambiguous and the failing test below
reproduces it.

## The change

The browser already knows the kind: the empty conversation it began is in the chat controller's
`base` with `kind: "remember"`. Send it, and let the server use it **only when the write creates
the thread**.

1. **`SpokenTurn.kind?: "chat" | "remember"`** (`src/chat.ts`). `withSpokenTurn` uses it for a new
   thread (`kind ?? "chat"`), and refuses with `ChatConflict` a kind that contradicts an existing
   thread — the same rule `withTurn` has (*a thread is one kind for life*). An identical kind
   passes, so the replayed-POST idempotency is unchanged.
2. **Route** (`spokenChat` in `src/routes.ts`): `kind` optional; if present it must be `chat` or
   `remember`, else 400. `candidates` is refused: a referee candidates thread has no Live control,
   and a spoken turn creating one would be a mode nobody designed. A contradiction surfaces as the
   409 `ChatConflict` already maps to, which the client already treats as "reload and repair".
3. **Client** (`startSpoken` in `src/web/chat/reduce.ts`): look up `op.threadId` in `state.base`
   and put that thread's kind on the `spoken` command; the controller's `#write` copies it into the
   request body, which it rebuilds field by field. No
   change to `useChat.speak`, `useLiveConversation`, or `ConversationModes`.

The spoken rows carry no `stance` — as today for spoken turns into an existing Remember thread. The
stance picker then seeds from the last stanced answer, or `balanced`.

### Simpler option passed over

**Send the kind from `ConversationModes` (this mode's kind) through `useLiveConversation` to
`speak`.** Rejected: it is the mode's kind, not the thread's, and those differ whenever the reader
opens a thread of the other kind — exactly the "chosen from the request, not the thread" mistake
remember-mode.md warns about. The controller's `base` already has the thread's own kind, and one
line in the reducer reads it.

**Change the arrival rule to count all threads.** Rejected: it would un-fix GPT Sol's finding 7
(three chats and no Remember threads would show chats on pressing Remember), and would not make the
conversation a Remember conversation.

## Privacy

No new field about the reader. `/privacy` already says, of the live voice mode, that *"the text of
what was said comes back to us and is stored as part of the conversation"*
(`src/web/PrivacyPage.tsx`). Nothing to flag.

## Deferred, named

- **Greg's existing conversation stays a Chat.** Re-kinding it is a production write to a real
  reader's row (his own). It is in the Chat list, and in Remember's list without the `remember`
  tag. One `update spideryarn.chat_threads set kind = 'remember' where id = …` if he wants it; not
  run from here.
- **Remember-specific live prompt and stances.** The spoken companion in a Remember thread still
  uses the Chat live prompt (live-conversation.md already says so). This fix is storage only.
- **Live from Remember's list** (no open conversation) still does nothing (`onStartLive` returns
  when `!id && kind !== "chat"`). Unchanged.

## Tests

- `tests/chat-spoken-turn.test.ts`: a new thread takes `kind: "remember"`; an existing Remember
  thread with no kind sent stays Remember; a contradicting kind is a `ChatConflict`; absent kind is
  still `chat`. **Written first and watched red.**
- `tests/chat-spoken-operation.test.ts`: the `spoken` command carries the begun thread's kind.
- `tests/chat-spoken-kind-controller.test.ts`: the real `ChatController`, with a fake transport
  that captures the body — `kind: "remember"` on the first append, and again on the second after
  the server renamed the thread. Watched red with the controller's spread removed.
- `tests/chat-spoken-route.test.ts`: `kind: "remember"` creates a Remember thread through HTTP and
  Postgres; `kind: "candidates"` and a garbage kind are 400; a contradiction is 409.

## Review

GPT Sol on the plan, 2026-09-30: **approve with changes.** (1, P1) The controller rebuilds the body
field by field, so reducer and route tests would stay green with that hop dropped — the controller
test above was added and watched red. It confirmed the renamed-id path is sound: the server's thread
replaces the tab's entry before the live hook adopts the new id. (2, P2) "Nothing was lost" was
stronger than the evidence — reworded above.

GPT Sol on the code, 2026-09-30: **ship after its fix.** One P2, fixed by it with a test: a Remember
thread whose first spoken transcription failed kept the title "New chat" for good; it now keeps
"Remembering", the placeholder the tab already shows. It traced the paths the kind feeds — the next
typed turn, retry and edit, the stance seed, the `/live` ticket, the dialog, the renamed-id path —
and found them right. A kind contradiction on the spoken path takes the tail conflict's repair, words
kept. Gates re-run outside its sandbox: 68 files, 1,020 tests; typecheck 0.

## Docs

live-conversation.md § The controls (the Remember paragraph) and remember-mode.md get one sentence
each: a Live conversation started in an empty Remember conversation is stored as Remember.
Postmortem: [260930b](../postmortems/260930b-live-conversation-in-remember-saved-as-chat.md).
