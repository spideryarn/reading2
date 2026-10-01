# Remember is its own single thread

Report `spya-peszam` (Greg, admin, 2026-10-01):

> The Remember mode should be its own single, special conversation thread (not visible from Chat,
> nor should other Chat threads be visible in Remember mode). It's a special kind of conversation
> thread just for helping the user to remember from the article, with its own special UI (e.g. for
> more Socratic responses, etc).

Greg chose the design on 2026-10-01, of two: **keep reusing Chat's machinery** (same table, store,
streaming route, citations and recovery) **but separate the two on screen**. Remember shows only its
own thread, Chat no longer lists Remember threads, and there is **one Remember thread per article per
reader**. Existing Remember threads are folded into it without losing a turn.

**The option passed over** was rebuilding Remember as a separate feature with its own storage. It
would buy nothing the reader sees that this does not, and would duplicate the stream, the recovery,
the citations and the live-conversation path, each of which has a history of bugs fixed once.

Also folded in, from the Overseer (plan 261001l § Stage 3): on a landscape iPhone (band ~338px
tall) Remember's composer takes 280 of 338px at rest. Make the at-rest composer compact on short
bands.

## What it changes, in one picture

```
   BEFORE                                     AFTER
   chat mode      remember mode               chat mode         remember mode
   ┌──────────┐   ┌──────────┐                ┌──────────┐      ┌──────────────────┐
   │ list:    │   │ list:    │                │ list:    │      │ Remember         │
   │  chat A  │   │  chat A  │                │  chat A  │      │ (the one thread, │
   │  chat B  │   │  chat B  │                │  chat B  │      │  opened directly;│
   │  rem 1 ▸ │   │  rem 1 ▸ │                └──────────┘      │  no list, no +)  │
   │  rem 2 ▸ │   │  rem 2 ▸ │                                  └──────────────────┘
   └──────────┘   └──────────┘
```

## Where we are (measured, production, read-only, 2026-10-01)

| kind | threads | articles | owners |
|---|---|---|---|
| chat | 37 | 15 | 1 |
| remember | 3 | 3 | 1 |
| candidates | 2 | 2 | 1 |

**No article has more than one Remember thread** — zero `(article, owner)` groups to merge, six
Remember messages, none pending. Every article's threads belong to one owner (articles are owned;
`articleIdForOwned`). So on production the fold below moves nothing; it exists for correctness on
any other database and for the window between this measurement and the deploy. The unique index is
the part that does real work on production.

## Design

### 1. The invariant, in the database

A partial unique index: `chat_threads_one_remember` on `(article_id) where kind = 'remember'`.
An article has exactly one owner, so this is "one per article per reader" (F9 below says why not
`owner_id` too).

### 2. The fold, in the same migration, before the index

Hand-completed SQL in the migration drizzle-kit generates for the index (the
`0048_rename_review_thread_kind.sql` precedent: data movement first, constraint last, because
creating the unique index validates against the rows already there).

For each `(article_id, owner_id)` with more than one Remember thread:

- **Keep the earliest-created** (ties broken by id) — its id, title, anchor-less row and
  `created_at` stay; `updated_at` becomes the group's latest.
- **Move every message of the others into it**, conversation by conversation in the order the
  threads were created, each keeping its internal order: new `ordinal = kept's count + running
  position`. Never interleaved by timestamp, which could separate a question from its answer.
  Every column of the message is kept (id, text, stance, citations, tools, status, attempt…); only
  `thread_id` and `ordinal` change.
- **Repoint `realtime_sessions.thread_id`** (advisory text, no FK) from a folded thread to the kept one.
  `comments.thread_id` needs nothing: only chats are started from a comment.
- **Delete the folded threads**, by then empty.
- **Fail loudly rather than lose anything**: message ids are unique per article in practice
  (`taken()` scans the whole article), but the PK is `(article, thread, id)`; if a moved id ever
  collided the insert fails and the migration's transaction rolls back with nothing changed. No
  `on conflict do nothing`.

Test: a Postgres test that seeds two articles — one with three Remember threads (with stances,
an errored answer, a citation), one with a single Remember thread and some chats — runs the
migration's fold SQL, and asserts every message row is present byte for byte except `thread_id`
and `ordinal`, the order, the chats untouched, and that a second Remember insert now fails on the
index. Red first: the assertion on the index fails before the migration exists.

**Production**: this migration writes readers' data, so it is not run on production by me. The
Overseer runs migrations at deploy; I message it before landing, with the measurement above, and
the deploy waits on its yes.

### 3. The server: a new Remember thread joins the existing one

