I found one P0, four P1s, and four P2s. The overall design is sound, but the delete/start-over and stale-thread paths need tightening before implementation.

## Findings

**F1 — P0 — “Delete → fresh thread” can delete the first new turn.**

The plan starts a fresh local Remember thread immediately after deleting the old one ([plan:121](</home/greg/code/spideryarn2/.claude/worktrees/fb-remember-own-thread/docs/plans/261001m-remember-is-its-own-single-thread.md:121>)). Today `remove` is fire-and-forget ([useChat.ts:893](</home/greg/code/spideryarn2/.claude/worktrees/fb-remember-own-thread/src/web/useChat.ts:893>)), while deletion and `begin` are separate transactions.

If the reader types quickly:

1. DELETE old Remember starts.
2. Fresh send reaches `begin` first.
3. The server folds that send into the still-existing old Remember thread.
4. DELETE acquires the article lock and cascades the old thread—including the new question.

Concrete fix: make “Start over” wait for confirmed deletion before enabling the fresh composer. `remove` needs a completion result, not just optimistic dispatch. On failure, do not permit a new Remember send that would silently rejoin the old thread. Add a test with a deliberately delayed DELETE proving no new POST is issued before deletion succeeds.

---

**F2 — P1 — Moving a pending attempted answer breaks its in-flight writer.**

The migration preserves `attempt_id` while changing `thread_id` ([plan:72](</home/greg/code/spideryarn2/.claude/worktrees/fb-remember-own-thread/docs/plans/261001m-remember-is-its-own-single-thread.md:72>)). But `finish` matches the original `(article_id, thread_id, message_id, attempt_id)` ([pg-chat.ts:471](</home/greg/code/spideryarn2/.claude/worktrees/fb-remember-own-thread/src/store/pg-chat.ts:471>)).

If a pending row belongs to a folded-away thread, an already-running model call later finishes against the old thread ID, updates zero rows, and the moved row eventually becomes a swept error. The generated answer is lost.

Concrete fix: under the migration lock, abort if any doomed thread has `status='pending' AND attempt_id IS NOT NULL`, unless deployment guarantees all old workers are quiescent. An alternative is choosing the sole active thread as keeper, but that still needs an abort when multiple folded threads have live attempts. Add this case to the migration test.

“Keep earliest” is right once live attempts are excluded.

---

**F3 — P1 — The client follows a new server ID, but does not coalesce it with an ID already present locally.**

The plan relies on the existing `begin` handoff ([plan:97](</home/greg/code/spideryarn2/.claude/worktrees/fb-remember-own-thread/docs/plans/261001m-remember-is-its-own-single-thread.md:97>)). `withServerIds` currently renames the provisional thread but never checks whether `begun.threadId` already names another local thread ([model.ts:995](</home/greg/code/spideryarn2/.claude/worktrees/fb-remember-own-thread/src/web/chat/model.ts:995>)).

A stale/old tab that contains both the canonical Remember thread and a provisional new one ends with two array entries sharing the canonical ID. `ChatPanel` opens the first with `find` ([ChatPanel.tsx:363](</home/greg/code/spideryarn2/.claude/worktrees/fb-remember-own-thread/src/web/ChatPanel.tsx:363>)); the optimistic question or streamed answer can therefore appear in the other, invisible duplicate.

Concrete fix: at `turn.began`, if the target ID already exists, merge the provisional question/reply into that thread and remove the provisional entry. Test both array orders: canonical-before-provisional and provisional-before-canonical.

---

**F4 — P1 — The spoken conflict is safe for ordering but incomplete for navigation and recovery.**

Refusing a spoken append whose `expectedTailId` did not see the canonical thread is correct ([plan:101](</home/greg/code/spideryarn2/.claude/worktrees/fb-remember-own-thread/docs/plans/261001m-remember-is-its-own-single-thread.md:101>)). Silently appending would defeat the tail guard.

The problem is that `ChatConflict` carries no canonical thread ID. The client repairs the stale requested ID, while the new Remember UI has no list from which to find the real conversation. The reader’s spoken exchange is refused and the URL stays on the provisional thread until they reload or send a typed turn.

Concrete fix: return a typed 409 carrying the canonical `threadId`. On this conflict the client should:

- preserve or clearly expose the unsaved spoken transcript;
- hang up;
- switch `?thread=` to the canonical ID;
- refresh that thread.

Do not silently append the spoken exchange.

---

**F5 — P1 — The fold and unique-index creation have a concurrent-insert window.**

The plan folds rows and then creates the index ([plan:59](</home/greg/code/spideryarn2/.claude/worktrees/fb-remember-own-thread/docs/plans/261001m-remember-is-its-own-single-thread.md:59>)). Without an explicit table lock, an old production instance can insert a second Remember thread after the fold query but before `CREATE UNIQUE INDEX` acquires its lock. The index then fails validation and blocks deployment.

Concrete fix: acquire a write-conflicting lock on `chat_threads` before inspecting/folding, held through index creation—for example `SHARE ROW EXCLUSIVE`. All normal creators go through the thread upsert, so this closes the window. Coordinate this with F2: blocked in-flight finishes must not resume against moved thread IDs.

