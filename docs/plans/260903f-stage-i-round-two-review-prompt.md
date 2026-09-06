# Review round two: stage I — retire the `SPIDERYARN_STORE` tombstone

Round one is [260903f-stage-i-review-prompt.md](260903f-stage-i-review-prompt.md); your verdict on
it is [260903f-stage-i-review-sol.md](260903f-stage-i-review-sol.md), and it was **refuse as-is**.
This is the same candidate after the repairs, plus the two deletions you asked for.

**Finding IDs are stable across rounds.** `F1`, `F2` and `F3` below are the ones you issued and mean
exactly what they meant then. Anything new starts at **`F4`** and numbers upward.

## The candidate

**Live pre-commit**, still. Base SHA `870bcb832a2e451e4fd2ca48f380aa9796c53439` on branch
`worktree-delete-store-flag`, in the worktree
`/home/greg/code/spideryarn2/.claude/worktrees/delete-store-flag`.

```
git diff 870bcb832a2e451e4fd2ca48f380aa9796c53439 -- <paths below>
```

**Changed paths** — 30 modified, 3 deleted; 35 files, 390 insertions, 1254 deletions:

```
src/db/client.ts  src/env.ts  src/store/index.ts  src/store/blobs.ts  src/store/db-errors.ts
src/source-scan.ts  src/upload-records.ts  src/vercel-health.ts
scripts/check.ts  scripts/deploy.ts  scripts/deploy-checks.ts  scripts/stage.ts
scripts/store-migration-candidates.ts  scripts/store-migration-witness.ts
tests/one-store-only.test.ts  tests/health.test.ts  tests/deploy-checks.test.ts
tests/dev-server-store-default.test.ts  tests/store-export-fails-closed.test.ts
tests/store-seams-have-two-implementations.test.ts  tests/store-migration-registry.ts
tests/db-error-scrub.test.ts  tests/referee-routes-postgres.test.ts
.env.example  AGENTS.md  docs/project/{architecture,database,deployment,setup-dev,supabase-local,testing}.md
docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md
DELETED: src/store/live.ts  tests/store-selection.test.ts  tests/store-flag-refused-at-boot.test.ts
```

**Untracked files**, which no pathspec can name and which are therefore easy to miss. There are
four, all in `docs/plans/`, and all four will be committed:

```
260903f-stage-i-review-prompt.md      (round one's prompt)
260903f-stage-i-review-sol.md         (round one's verdict — yours)
260903f-stage-i-round-two-review-prompt.md   (this file)
260903f-stage-i-round-two-review-sol.md      (where your answer will be written)
```

**The commit SHA will be written into this file once the change is committed**, so that what you
reviewed stays identifiable after the working tree moves on.

**Start** with `src/db/client.ts` and `tests/one-store-only.test.ts` — that is where F1's fix and
its guard live. That is a starting point and **not** a limit on scope.

## What changed since round one

### F1 (P1) — the lost import-time `.env.local` load

You were right, and I reproduced it independently before touching anything: with the three Supabase
credentials absent from the inherited environment and present in `.env.local`, importing
`src/store/index.js` threw at `src/store/blobs.ts:310` — *"the store is Postgres, but there is no
Supabase Storage configured"*.

**The fix is one statement at module scope in `src/db/client.ts`**, `loadEnvLocal();`, with a
docstring above it saying it is load-bearing and why. You offered two options — rehome the lost load
before `store/index.ts`'s boot-time constructor, or convert every affected entry point to load then
dynamically import. I took the first. `src/db/client.ts` rather than `src/store/index.ts` because
`src/jobs.ts`, `src/upload-records.ts` and `src/store/ai-calls.ts` all reach Postgres without going
through the wiring hub, so the hub is one door of several and `client.ts` is the boundary all of
them cross. That reasoning is itself recycled: the tombstone was moved from `index.ts` to
`client.ts` for the same reason during stage F, and the comment at the head of `src/store/index.ts`
records it.

**It is guarded**, by a source-shape assertion in `tests/one-store-only.test.ts` — the unit lane sets
`VITEST`, which is exactly what makes `src/store/index.ts` skip the credential check, so no test in
that lane can execute the failure. The regex anchors to column zero to exclude the lazy
`loadEnvLocal()` inside `databaseUrl()`, which runs far too late to help.

**Both new assertions were mutation-tested**: removing the module-scope call turned the guard red
*and* reproduced the real boot failure; planting a bogus allowlist entry turned the emptiness
assertion red.

