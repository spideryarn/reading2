# Code review: 261019n, part 1

## Verdict

The `published` addition is correct and complete, and the existing completed-import reread and loop
guard still work. I found three bugs in the new job selection, all fixed in this working tree with
tests that failed first:

1. Retry returned a new job but the page kept drawing the old failed card until polling caught up.
2. Equal `createdAt` values had no `id` tie-break, unlike the job store.
3. A missing or invalid `createdAt` could make `Date.parse` return `NaN` and permanently hide later
   valid jobs.

No in-scope findings remain. Nothing was committed.

## Findings and fixes

### 1 — Retry kept the old failed card in the POST-to-poll gap

`onRetried` stored only `{slug, id}` while `newestImport` still selected exclusively from
`queue.jobs`. After a successful Retry, the list could therefore still contain only the failed
attempt for one poll. The old card, including its Retry button, remained visible even though the
component already held the replacement `Job`.

Fixed by retaining the replacement as an optimistic candidate. The polled list's copy is placed
first, so as soon as that id arrives its newer `running`, `error`, or `done` status wins over the
held response snapshot. A newer different job from another tab can also supersede it normally.

Red-first test: `draws Retry's replacement before the polled list has it`.

### 2 — Equal creation times depended on array order

The store defines a total order of `(createdAt, id)` and returns both descending. The first selector
compared only parsed times with `>`, so two jobs created in one millisecond retained whichever input
order happened to reach it. That could disagree with the store and made the claim “newest” partial.

Fixed by applying the store's `id` tie-break after equal times.

Red-first test: `breaks a createdAt tie by id, as the job store does`.

### 3 — Unvalidated wire data could poison the time comparison

`Job.createdAt` is required by TypeScript, the Postgres column is `NOT NULL`, and the current server
adapter emits `row.createdAt.toISOString()`. So the normal server cannot omit it or send an invalid
date. But the browser does not decode `/api/jobs` at runtime: `send<{jobs: Job[]}>` asserts the JSON
shape, and `currentClientJob` spreads it unchanged. The engine therefore *can* hold a missing or
invalid value if the wire contract is broken.

With the original selector, a malformed first candidate produced `NaN`; every later comparison of
`validTime > NaN` was false, so the malformed job hid valid imports. Fixed locally by ranking a
valid time above an invalid one, then using `id` as the deterministic fallback.

Red-first test: `does not let a malformed or missing createdAt hide a valid import`.

Adding runtime decoding for the whole `Job` response would be the wider fix. I did not add that in
this review: it affects every queue consumer and needs a deliberate policy for rejecting or dropping
malformed jobs. The local selector now fails soft rather than being poisoned. The root-cause write-up
is `docs/postmortems/261019e-a-selector-is-only-as-current-and-total-as-its-input.md`.

## Checks requested explicitly

- **`onRetried` and `followed`:** fixed the stale-list gap above. The newer-retry-over-followed-job
  test still passes, so an older followed failure is not resurrected.
- **Equal `createdAt`:** now uses the store's `id` tie-break and has a regression test.
- **Missing or invalid `createdAt`:** possible only after a broken wire response, not from the
  present Postgres adapter; locally guarded as above.
- **`watchTerminal`:** still correct. The watcher remains registered on the running job id;
  `jobEngine.apply` updates the snapshot and calls `tellWatchers`, which sends `done` and invokes
  `onPublished`. `reads the article again when the import is done` passes.
- **Already-completed import:** both `does not loop if the article is still unreadable after the
  completed import was checked` and `allows a fresh completed-import check after an in-place change
  of address` pass unchanged.
- **`AdminArticle` consumers:** the only production consumers are the admin route, the
  cross-owner store, and `AdminArticlesPage`; all now carry or read `published`. The two test
  consumers were updated. No other constructor or consumer was missed.
- **Disclosure:** another reader's private row gets `published: null`, alongside its null title and
  slug. The boolean is sent only where those fields were already shown (the administrator's own or a
  public article), so it adds no private cross-account fact.
- **Comments:** replaced the stale “By id from then on” description and documented the complete
  `(createdAt, id)` rule and the unvalidated-wire fallback.

## Verification

- Red run, before the fixes: `tests/still-being-added.test.tsx` — 3 failed, 20 passed (the three
  findings above).
- `npx vitest run tests/still-being-added.test.tsx tests/admin-articles-page.test.tsx` — 32 passed.
- `npx biome check` on the seven changed source/test files — passed.
- `npm run typecheck` could not start `tsx` in this sandbox (`listen EPERM` on its `/tmp` IPC socket).
  Running the same driver without that launcher IPC, `node --import tsx scripts/typecheck.ts`, passed
  all four TypeScript projects and the source-coverage check.
- `tests/article-transfer.test.ts` could not run here because the sandbox cannot connect to the local
  Postgres port (`connect EPERM 127.0.0.1:54362`). Its added assertions and query shape were reviewed;
  this is an environment failure, not a test failure.
