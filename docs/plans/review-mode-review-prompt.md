# Review this plan before it is built

You are reviewing a plan for the Spideryarn repo (an AI-assisted reading app, TypeScript + ESM,
React client, Node server on Vercel, OpenRouter as the model gateway, Postgres via drizzle with a
parallel filesystem store). Read-only review: do not edit files. Be concrete and rank findings by
how much damage they would do.

## The plan

Read `docs/plans/review-mode.md` in full. That is the thing under review.

**Review mode** is a new mode in the reading view's middle band. The reader talks (dictation) or
types about what they took from the article, and the model helps them find where their understanding
is off — with four "stances" they can pick per turn (Balanced / Respond / Socratic / Signposts).
The plan's central claim is that a review conversation IS a chat thread, so nearly all of the
existing chat machinery is reused unchanged.

## Context you will need

- `src/converse.ts` — the chat model call, `SYSTEM`, `buildConverseMessages`, `ConverseRequest`,
  `recentHistory`, `anchorSection`. **Read the long header comment on `buildConverseMessages`
  about the `cache_control` breakpoint** — the plan's biggest claim rests on it.
- `docs/postmortems/chat-cache-automatic-breakpoint.md` — the caching bug that comment describes.
- `docs/project/prompt-caching.md`.
- `src/chat.ts` — the filesystem store. `withTurn`, `withRetry`, `withEdit`, and the header note
  about the three persistence rewrites in the previous version of this app.
- `src/store/contracts.ts` § `Turn`, `ChatStore` — the two-store contract.
- `src/store/pg-chat.ts` — `upsertThread` and its `onConflictDoUpdate`, whose `set` clause
  deliberately omits `created_at` and the anchor columns.
- `src/db/schema.ts` § `chatThreads`, `chatMessages` — the check constraints and why they are there.
- `src/routes.ts` § `streamChat` — body parsing, `inTurnOrder`, `settleThread`, the anchor 409, the
  frame protocol, and the `finally` that must not throw after the headers are gone.
- `src/web/useChat.ts` — `send`, `retry`, `edit`, the optimistic rows, `withServerIds`, stream
  recovery.
- `src/web/ChatPanel.tsx` — `ChatPanel`, `ThreadList`, `Conversation`, `Composer` (~line 1406),
  `SUGGESTIONS`.
- `src/web/App.tsx` § `ChatBand` (~line 1690) — the once-per-visit "start a new conversation" latch.
- `src/web/params.ts` § `modeParam`, `threadParam` — the mode band's URL contract.
- `src/web/Dock.tsx` § `MODES_UI`, `DockModes` — the mode switch and its roving tabindex.
- `src/web/useDictationField.ts`, `docs/project/dictation.md` — the mic the plan reuses.
- `docs/plans/chat-mode.md` and `docs/project/chat-tools.md` — the two documents this plan builds on.
- `docs/reusable/silent-success.md` — the failure pattern this codebase cares most about.
- `docs/project/vision.md` — in particular § Anti-goals, which names chat.

## What I most want you to attack

1. **The prompt.** This is the feature, and the rest is plumbing. Read the draft prompt in full.
   - Does the TONE section actually produce the reply Greg wants, or does a long list of banned
     phrases produce a stilted model that sounds evasive instead of superior? Which of those rules
     would you cut, and which is missing?
   - **BALANCED is the default and is defined as per-point triage** ("stuck → tell; nearly there →
     ask"). Is that a judgement a model can actually make from a paragraph of spoken text? What
     does it do when it cannot tell? Name the failure mode you expect and what the prompt should
     say to catch it.
   - **SOCRATIC has no ground truth.** The model believes the reader is wrong and asks a leading
     question. If the model is the one who is wrong — it has misread the article, or the reader has
     a defensible alternative reading — Socratic questioning is worse than a direct claim, because
     the reader cannot argue with a question. Should the prompt say something about this, and what?
   - **Does anything here let the model grade the reader?** Look for the sentence that will, in
     practice, become "you got 3 of 4 right".
   - Is `WHAT IS WORTH RAISING`'s ranked list the right ranking?
2. **The caching split.** The plan puts `kind` in the system prompt (above the `cache_control`
   breakpoint) and `stance` in the final user message (below it). Verify that against
   `buildConverseMessages` and the postmortem. Is the claim "two cached prefixes per article, paid
   once on entering the mode" actually true given `recentHistory`'s sliding window and the fact that
   the assistant's canned `"Read it. What would you like to know?"` line sits below the breakpoint?
   Should that canned line differ for review, and what does it cost if it does?
3. **`kind` on the thread.** The plan writes it on insert only, mirroring `anchor`. Enumerate what
   goes wrong if it is ever written twice, or never written (an old row, a filesystem thread with no
   `kind` field, a client that omits it). The plan proposes a 409 for a `kind` that contradicts an
   existing thread — is that the right status and the right place, given the anchor check it sits
   beside runs inside `inTurnOrder`?
4. **`stance` on retry and edit.** `withRetry` and `withEdit` re-ask a *stored* question. The plan
   says the client re-sends its current picker value. Walk that through: a reader asks Socratically,
   switches the picker to Respond, then presses retry on the old answer — what do they get, and does
   the transcript then lie? What about two tabs? What about an edit that discards turns whose
   stances differed? Say what the correct rule is.
5. **The shared thread list.** Both modes show all threads, tagged. Opening a `review` row from chat
   mode is supposed to flip `?mode=`. What breaks — the `started` latch in `ChatBand` (which is a
   ref reset on unmount), `?thread=` pointing at a thread the new mode's panel has not loaded, the
   history stack (`mode` pushes, `thread` replaces), a double navigation? Is there a simpler rule?
6. **The composer.** The plan proposes a second composer component sharing `useDictationField`, the
   Escape ladder and the key-bubbling rule with chat's. Is that the right seam, or does it duplicate
   the parts most likely to drift? What specifically must be extracted rather than copied? Note that
   chat's composer has a `readOnly` window during transcription in which `submit()` must not fire.
7. **What the plan does not mention at all.** Migration ordering against a live deploy; the
   filesystem store's lack of a `kind` column (it is JSON, so it is free — is it?); `MAX_QUESTION_CHARS`
   against a spoken paragraph, which is much longer than a chat question; `titleFrom` on a rambling
   spoken opening; what the reading view's `ThreadSummary` and the prose marks do with a review
   thread; keyboard/ARIA for the stance picker inside a `role="radiogroup"` dock; the token cost of a
   long spoken turn in `recentHistory`.
8. **The scope decision.** Greg chose "whole article + a position line" over truncating at the
   reader's position, accepting spoilers. The plan leaves a no-spoilers instruction open. Given the
   prompt's other content, is a soft instruction worth adding, actively harmful, or a coin flip?

Please also flag anywhere the plan contradicts reasoning already written into `converse.ts`,
`chat.ts` or `useChat.ts` headers, since that reasoning was hard-won and the plan may be discarding
a fix without knowing it. And say plainly if you think any part of this should not be built.
