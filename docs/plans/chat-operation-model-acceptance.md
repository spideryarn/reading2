# Acceptance list: what today's `ChatApi` does, and what would catch it breaking

Reference for [chat-operation-model.md](chat-operation-model.md) § "What the façade must still do,
exactly as it does now". For each of the eight items, where it is implemented in
`src/web/useChat.ts`, and the test — if any — that would go red if it broke. Found by grepping for
the behaviour and reading the test body to confirm it asserts the thing, not merely that it runs the
code path.

| # | Behaviour | Implemented at | Test that would catch a break | Verdict |
|---|---|---|---|---|
| 1 | `send` returns a thread id synchronously (before any request) | `useChat.ts:1469–1563`, `return id;` at 1560 | `tests/chat-arrival-race.test.ts`, "does not take away a question the reader sent while it was still in flight" — `made = api().send(...)` is a plain (unawaited) call inside an `act` callback, and `made` is later asserted to equal `sentTo`, the thread id read back out of the POST body. If `send` returned a promise or `undefined`, that equality would fail. | PINNED |
| 2 | `begin` returns a thread id synchronously | `useChat.ts:839–862`, `return id;` at 861 | `tests/chat-arrival-race.test.ts`, "keeps a conversation the reader started while it was still in flight" — `made = api().begin("chat")`, then `expect(ids()).toEqual([made])`. Same reasoning: `made` has to already be the real id for this to pass. | PINNED |
| 3 | `onThreadId` fires when the server overrules the optimistic thread id | `useChat.ts:1319–1325`, inside `nameRow` (called from `run`'s `begin` frame) | None. `grep -rn "onThreadId" tests/` returns zero hits — the callback is never passed by any test, let alone asserted to fire. | UNPINNED |
| 4 | The reader's question and the empty answer row appear before the request leaves | `useChat.ts:1493–1535` (`setThreads` in `send`), which runs before `run` is called at 1543 | `tests/use-chat-recovery.test.ts`, "fails a send whose request is never answered at all" — the POST is stubbed to hang forever (`postBody = "hang"`), and directly after `send()` and one `settle()`, `expect(row2()?.status).toBe("pending")` passes. The row can only exist with that status while the POST is still open if it was written before the request could possibly have returned. | PINNED |
| 5 | A retry blanks the replaced answer's fields, carrying only `stance` across | `useChat.ts:1565–1602` (`retry`) | None. `retry` is called in `tests/chat-edit-guard.test.ts` and `tests/chat-error-scope.test.ts`, but the former only asserts `expectedTailId` is absent from the retry's POST body, and the latter only asserts on `error` and cross-article scoping. Nothing reads the row's `citations`, `tools`, `searches`, `error`, or `stance` after a retry. (`stance` does appear in `chat-list-composer.test.tsx` and `chat-list-loading.test.tsx`, but on the optimistic row from `send`, not on a retried row.) | UNPINNED |
| 6 | A refused edit (409) puts the discarded turns back | `useChat.ts:1392–1396` (the 409 branch in `run`, which calls `refreshThread`) + `refreshThread` at 714–736 | None. `.edit(` on the client hook is only called in `tests/chat-edit-guard.test.ts`, whose stub always returns `ok: true` — no test ever gives an edit a 409. `tests/chat-error-scope.test.ts` does exercise the 409 branch, but only by calling `retry`, not `edit`, and its assertions are about `error` staying scoped to the right article, not about the discarded turns reappearing. | UNPINNED |
| 7 | A refused cancel (409) puts the conversation back | `useChat.ts:1002–1014` (the `catch` in `askToCancel`) | None. `grep -rn "cancelAndDiscard" tests/` returns zero hits — the function is never called by any test. This matches the plan document's own note (line 205–206): "no test in `tests/` calls `stop` or `cancelAndDiscard` on the hook." | UNPINNED |
| 8 | A failed rename or delete does **not** roll back, and sets `error` | `useChat.ts:1669–1684` (`write`, shared by `rename` and `remove`) | None. `.rename(` on the client hook has zero call sites anywhere in `tests/` — not even a passing case. `.remove(` is called in `chat-arrival-race.test.ts` and `use-chat-recovery.test.ts`, but both stub the DELETE as succeeding; neither test makes it fail and checks that the thread stays gone from screen with `error` set. | UNPINNED |

**6 of 8 UNPINNED.**

## What else would silently survive a rewrite

Things I actually checked, not a guess at coverage gaps:

- **`rename` has no test at all, not even a passing one.** Nothing asserts the optimistic title
  change happens, that the PATCH body carries the new title, or that it round-trips. A rewrite could
  drop the optimistic update entirely — or swap `title` for the wrong field — and every suite would
  stay green.
- **`stop` has zero call sites in `tests/`,** same as `cancelAndDiscard`. The whole
  "wish recorded before the `begin` frame names the row" mechanism (`stopWanted`/`cancelWanted`,
  and after this refactor the `intent` field) has no test forcing a stop or a cancel through that
  window — confirmed by grep, and it is exactly the case Sol asked stage 3 to add tests for because
  nothing today exercises it.
- **The `attempt` field never gets checked in a request body.** `askToStop` and `askToCancel` both
  send `attempts.current.get(messageId)`, and nothing in `tests/` reads a POST body from either call
  to confirm the right attempt token went out — consistent with neither function ever being called
  by a test in the first place.
