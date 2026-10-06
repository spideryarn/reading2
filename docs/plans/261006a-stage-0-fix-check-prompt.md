# Fix check: stage 0 of 261006a, findings S0-1 and S0-2

Read-only, and narrow. Do not change any file. Discovery is closed: this checks two fixes only.

**Candidate:** commit 59f243183 in /var/tmp/spideryarn-worktrees/learn-rename-s0
(`git show 59f243183 --stat`). It answers your review in
docs/plans/261006a-stage-0-code-review-sol.md. The fixes were written by another model and are
unreviewed code.

- **S0-1** (`rename` / `remove` in src/store/pg-chat.ts committed, then read the list outside the
  transaction): both now return `threadsFor(articleId, tx)` from inside the locked transaction.
- **S0-2** (the refusal arrived as a 500, which the browser commits): `UnknownStoredThreadKind` in
  src/types.ts now carries `status = 409` and the reader's sentence `CHAT_BEING_UPDATED`
  (src/messages.ts, `[db-updating]`), using the typed-status door in src/store/db-errors.ts.
- Tests: tests/unknown-thread-kind-refuses-cleanly.test.ts (five), and one changed assertion in
  tests/unknown-stored-thread-kind.test.ts.

**Answer three questions.**

1. Is each finding closed? For S0-2, trace it: does every route that can throw this class answer
   409 with a body the client's refusal path accepts (src/web/chat/effects.ts § runTurn and
   whatever reads the 409 body), for retry and edit specifically?
2. Does a 409 from this class do harm anywhere a 500 did not? Every chat route can now answer 409
   (list, rename, delete, spoken append, hint, realtime setup). Is there a caller that treats a 409
   as a *specific* other refusal (a conflict to repair, a "thread is busy", an attempt already
   taken) and then does something wrong or loops: a repair fetch that is refused again and
   retried without bound, a Live session torn down, a draft discarded?
3. The export (src/store/export.ts) throws the same class from a CLI path: anything there that
   keys on `status`?

Raw results from my runs (you have no network for Postgres):

```
tests/unknown-thread-kind-refuses-cleanly.test.ts  5 passed
tests/unknown-stored-thread-kind.test.ts           3 passed
tests/store-chat-pg.test.ts 28 passed; chat-route 3; db-error-scrub 20; chat-edit-guard 13;
chat-hint-opened-route 9; store-guard-idempotent 3; npm run typecheck clean
mutations: rename read moved back outside -> rename test red; same for remove; status removed -> all 5 red
```

Severity scale: P0 data loss, security, charging, service broadly unusable. P1 user-visible wrong
behaviour or a contract violated. P2 design risk, no wrong behaviour today. P3 prose. ID findings
FC-1 …, established or suspected, file and symbol, what to do. Verdict: closed / still open.

Accepted already: in the deploy window, chat on an article holding a Learn thread is refused for a
few minutes, now with this sentence.
