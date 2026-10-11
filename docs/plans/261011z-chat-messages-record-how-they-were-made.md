# Chat messages record how they were made

Report `spya-z30x5n` (#570, SPIDERYARN-READING2-HM, admin), queue item `qi-ma5c3n45`. Session
`fbz30x5n-chat-message-modality`, 2026-10-11.

> In chat mode, can you annotate internally in your data representatives somehow whether parts of a
> conversation come from typing or voice dictation, or maybe edited voice dictation, or live
> conversation? I'm especially interested for you to know which bits of the AI response came from
> the live, real-time voice, because we may want to kind of look through those and check to see if
> they're doing a good job.
>
> — Greg, 2026-10-11

Internal data only: nothing is shown. Store it now (AGENTS.md: *store when it happened*), so that
a later review of live answers has something to select on.

## What exists today

- A spoken exchange is already two ordinary `chat_messages` rows, written by `appendSpoken`
  (`src/store/pg-chat.ts`) from `POST /api/chat/:slug/:threadId/spoken`. The **assistant** half
  carries `model` = `gpt-realtime-*` or `gpt-live-*`, set server-side. So the live answers can be
  found today, but only by knowing the model names; the **user** half carries nothing at all.
- A typed question goes through `POST /api/chat/:slug` → `chatStore.begin`. The composer sends
  `typed: true` on every send, dictated or not, and that flag is deliberately not stored: it gates
  the guide's `offer_to_save` and means "the reader wrote this whole question", not "keyboard".
- Nothing on the client records whether a dictation landed in the box.

## The design

One nullable column, `chat_messages.modality text`, with a CHECK:

| role | values | written by |
|---|---|---|
| user | `typed` — keyboard only | composer, via the `POST /api/chat` body |
| user | `dictated` — dictation only, sent untouched | composer |
| user | `mixed` — both dictation and typing went into it, in either order | composer |
| user | `spoken` — the transcript of a live conversation turn | `/spoken`, server-side |
| assistant | `written` — a streamed text answer | `begin`, retry, edit — server-side |
| assistant | `spoken` — a live voice answer (engine is in `model`) | `/spoken`, server-side |

**Null means "not recorded"**: every row before this lands, and a user turn whose words did not
come through the composer (a button's words: greetings, suggestions, the "?" help press, which has
its own `help` column; the command bar's *Ask the guide* row). Never guessed.

CHECK: `modality is null or (role = 'user' and modality in (typed, dictated, mixed, spoken)) or
(role = 'assistant' and modality in (written, spoken))`. The database refuses a `written` question or a
`dictated` answer from any writer.

**Why one column and not two booleans or a table.** The four user cases are one fact with four
values, and "spoken" is shared by both halves of an exchange, so a review query is
`where modality = 'spoken' and role = 'assistant'`. A `live_at` timestamp would answer only the question
the admin is most interested in and not the other three. `sql.md`: a column, not JSON.

**The client says how the question was written; the server says everything else.** The browser
may only send `typed | dictated | mixed` on a new turn. `spoken` is set by the `/spoken`
route alone and `written` by the server on every reply it streams, so neither can be claimed. A
reader can lie about whether they typed or dictated their own question; that harms nothing, since
it is a statistic about their own words. Unknown values are a 400, not silently dropped.

**The question keeps its modality; every new answer is `written`.** An edit keeps the user row
(and stamps `edited_at`, which already says the words changed after sending; folding that into
`modality` would make one column mean two things). A retry or an edit writes a new streamed answer,
so the reply is set to `written` in `withRetry`, `withEdit`, the SQL retry update and the optimistic
rows, including when the answer being retried was a spoken one (Sol F1).

### How the composer knows

In `Composer` (`src/web/ChatPanel.tsx`), one ref for the current draft's provenance:
`{ dictated, typed, seeded }`. `dictated` — a dictation landed in the box (the `useDictationField`
`onChange` ran); `typed` — the textarea's own `onChange` ran (keyboard, paste, IME, undo);
`seeded` — the box began this draft non-empty (a handed-over question, a restored draft). A pure
function `composerModality` → `mixed | dictated | typed | null`, null whenever `seeded`, because
words we did not see arrive are words we cannot vouch for (Sol F4).

The ref resets to empty whenever the box becomes empty — a send, Escape's clear, or a select-all
delete (Sol F3) — and `submit` **snapshots** the modality before it clears the box and awaits
Live's hand-off, then sends the snapshot, so a draft begun during that wait is not mixed into the
question that went (Sol F2).

Known imprecision, accepted: the flags live in the component, so a draft half-dictated, left by
switching conversation and finished by keyboard on return, records `typed`. Carrying provenance
with the kept draft (`drafts` in ChatPanel) is more parts than v1 needs.

`SendHow` gains `modality?: ComposerModality`, next to `typed`, which keeps its own meaning. It travels
`Composer → ChatPanel → ConversationModes.sendTo → useChat.send → POST body`, as `typed` does.

## Not doing (simplest first)

- **No backfill.** Old spoken answers are found exactly by `model` (`gpt-realtime-%`,
  `gpt-live-%`), and their questions are the row at `ordinal - 1`; the query goes in
  live-conversation.md. A migration that rewrites real readers' rows is Greg's call (the `help`
  precedent), and here it buys nothing a query cannot.
- **Not shown anywhere.** No UI, no admin view. Reviewing live answers is a query for now.
- **The command bar's *Ask the guide* row** (`CommandBar.tsx` has dictation too) records null.
  Wiring it is the same helper on a second box; deferred, queued as `qi-9pknjrsf`.
- **The `typed` flag is not folded into `modality`.** They mean different things (whole question by the
  reader vs. keyboard), and `offer_to_save` depends on the first.

## Stages

1. **Schema + server + client, one stage** (it is small): column and migration; `ChatMessage.modality`
   in `src/types.ts`; `toMessage`/`messageRow` and the roundtrip test; rollback export field list
   (`src/store/export.ts`) and its restore side (`tests/helpers/seed-reader-state.ts`, Sol F5); `withTurn`/`withSpokenTurn` in `src/chat.ts`; body validation in
   `streamChat`; the optimistic rows in `useChat` (so a reload and a live tab agree); the composer
   flags and `composerModality` with a unit test; docs (`live-conversation.md`, `dictation.md` or
   `mode`-side doc, `chat-tools.md`/whichever owns ChatMessage fields). Tests red first: the route
   stores `modality` from the body, refuses `spoken` from the browser, `/spoken` writes `spoken` on both
   rows, a streamed reply is `written`, the CHECK refuses a mismatched role.
2. GPT Sol code review, fix, push to `dev`, bookkeeping.

Done when: a typed question, a dictated one, a dictated-then-edited one and a live exchange on the
local stack each produce the expected `modality` on both rows, and `npm test` / `npm run typecheck` pass.

## Plan review

GPT Sol, 2026-10-11, `-plan-review-sol.md`: REWORK, six findings, all taken. F1 (retry/edit
answers are `written`), F2 (snapshot before the Live hand-off), F3 (reset on any clear), F4 (a
seeded draft is null), F5 (the rollback restore helper), F6 (`dictated_edited` claimed an order it
cannot know → `mixed`; `via` → `modality`). Folded into the sections above.

## Code review

GPT Sol, 2026-10-11, `-code-review-sol.md`: SHIP AFTER FIXES. Two findings, both fixed by the
reviewer with a red-first test each:

- C1: the paragraph-side chat dialog (`ChatDialog.tsx`) dropped the composer's `SendHow` on new
  and follow-up questions.
- C2: the "Ask something new…" list composer (`onSendNew`) dropped it too.

The class: TypeScript accepts a callback with fewer parameters, so a one-argument adapter
typechecks while discarding the second. Any new adapter around `Composer` has to forward `how`.

## What landed

Commit `adae047e8` holds the column, the CHECK, the plumbing, the tests and the docs. The commit
after it holds the review fixes.

- Typed, dictated and mixed are now stored from every `Composer`: the band, the list, and the
  dialog.
- Both halves of a live exchange are stored as `spoken`.
- Every streamed answer is stored as `written`.
- Deferred: the command bar's "Ask the guide" box (qi-9pknjrsf).
- How to review the live-voice answers: [live-conversation.md § What a spoken row carries](../project/live-conversation.md#what-a-spoken-row-carries-that-a-typed-one-does-not).
