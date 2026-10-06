# Code review: plan 261006h, both stages, built and committed

You are a reviewer who also fixes. Fix what is **inside these two stages**, narrowly, and red-first
(write or extend a test, see it fail, then fix). Report, do not fix, anything wider you notice. Do
not commit. Do not quote Greg anywhere unless you are copying an existing quote verbatim from a
file in this repository.

## The candidate

- Plan: `docs/plans/261006h-browser-storage-keyed-by-reader-and-the-feedback-switch-test.md`,
  including § What landed. Your own plan review is `docs/plans/261006h-plan-review-sol.md`.
- Stage 2, commit `0026fa06e`: `tests/feedback-dialog-has-its-reader.test.tsx`.
- Stage 1, commit `a626d45e7`. `git show a626d45e7 --stat` lists every path. Start with
  `src/web/last-view.ts`, `src/web/lib/storage-reader.ts`, `src/web/modes/search/stored-pairs.ts`,
  `src/web/modes/search/auto-thorough.ts`, `src/web/modes/search/SearchMode.tsx`,
  `src/web/article/ArticlePage.tsx`, `scripts/seed-accounts.ts`, `scripts/db-seed-owner.ts`,
  `scripts/browser-sign-in.ts`, and the tests in that commit. That does not limit scope.
- Docs changed in the same commit (`docs/project/auth.md`, `url-state.md`, `search.md`,
  `supabase-local.md`, `browser-testing-playwright.md`, `web-client.md`): check each new sentence
  against the code.

## What to do

1. Attack it independently first. The threat: two readers, A and B, in one browser profile; the
   reader changes by sign-out and sign-in, or in another tab while this tab stays mounted. B must
   never be put at A's place in an article, never have A's view saved under B's key, and no code
   running as B may be handed or delete A's search-pair record. And the opposite failure: a
   one-reader browser must lose nothing it has today (saved places, the first-open default firing
   once and only once, pairs tidied after a reload).
2. Run these yourself; they need nothing outside the tree:
   `npx vitest run tests/last-view.test.ts tests/last-view-change-of-reader.test.tsx tests/first-open-default-wiring.test.tsx tests/search-auto-thorough.test.tsx tests/seed-accounts.test.ts tests/feedback-dialog-has-its-reader.test.tsx`
   Mutate the finished code and check the suite notices.
3. The scripts cannot be run in your sandbox (no loopback). Raw output from `npm run db:seed-owner`
   on this box, run by the builder:
   ```
   ✓ created dev-reader-b@spideryarn.local (00000000-0000-4000-8000-000000000004) — a second reader to sign in as, who is not an administrator
   ✓ signed in as dev-admin@spideryarn.local, token sub is f4d08b58-5573-4811-9887-e26c114fb324
   ✓ signed in as dev-reader-b@spideryarn.local, token sub is 00000000-0000-4000-8000-000000000004
   ```
   Read `scripts/browser-sign-in.ts` § `signOut` and the `as: "second"` path as code.

Severity: **P0** cross-reader exposure or data loss; **P1** does not do what it says, or breaks
existing behaviour; **P2** real but minor; **P3** wording. Give every finding an id (C1, C2, …),
say whether you reproduced it or reasoned to it, say for each whether you fixed it, and list every
file you changed. End with one line: `VERDICT: approve` / `approve with fixes` / `rework`.

## My own suspicions (already mine, worth less; spend most of the run elsewhere)

- The in-place A→B path in `useLastView`: the strip of article parameters, its interaction with
  nuqs state already held in memory by mounted modes, and with the first-open effect that waits on
  the settings store (which reader's `signedIn` does it see during the change?).
- `readLastView` now writes (legacy adoption) inside a function called from a metadata-visit guard
  in `save`; is there a path where adoption happens for a visit that should have left no trace?
- The sentence I would least like to be wrong about: "the search band cannot outlive its reader,
  so `useMadeFor()` is right in `SearchMode.tsx`" (`src/web/article/access.ts` § `useArticleAccess`).
- The behaviour change recorded in § What landed (a signed-out visit no longer uses up the first
  open): is anything else that reads `claimFirstOpen` now wrong, and are the docs consistent?
- `tests/store-parity.test.ts` builds ids of the shape `…00000000000<n>`; does the second reader's
  id collide with anything that writes to the shared local database?