The questions worth your attention: **is the placement right**, is one statement enough for every
affected entry point, and does anything reach Postgres without crossing `src/db/client.ts`?

### F2 (P2) — the circular confirmation criterion

Corrected in the plan doc, and **struck out rather than quietly rewritten**: the header now records
what it used to say, that it was circular, that you found it, and that the evidence is the two
`vercel env rm` results themselves. Please check the replacement is not circular in a new way.

### F3 (P3) — present-tense claims that are now false

Swept: `src/store/index.ts`, `docs/project/database.md`, `scripts/stage.ts`, `AGENTS.md`,
`docs/project/architecture.md`, and a further nine or so sites in `src/` and `tests/`. `AGENTS.md`
and `docs/project/architecture.md` are owner-approved edits and are now **in the commit**, contrary
to what round one's prompt said about `architecture.md`.

**Deliberately not swept**: roughly eleven test-file headers that name `src/store/live.ts` inside
historical narrative, and around seventy comments that explain in the past tense what the flag used
to decide. Deleting those would be rewriting history to satisfy a grep. The plan's "done" criterion
was sharpened accordingly — from the flag *appearing* nowhere to being **read** nowhere.

### Q1 — `src/store/live.ts` deleted outright

As you advised. Zero importers of `notMigratedError` / `notMigrated` were verified by grep first.
The anti-vacuity anchor in `one-store-only.test.ts` now names `src/store/index.ts`.

### Q2 — exported `inheritedEnv()` deleted, `INHERITED` kept

As you advised.

### New in this round, and not asked for by you

`scripts/store-migration-candidates.ts` had a whole reporting dimension built on the deleted file: a
`FLAG_LEAF = "src/store/live.ts"` constant, a `flagReaders` set, a `flag-selection-only` bucket, a
`livePath` field and a `reachingFlagLeaf` count. With the file gone that dimension is permanently
zero while naming something not on disk. **It is deleted.** The bucketing is unchanged in fact,
because an empty cut removes nothing — but please check that claim rather than take it, since it is
the kind of thing that is obviously true right up until it is not.

## The severity scale

- **P0** — data loss, a security hole, wrong charging, or the service unusable.
- **P1** — user-visible wrong behaviour, or an authoritative contract violated.
- **P2** — a design or maintainability risk with no wrong behaviour today.
- **P3** — a non-behavioural defect: prose that is false, a comment that misleads.

**Refuse only on an *established* P0 or P1** — one you have direct evidence for, with no unresolved
material inference in the chain. Anything you suspect but cannot establish is worth saying and is
not grounds for refusal; say which it is.

## What this change is for

`SPIDERYARN_STORE` chose between a filesystem store and Postgres until 2026-09-05, when the
filesystem store was deleted. From then until 2026-09-06 the variable was a validated no-op: unset
and `postgres` passed silently, `files` or anything else threw. That was kept deliberately, and only
because Vercel's Preview and Production environments still carried the variable — silently ignoring
an operator who asked for `files` is the exact failure this migration exists to leave behind. Greg
removed it from both environments at 16:35 on 2026-09-06. This stage deletes the tombstone, the
sensor that was watching for that removal, and the scaffolding both stood on.

## Two things I would look at, if the pass above turns up nothing

Labelled as mine, and **please form your own view first** — these are the ones I am least sure about
and most likely to have talked myself into.

1. **`tests/store-seams-have-two-implementations.test.ts` now holds a check that cannot fire.**
   `callsNotMigrated` matches a call to an identifier literally spelled `notMigrated` inside a
   `pg*Store` initializer. Nothing defines that name any more, so on today's source it is not a
   guard, it is a tripwire for someone reviving the helper *and* keeping the spelling. The file now
   says so in as many words rather than letting it look load-bearing, and its neighbour
   `"has a Postgres implementation for every seam"` is structural and unaffected. Is saying so
   enough, or should the check test the *shape* — a `pg*Store` whose every method body only throws —
   or simply go?

2. **The F1 guard is a source-text assertion, which is a weak instrument.** It cannot see a
   `loadEnvLocal()` that is present but unreachable, and it would pass on a file that had the line
   and nothing else. I could not find a way to make the unit lane execute the real failure, because
   the lane's own `VITEST` variable is what suppresses it. Is there a test shape I have missed —
   a child process, a separate vitest project without `VITEST` set — that would make this a real
   check rather than a spelling check?
