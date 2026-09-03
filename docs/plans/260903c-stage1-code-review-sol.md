Stage 1 is not ready to commit. I found three correctness blockers and one required test gap.

## Must-fix before commit

1. **The session is announced too late to prevent one-frame account leakage.**

[`App.tsx`](/home/greg/code/spideryarn2/.claude/worktrees/experimental-mode-gate/src/web/App.tsx:300) calls `announceSession` from `useEffect`. Children render and commit before that passive effect runs.

Concrete failure after Stage 2:

1. Account A has experimental features on.
2. `useSession` changes to account B or signed-out.
3. `App` renders B’s/shared article tree.
4. Its Dock reads A’s still-current module snapshot and draws experimental modes.
5. Only afterward does the effect reset the store.

The store tests call `announceSession` directly, so they bypass this seam. The store resets synchronously *once announced*, but the application does not announce synchronously enough to satisfy “never render A’s setting for B.”

2. **A `reload()` begun during a save can overwrite the successful PATCH.**

[`reload()`](/home/greg/code/spideryarn2/.claude/worktrees/experimental-mode-gate/src/web/experimental-store.ts:331) is not blocked by `busy`, and loads do not capture or compare `saveToken`.

Concrete interleaving:

1. Stored value is off.
2. `set(true)` starts a PATCH.
3. `reload()` starts a GET; the server reads off, but its response is delayed.
4. PATCH commits on and its response updates the store to on.
5. The delayed GET is still “fresh” by `epoch` and `loadToken`, so it writes off over the successful save.

The comment claiming `saveToken` protects “a reload mid-save” is therefore false. This is the same UI/database disagreement the store was introduced to eliminate.

3. **An old epoch’s PATCH can be authenticated—or retried—as the new account.**

`epoch` protects only response application. It does not bind the request to the account for which `set()` was called.

[`apiFetch`](/home/greg/code/spideryarn2/.claude/worktrees/experimental-mode-gate/src/web/lib/api.ts:431) obtains its token asynchronously, and after a 401 [`refreshSession()` and retry](/home/greg/code/spideryarn2/.claude/worktrees/experimental-mode-gate/src/web/lib/api.ts:454) use the then-current session.

Concrete failure:

1. A starts `set(true)`.
2. Session changes to B; `announceSession` clears `busy`.
3. B starts `set(false)`.
4. A’s request gets a 401 after the switch.
5. `apiFetch` refreshes B’s session and retries A’s `{ experimental: true }` with B’s token.
6. The store discards A’s response because its epoch is old, but B’s database row is now on while B’s UI says off.

A sign-out followed by returning to the same account also permits two writes to the same row to overlap after `busy` is cleared. The old `finally` guard correctly prevents A’s completion from clearing B’s `busy`, but it cannot repair server-side ordering or targeting.

4. **The newly added failure-recovery and epoch/finally paths are not tested.**

There is no test where:

- the opening GET is invalidated by `set()`;
- that PATCH fails;
- the automatic `reload()` is observed restoring `loaded`.

So the second half of the reported fix has never been seen fail.

Likewise, no test switches to B, starts B’s PATCH, then lets A’s PATCH finish. Removing the `myEpoch !== epoch` guard from `finally` would leave the present tests green even though A could release B’s write lock.

Given the repo’s “a check you have never seen fail is not evidence” rule, both race guards need direct regression tests before commit.

## Should

1. **`saveToken` is currently redundant.**

Within one epoch, `busy` prevents a second save. Across epochs, `epoch` rejects the old continuation. There is no reachable production continuation for which `mine !== saveToken` adds protection while `myEpoch === epoch`.

More importantly, it advertises protection it does not provide against reloads. Either the invariant needs changing or the counter/comment should stop claiming it handles that case.

2. **Two lifecycle tests overstate what they exercise.**

- “Session is still loading” announces the exact `(null, false)` state installed by `resetForTests`, so `announceSession` immediately returns. It proves the initial snapshot, not the `!known` transition.
- The account-switch test starts after A’s GET has completed. It proves synchronous clearing of A’s settled value, but not rejection of an A GET/PATCH that lands while B is active.

The late-sign-out test is sound, but it does not cover the account-switch variants above.

3. **Some rationale is now stale.**

- [`experimental-store.ts`](/home/greg/code/spideryarn2/.claude/worktrees/experimental-mode-gate/src/web/experimental-store.ts:406) retains the old “two clicks in one tick share a render closure” explanation. There is no render closure in the module store, and `busy` rejects the second click anyway.
- [`useExperimental.ts`](/home/greg/code/spideryarn2/.claude/worktrees/experimental-mode-gate/src/web/useExperimental.ts:38) says the store has no browser-only state. Session identity and fetched reader state are browser-side. Using the same module snapshot as `getServerSnapshot` is harmless only because this client is not React-SSR rendered.
- [`public-network-trace.test.tsx`](/home/greg/code/spideryarn2/.claude/worktrees/experimental-mode-gate/tests/public-network-trace.test.tsx:1532) still says it clears “two requests” and “exactly those two”; it now clears three. The earlier “one difference…exactly one” heading is similarly stale.

## Noted / verified

- The `loadToken += 1` inside `set()` is correctly positioned. There is no asynchronous boundary between setting `busy`, capturing `epoch`, and invalidating the load, and the invalidation happens before the optimistic snapshot is published.
- The save-failure `reload()` cannot run for an earlier epoch or loop: both epoch and save checks precede it, and a load failure does not recursively reload.
- `!state.loaded` is a reasonable recovery condition—better than narrowly recording “we superseded a load.” It means no authoritative answer remains, including after an offline copy or earlier load failure.
- Snapshot identity is correct today. All eight observable data fields are compared, while `set` and `reload` are stable module functions. Internal token changes intentionally do not require rendering.
- `resetForTests()` is correct to invalidate pending work and retain listeners. Clearing listeners would silently detach mounted subscribers. Its `saveToken` bump is redundant for the same reason noted above, but harmless.
- The network-trace addition is load-bearing and correctly written: it directly proves zero `/api/reader` requests for the stranger and exactly one for the signed-in reader before filtering the permitted difference. The full trace suite passed. Its phrase “not one per view” is broader than that parameterized test alone—it opens one view per session—but the module-store unit test separately proves repeated same-user announcements do not refetch.
- No old hook argument was lost. The Stage 2 prop can cleanly accept a narrow structural slice such as `on`, then widen for Stage 3. The passive-effect blocker is the main Stage 2 readiness problem.

Checks run:

- Requested suites: **19/19 passed**
- `public-network-trace.test.tsx`: **42/42 passed**
- All three TypeScript projects passed when invoked directly
- `git diff --check`: passed

`npm run typecheck` itself could not start its `tsx` wrapper because this sandbox refused its `/tmp` IPC socket; the underlying three `tsc` runs were successful.