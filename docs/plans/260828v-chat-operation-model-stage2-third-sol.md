# DO NOT SHIP

1. **P1 — the repair rule is narrowed again, not closed.**

   A completed edit replaces the edited question and truncates everything after it. `touching()` records only the rewritten question and new answer IDs. The merge therefore restores the old answer and every later turn from the stale snapshot. [project.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/chat/project.ts:36), [reduce.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/chat/reduce.ts:212), [reduce.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/chat/reduce.ts:835).

   The new edit test only checks the question text. It passes with the broken result `q1, old-a1, new-a`, and never checks the row set. [chat-reduce.test.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/chat-reduce.test.ts:928).

   There is a second hole: a `null` repair deletes the whole thread without consulting `touched`. A send started after the repair—live or completed—is removed outright. A live operation cannot re-project because its thread has disappeared. [reduce.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/chat/reduce.ts:925).

   `touched` describes row replacements, not the full class of later mutations: append, replace, truncate, and recreate-after-absence. The class remains open.

2. **P1 — the single supersession rule over-applies to `turn.began`.**

   `turn.began` is not merely the superseded turn writing its answer; it carries the server’s real address. Delete a new conversation before `begin`, and `delete.started` supersedes the turn. The global rule then discards the later `turn.began`, so neither the tombstone nor delete follows the corrected ID. The already-issued DELETE still names the provisional ID and succeeds even when it removed nothing; the real conversation returns on reload. [reduce.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/chat/reduce.ts:288), [reduce.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/chat/reduce.ts:1030), [chat.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/chat.ts:207).

   So “superseded means does absolutely nothing” is too broad. A superseded turn’s naming event may still be required by the operation that superseded it.

3. **P2 — supersession does not always transfer tombstone ownership.**

   A second already-sent cancel supersedes the first, but inherits its tombstone only when the first was still waiting. If both requests fail, the first failure is silenced and the second cannot lift the first’s tombstone. The conversation remains hidden. [reduce.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/chat/reduce.ts:419). The inheritance test covers only two pre-`begin`, unsent cancels. [chat-reduce.test.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/chat-reduce.test.ts:1495).

Direct answers:

- **Finding 2:** narrowed again.
- **Supersession:** correct for repairs, renames, recovery-after-delete and ordinary stale results; wrong as an unconditional rule for `turn.began`, and its takeover premise is incomplete for sent cancels.
- **`renamed()`:** it covers all reducer-owned thread-ID locations: `base`, tombstones and operations. The fourth holder is outside state: commands and requests already emitted with the old ID. They cannot be repaired by rewriting the operation afterward.
- **Other fixes:** `detach()` is right; superseded repair failures are now correctly silent; every reducer-visible asynchronous result passes the gate.
- **Stage 2:** not done. Stage 3 is not yet only the seven permutations and rename fence.

The read-only sandbox prevented executing the test harness because `tsx` could not create its IPC socket. No files were changed.