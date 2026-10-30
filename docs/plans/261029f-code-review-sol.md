High

- None.

Medium

- [src/web/last-view.ts:955](/var/tmp/spideryarn-worktrees/reading-place-across-devices/src/web/last-view.ts:955) — a server answer arriving after navigation but before React rerender could save article B’s query under article A. Fixed by validating the live pathname/slug/view before applying or saving the answer; regression test added.
- [src/web/useReadingTime.ts:443](/var/tmp/spideryarn-worktrees/reading-place-across-devices/src/web/useReadingTime.ts:443) — if P1 was in flight, movement produced P2, then the reading view unmounted, cleanup skipped P2 permanently. Fixed by serially sending the newer version after P1 settles; regression test added.

Low

- [src/web/useReadingTime.ts:350](/var/tmp/spideryarn-worktrees/reading-place-across-devices/src/web/useReadingTime.ts:350) — a well-formed but non-current `?at=` was marked sent although the store silently dropped it, potentially leaving no opening row. Fixed by accepting the initial block only when it exists in the current article; otherwise sending top.
- [tests/reading-place-route.test.ts:158](/var/tmp/spideryarn-worktrees/reading-place-across-devices/tests/reading-place-route.test.ts:158) — “malformed place writes neither half” checked only the place. Fixed by also asserting reading-time totals remain unchanged.

Verification:

- Typecheck passed for all 4,094 source files via `node --import tsx scripts/typecheck.ts`. The requested npm wrapper itself was blocked by sandbox IPC permissions.
- Nine runnable focused files passed: 110 tests.
- `reading-place-route.test.ts` could not run because the sandbox blocks local Postgres access (`EPERM 127.0.0.1:54362`).
- Scoped lint: no errors.

Files edited:

- `src/web/last-view.ts`
- `src/web/useReadingTime.ts`
- `tests/last-view-server-place.test.tsx`
- `tests/use-reading-time.test.tsx`
- `tests/reading-place-route.test.ts`