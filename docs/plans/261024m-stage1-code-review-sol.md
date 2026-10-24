Candidate `339091370` was not ready as written. I fixed four server-stage issues; one wider pre-existing client retry issue remains reported only.

### Findings

- **S1 — P1 — Pre-model failures could consume or strand an automatic fill.**  
  After taking the allowance, prompt/context setup failures were followed by `release()`, retaining the fill; a smaller gap before the streaming `try` could leave the lease live until expiry. Fixed by wrapping everything after admission in one terminal `finally`, tracking the actual provider boundary via [src/converse.ts](/var/tmp/spideryarn-worktrees/qhc4y2j-citation-card-chat/src/converse.ts:2206), and refunding when it was never crossed in [src/routes.ts](/var/tmp/spideryarn-worktrees/qhc4y2j-citation-card-chat/src/routes.ts:3816). Settlement is one-shot in [src/cite-check.ts](/var/tmp/spideryarn-worktrees/qhc4y2j-citation-card-chat/src/cite-check.ts:125).

- **S2 — P1 — The concurrency lease was released before gist model/store work.**  
  This contradicted C10 and could admit two more automatic checks while two earlier gist calls still ran. Fixed by moving settlement after `refreshGist` in [src/routes.ts](/var/tmp/spideryarn-worktrees/qhc4y2j-citation-card-chat/src/routes.ts:4334). Added a Postgres regression test at [tests/chat-origin-route.test.ts](/var/tmp/spideryarn-worktrees/qhc4y2j-citation-card-chat/tests/chat-origin-route.test.ts:1009).

- **S3 — P2 — A throwing `res.end()` skipped allowance settlement.**  
  The candidate called `res.end()` before releasing the lease. Fixed by the same outer `finally`; added a regression at [tests/chat-origin-route.test.ts](/var/tmp/spideryarn-worktrees/qhc4y2j-citation-card-chat/tests/chat-origin-route.test.ts:1057).

- **S4 — P2 — The stored title snapshot was not bound to the authoritative work.**  
  A malformed client could ask the exact question about work A while saving a thread titled as work B. Fixed by requiring `origin.quote === originName(work.title)` in [src/cite-check.ts](/var/tmp/spideryarn-worktrees/qhc4y2j-citation-card-chat/src/cite-check.ts:197). The new test was observed red before the fix.

- **S5 — P2 — Reported, not fixed: wider existing behavior.**  
  If an ordinary initial Chat send fails before `begin`, “Answer again” sends `retry` using provisional IDs ([useChat.ts](/var/tmp/spideryarn-worktrees/qhc4y2j-citation-card-chat/src/web/useChat.ts:764), [useChat.ts](/var/tmp/spideryarn-worktrees/qhc4y2j-citation-card-chat/src/web/useChat.ts:912)); the server has no thread to retry. This predates cite-check and is outside this stage.

The suspected same-ID `withTurn` refusal is correct: an uncommitted first attempt leaves no holder and can be resent; a committed attempt whose response was lost returns the authoritative thread ID for adoption.

The remaining audit was clean:

- Every named refusal before a model call is free; transactional and unique-index races refund.
- `cancel` deletes only the named fill owned by the current reader.
- Success, error, stop, thrown provider errors, and disconnect retain the fill and release the slot exactly once.
- Socket close only suppresses writes.
- Client and server build the question through the same functions; block prose is not part of it.
- Migration CHECKs match the schema, the existing item CHECK admits cite-check rows, and `chat_threads_one_cite_check` matches the store constant.
- Other origins, retry/delete-from behavior, labels, owner isolation, and untrusted-text fencing remain intact.

### Verification

- 101 relevant pure tests passed.
- `converse-ceiling` and `converse-stop`: 23 passed.
- Server `tsc --noEmit -p tsconfig.json`: passed.
- `npm run db:chain`: passed.
- Scoped lint: no errors.
- The new Postgres route tests could not run in this sandbox.
- Repository-wide typecheck/client tests are currently blocked by unrelated concurrent stage-2 edits in `useHoverCard.ts` and `Reader.tsx`; I left those files untouched.

Verdict: the server patch now matches the stage specification, pending a Postgres rerun of `tests/chat-origin-route.test.ts`. No commit or migration was performed.

Modified files:

- `src/cite-check.ts`
- `src/converse.ts`
- `src/routes.ts`
- `tests/cite-check.test.ts`
- `tests/chat-origin-route.test.ts`