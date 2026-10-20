As submitted: **refuse**. The review established multiple P1 contract violations. I fixed the in-stage findings without committing, but the literal “nothing is written anywhere” invariant remains too strong because Supabase authentication deliberately writes through to the administrator’s real browser storage.

## Findings

- **C1 — P1 — established: comment-prefixed transaction ends escaped the database guard.**  
  (a) `/* nested */ COMMIT`, or `-- comment\rCOMMIT`, followed by an insert left the wrapper believing the transaction was still active, so the insert could autocommit.  
  (b) Transaction control now uses PostgreSQL-aware comment tokenisation, changes state only after success, and destroys a client released in an uncertain transaction.

- **C2 — P1 — established: `PREPARE TRANSACTION` could detach the guarded transaction.**  
  (a) With prepared transactions enabled, `PREPARE TRANSACTION 'x'` ends the server transaction while the old wrapper retained `inTransaction = true`. Supabase probably disables prepared transactions, but the boundary did not enforce that assumption.  
  (b) All two-phase transaction preparation is refused before execution.

- **C3 — P1 — established contract violation: chained transactions were not pinned.**  
  (a) `COMMIT AND CHAIN` or `ROLLBACK AND CHAIN`, followed by `SET TRANSACTION READ WRITE`, could change the new transaction’s mode, contrary to the documented guarantee.  
  (b) Chained transactions remain tracked and immediately run `SELECT 1` to pin their inherited read-only mode.

- **C4 — P1 — established: PostgreSQL `READ ONLY` is not a complete side-effect boundary.**  
  (a) `NOTIFY`, `pg_notify`, `set_config`, session advisory locks, SQL prepared statements, held cursors, `LOAD`, named driver statements, and privileged `COPY` were accepted.  
  (b) Known session/external-effect forms are now refused. Ambiguous backslash literals and `U&"…"` identifiers fail closed; bound values remain unaffected.

- **C5 — P1 — established: control requests queued ordinary arrival work.**  
  (a) `/current` and `/end` carrying the view-as header reached `noteArrival`, which can write `reader_arrivals` and send signup mail.  
  (b) View-as control requests now skip the ordinary arrival epilogue.

- **C6 — P1 — established: Referee scanning mutated process state.**  
  (a) A cold `GET /api/referee/scan/:slug` filled the module-level scan cache.  
  (b) A marked request now neither reads nor fills that cache.

- **C7 — P1 — established: a nullable address discarded the expiry.**  
  (a) `/current` returning `subjectEmail: null` made the client reject the whole valid response and never arm its expiry timer.  
  (b) Email is nullable and the bar falls back to the subject ID.

- **C8 — P1 — established: subject pages mounted before `/current` authorized them.**  
  (a) If the first `/current` hung or failed, the shelf could load without an expiry and remain visible indefinitely.  
  (b) Subject pages stay unmounted until `/current` returns a valid identity and expiry.

- **C9 — P1 — established: authorization revocation was not terminal.**  
  (a) Actor demotion and subject promotion returned 403s that the 410-only client ignored; `/current` also failed to recheck subject-admin status.  
  (b) Those refusal codes now end the tab, and `/current` rechecks the subject.

- **C10 — P1 — reasoned, with event-level regression coverage: history could restore an ended document.**  
  (a) After SPA navigation, `location.replace("/")` replaced only the newest history entry; Back could restore an older view-as document from bfcache.  
  (b) The document is hidden synchronously on `pagehide` and redirected on persisted `pageshow`. A real-browser bfcache run was not available here.

- **C11 — P1 — established: auth broadcasts wrote the administrator’s offline cache.**  
  (a) A Supabase `SIGNED_OUT` event called `rememberUser(null)` and `forgetUser(admin)`, writing IndexedDB; an account switch could also leave subject state mounted.  
  (b) View-as skips offline-cache bookkeeping and ends on sign-out or account change.

- **C12 — P2 — established: the boot pass-through was a namespace, not one capability.**  
  (a) Any newly written `sb-*-auth-token`-shaped key passed through to real localStorage.  
  (b) Only matching auth keys already present when the boot script runs may pass through.

- **C13 — P2 — established: the AsyncLocalStorage lifetime documentation was false.**  
  (a) A timer created inside `runViewingAs` retains the marker after the callback returns; a shared queue created outside can lose it. No current allowlisted handler does either.  
  (b) The documentation now states the real lifetime and forbids detached/externally drained work.

