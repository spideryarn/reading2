## Findings

1. **P1 — fixed: stale gists could survive transcript changes or expose a newly opened Recall hint.** The millisecond timestamp CAS could not detect same-millisecond writes or `hintOpenedAt`, which deliberately leaves `updated_at` unchanged. `setGist` now compares the actual transcript snapshot atomically under the article lock; begin, retry, edit, spoken turns, and first hint opening clear the old gist. Tests cover identical timestamps and an in-flight pre-hint gist. [pg-chat.ts:735](/var/tmp/spideryarn-worktrees/fbwhq0j0-chat-knows-other-threads/src/store/pg-chat.ts:735), [chat-gist-store.test.ts:102](/var/tmp/spideryarn-worktrees/fbwhq0j0-chat-knows-other-threads/tests/chat-gist-store.test.ts:102)

2. **P1 — fixed: a superseded attempt could generate a gist for another attempt’s answer.** Reply IDs survive retries, so checking only ID plus `done` was insufficient. `finish` now returns whether its attempt-fenced update landed, and `streamChat` refreshes only on `true`. The flag is set before the final socket write so a disconnect after storage does not lose the gist. [pg-chat.ts:488](/var/tmp/spideryarn-worktrees/fbwhq0j0-chat-knows-other-threads/src/store/pg-chat.ts:488), [routes.ts:3853](/var/tmp/spideryarn-worktrees/fbwhq0j0-chat-knows-other-threads/src/routes.ts:3853)

3. **P1 — fixed: rollback restore silently discarded exported gists.** `src/store/export.ts` wrote `gist`, but the hand-written restore helper did not insert it. It now does, with a round-trip assertion. The downloadable bundle already spreads the complete row and therefore retains both `gist` and `gist_at`. [seed-reader-state.ts:283](/var/tmp/spideryarn-worktrees/fbwhq0j0-chat-knows-other-threads/tests/helpers/seed-reader-state.ts:283), [store-export-thread-kind.test.ts:122](/var/tmp/spideryarn-worktrees/fbwhq0j0-chat-knows-other-threads/tests/store-export-thread-kind.test.ts:122)

4. **P2 — fixed: the fallback could describe an older topic.** It previously used the latest settled exchange, so a newer pending or failed question disappeared. It now names the latest actual user question, including a renamed one-exchange thread. [reader-notes.ts:308](/var/tmp/spideryarn-worktrees/fbwhq0j0-chat-knows-other-threads/src/reader-notes.ts:308)

5. **P2 — fixed: two stated hard budgets were not truly hard.** Gist input omitted the fence and omission notice from its 16,000-character accounting, and the complete other-conversations section had only a row budget. Both complete payloads are now bounded and tested, including hostile delimiters and long gists. [chat-gist.ts:96](/var/tmp/spideryarn-worktrees/fbwhq0j0-chat-knows-other-threads/src/chat-gist.ts:96), [reader-notes.ts:474](/var/tmp/spideryarn-worktrees/fbwhq0j0-chat-knows-other-threads/src/reader-notes.ts:474)

6. **P2 — fixed: established route tests would mistake the background gist request for another foreground request.** The Chat Help, visible-blocks, Guide, and High-powered AI stubs now identify and answer `conversation_gist` separately.

7. **P2 — unresolved design evidence:** plan-review point 6 was not performed. The eval compares model-written gists against no list, but never compares them with the proposed recent-question/answer preview, which could remove the migration, paid call, and lifecycle machinery. [chat-other-threads.ts:14](/var/tmp/spideryarn-worktrees/fbwhq0j0-chat-knows-other-threads/evals/chat-other-threads.ts:14). I corrected the plan’s claim that all six review points had been handled.

Lifecycle inspection otherwise checks out: response end and queue release precede the gist; errors do not gist; disconnects and stopped answers do when storage lands; superseded attempts do not. The model call remains inside request spend and owner attribution, and Vercel keeps the whole handler promise alive. A following turn can overlap the model call; only the short final compare/write transaction can briefly contend on the article lock. [routes.ts:3905](/var/tmp/spideryarn-worktrees/fbwhq0j0-chat-knows-other-threads/src/routes.ts:3905)

All job registrations, model routing, effort, cost disposition, plain-words exemption, `NON_TASK_MODELS`, schema/type mapping, migration registry, and exports are present. Prompt/tool wording is narrow and does not contradict the existing notes rule.

## Files I changed

- `src/chat-gist.ts` — made the input cap exact; corrected fallback documentation.
- `src/chat-tools.ts` — corrected stale private-context documentation.
- `src/reader-notes.ts` — corrected fallback selection and added a complete-section cap.
- `src/routes.ts` — fenced superseded attempts and disconnect-after-storage.
- `src/store/contracts.ts` — returned `finish` landing status and passed a transcript snapshot to `setGist`.
- `src/store/pg-chat.ts` — robust transcript CAS and stale-gist invalidation.
- `tests/chat-gist.test.ts` — fallback and hard-budget coverage.
- `tests/chat-gist-store.test.ts` — same-millisecond, hint, invalidation, and attempt-fence coverage.
- `tests/chat-help-route.test.ts`, `tests/chat-visible-route.test.ts`, `tests/guide-route.test.ts`, `tests/high-power-routes.test.ts` — separated gist requests from foreground request assertions.
- `tests/helpers/seed-reader-state.ts` — restore exported gists.
- `tests/store-export-thread-kind.test.ts` — pin gist export/restore.
- `tests/reader-notes-tool.test.ts` — pin digest budget with maximum-length gists.
- `docs/plans/261008e-chat-knows-the-reader-s-other-conversations.md` — corrected lifecycle/fallback details and recorded the unrun alternative evaluation.

Verification:

- Typecheck: passed all 3,514 covered files.
- Pure touched suites: 4 files, 185 tests passed.
- `git diff --check`: passed.
- Lint: no errors; existing complexity/style advisories remain.
- The requested combined suite and `npm test` could not start because this sandbox denies the local PostgreSQL connection (`EPERM 127.0.0.1:54362`). Therefore the changed store, export, and route suites remain unexecuted here.

DO NOT SHIP