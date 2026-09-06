# Review: stage I — retire the `SPIDERYARN_STORE` tombstone

The last stage of
[260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md](260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md).
Deletes a validated no-op and the sensor that was watching for its unblocking.

## The candidate

**Landed as `219c4bc1`** (2026-09-06), which is where to read what this reviewed. It was a live
pre-commit candidate at the time, on base SHA `870bcb832a2e451e4fd2ca48f380aa9796c53439`, branch
`worktree-delete-store-flag`, in the worktree
`/home/greg/code/spideryarn2/.claude/worktrees/delete-store-flag`.

**The commit is not what this round saw.** Its verdict was *refuse as-is*, and the F1 fix, the two
deletions it asked for (Q1, Q2) and everything round two then found all post-date it —
[round two](260903f-stage-i-round-two-review-prompt.md) is the review of the commit as it landed.

```
git diff 870bcb832a2e451e4fd2ca48f380aa9796c53439 -- <paths below>
```

**Changed paths** (22 modified, 2 deleted, 844 net lines removed):

```
src/store/live.ts  src/db/client.ts  src/vercel-health.ts  src/store/index.ts  src/env.ts
scripts/deploy-checks.ts  scripts/deploy.ts  scripts/check.ts  scripts/store-migration-witness.ts
tests/one-store-only.test.ts  tests/health.test.ts  tests/deploy-checks.test.ts
tests/dev-server-store-default.test.ts  tests/store-export-fails-closed.test.ts
.env.example  docs/project/{architecture,database,deployment,setup-dev,supabase-local,testing}.md
docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md
DELETED: tests/store-selection.test.ts  tests/store-flag-refused-at-boot.test.ts
```

**Untracked file**, which no pathspec can name and which is therefore easy to miss: this prompt
itself, `docs/plans/260903f-stage-i-review-prompt.md`. There are no other untracked files in scope.

**Start** with `tests/one-store-only.test.ts`, `src/store/live.ts` and `src/vercel-health.ts`.
That is where to start and **not** a limit on scope.

`docs/project/architecture.md` is edited in the tree but **will not be in the commit** — it is one
of this repo's seven entry-point docs, whose wording needs the owner's approval one set at a time.
Review it anyway; it is part of the change even though it lands separately.

## What it is meant to do

`SPIDERYARN_STORE` chose between a filesystem store and Postgres until 2026-09-05, when the
filesystem store was deleted (stage G). Since then the variable has been a **tombstone**: a
validator in `src/store/live.ts` that accepts unset and `postgres` silently and throws on `files`
or any other value. It was kept deliberately, and only because Vercel's Preview and Production
environments still carried the variable and no agent on this box has a Vercel credential —
silently ignoring an operator who asked for `files` is the exact failure this migration exists to
leave behind.

**Greg removed it from both environments at 16:35 on 2026-09-06** (`vercel env rm
SPIDERYARN_STORE production` and `… preview`, both returning *Removed Environment Variable*). That
was the only thing stage I was gated on. This change therefore deletes:

- the tombstone validator, and the two test files whose entire subject it was;
- the sensor stage F added — a `retired` field on `/api/health` and a *"still to remove"* line in
  `npm run deploy` — whose job was to announce that this gate had opened, and which has now done it;
- the `src/vercel-health.ts` exemption in the `one-store-only.test.ts` allowlist.

`src/store/live.ts` itself **survives**: it also holds `notMigratedError` / `notMigrated`, the 501
for a write with no Postgres implementation, which is unrelated scaffolding for a different plan.

The guard `tests/one-store-only.test.ts` also survives and its claim gets **stronger**: it went
from *"only the tombstone reads this variable"* to *"nothing reads it at all"*.

## What you can and cannot run

You have the tree and no network — not even loopback. **`tests/one-store-only.test.ts` needs
nothing but the filesystem** (it greps source), so please run it yourself:

```
npx vitest run --project unit tests/one-store-only.test.ts
```

Anything touching Postgres is mine to run; the gate results are pasted below as raw output.

## Attack it

Independent pass first. In particular:

1. **Is anything left that reads the flag?** The plan's own acceptance criterion names paths beyond
   the obvious ones: `evals/`, `vite.config.ts`, `package.json`, `.env.example`, `AGENTS.md`,
   and `api/index.js` — the production shim Vercel actually invokes, which this guard's regex
   missed until 2026-09-05 because it only matched `/\.tsx?$/`.
2. **Did deleting the tombstone lose a side effect?** `src/store/live.ts` called `loadEnvLocal()`
   at module load and was imported for effect by `src/db/client.ts` — the narrowest boundary
   everything reaching Postgres must cross. If `.env.local` loading depended on that import, its
   removal is a P0 that no unit test would see.
3. **Is the surviving guard still able to fail?** `MAY_NAME_THE_FLAG` is now empty, so the case
   that checks exemptions for staleness iterates nothing and passes vacuously. Does the file still
   have a case that can go red? This repo's chronic failure class is a check that cannot fail
   ([silent-success.md](../reusable/silent-success.md)), and shipping one *inside* the commit that
   removes a silent-failure hazard would be a poor joke.
4. **Does any comment now state something false in the present tense?** Several files legitimately
   explain the flag's history in the past tense and should keep doing so. A sentence saying the
   variable "is still set in Vercel", or that "stage I will delete this", is now wrong.
5. **The health endpoint's shape changed.** Is `retired` removed from the type as well as the
   value, and does anything consume `/api/health` that will break on the missing field?

## Severity scale

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

Grade by consequence, not by the file: a defect in prose that will cause a P1 to ship is not a P3
because it is made of words. **Refuse only on an established P0 or P1** — direct evidence with no
unresolved material inference. Give every finding a stable ID: `F1`, `F2`, …

## My own suspicions — read last

These are already mine and worth less than what you find on your own; spend most of the run
elsewhere.

- The empty `MAY_NAME_THE_FLAG` in point 3 above is the thing I am least happy about.
- I am not certain the `retired` field is gone from every consumer, only from its producer.
- Deleting two whole test files (`store-selection.test.ts`, `store-flag-refused-at-boot.test.ts`)
  is what the plan says to do, but check I have not thrown away an assertion that was about
  something other than the flag and was only living there.

## Two open questions I want your judgement on, and have deliberately not settled

**Q1 — `src/store/live.ts` is now an orphan. Delete it outright?** With the tombstone gone the file
holds only `notMigratedError` / `notMigrated`, the 501 for a write with no Postgres implementation.
I verified by grep that **nothing imports either one**: every remaining mention across `src/` and
`tests/` is prose inside a comment. `npm run knip` now lists the file under "Unused files" (12 → 13);
knip is advisory here, not a gate, so `npm run check` stays green either way.

Arguments for deleting it in this stage: the repo's owner has said explicitly that he wants dead
code gone so future agents are not confused, and a file knip calls unused is exactly that. Arguments
against: it was already dead *before* this stage, it is named as the interim refusal by a different
plan (`docs/plans/260826e-postgres-storage-implementation.md` § step 10), and deleting it turns
about eight explanatory comments across `src/` and `tests/` into references to a function that does
not exist — a materially bigger diff than the one you are reviewing.

I would rather be told than decide this alone. Which way, and does it belong in *this* stage?

**Q2 — `inheritedEnv` in `src/env.ts` is now dead too.** It was grown specifically for the
tombstone, to see what the shell exported as distinct from what `.env.local` overrode. It now has
one definition and zero callers. Same question, lower stakes: delete now, or leave with the honest
note the implementer added saying it has no callers?

Grade both as P2 at most — neither is wrong behaviour today. I am asking for a recommendation, not
a finding.
