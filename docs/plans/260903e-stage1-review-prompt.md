# Review the code, not the plan

You reviewed the plan for this work earlier and requested changes; this is the obligatory end-of-stage
review of what was actually built. **Weight this one higher than the plan review** — a plan-stage
review cannot find a wrapper that drops an errno.

Working directory is a full checkout of the Spideryarn repo (TypeScript + ESM, Postgres/Supabase).

## What to read

1. **The scoped diff:** `/tmp/claude-1000/-home-greg-code-spideryarn2/88b5a2b0-797c-4c1d-a29a-de36e3f1dfb1/scratchpad/stage1.diff`
   — all changes under `src/`, `scripts/`, `tests/`, with the one new test file appended in full.
2. **The plan**, for what was and was not in scope:
   `docs/plans/260903e-sweep-recorded-rather-than-fixed-defects.md`. Note that your plan review
   already removed a positional theory, a `DEFECT:` test convention, and all `docs/reusable/` edits.
   Those are gone; do not re-litigate them.
3. `docs/postmortems/260903e-three-attempts-to-build-a-control-for-recorded-not-fixed.md`.

## What was built — five fixes on disjoint files

1. **`scripts/db-export.ts`** — the rollback script called `loadEnvLocal()` and never
   `resolveTargetUrl()`, so `DATABASE_URL=<remote> npm run db:export` exported the laptop while
   printing success. Now resolves with `shellWins: true` like `db-migrate`/`db-check`, **and assigns
   `process.env.DATABASE_URL`**, because this script builds no pool of its own — `src/db/client.ts:73`
   and `src/store/blobs.ts:318` each read the env var for themselves.
2. **`src/pdf-read.ts`** — `if (await readFile("raw.json").catch(() => null)) return;` treated any
   non-empty bytes as done, so a crash mid-write made an article permanently unreadable. Now parses
   and applies the shared `whyUnusable("raw", …)` shape check.
3. **`src/store/pg-comments.ts`** — guarded at its export like `pg-jobs`/`pg-uploads`. This forced a
   change to the composition root, see below.
4. **`src/quiz.ts`** — the deferred cap bug names `dropped.overCap` as its trigger; that number was
   absent from the only diagnostic that fires when it fires. Added, and wrapped in the `{ authored }`
   channel because as free text the whole string was `withheld: true` and never reached Sentry.
5. **`src/web/App.tsx` + `styles.css`** — `@media (max-width: 843px)` could not see `?spine=0`, so
   between 832 and 843px with the rail off the band was laid over prose the layout had just made room
   for. Replaced with a `band-covers` class written from `fit.modeW === 0`.

## Where I most want you to attack

1. **The composition-root change (`src/store/index.ts`), which is the riskiest thing here.**
   `guarded()` now returns an already-guarded store as-is instead of wrapping it. The justification is
   that double-wrapping is **not** a no-op: `scrubDbError` copies a SQLSTATE onto the error it returns
   but has nothing to copy an **errno** onto, so on a second pass `ECONNRESET`/`ETIMEDOUT` stop
   matching `TRANSIENT_ERRNOS` and `STORAGE_BUSY` becomes `STORAGE_FAILED` — which `src/jobs.ts`
   persists as `bug` and which removes the reader's Retry button.
   **Verify that claim yourself** in `src/store/db-errors.ts`, and then ask the harder question:
   is skipping the second wrap the right fix, or does it mask that `scrubDbError` should carry the
   errno through? Is `isGuardedStore` (a `Symbol.for` brand) sound across module-instance boundaries?
   Could any store now end up *unguarded* that was guarded before?

2. **`{ authored }` in `src/quiz.ts`.** That channel asserts every character of the string is ours,
   and it is the difference between the diagnostic reaching Sentry and being withheld. I checked the
   interpolations — integers and band names off the `SPREAD_ENDS` constant. **Check me.** Is there any
   path by which model text, a question, a quote or a provider message reaches that string? A false
   `{ authored }` claim is a privacy regression, and one was caught in this exact code two days ago.

3. **`src/pdf-read.ts`.** Does the tolerant read still short-circuit correctly on a *valid* manifest?
   Is `whyUnusable("raw", …)` — which checks only a string `file` field — the right strictness, or
   does it accept things that will fail later? Note the write is still **not** atomic, deliberately
   and recorded; say if you think that is wrong.

4. **`scripts/db-export.ts`.** Is `process.env.DATABASE_URL = url` safe here? Is `shellWins: true`
   correct for a rollback tool? The other four `db-*.ts` scripts with no `resolveTargetUrl` were
   each argued as not needing one — check that reasoning in the diff.

5. **The layout change.** `.band-covers` is written when `fit.modeW === 0`, which is *also* true when
   no band is open, so every rule names `.mode-band` as well. Is that sound? Does removing the media
   query lose anything at widths nobody checked? `:has()` has 22 existing uses in the file.

6. **Anything the diff asserts that you can falsify.** Roughly a third of the automated findings
   feeding this work were wrong, all in the same direction — a symptom confirmed absent from the file
   named, without checking whether something else supplied it. Two of five subagent reports here
   contained a claim I had to correct.

## Please run something

Your sandbox allows it, and a finding you reproduced outranks one you reasoned to:

```
npx vitest run tests/store-guarded.test.ts tests/db-error-scrub.test.ts
```

Fast, no network, and it covers the riskiest change. **Note before you conclude anything from a
failure:** this box is shared and currently at load average ~150 with ~140 concurrent vitest
processes from other agents' sessions, several other worktrees run the same suites against one local
Supabase, and `tests/store-comments.test.ts` and siblings use **fixed literal fixture ids**, so two
worktrees running them concurrently collide in the fixture rather than in the code. A store test
failing on a duplicate key or an advisory-lock timeout is contention. A store test failing on an
*assertion* is not.

## Verdict format

Findings ranked by how much they would change the code, each marked as something you reproduced or
something you reasoned to. Say plainly if any of the five should not ship.
