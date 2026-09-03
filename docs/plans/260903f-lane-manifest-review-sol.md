## Verdict

I would not ship the guards under the claim that they prove completeness yet. The manifest and central account seeding look sound, and I found no wrongly assigned private-lane suite, but the owner guard has a real semantic hole. Two proposed follow-ups also need changing: the Stripe fixture and `admin-store`’s non-vacuity.

### 1. The owner guard is file-complete, not owner-complete — high confidence, reproduced

The guard treats any `seedAuthUser(` call as covering every literal owner UUID in that file:

- scan: [store-migration-registry.test.ts:327](/home/greg/code/spideryarn2/.claude/worktrees/delete-store-flag/tests/store-migration-registry.test.ts:327)
- exemption by filename: [store-migration-registry.test.ts:426](/home/greg/code/spideryarn2/.claude/worktrees/delete-store-flag/tests/store-migration-registry.test.ts:426)

There is already a witness: [store-jobs-parity.test.ts:112](/home/greg/code/spideryarn2/.claude/worktrees/delete-store-flag/tests/store-jobs-parity.test.ts:112) declares `STRANGER`, but only `OWNER` and `OWNER_B` are seeded at [line 206](/home/greg/code/spideryarn2/.claude/worktrees/delete-store-flag/tests/store-jobs-parity.test.ts:206). `STRANGER` is currently read-only, so the test is safe—but if it starts writing, the guard remains green.

The narrower policy is right; fifty declarations would be noise. The implementation should nevertheless track `(file, owner)` rather than just files. With only about eighteen literal-owner files, an explicit per-owner audit is affordable and materially stronger.

The documented counts have also drifted: I found 18 literal-owner files—9 containing a seed call and 9 exceptions—not 20 and 10. The `> 5` controls prevent total collapse, but cannot detect that inventory drift.

### 2. The lane guard is syntactically non-vacuous but semantically incomplete — high confidence, reproduced/reasoned

The guard has useful protections:

- the detected universe must exceed 70;
- every detected file must be assigned;
- every assignment must correspond to a detected file;
- all lane values are checked.

So it does not simply vouch for an empty set. On the current tree I reproduced:

- 85 files containing `pgReady(`
- 15 containing `new Pool(` or `new Client(`
- 93 unique files
- exactly 93 lane assignments: 89 private, 4 shared

I also audited direct `pg` imports and meaningful `getDb()` usage and found no currently omitted database suite.

But the predicate at [store-migration-registry.test.ts:322](/home/greg/code/spideryarn2/.claude/worktrees/delete-store-flag/tests/store-migration-registry.test.ts:322) misses:

- an aliased or namespace constructor such as `new PgPool()` or `new pg.Pool()`;
- a helper such as `openTestDb()` that creates the connection elsewhere;
- dynamic imports;
- a transitive application call to `getDb()`.

A raw transitive-import guard is not the answer: I found roughly 153 tests outside the lane map that can reach a module importing `pg`, mostly legitimate unit tests that mock or never execute that path.

I would describe this guard as a syntactic inventory guard, then make T-D supply the semantic backstop: the unit project should delete or poison `DATABASE_URL` after `.env.local` has loaded, so a missed database test fails rather than contacting the shared database. Connection-opening test helpers should also be included explicitly in the scan.

### 3. The proposed Stripe backfill is incomplete and unsafe on shared `postgres` — high confidence, reproduced from code

Deferring this family to T-D is reasonable. The proposed fix is not.

The migration creates both `reader` and `researcher` as active tiers with null price IDs: [20260902181004_seed_billing_tiers.sql:14](/home/greg/code/spideryarn2/.claude/worktrees/delete-store-flag/drizzle/20260902181004_seed_billing_tiers.sql:14). But `plans-match-tiers` expects every paid UI row to be offerable: [plans-match-tiers.test.ts:104](/home/greg/code/spideryarn2/.claude/worktrees/delete-store-flag/tests/plans-match-tiers.test.ts:104). Filling only `reader` leaves `researcher` failing.

“Update only when null” protects an existing real ID, but it does not make writing a fake ID into shared `postgres` safe. Null is its legitimate state on any machine where `stripe-setup.ts --apply` has not run; the fixture would then persist a nonexistent Stripe price into the developer database.