---

**F6 — P2 — An effect-based auto-selection can briefly render the list the plan says never exists.**

The plan says “Remember never shows a list,” but selects the canonical thread only after load ([plan:117](</home/greg/code/spideryarn2/.claude/worktrees/fb-remember-own-thread/docs/plans/261001m-remember-is-its-own-single-thread.md:117>)). The present panel renders `ThreadList` whenever no selected thread matches ([ChatPanel.tsx:584](</home/greg/code/spideryarn2/.claude/worktrees/fb-remember-own-thread/src/web/ChatPanel.tsx:584>)). A normal `useEffect` runs after the first committed render, so arrivals with an existing thread can flash the list.

Concrete fix: derive an effective Remember thread directly during render and separately synchronize the URL in an effect. While creating the first local thread, render a starting state or the single-thread shell—not `ThreadList`. Test the intermediate render, not only the settled DOM.

---

**F7 — P2 — Advisory-reference migration must use the article-scoped thread identity, and comments should be preserved too.**

Thread IDs are explicitly unique only within an article ([schema.ts:3198](</home/greg/code/spideryarn2/.claude/worktrees/fb-remember-own-thread/src/db/schema.ts:3198>)). Therefore the realtime update in [plan:74](</home/greg/code/spideryarn2/.claude/worktrees/fb-remember-own-thread/docs/plans/261001m-remember-is-its-own-single-thread.md:74>) must join on both `article_id` and old `thread_id`. Updating on text ID alone can corrupt another article’s historical session.

The supported route only links comments to chats, so the plan’s comment reasoning is true for valid application writes. But `comments.thread_id` deliberately has no FK or kind constraint ([schema.ts:1791](</home/greg/code/spideryarn2/.claude/worktrees/fb-remember-own-thread/src/db/schema.ts:1791>)). Repointing any matching advisory comment is cheap and preserves anomalous/imported/manual data rather than leaving a dead link.

Concrete fix: build a mapping table/CTE containing `(article_id, folded_id, kept_id)` and use it for both `realtime_sessions` and `comments`. Test that an identical thread ID in another article remains untouched.

---

**F8 — P2 — “Kept message count + position” assumes dense ordinals the schema does not enforce.**

The plan starts moved ordinals at the keeper’s message count ([plan:69](</home/greg/code/spideryarn2/.claude/worktrees/fb-remember-own-thread/docs/plans/261001m-remember-is-its-own-single-thread.md:69>)). The database only enforces uniqueness and non-negativity ([schema.ts:3453](</home/greg/code/spideryarn2/.claude/worktrees/fb-remember-own-thread/src/db/schema.ts:3453>)), not `0…count-1`.

For keeper ordinals `0,2`, count is `2`, so the first moved row collides with ordinal `2`.

Concrete fix: either preflight and abort on non-dense affected threads, or begin moved ordinals at `coalesce(max(ordinal), -1) + row_number()`. Add a sparse-ordinal migration case.

---

**F9 — P2 — The proposed owner-aware index is more future-proof than the server rule.**

The index permits one Remember thread per `(article_id, owner_id)` ([plan:55](</home/greg/code/spideryarn2/.claude/worktrees/fb-remember-own-thread/docs/plans/261001m-remember-is-its-own-single-thread.md:55>)), but `threadsFor` loads every thread for the article without owner filtering ([pg-chat.ts:198](</home/greg/code/spideryarn2/.claude/worktrees/fb-remember-own-thread/src/store/pg-chat.ts:198>)), and the pure resolver has no owner information. If shared articles ever arrive, the server could append to another owner’s Remember thread even though the index is “right.”

Concrete fix: use the simpler unique index on `article_id` today, because article identity already belongs to one reader. Add `owner_id` only alongside owner-scoped loading/resolution if shared articles are introduced. Otherwise, update the store and resolver now so the claimed future behavior is real.

## Other conclusions

- Runtime creators are covered: only `pgChatStore.begin` and `appendSpoken` insert/upsert threads. Retry and edit only update existing rows; export is read-only; admin is read-only. The fixture seeder inserts directly and will simply need to obey the new index.
- Typed fold-and-append is preferable to a 409. Typed sends have no tail contract, the reader’s exact words are retained, and one-thread semantics make the canonical destination unsurprising. F3 is the missing client half.
- Earliest-created is a sensible keeper after excluding active pending attempts. Ordering whole conversations by thread creation, then their internal ordinal, is also preferable to timestamp interleaving.
- The two-row composer under `max-height: 500px` is a reasonable measured v1. Because the band is fixed between the controls and dock, viewport height closely tracks available band height. Implementation must account for the current hard-coded `rows={6}` and inline 360px auto-sizing; merely lowering CSS `max-height` to two rows would also prevent growth. Test both an empty composer and a long dictated value at 844×390.
- The materially simpler migration, given measured production has zero duplicate groups, is: lock, assert no duplicates, create the index. If the assertion fails, abort and perform a separately reviewed fold under quiescence. That removes F2, F7, and F8 from the deploy-critical migration. If automatic folding across arbitrary databases is a firm requirement, keep the fold and address them explicitly.

No files were changed and no tests were run; this was a read-only plan review.