- **C14 — P1 — established and still deliberate: authentication can write real browser storage.**  
  (a) A refresh of an auth key present at boot calls the real localStorage implementation.  
  (b) Closing this requires a different isolated-auth design; this patch restricts the capability and documents the exception. This is the remaining established reason the literal invariant must be refused.

- **C15 — P2 — established residual boundary.**  
  (a) PostgreSQL still permits writes to an existing temporary table, and SQL inspection cannot enumerate every privileged extension function with external effects. No current allowlisted handler uses either.  
  (b) The full closure is a restricted role with no temporary-table privilege and tightly limited function grants, which was explicitly out of scope.

- **C16 — P2 — reasoned residual boundary.**  
  (a) The bfcache mitigation prevents redisplay but does not prove that the browser never physically retains the hidden document.  
  (b) The guarantee is now stated as hide-and-redirect, not absence from bfcache.

The other gate properties held: unknown routes, HEAD, OPTIONS, unlisted/admin routes, malformed or foreign nonces, stopped/expired sessions, demoted actors, and promoted subjects fail closed. No allowlisted handler currently uses SSE, detached timers, a queue, another application pool, a service worker, or an application BroadcastChannel.

## Verification

- Focused view-as/client/source/doc tests: **71 passed**
- New database guard unit tests: **15 passed**, including observed red-first lexer and session-state cases
- Typecheck fallback: **passed across 3,889 source files**
- Biome on reviewed database files: **passed**
- `git diff --check`: **passed**
- PostgreSQL integration tests were added but could not run because the sandbox rejects localhost/Docker access with `EPERM`.
- The candidate’s earlier full-suite result does not cover these uncommitted fixes.

## Files changed

- Runtime: [index.html](/var/tmp/spideryarn-worktrees/admin-view-as/index.html), [src/db/client.ts](/var/tmp/spideryarn-worktrees/admin-view-as/src/db/client.ts), [src/routes.ts](/var/tmp/spideryarn-worktrees/admin-view-as/src/routes.ts), [src/source-scan.ts](/var/tmp/spideryarn-worktrees/admin-view-as/src/source-scan.ts), [src/view-as-scope.ts](/var/tmp/spideryarn-worktrees/admin-view-as/src/view-as-scope.ts), [src/web/App.tsx](/var/tmp/spideryarn-worktrees/admin-view-as/src/web/App.tsx), [src/web/ViewAsBar.tsx](/var/tmp/spideryarn-worktrees/admin-view-as/src/web/ViewAsBar.tsx), [src/web/lib/api.ts](/var/tmp/spideryarn-worktrees/admin-view-as/src/web/lib/api.ts), [src/web/lib/view-as.ts](/var/tmp/spideryarn-worktrees/admin-view-as/src/web/lib/view-as.ts), [src/web/view-as-session.ts](/var/tmp/spideryarn-worktrees/admin-view-as/src/web/view-as-session.ts)
- Tests: `tests/source-scan.test.ts`, `tests/view-as-api.test.ts`, `tests/view-as-boot.test.ts`, `tests/view-as-db-guard.test.ts`, `tests/view-as-gate.test.ts`, `tests/view-as-tab.test.tsx`
- Project docs: `docs/project/admin.md`, `docs/project/security-map.md`, `docs/project/security.md`
- Postmortems: `docs/postmortems/261020b-a-read-only-handler-is-not-a-read-only-request-lifecycle.md`, `261020c-a-sql-regex-state-machine-cannot-own-the-server-transaction-state.md`, `261020d-authorization-expiry-must-remove-data-already-on-screen.md`

No commit was created, and the two pre-existing untracked plan-review files were left untouched.

No—the reviewed revision’s original security statement was not accurate; the exact replacement is: “View-as allows only allowlisted subject-data GETs; for current handlers it prevents application database and Storage writes, process/offline-cache mutation, paid model calls, email, job enqueueing and after-response work except the recorded session start/stop rows and logs, while the administrator’s existing Supabase authentication keys remain shared with real localStorage and may refresh; PostgreSQL guarantees read-only persistent non-temporary tables and sequences plus explicit refusals for known session/external-effect SQL, not arbitrary extension-function effects or existing temporary-table writes; and a departing document is hidden and redirected on bfcache restoration, not guaranteed absent from bfcache.”