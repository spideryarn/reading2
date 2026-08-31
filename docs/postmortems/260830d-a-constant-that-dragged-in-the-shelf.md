# A constant that dragged in the shelf, and the test that stopped running

**Found 2026-08-30**, by running `npm test` on a tree that was red for other reasons.
`tests/auth-callback.test.ts` had not run a single one of its eleven tests since
**2026-08-27**, three and a half days. It threw on import:

```
TypeError: supabase.auth.onAuthStateChange is not a function
 ❯ src/web/lib/api.ts:685:15
 ❯ src/web/TitleEditor.tsx:29:1
 ❯ src/web/ShelfEntry.tsx:29:1
```

The auth callback has nothing to do with the shelf. That is the whole of the bug.

## The chain

Seven modules, and every hop is reasonable on its own:

```
tests/auth-callback.test.ts
  → src/web/AuthCallback.tsx      wants a page title
  → src/web/page-title.ts         wants DEFAULT_MODE
  → src/web/params.ts             wants DEFAULT_BY          ← the load-bearing hop
  → src/web/library-columns.tsx   the shelf's column definitions
  → src/web/ShelfEntry.tsx
  → src/web/TitleEditor.tsx
  → src/web/lib/api.ts            calls supabase.auth.onAuthStateChange() at module load
```

[`src/web/params.ts`](../../src/web/params.ts) needs one default sort order. It imports it as a
**value**, from a file that renders shelf cards. So anything that wants a URL-parameter constant
gets the shelf, its editor, and the client's whole API layer — including a module-load call into
the Supabase SDK. A `type`-only import here would have cost nothing at runtime; `DEFAULT_BY` is a
string.

## Nothing was wrong when it was written

Three commits, each fine in isolation, and the third closed the circuit:

| When | Commit | What it did |
| --- | --- | --- |
| 2026-08-26 22:38 | `a2e3205` | `params.ts` starts importing `DEFAULT_BY` from `library-columns.tsx` |
| 2026-08-27 00:15 | `796c288` | `lib/api.ts` gains a module-load `supabase.auth.onAuthStateChange(…)` |
| 2026-08-27 08:59 | `a4499cc` | `AuthCallback.tsx` starts importing `page-title.ts` |

`a4499cc` is the one that broke it, and it is the one that looks least like it could. It gave the
auth callback a document title. Its parent had no `page-title` import in that file; at `a4499cc`
the other two hops were already in place and the test's mock was still
`supabase: { auth: { initialize, getSession } }`.

Verified without switching branches, which is not allowed in this tree — `git show <rev>:<path>`
reads any commit's copy of a file in place.

## Why nobody noticed for three days

Vitest **did** report it. It reported it like this:

```
 Test Files  1 failed (1)
      Tests  no tests
```

That is a failure line, and the exit code was non-zero. But `no tests` reads like a file with
nothing in it, not like a file whose eleven tests were silenced — and the summary shows no drop in
the passing count, because those eleven were never counted. The suite went from
`6410` tests to `6421` when the mock was fixed; nothing in the red output said eleven tests had
gone missing.

The tree was also red for unrelated reasons the whole time, and this line sat among them. A review
prompt written on 2026-08-30 (`docs/plans/260830x-title-normalisation-review7-prompt.md`) names it as "a
supabase mock reached through unmodified files" and files it under peers' uncommitted work. It was
not; it was committed and three days old. See
[silent-success.md](../reusable/silent-success.md) — the check reported the fault and the reader
took it for something else.

## The fix that landed

`tests/auth-callback.test.ts` now stubs `onAuthStateChange` the way eleven other test files in
this repo already do:

```ts
onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
```

That is the right size for the immediate hole and the wrong size for the problem. It makes a
twelfth test file carry a stub for a module it does not use.

## The fix that is right for the long term — not done

Two, and the first is cheap:

1. **Cut the chain at `params.ts`.** Move `DEFAULT_BY` to a leaf module with no component imports —
   or duplicate the one string — so wanting a URL-parameter default does not import the shelf.
   `params.ts` already takes `ShelfFilter` and `ShelfView` from `ShelfControls.js` as `import type`,
   which costs nothing at runtime. Its value imports are what pull the tree in, and there are two of
   them from column modules — `DEFAULT_BY` here and `ADMIN_DEFAULT_BY` from `admin-columns.js`.
2. **Stop subscribing at module load.** `lib/api.ts` calls into the SDK as a side effect of being
   imported, so every importer inherits a dependency on a live Supabase object. A lazy
   subscription — first `apiFetch`, or an explicit `startTokenCache()` from `main.tsx` — would make
   the module inert to import and this class of breakage impossible.

Neither is in this commit: both touch client modules another agent has open.
[web-client.md](../project/web-client.md) is where the client's module layout is described.

## What would have caught the class

- **A guard on the count.** Not "did the suite pass" but "did the number of collected test files
  or tests fall". Eleven tests vanishing is invisible in a pass/fail line and obvious in a count.
  The `6410 → 6421` jump is the evidence that would have read as a fault three days earlier.
- **A lint rule against value imports from component modules into `params.ts`-shaped leaves.** The
  cycles gate in `npm run check` is clean here, because this is not a cycle — it is a straight line
  seven modules long, and straight lines are exactly what a cycle detector approves of.