The safe version is:

- positively prove the target is a factory-owned private database;
- backfill every active paid tier required by the UI;
- never use nullness alone to distinguish private from shared.

### 4. `admin-store` belongs in the shared lane, but its oracle can still be vacuous — high confidence, reasoned

The correction to the original explanation is right: GoTrue supplies accounts over HTTP, so a schema-only database does not imply no accounts.

However, [admin-store.test.ts:82](/home/greg/code/spideryarn2/.claude/worktrees/delete-store-flag/tests/admin-store.test.ts:82) only requires nonempty auth accounts, while its aggregate checks at [line 98](/home/greg/code/spideryarn2/.claude/worktrees/delete-store-flag/tests/admin-store.test.ts:98) accept zero. Because the implementation uses `?? 0`, a fresh shared app database can still pass without exercising a nonzero node-postgres count conversion.

Keep it shared, but create one controlled aggregate and assert its exact nonzero count. Otherwise shared state merely makes the test non-vacuous on this particular box.

### 5. The exception set is operationally safe, but several reasons are wrong — medium/high confidence, reasoned from test paths

I found no exception currently writing a row whose FK requires the unseeded owner. The nine exceptions are therefore safe today.

Three explanations should be corrected:

- `export-route`: seeding the outsider would not introduce a second explanation for the 404; it would remove the possible explanation “the requester does not exist.” The test already has stronger evidence: the handler calls `articleBundle`, an owner-positive control returns 200, and removing the ownership predicate was observed to return 200.
- `public-visibility-pg`: the outsider is not strictly read-only—it is used for a PUT. The update matches no owned row, so it still performs no FK-constrained write.
- `owner-isolation`: Alice and Bob are request-context identities; the persisted fixture uses the ambient owner. Its current reason conflates those roles.

Also, direct `seedAuthUser` is not “driving GoTrue”; it inserts database fixtures directly.

### Direct answers

1. **“One cause” or one symptom?**  
   It is one missing lane precondition: private databases lack the local account baseline assumed by code operating outside request context. Central seeding is better than fifty calls. The counter-risk is that it can hide code accidentally falling out of request scope and using the ambient owner; auth-sensitive route tests still need distinct principals and explicit isolation controls. I could not reproduce the exact 49/54 attribution without Docker or the original result artifact.

2. **Does baseline seeding silently break an existing emptiness oracle?**  
   I found only one explicit assertion that a clone has zero auth users, in [db-test-create.test.ts:548](/home/greg/code/spideryarn2/.claude/worktrees/delete-store-flag/tests/db-test-create.test.ts:548). It creates and examines its own clone and is shared-lane, so lane seeding does not invalidate it. I found no private-lane test currently relying on `auth.users` being empty.

3. **Does `environmentOwnerId` behave correctly on another machine?**  
   Yes. I reproduced that a different valid `SPIDERYARN_OWNER_ID` is included as an additional account, and an invalid value throws `not a uuid: …` before seeding. The value is read when `localAccounts()` runs, after `.env.local` loading—not captured at module initialization. Missing production configuration also throws; non-production falls back to the development owner.

4. **Was the earlier marker scan inadequate?**  
   Yes. `currentOwnerId()` and helper-mediated access evade that marker list. I could not verify the exact 54-file split without its file list, but the substantive correction is right.

5. **Lane assignments?**  
   I found no private-lane suite whose oracle requires shared service state. `store-realtime-sessions` is correctly private. The four shared assignments are defensible, including `db-test-create` by contract.

One smaller documentation error: the registry says three tests reach the real Storage bucket, but `illustrated-route` and `store-export-bundle` mock/refuse blob storage. Only `helpers-load-article` appears to exercise the shared bucket.

## Execution evidence

- Focused lane guards: **3 passed**
- Seeder and non-DB feedback cases: **10 passed, 8 database cases skipped**
- Typecheck: **passed**, all 1,196 source files covered
- Biome on changed TypeScript files: **passed**
- Full registry file: **8 passed, 1 infrastructure failure**—the Stage-A spawned `tsx` process received `EPERM` creating its IPC socket
- Docker/local Supabase: **not reachable from this sandbox**; access to `/var/run/docker.sock` was denied, so I did not reproduce the private-database integration batch.