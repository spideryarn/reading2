Found and fixed **three P2 defects within stage 2**. The server access predicate is sound. One older **P1 account-switch defect** remains outside this change.

1. **P2 — private keys reached browser console logs.**  
   [public-api.ts:151](/var/tmp/spideryarn-worktrees/import-permalink-and-share/src/web/public-api.ts:151) handles the expected 409 through `readJson`, whose logger printed the full response URL, including `?key=…`. **Fixed** in [api.ts:120](/var/tmp/spideryarn-worktrees/import-permalink-and-share/src/web/lib/api.ts:120): console URLs now omit queries and fragments. Real-response-URL tests failed for both 409 and 500 before the fix and passed afterwards. No external telemetry transmission was established.

2. **P2 — an older attachment read overwrote a completed link mutation.**  
   [add-share-link.ts:390](/var/tmp/spideryarn-worktrees/import-permalink-and-share/src/web/add-share-link.ts:390) checked only whether a write remained outstanding when the read arrived. A delayed OFF could erase a successful create; a delayed ON could redraw a revoked key. **Fixed** with a write-generation fence that covers both reply orders. Both regressions were reproduced red first.

3. **P2 — the POST snapshot resurrected a stopped or vanished import.**  
   Candidate `AddPage.tsx:873`, now [AddPage.tsx:877](/var/tmp/spideryarn-worktrees/import-permalink-and-share/src/web/AddPage.tsx:877), fell back indefinitely to POST-time status. **Fixed** by retaining newer list evidence and using the existing terminal watcher for endings and fresh disappearance. Terminal evidence also outranks an older running list entry. Three regression tests were seen fail before their fixes.

4. **P1 — older account-switch isolation remains incomplete.**  
   [AddPage.tsx:410](/var/tmp/spideryarn-worktrees/import-permalink-and-share/src/web/AddPage.tsx:410) retains the purpose session by source alone. B can inherit A’s private purpose; an unsaved draft could subsequently save under B’s credentials if B owns the same slug. The posting guard, High-powered AI intent and retained `{article}` answer also ignore reader identity, causing the acknowledged “Queueing it…” stall and possible stale completion. **Left for you:** these predate the candidate and require a wider session-lifecycle fix. Item 11 is a defect.

The **2c server read reveals only the accepted existence fact**, under the same sharing rules used after publication. Each pending lookup independently requires access, no current revision, and a queued or live-leased running job correlated by both slug and owner. It selects only a constant. Wrong, missing, revoked and another article’s keys cannot authorize the 409.

The wire body is exactly `{ error, code: "still-being-added" }`; `no-store` is set before dispatch. Server logging records the query-free request path, fixed sentence, status and elapsed time—not article metadata or job details. No additional semantic disclosure was found. This is **not a constant-time guarantee**.

Head, assets, listings and successful published reads retain their existing behaviour. The `jobs` permission is narrowly limited to `public-reader.ts` and the predicate-only `job-fence.ts`; authenticated job stores remain forbidden.

I performed all four requested mutations and restored the source afterwards:

| Guard removed | Tests observed red in `public-reads.test.ts` |
|---|---|
| Access predicate | Access, clause placement and bound-parameter assertions |
| Owner correlation | Owner/slug correlation assertion |
| Live lease | Pending-status/database-clock assertion |
| Null revision | Unpublished-revision assertion |

The database suite already covers access, owner correlation and expired leases. I added direct database coverage for null-revision exclusion and an unpublished minimal row, but could not execute it here. Minimal rows remain protected by sharing-writer refusals and the access predicate; the pending query itself has no processing filter.

The **private key’s path** is:

- Owner response → reader-scoped controller state → readonly copy-box value while open → clipboard/shared URL.
- It remains in the controller during an ordinary same-reader unmount; retirement drops it and fences late replies.
- Closing the section unmounts the copy box. No key is placed in local/session storage, the public-sharing mark, offline cache, audit records, or diagnostic buffer.
- Opening the shared URL intentionally retains `?key=` and sends it with public article/asset requests.
- A direct reader switch cannot draw the old sharing controller’s key. The newly discovered console path is now scrubbed.

All six plan-review findings are implemented:

| Finding | Regression evidence |
|---|---|
| F1: reader isolation | Controller retirement, direct A→B and late-reply tests pass |
| F2: declared serialization | Real-dispatcher exact-body and unrelated-409 tests pass |
| F3: owner detection first | Owner, signed-in non-owner and signed-out visitor tests pass |
| F4: Retry snapshot | Replacement id/slug and upload snapshot tests pass |
| F5: expired leases | SQL mutation detected; database behavioural test blocked |
| F6: meaningful adjunct checks | Exact body verified; real head/asset positive controls remain database-blocked |

New controllers start requests in effects, not render. Registry allocation during render performs no IO. StrictMode replay preserves the POST guard and controller attachment. Sharing pause clears unsent retry timers; retirement fences replies. Visitor cleanup removes visibility listeners, clears polling and aborts outstanding requests on unmount or slug/key change. Its existing `reread` delegation remains appropriate.

**Item 2 is acceptable:** cancellation requested is still nonterminal while the lease is live; the response promises no completion time. **Item 10 is acceptable:** the public 409 independently authorizes waiting despite an unconfirmed owned session. **Item 12 was a defect and is fixed.**

Keeping two controller classes is reasonable: private-link creation can rotate a credential, so its uncertain-write rules differ materially from the public switch. The visitor’s extra fetch at publication is a small cost for retaining one access-resolution path.

Validation: **16 targeted suites passed, 467 tests**. Typechecking passed through `node --import tsx scripts/typecheck.ts`; the npm wrapper’s IPC socket was denied. Lint found only complexity advice, and `git diff --check` passed.

Blocked by the sandbox: `public-still-being-added-pg.test.ts`, `owner-isolation.test.ts`, and the full `npm test` database preflight; one `store-migration-registry.test.ts` subprocess assertion was also blocked. These are infrastructure limits, not findings against the candidate. No Git-writing commands ran.

Files changed:

- `src/messages.ts`, `src/web/AddPage.tsx`, `src/web/add-share-link.ts`, `src/web/lib/api.ts`
- `tests/add-page-sharing-section.test.tsx`, `tests/add-share-link.test.ts`, `tests/public-dispatch.test.ts`, `tests/public-still-being-added.test.ts`, `tests/public-still-being-added-pg.test.ts`
- `docs/postmortems/261006a-a-secret-bearing-response-url-escaped-through-a-diagnostic-sibling.md`
- `docs/postmortems/261006b-a-read-completion-does-not-prove-it-followed-a-write.md`
- `docs/postmortems/261006c-a-provisional-job-snapshot-outlived-newer-evidence.md`

**Verdict: scoped fixes complete; database/full gates must pass before unconditional approval. Decide the older P1 account-switch defect separately.**