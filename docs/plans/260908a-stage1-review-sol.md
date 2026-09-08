The DELETE oracle is sound for its deliberately narrow purpose, but the commit currently breaks a repository test. Fix F4 before Stage 2.

## Findings

**F4 — P1: the committed stage fails the migration-registry contract.**

The new oracle contains the reserved `**Blind to.**` marker at [chat-thread-delete-route.test.ts:72](/home/greg/code/spideryarn2/.claude/worktrees/worktree-chat-route-table/tests/chat-thread-delete-route.test.ts:72). The registry guard requires every test containing such a marker to appear in `STORE_CONVERSIONS`, but this new test was not a store conversion and only received a lane entry.

I ran the focused, database-free check:

```text
npx vitest run --project unit tests/store-migration-registry.test.ts \
  -t "finds no mutation evidence outside the conversion record"

1 failed:
tests/chat-thread-delete-route.test.ts
```

The governing assertion is at [store-migration-registry.test.ts:504](/home/greg/code/spideryarn2/.claude/worktrees/worktree-chat-route-table/tests/store-migration-registry.test.ts:504).

Do not add a historically false `STORE_CONVERSIONS` entry. Rename this marker to something outside that registry’s vocabulary, such as `**Outside this oracle.**`

**F5 — P2: the umbrella authentication proof is overgeneralised.**

The current conclusion for `/api/chat` and `/api/live` is correct, but the general claim at [260907b…md:787](/home/greg/code/spideryarn2/.claude/worktrees/worktree-chat-route-table/docs/plans/260907b-split-the-authenticated-api-dispatch-by-domain.md:787) is not:

- Public dispatch is not “the one thing” before `requireUser`; the exact Stripe webhook branch also runs there at [routes.ts:6381](/home/greg/code/spideryarn2/.claude/worktrees/worktree-chat-route-table/src/routes.ts:6381).
- A literal prefix merely being different from `/api/public` does not prove disjointness: `/api/public/foo` is a different literal prefix inside the public namespace.
- The listed exceptions therefore omit another pre-auth exact route being added or widened, dispatch order changing, and a namespace moving beneath `/api/public`.

Narrow the proof to: current `serveApi` has exactly two pre-auth claims—`isPublicNamespace(path)` and `path === WEBHOOK_PATH`; every queued namespace has a different first segment from `public` and does not contain the webhook path.

**F6 — P3: the lane comment incorrectly says Storage is untouched.**

The comment at [store-migration-registry.ts:2365](/home/greg/code/spideryarn2/.claude/worktrees/worktree-chat-route-table/tests/store-migration-registry.ts:2365) says nothing goes near Storage. `scratchArticleInPg` calls `loadArticleIntoPg`, which calls `storeRawSource` for this fixture’s `raw.json`.

This does not change the lane verdict: `private-postgres` is correct, Storage is content-addressed here, and the test does not assert on bucket state.

**F7 — P3: the `copied` assertion is cargo.**

[chat-thread-delete-route.test.ts:150](/home/greg/code/spideryarn2/.claude/worktrees/worktree-chat-route-table/tests/chat-thread-delete-route.test.ts:150) does not protect anything this route uses. Successful fixture publication already establishes the article, while chat deletion reads no block. Remove it to avoid an unrelated fixture-step dependency.

**F8 — P3: the plan still says it awaits plan review.**

[260908a…md:14](/home/greg/code/spideryarn2/.claude/worktrees/worktree-chat-route-table/docs/plans/260908a-chat-and-live-sessions-join-the-route-table.md:14) is stale now that the review and Stage 1 both exist.

## Oracle assessment

- Dropping the `await` deterministically makes the first case red: `send` synchronously serialises the Promise as `{}`.
- Removing `inTurnOrder` while retaining the await correctly stays green. Nothing in setup or assertions creates concurrent work, so the lock is not accidentally load-bearing.
- The second mutation failure is timing-sensitive: the background deletion could finish before the second `it` reads. It is useful observed evidence, but the first failure is the reliable oracle.
- The second case’s dependency on the first is intentional and cannot create a false green. Setup refuses anything except exactly two stored threads; `afterAll` runs only afterward.
- `private-postgres` is the correct lane. One run is serial, concurrent runs receive separate databases, and `shared-services` would expose the fixed slug to collisions.
- The minimal fake response is correct for this `send` route. Missing streaming methods would make an accidental streaming conversion fail loudly.

I could not run the Postgres-backed oracle, as requested. Biome passed on both touched TypeScript files. I did not treat typechecking of the live worktree as candidate evidence because unrelated uncommitted Stage 2 edits appeared during the review.

**Verdict: stage is sound with these changes.**