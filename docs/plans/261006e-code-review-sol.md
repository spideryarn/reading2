The committed candidate fails its contract. I fixed three **established P1 findings**, each reproduced red first:

- **F7 — Boot POST is unfenced.**  
  **(a)** Mount `/add/` as A, hold token lookup, sign in as B, then release it. The test observed A’s import POST carrying `TOKEN-B`: the child effect posted before the parent bound the engine.  
  **(b)** Fixed by binding the session in a layout effect, before child passive effects.

- **F8 — Late grant cleanup uses B’s identity.**  
  **(a)** Hold A’s batch grant, stop/rebind the batch, then resolve the grant. Cleanup sent `DELETE /api/uploads/upload-A as TOKEN-B`, including while the engine was unbound.  
  **(b)** Fixed by passing the operation’s captured reader into cancellation.

- **F9 — Batch queueing survives teardown.**  
  **(a)** Complete A’s PUT and switch to B in the microtask between `sendIt` returning and `run` resuming. The test observed `POST /api/jobs as TOKEN-B`.  
  **(b)** Fixed by checking `live()` immediately after awaiting `sendIt`.

No remaining established blocker found. Matching-reader controls pass, including refresh, offline cache and deadline fallback. **110 focused tests and typechecking pass.** Lint has no errors and two complexity advisories. The full suite was not run here. Nothing committed.

Files I changed:

- [src/web/useJobs.ts](/var/tmp/spideryarn-worktrees/add-page-reader-change/src/web/useJobs.ts)
- [src/web/batchUpload.ts](/var/tmp/spideryarn-worktrees/add-page-reader-change/src/web/batchUpload.ts)
- [tests/add-page-reader-change.test.tsx](/var/tmp/spideryarn-worktrees/add-page-reader-change/tests/add-page-reader-change.test.tsx)
- [tests/engines-send-as-their-reader.test.ts](/var/tmp/spideryarn-worktrees/add-page-reader-change/tests/engines-send-as-their-reader.test.ts)
- [tests/api-fetch.test.ts](/var/tmp/spideryarn-worktrees/add-page-reader-change/tests/api-fetch.test.ts)
- [docs/plans/261006e-add-page-forgets-everything-when-the-reader-changes.md](/var/tmp/spideryarn-worktrees/add-page-reader-change/docs/plans/261006e-add-page-forgets-everything-when-the-reader-changes.md)
- [docs/postmortems/261006h-a-current-service-reader-is-not-an-operations-reader.md](/var/tmp/spideryarn-worktrees/add-page-reader-change/docs/postmortems/261006h-a-current-service-reader-is-not-an-operations-reader.md)