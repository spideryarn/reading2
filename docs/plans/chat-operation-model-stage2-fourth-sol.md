# DO NOT SHIP

1. **P1 — the pre-`begin` delete/rename race remains open.**

   A provisional DELETE may answer successfully before `turn.began`. Its operation then retires. When `turn.began` arrives, `renamed()` only reissues operations still in the map, so it emits nothing. My direct reducer probe produced `commands: []`.

   This is reachable: the turn awaits article loading before creating the conversation, while deleting a missing thread reports success. The common case also keeps the client’s thread ID, and `renamed()` immediately returns when the IDs match. [routes.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/routes.ts:1196), [chat.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/chat.ts:207), [chat.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/chat.ts:337), [reduce.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/chat/reduce.ts:569), [reduce.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/chat/reduce.ts:998).

   The regression test only exercises `turn.began` before the DELETE result. [chat-reduce.test.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/chat-reduce.test.ts:1644)

2. **P2 — a pre-`begin` rename is visibly overwritten.**

   `rename.started` writes the reader’s title into `base`, but the opening turn’s `begin` then replaces it with `begun.title`. Rename success writes nothing back. My probe renamed to `mine`; after `begin`, the title was `why?`. [reduce.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/chat/reduce.ts:287), [model.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/chat/model.ts:837), [reduce.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/chat/reduce.ts:977)

Direct answers:

- **Finding 1:** closed. The identity rule is sound for reducer-owned `base`; committed changes replace the thread object, while live projections safely redraw over an admitted repair.
- **Finding 2:** narrowed again. `names(event)` performs the right surviving state transition, but the rename/delete operation may already have retired before it can be reissued.
- **Finding 3:** closed for every takeover in the current operation model: replacement, in-flight supersession, and final delete ownership.
- **Stage 2:** not done.
- **Stage 3:** the two stated narrowings are fair, but the suite overclaims permutation coverage. The naming test samples three orders and always puts `turn.began` last; the superseded symmetry test says it covers repair but only exercises rename and intent. [chat-invariants.test.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/chat-invariants.test.ts:463), [chat-invariants.test.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/chat-invariants.test.ts:592)

Vitest could not start because the read-only sandbox blocked its Vite temp file. Scoped lint passed with one complexity advisory. Typecheck had only unrelated shared-tree errors. No files changed.