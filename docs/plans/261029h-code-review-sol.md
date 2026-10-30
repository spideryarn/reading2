# Code review — the margin button starts the literature search

Commit reviewed: `1d3f1317c`.

I found two serious concurrency holes in the plan review's MARGIN-1 fix. Both could make the two
doors POST differently shaped jobs for one literature search. I fixed both, red test first. After
the fixes, I found no non-press path that starts `situate`, and no serious finding remains open.

## Findings

### MARGIN-CR1 — P1 — `starting` belonged to one hook mount, so the other door could POST in the same gap

Evidence:

- The gate asks `situate.starting` at
  [`src/web/useWhereAutoRun.ts:65`](../../src/web/useWhereAutoRun.ts#L65).
- In the commit, that value was only `queue.starting` from this particular `useSituate` mount
  (`useSituate.ts`, formerly line 224). Sources and Marginalia mount separate hooks. While Sources'
  POST was in flight but its returned job was not in `GET /api/jobs` yet, Marginalia therefore saw
  `starting: false`, `job: null`, and posted too.
- The red regression at
  [`tests/margin-press-starts-the-search.test.tsx:221`](../../tests/margin-press-starts-the-search.test.tsx#L221)
  held the first POST before it entered the queue. The committed code made two search POSTs; the
  expected count was one.

Changed:

- [`src/web/useSituate.ts:94`](../../src/web/useSituate.ts#L94) now shares an unforced Situate start
  per article across this tab's hook mounts. A second caller joins the first POST. If that POST
  fails, the waiting caller still gets its own attempt instead of mistaking failure for success.
- The shared interval is also part of `UseSituate.starting`
  ([`src/web/useSituate.ts:275`](../../src/web/useSituate.ts#L275)), so both gates describe the same
  operation while it is between POST and queue visibility.

### MARGIN-CR2 — P1 — quiet cadence could spend from an old queue snapshot and miss another tab's job

Evidence:

- Marginalia deliberately mounts `useSituate(slug, "quiet")` at
  [`src/web/marginalia/MarginaliaColumn.tsx:1399`](../../src/web/marginalia/MarginaliaColumn.tsx#L1399).
  Quiet cadence does not poll at rest, so `job === null` may only mean the last list predates a run
  started in another tab.
- The red regression at
  [`tests/margin-press-starts-the-search.test.tsx:252`](../../tests/margin-press-starts-the-search.test.tsx#L252)
  put a newly queued `[bibliography, situate]` job behind that stale snapshot. The committed code
  still POSTed `[situate]`.

Changed:

- Both automatic doors now wait for a job list requested after their activation token was minted,
  using the job engine's existing `afterFreshList` seam
  ([`src/web/useWhereAutoRun.ts:69`](../../src/web/useWhereAutoRun.ts#L69)). A narrow-window margin
  press still drops immediately and does not make this extra queue read.
- A failed queue read cannot hold an invisible press for the rest of the mount: after ten seconds
  the explicit press proceeds against the latest snapshot. The server's exact-work dedupe remains
  the last guard in that degraded case.
- [`tests/margin-press-starts-the-search.test.tsx:270`](../../tests/margin-press-starts-the-search.test.tsx#L270)
  also proves an active job holds the token, but a terminal failure releases it and the press makes
  its own attempt. A merely visible/stalled active job continues to hold it; queuing another job
  behind the same stuck article would not make the search progress.

### MARGIN-CR3 — P3 — Marginalia's docs still said it never mounted a full hook or ran another mode

Evidence:

- The committed implementation mounts full `useSituate`, but
  `docs/project/marginalia.md` still said every source was a read half and opening the column never
  ran another mode.
- The short Sources help also said the search starts whenever one “open[s] Sources”, contradicting
  its own later rule that a link, reload, or Back starts nothing.

Changed:

- [`docs/project/marginalia.md:23`](../../docs/project/marginalia.md) now names the press-triggered
  literature search as the exception and explains why full `useSituate` is mounted without making
  arrival spend.
- [`src/web/help/pages/modes/sources.md:8`](../../src/web/help/pages/modes/sources.md) now says which
  presses start the search, including the existing narrow-window exception. The generated Help
  corpus was rebuilt.

## Press-only audit

No additional spend path found:

- Reload, pasted/restored `?margin=1`, Back and Forward call no activator.
- The OFF press and command-bar selection while the margin is already on are rejected by
  `marginOn` in `useActivateMode`.
- The already-on narrow-window swap arms nothing. A press that turns it on where the notes do not
  fit is claimed and dropped; widening later cannot revive it.
- Visitors never mount `OwnerMarginFeed`; view-as does not arm from the Dock and `useAutoRun` also
  refuses a view-as token.
- A stored dossier wins before Bibliography is consulted. Bibliography status and `retryRead` are
  live props; `useAutoRun` keeps the rebuilt `ensure` closure in a ref, so object identity churn
  does not freeze an old status.
- StrictMode still produces one POST. The fresh-list waiter is cleaned up and re-registered across
  StrictMode's effect replay, and the activation token remains atomic.

Marginalia's separate `relations` arrival job is intentionally unchanged; the audit above is about
the paid `situate` search.

## Verification

- Red first: the two new concurrency tests failed on `1d3f1317c` (two POSTs instead of one; one
  POST instead of none), then passed after the fixes.
- `npx vitest run tests/margin-press-starts-the-search.test.tsx tests/every-mode-draws-its-surface.test.tsx`
  — passed, 100 tests.
- `WRITE_HELP_CORPUS=1 npx vitest run tests/help-corpus.test.ts` — passed, 7 tests.
- `npm run typecheck` — the `tsx` launcher was refused permission to create
  `/tmp/tsx-1000/14.pipe` by this sandbox. Running the same checked script directly with Node,
  `node scripts/typecheck.ts`, passed all five TypeScript projects and confirmed all 4,079 source
  files are covered.
- `npx biome lint src/web/useWhereAutoRun.ts src/web/useSituate.ts tests/margin-press-starts-the-search.test.tsx`
  — clean.

No commit made, as requested.