The client mints thread ids, so a stale tab, a second tab or a bookmark can try to begin a second
Remember thread. The index would make that a 500. Instead, in the pure rules in `src/chat.ts`:

- **`withTurn`** (typed turn): kind `remember`, no thread with this id, and the article already has
  a Remember thread → **append to that thread**. The `begin` frame already carries the server's
  thread id and the client already follows it (`onThreadId`, the overruled-id path), so the
  reader's words land in the one conversation and the URL follows. Nothing is refused, nothing lost.
- **`withSpokenTurn`** (live): the same case → the existing thread is treated as the target, so the
  existing tail guard answers `ChatConflict` ("has moved on … reload"). A spoken exchange carries an
  `expectedTailId` precisely so that it is never appended under turns it did not see; silently
  appending here would defeat that guard.

The route needs no change beyond what follows from these (the length cap and stance check already
resolve the stored kind when there is one; for a fresh id whose turn will be folded, `wantedKind` is
`remember`, which is right).

### 4. The client

`src/web/modes/conversation/ConversationModes.tsx` § `ConversationBand`, `src/web/ChatPanel.tsx`.

- **Each mode lists only its own kind.** The band's `threads` filter becomes `t.kind === kind`
  (Candidates already excluded). The cross-mode jump in `onThread` (open a thread of the other kind →
  `onMode`) goes, since it is unreachable, and so does the `remember` tag in the list.
- **Remember never shows a list.** On arrival, once loaded: if the reader has a Remember thread and
  `?thread=` does not name it, replace `?thread=` with it; if they have none, `begin("remember")` as
  today. `?thread=` naming a chat in Remember mode is overridden the same way. No "all
  conversations" (×) button, no "+" button, no rename in Remember.
- **Delete stays, as "Start over".** Same armed two-press delete; afterwards the band begins a fresh
  empty Remember thread rather than falling back to a list. It is the reader's data and the only
  way to clear it.
- **The header says "Remember"**, not the thread title (which is the reader's first 60 characters,
  often "Um, so…").
