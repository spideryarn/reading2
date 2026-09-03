# Review this umbrella plan before anything is built

You are reviewing a **plan**, not code. Nothing has been implemented yet.

## What this is

`docs/plans/260903a-improve-the-codebase-sweep.md` is the umbrella plan from a periodic whole-tree
codebase-improvement sweep of the Spideryarn repo. The method is in
`docs/reusable/improve-the-codebase.md` — read that first; it is the standard the plan has to meet,
and it is unusually specific about what a good finding looks like and what a bad one looks like.

Nine read-only audit agents swept the tree in parallel (four by lens, five by zone). Their findings
were verified by the orchestrator and written up as Tiers 0–3 with an evidence state on each. The
plan proposes five work stages, three of them running in parallel on non-overlapping file sets.

**Working directory**: this repo, at `worktree-improve-260903`, base commit `ba05333b`.
The tree is read-only to you, but **you can run one test file or a script** — please do:

    npx vitest run tests/<one>.test.ts
    node --import tsx <script>

`npm test`, `npm run check` and `npm run typecheck` will not run in your sandbox. Do not try.

## What I most want from you

The run is unattended (the author is asleep), so the cost of a bad plan is a whole night of work in
the wrong direction. In rough order of value to me:

### 1. Is any finding wrong?

Every item carries an evidence state — `reproduced`, `proved from the code`, or `hypothesis`.
**Check the strength, not just the claim.** Where I have asserted a quantifier ("six copies", "36
references", "seven transactions", "nothing catches a 40001"), I counted — but check the counts you
can check cheaply, because a count that arrives low is the structural failure mode of this method,
and a dedup that leaves a copy alive is worse than no dedup.

Specifically worth your scepticism:

- **T0.1** — I claim `npm run check` cannot pass on a clean checkout, because the `test` gate runs
  `tests/pdf-bundle-trace.test.ts` which needs `api-dist/vercel.js`, and nothing in `check` builds
  it. Verify by reading `scripts/check.ts`'s `STEPS`, `package.json`'s `build`, `vercel.json`'s
  `buildCommand` and `tests/pdf-bundle-trace.test.ts`. **Is my proposed fix right?** I want to make
  `npm run build` be *both* build passes and reduce `vercel.json` to `npm run build`. Tell me what
  that breaks. `scripts/build-stamp.ts`, `scripts/client-shell.ts`, `scripts/sentry-build.ts` and
  `tests/no-secrets-in-bundle.test.ts` all have opinions about build ordering; I have read them but
  not exhaustively. The alternative — a separate `build:api` step inside `check.ts` only — is
  smaller but leaves the full recipe living in `vercel.json` and a doc.
- **T1.2** — I claim `articleIdFor` exists in six throwing copies and that `pg-comments.ts:84` has
  dropped the `requireSlug(slug)` call its five siblings make. Check both halves.
- **T1.3** — I claim seventeen `.transaction(` call sites across nine `src/store/pg-*.ts` files do
  not pin an isolation level while five elsewhere do. Check the list. **And tell me whether pinning
  is actually right**: `docs/project/sql.md` says these depend on `read committed`, but I have not
  verified what the Supabase role actually defaults to and I say so. Is a plan that pins seventeen
  call sites on a doc's say-so sound, or should the first move be measuring the default?
- **T1.5** — I claim `tests/admin-queries.test.ts`'s three "attributes through the article"
  assertions would pass a query whose join condition was `eq(articles.ownerId, articles.ownerId)`.
  **This one you can run.** `npx vitest run tests/admin-queries.test.ts` passes today; the claim is
  about what it would *also* pass. If you can construct the mutation and show it green, say so; if
  you think the surrounding assertions in that file already catch it, say that instead.
- **T1.8** — five deletions. Each is an **absence**, and improve-the-codebase.md is explicit that an
  absence is only as good as its sweep. `scripts/` and `docs/` are where a "callerless" symbol's
  caller has hidden before. Re-run any grep you doubt.

### 2. Is the ordering right, and are the parallel lanes actually independent?

The rule I am working to is: *the first stage addresses the highest confirmed tier unless risk
explicitly vetoes it*, and *if you run stages in parallel the constraint is non-overlapping file
sets, not independent ideas*.

- Stage 1 is the gates. Is that right, or does something in Tier 1 deserve to go first?
- Stage 2 runs 2a / 2b / 2c concurrently. **Read the file lists and tell me if they collide.** I
  found two collisions (2c's citation sweep reaching into `src/store/`, and `scripts/db-*.ts`) and
  resolved both by giving 2a sole ownership of `src/store/` and 2b sole ownership of
  `scripts/db-*`. Did I miss one? `src/process-state.ts`, `src/cost-report.ts` and the `tests/`
  directory are where I am least confident.

### 3. Is any proposed fix worth less than the machinery it costs?

**Please answer this one explicitly for each of T1.2, T1.3, T2.1 and T2.3** — reviewers are good at
this and do not volunteer it. improve-the-codebase.md gives me two tests to apply and I have applied
them, but I am the wrong person to grade my own enthusiasm:

- **the deletion test** — would removing the proposed module concentrate complexity behind a smaller
  interface, or spread it across the callers?
- **the YAGNI test** — if the requirement does not exist today, neither should the complexity.

T2.3 in particular: extracting a `withStallTimeout` helper used by seven streaming handlers. The
audit that found it also found **no drift between the seven copies**. Is that a reason not to do it?
The counter-argument in the plan is that `src/explain.ts:494-500` records the adjacent half of the
same idiom having been consolidated into `src/ai-call.ts` after three of six copies diverged. Which
argument wins?

### 4. What did the sweep miss?

Four of five zones came back with a verdict of "sound" and no fresh live defect. That is either true
or it is what a sweep looks like when its agents read shallowly. The plan's scope line says what the
method is blind to. **Is there a shape of problem this sweep structurally could not see, that you
would look for?** Static reading finds no races, no ordering bugs, nothing runtime-only, and nobody
drove a browser.

## How to report

For each finding, give me:

**(a) the mutation** — the input, edit or command under which the current code or the proposed plan
fails its own claim. Something I can run and watch go red. A finding with no (a) is an opinion and I
will rank it last, which is fine — say so and give it anyway.

**(b) the smallest change that closes it**, as a code block. Not a patch to apply; a shape to copy.

Rank your findings by (a). Then a one-line verdict: **ready to build** / **ready with changes** /
**not ready**, and if not ready, the single thing that has to change first.

Be blunt. I would rather lose an hour to a rewrite now than a night to building the wrong thing.

## Files worth opening

- `docs/plans/260903a-improve-the-codebase-sweep.md` — the plan under review
- `docs/reusable/improve-the-codebase.md` — the standard it must meet
- `scripts/check.ts`, `package.json`, `vercel.json`, `tests/pdf-bundle-trace.test.ts` — T0.1
- `knip.jsonc` — T1.7
- `src/store/pg.ts`, `pg-comments.ts`, `pg-chat.ts`, `pg-searches.ts`, `pg-referee-claims.ts`,
  `pg-referee-criteria.ts`, `pg-lookups.ts` — T1.2, T1.3
- `src/store/ai-calls-fs.ts`, `src/process-state.ts` — T1.4
- `tests/admin-queries.test.ts`, `src/store/pg-admin.ts` — T1.5
- `src/explain.ts`, `src/ai-call.ts`, `src/search.ts`, `src/converse.ts` — T2.3
- `scripts/db-migrate.ts`, `scripts/db-seed-dev.ts`, `scripts/db-reown.ts` — T1.11
- `docs/project/sql.md`, `docs/postmortems/260901f-a-for-update-that-locks-nothing.md` — T1.3
- `docs/postmortems/260902c-the-truncation-retry-cost-storm.md` — T1.4, T2.1
