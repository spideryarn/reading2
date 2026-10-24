1. **Medium — [src/web/AddFromExtension.tsx:205](/var/tmp/spideryarn-worktrees/fbxsfrsg-extension-open-existing/src/web/AddFromExtension.tsx:205)** — `ONE_UPLOAD_AT_A_TIME` had a lost-wakeup race. If the competing upload settled before React rendered the refusal, `ready` remained `true`, no dependency changed, and the page stayed on “Getting the page…” indefinitely. **Fixed:** the refusal now bumps `attempt`, safely retrying the cached, released capture. The regression test failed before the fix and passes afterward.

2. **Low — [tests/authenticated-api-route-contract.test.ts:1218](/var/tmp/spideryarn-worktrees/fbxsfrsg-extension-open-existing/tests/authenticated-api-route-contract.test.ts:1218)** — the route-contract gate was red because both matcher and guard canaries remained at 133/164 after adding the route. **Fixed:** updated them to 134/165.

3. **Low — [tests/add-from-extension-already-have.test.tsx:85](/var/tmp/spideryarn-worktrees/fbxsfrsg-extension-open-existing/tests/add-from-extension-already-have.test.tsx:85)** — the Strict Mode test allowed duplicate lookups with `lookups.length > 0`, and F4’s one-upload retry seam was untested. **Fixed:** exact lookup counts, proper React `act` configuration, and a regression proving one destructive take, one refused send, then one accepted retry.

F1–F3 were met. F4 was incomplete in the commit; the fixes add its missing race coverage and strengthen the once-only assertions.

The route is correctly authenticated and owner-scoped through `requireUser` → `setRequestOwner` → `slugForUrlKey`/`ownedByReader`. Invalid or credential-bearing addresses get 400; valid misses return 200 with `slug: null`; another reader learns nothing. Omitting `viewAs` fails closed. This adds a consumer of the saved-from defence but does not alter the defence itself. The appropriate security-map update exists as a separate working-tree edit; I left it untouched.

`savedFrom` is backward-compatible with older stored entries, is revalidated by `savedSource`, and `capturePage` remains self-contained for both bookmarklet stringification and `executeScript`.

Checks:

- Unit portion: **684 tests passed** across four files.
- The two Postgres-lane targets could not start because this sandbox cannot access local Docker/Postgres.
- `npm run typecheck` hit the sandbox’s Unix-socket restriction; the equivalent `node --import tsx scripts/typecheck.ts` passed all projects and all 4,002 source files.
- Scoped lint and `git diff --check` passed.
- No commit, push, staging, or other git-state mutation performed.

Wider: repository policy calls for a postmortem for this lost-wakeup bug class. I did not create one because it falls outside the authorized change files.

**Verdict: SHIP AFTER FIXES (MADE)**