- Chat mode with a stale `?thread=` naming a Remember thread: not in the list, so chat behaves as
  for any unknown id (today's rule). No redirect — simplest.

### 5. Compact composer on short bands

At rest the Remember box is six rows (`rows={remember ? 6 : 1}`) and grows to 360px. On a short
viewport (`(max-height: 500px)` — the landscape phone; a laptop is never that short) the at-rest
box is two rows; it still grows with what is typed or dictated, capped at 30% of the viewport height (45% was tried first and, in the browser check, left one
clipped line of transcript after six typed lines at 844×390), so
the transcript stays visible. Measured with Playwright at 844×390 before and after.

## Stages

1. **Server + migration** — the index, the fold SQL, `withTurn` / `withSpokenTurn`, tests red first
   (pure-rule tests for the fold-into-existing and the spoken conflict; the Postgres migration test).
2. **Client** — own-kind lists, Remember's single thread, Start over, header, compact composer;
   component tests red first (Remember never renders the list; Chat never lists a Remember thread;
   delete in Remember begins a new one).
3. **Docs** — `remember-mode.md` (§ On screen's "The list of conversations is shared" is now false;
   § A Remember conversation IS a chat thread gains the one-per-article rule), `chat-tools.md` if
   it mentions the shared list, `live-conversation.md` if affected.
4. **Gates, Sol code review (workspace-write), Playwright desktop 1280 and 390, and 844×390 for the
   composer**, then ask the Overseer about the migration, push to `dev`, note, endings.

## Deferred

- Remember's "own special UI" beyond the above (more Socratic controls, etc.) — Greg's "its UI can
  then grow its own controls". This plan makes room for it; it does not invent controls.
- Retry-as-a-different-stance, already deferred in remember-mode.md.

## Questions for the reviewer

- Fold-and-append for a typed turn versus a 409: is appending a turn the reader typed into a new
  (stale) thread id onto the existing thread ever surprising?
- Any other writer of `chat_threads` that could create a second Remember thread (import, export
  restore, admin)?

## Changed by GPT Sol's plan review (round 1)

Review: [261001m-remember-own-thread-plan-review-sol.md](261001m-remember-own-thread-plan-review-sol.md).
One P0, four P1s, four P2s. Taken unless said otherwise:

- **F1 (P0) — Start over must wait for the delete.** Delete is fire-and-forget today, so a quick
  first question after Start over could be folded into the old thread just before the delete
  cascades it away. The band does not begin the fresh Remember thread (and the composer is not
  offered) until the delete has been confirmed; if the delete fails the old thread comes back, as it
  does for chat today. Test with a held DELETE: no POST leaves before it resolves.
- **F2 (P1) — the fold aborts on a live attempt.** If any thread being folded away has a `pending`
  row with an `attempt_id`, the migration raises and changes nothing — moving it would orphan the
  in-flight writer, which matches on the old thread id. Production has zero pending Remember rows.
- **F3 (P1) — the client coalesces a server-chosen id it already holds.** `withServerIds` in
  `src/web/chat/model.ts`: when `begun.threadId` names another thread already in the local list,
  the provisional thread's question and reply are merged into it and the provisional entry
  removed. Tested in both array orders.
- **F4 (P1) — spoken conflict: partly taken.** The spoken turn still gets the existing
  `ChatConflict` (correct, as Sol agrees). Not taken: a typed 409 carrying the canonical id. The
  case needs two tabs both opening Remember on an article with no Remember thread and then speaking
  in the second; the live session already keeps its unsaved lines on a refused flush, the message
  says reload, and the band's own selection rule (below) moves to the canonical thread the moment
  the list refetches. Revisit if it is ever seen.
- **F5 (P1) — the migration takes `lock table chat_threads in share row exclusive mode`** first,
  held through the index build, so an old instance cannot insert a second Remember thread between
  the fold and the index.
- **F6 (P2) — the Remember thread is derived during render**, not chosen in an effect: the band
  computes the effective thread (the stored Remember thread if there is one — at most one has
  messages — else the provisional one), passes it to the panel, and only syncs `?thread=` in an
  effect. The list is never rendered in Remember, not even for a frame; before the first load it
  shows the existing loading state.
- **F7 (P2) — a mapping of `(article_id, folded_id, kept_id)`** drives every repoint, so
  `realtime_sessions` and any `comments.thread_id` are matched on article as well as id.
- **F8 (P2) — moved ordinals start at the keeper's `max(ordinal) + 1`**, not its count.
- **F9 (P2) — the index is on `article_id` alone** (`where kind = 'remember'`). An article has one
  owner and the server's resolver is article-scoped; an owner column in the index would claim a
  per-reader rule nothing else enforces. If shared articles ever arrive, the owner goes into the
  loading and the index together.

Sol's "materially simpler" migration — assert no duplicates and create the index, folding only by
a separate reviewed step — is not taken because the brief asks for the fold; with F2, F5, F7 and F8
the fold is small and its test covers each case.

## Before the deploy that carries the migration (for the Overseer)

The Overseer approved the migration on 2026-10-01 on condition that this count is still zero just
before the deploy (read-only; inside `begin read only` … `rollback` on production):

```sql
select count(*) as articles_with_several_remember_threads
from (
  select article_id
  from spideryarn.chat_threads
  where kind = 'remember'
  group by article_id
  having count(*) > 1
) x;
```

Zero means the fold moves nothing and the migration only creates the index. Anything else: hold
it for Greg. Measured 0 on 2026-10-01 at about 15:20.

## Code review: what Sol found, and the one place I took a different route

Round 1 ([261001m-remember-own-thread-code-review-sol.md](261001m-remember-own-thread-code-review-sol.md)),
Sol fixing as it went: **C1 (P1)** Start over could wait forever on a loading placeholder when the
thread it deleted had never been named by the server; **C2 (P1)** Start over could DELETE while
Live was still flushing its last spoken exchange, which could write into the deleted thread;
**C3 (P3)** a test left nuqs's URL queue running after teardown. All taken; commit `7ab05e350`.

Round 2 ([261001m-remember-own-thread-code-review-2-sol.md](261001m-remember-own-thread-code-review-2-sol.md)),
narrow, on those fixes: no batching hole between `setResetting("deleting")` and `remove()`
(`useSyncExternalStore` updates the snapshot synchronously); but **R2-1 (P1)** C1's fix could send a
DELETE to a provisional id the server had since folded into a different thread — a no-op that let
Start over claim success. Sol fixed it with more reducer machinery for deleting a thread the server
had not named yet.

**Not taken as built: the case was removed instead of handled.** Everything in C1 and R2-1 exists
for one moment — pressing Start over before the server has named a brand-new Remember conversation,
or while its answer is still arriving. So Start over is now offered only on a conversation that is
stored, server-named and has nothing in flight. A Remember delete then always targets a known,
settled id and is never held, and the unnamed-delete paths in `src/web/chat/reduce.ts` go
(`forgetLocalThread`, `releaseUnstoredDelete` and the superseded-turn branch). The cost: a
reader cannot Start over in the second or two while an answer is arriving. That is the same as
pressing it a moment later. C2 and C3 stay.
