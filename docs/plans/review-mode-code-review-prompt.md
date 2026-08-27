# Review the built code

You reviewed the **plan** for Review mode yesterday and returned a NO-SHIP verdict with seven
findings — `docs/plans/review-mode-review-sol.md`. The plan was revised against all seven and the
feature is now built. This is the second pass, on the code, and it should be weighted higher than the
first: a plan-stage review cannot find a `PATCH` that writes one field and then rejects the request.

Read-only review: do not edit files. Rank findings by how much damage they would do.

## What to read

1. **`docs/plans/review-mode.md`** — the revised plan, including a table at the end recording what
   each of your seven findings changed.
2. **`docs/project/review-mode.md`** — the doc written after the build.
3. **The scoped diff**: everything under "the diff" below is my work. Note that `src/converse.ts`
   also contains *another agent's* in-flight refactor (extracting `openRouterStream` into
   `src/ai-call.ts`) which is NOT mine and is not under review — ignore hunks about
   `openRouterStream`, `ProviderRefused`, `PROVIDER_ORDER` and `sseChunks`.

Diff file: `/private/tmp/claude-501/-Users-greg-Dropbox-dev-experim-spideryarn2/75b5cc48-91ef-4b1f-b4e9-e4842b9fb53a/scratchpad/review-mode.diff`

Also read in the repo:
- `src/converse.ts` § `REVIEW_SYSTEM`, `systemFor`, `readItFor`, `stanceLine`, `buildConverseMessages`
- `src/chat.ts` § `normaliseKind`, `withTurn`, `withRetry`, `withEdit`, `stanceOf`
- `src/routes.ts` § `streamChat` (the new validation block, the 409, `MAX_REVIEW_CHARS`), `summarise`
- `src/store/pg-chat.ts` § `toMessage`, `threadsFor`, `messageRow`, `upsertThread`
- `src/store/export.ts` and `src/store/import.ts` (the chat rows)
- `src/db/schema.ts` § `chatThreads`, `chatMessages`; and `drizzle/0019_nebulous_romulus.sql`
- `src/web/App.tsx` § `ConversationBand`, and the `overlay` in `Reader`
- `src/web/ChatPanel.tsx` § `ChatPanel`, `Conversation`, `Composer`, `ThreadList`, `ReviewInvitation`
- `src/web/useChat.ts` § `send`, `begin`
- Tests: `tests/review-prompt.test.ts`, `tests/review-store.test.ts`, `tests/review-route.test.ts`,
  the review block at the end of `tests/store-chat-pg.test.ts`, and the `canonical()` change in
  `tests/store-roundtrip.test.ts`
- Eval: `evals/review-stances.ts` and its output `evals/results/review-stances.md`

## What I most want you to attack

1. **Did I actually fix your seven, or only appear to?** Go finding by finding against the table at
   the end of the plan. Say plainly where the code does something weaker than the plan claims.
2. **The prompt, again, now that you can see it whole** (`REVIEW_SYSTEM`). It is much longer than
   chat's. Is any rule now *contradicted* by another — particularly "NO INVENTORY" against "WHAT IS
   WORTH RAISING"'s ranked list, and "THEIR WORDS BEAT THE STANCE" against SIGNPOSTS' "do not say
   what they got wrong"? And read `evals/results/review-stances.md`: 28 real answers. Do any of them
   do the thing the prompt forbids while passing my crude phrase check? I am specifically unsure
   whether the `correct` case's replies (which DO push back on the reader, arguably correctly) are
   the refinement Greg asked for or the invented correction you warned about.
3. **`stanceOf(existing.messages[index + 1])` in `withEdit`** — I call it twice in a conditional
   spread. Is the index right in every case (editing the last question; a question whose answer was
   never stored; an edit on a thread whose first message is an assistant row)? What happens on a
   malformed thread?
4. **The 409 and the 400s in `streamChat`.** I refuse `kind`/`stance` on retry and edit *before*
   anything is read; I check the contradicting kind inside `inTurnOrder` beside the anchor check;
   `withTurn` refuses again inside the transaction. Walk two tabs through it. Is there an ordering
   where a rejected request still aborts a live answer? Is `ChatConflict` from `withTurn` actually
   mapped to a 409 by the route, or does it become a 500?
5. **`MAX_REVIEW_CHARS` reads the REQUEST's kind, not the thread's**, which contradicts the rule I
   apply everywhere else. I think that is right (the cap is on bytes already in this body) but say if
   it opens a hole — e.g. a 20,000-character *chat* question smuggled in with `kind: "review"` on a
   thread that is a chat, where the 409 fires only later.
6. **The client.** `ConversationBand` is keyed on `mode` and its latch resets on `[slug, kind]`; the
   stance is `picked ?? lastStance ?? "balanced"`; `onThread` calls `onMode` then `setThread`. Walk
   through: opening a review from chat mode, pressing Back, a `?thread=` naming a thread that no
   longer exists, and two rapid clicks. Does the overlay gate (`chatAnchors.summaries.find(...)`)
   behave when summaries have not loaded yet — it uses `?.kind !== "review"`, so an *unknown* thread
   is treated as a chat. Is that the right default?
7. **The `canonical()` change in `tests/store-roundtrip.test.ts`.** I made a missing `kind` compare
   equal to `"chat"`. Is that an honest normalisation or have I lowered a bar? What would it now hide?
8. **Anything that will bite later**: the `Composer` now takes `kind`/`stance`/`onStance` with
   defaults and is used in three places; `ChatPanel` has a `review` boolean; `ThreadList` has one
   too. Is this the "component with flags" that `Dock.tsx`'s header warns against, and if so what is
   the seam I should have cut instead?
9. **What is missing entirely** that this feature needs and I have not built or mentioned.

Please say plainly if any part of this should be reverted rather than fixed. And check my claims
against the code rather than against my comments — several comments in this diff assert things
("this test goes red if you do X") and I want to know if any of them are false.
