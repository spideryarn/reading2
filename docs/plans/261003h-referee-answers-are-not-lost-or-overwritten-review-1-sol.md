The trim fix is sound, but the plan does not yet close Claims end to end. Reviewed against HEAD `d65cef3c028677072139faf1724c1529c686735c`; I made no edits or database mutations.

1. **PR-1 — P1, established: a superseded run becomes a false transport failure.**  
   Plan `docs/plans/261003h-referee-answers-are-not-lost-or-overwritten.md:60` deliberately ends A’s stream without `done`. [useClaims.ts:233](/home/greg/code/spideryarn2/.claude/worktrees/sweep5-6a-referee-answers/src/web/useClaims.ts:233) then reports “The claims stopped arriving. Try again,” clears its claims, and releases the running guard. This happens whether B is still running or already finished. The database fence works, but A’s reader receives the wrong explanation and an invitation to replace B with another paid run.  
   **Change:** add an explicit terminal response for supersession and client handling that reads/follows the current stored run without starting another call. Preserve failure handling for genuinely truncated streams. Test both completion orders through the route and hook.

2. **PR-2 — P1, established: the fingerprint fix still shows stale streamed answers as current.**  
   Plan `:64` correctly stores the hash of the loaded blocks. However, [useClaims.ts:212](/home/greg/code/spideryarn2/.claude/worktrees/sweep5-6a-referee-answers/src/web/useClaims.ts:212) treats that run hash as the article’s *current* hash. The `done` branch at `:223` never refreshes it, and `:305` therefore compares the answer’s hash with itself. Load revision R1, publish R2 before `begin`, then finish: storage records R1 correctly, but the active panel gives no stale warning until another GET.  
   **Change:** keep the input fingerprint separate from the current article fingerprint. Refresh current currency at completion, using the existing GET or a separately named terminal field. Add the controlled R1→R2 route race and a client assertion that the warning appears without reloading the page.

3. **PR-3 — P0, reasoned rollout risk: legacy writers can still destroy the newer answer.**  
   Plan `:89–91` addresses whether one request changes implementation, but the hazardous schedule involves **two requests**: old A begins; deployment changes; new B begins and finishes; old A finishes. HEAD [pg-referee-claims.ts:265](/home/greg/code/spideryarn2/.claude/worktrees/sweep5-6a-referee-answers/src/store/pg-referee-claims.ts:265) updates solely by article ID, so A replaces B’s saved claims while retaining B’s date and fingerprint. An old `begin` also leaves a newer token untouched. The nullable column provides schema compatibility, not mixed-version write safety. Production overlap was not observed in this review; the overwrite follows directly if legacy requests remain active.  
   **Change:** specify a rollout that drains legacy Claims requests before enabling fenced writers, or use a compatibility rollout that prevents legacy writes to tokened rows. Cover the mixed-version schedule explicitly; remove the unconditional safety claim.

4. **PR-4 — P2: clearing the token needs a terminal-status guard.**  
   Plan `:56–57` clears the attempt on `finish`, while [contracts.ts:1335](/home/greg/code/spideryarn2/.claude/worktrees/sweep5-6a-referee-answers/src/store/contracts.ts:1335) permits `status: "pending"`. Carrying that patch type forward allows a valid-token finish to leave a pending row with no usable attempt. Today’s production caller sends terminal statuses, so this is a contract risk rather than current reader-visible failure. Criteria already rejects this at `src/store/pg-referee-criteria.ts:290`.  
   **Change:** restrict Claims finishes to `"done" | "error"` and reject other statuses before writing. Test that rejection leaves the token and row unchanged.

5. **PR-5 — P2: make the complete migration deliverables explicit.**  
   Plan `:53` names the ALTER but omits its schema and migration bookkeeping work. [database.md:732](/home/greg/code/spideryarn2/.claude/worktrees/sweep5-6a-referee-answers/docs/project/database.md:732) requires generated journal/snapshot artifacts alongside handwritten SQL. A bare SQL file will not satisfy the migration machinery.  
   **Change:** name the `schema.ts` declaration, SQL, journal and accurate snapshot, plus chain/drift verification. The existing drift test discovers columns dynamically; it needs no hardcoded Claims column-list update.

6. **PR-6 — P2: typechecking will not repair tests that assert the old finish semantics.**  
   Plan `:103` says the type change does the remaining work. But [store-parity-referee.test.ts:729](/home/greg/code/spideryarn2/.claude/worktrees/sweep5-6a-referee-answers/tests/store-parity-referee.test.ts:729) finishes an already swept run, and `:766` expects that finish to overwrite the sweep’s error. Supplying the old token makes it compile but correctly returns `null` under the new fence.  
   **Change:** explicitly update this lifecycle: assert the swept attempt cannot write, begin a fresh attempt, then test an ordinary failure with its new token. Also retain the existing `ClaimsRun` shape assertions—the `{ run, attempt }` envelope should remain internal.

Other checks passed:

- **Removing the pure list returns is safe.** The only production callers are `src/store/pg-searches.ts:179` and `src/store/pg-referee-criteria.ts:160`; both consume only the selected run/row and `kind`. Other readers are tests.
- **Hash equality holds for the same readable revision.** `blocksFor` preserves order and the four hashed fields (`src/store/pg.ts:1482`, `:1512`); sanitisation changes only HTML (`src/sanitize.ts:177`). `sourceHashFor` selects the same fields in ordinal order (`src/store/pg.ts:1660`). Unreadable/minimal paths throw rather than return alternative blocks. Passing the loaded hash from the route is the right repair.
- **The bundle automatically carries the new column.** `article-rows.ts:776` selects whole Claims rows, and `export-bundle.ts:540` serialises them through `rowJson`. Rollback `export.ts:778` intentionally projects the public run shape, as it does for sibling attempt bookkeeping. There is no production importer to extend. Add export assertions documenting that distinction rather than copying the transient token into every format.
- **The nullable, unconstrained column is reasonable.** A CHECK is not necessary for the proposed fence; it would not resolve mixed-version writers.

NOT READY