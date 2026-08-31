# Review request: repairing a drizzle migration watermark, on a laptop and on production

You are reviewing a **design decision**, before it is built. Answer with a verdict
(SHIP / NO-SHIP / SHIP-WITH-CHANGES) and specific findings. Be adversarial: the whole
reason you are being asked is that the obvious check here agrees with the bug.

## The defect, established by probing the live schema rather than by reading the journal

`npm run db:migrate` on this project prints `✓ migrations applied` and applies nothing.
Four published migrations have never run on the developer laptop:

| migration | journal `when` | effect that is MISSING from the live schema |
|---|---|---|
| `0032_jobs_concurrency_cap` | 1788118212636 | old `jobs_only_one_running` unique index still present |
| `0033_quotes`               | 1788159937926 | `spideryarn.article_revisions.quotes` column does not exist |
| `0034_flowery_wolfsbane`    | 1788163164707 | `chat_messages.passages` / `.interrupted` do not exist |
| `0036_drop_summary_column`  | 1788175229610 | `article_revisions.summary` still present; `revision_step_runs_step` CHECK still lists `'summary'` |

Applied and present: everything up to `0031_sketch`, plus `0035_timeline`
(`when` = 1788200000000), plus two now-renumbered local migrations.

## Root cause

`scripts/db-migrate.ts` calls drizzle-orm's node-postgres `migrate()`. That migrator
reads **one watermark** — the single newest row of `__drizzle_migrations` by
`created_at` — *once*, before its loop, and then applies only journal entries whose
`when` is **strictly greater** than that watermark. It is not a per-migration ledger.
A migration whose `when` is lower than the watermark is skipped permanently and
silently.

Two things raised the watermark past those four:

1. `0035_timeline`'s journal entry was hand-written with a fabricated round
   `when: 1788200000000` — later than every migration around it, including `0036`,
   which is `1788175229610`. So **`0036` is skipped on any database that applied
   `0035` first.** We believe that includes production, which we cannot currently
   reach to confirm (no `.env.prod` in this tree).
2. On the laptop, two *unpushed* local migrations carried real drizzle-kit timestamps
   from later the same evening (1788191337811, 1788194935325). Applying those first
   raised the watermark above origin's published `0032`–`0034` and `0036`, so a
   subsequent `git pull` + `db:migrate` could never run them.

## What I propose to do

**On the laptop**, and note the constraint: I may NOT `supabase db reset`. Greg asked
to avoid it because it destroys `auth.users` (3 real accounts locally), and preserving
accounts is the point.

1. Apply the four missing migrations by hand, in journal order, against the local
   database.
2. Insert the corresponding `__drizzle_migrations` bookkeeping rows using each
   migration's own journal `when` as `created_at`, so the ledger tells the truth.
   (This does not lower the watermark: the newest row stays the newest.)
3. Verify by re-probing the live schema for each of the four effects above — not by
   re-reading the journal, and not by trusting a `✓`.

**Do NOT re-timestamp the published migrations.** Production may have applied
`0032`–`0035` correctly; rewriting their `when` would make them re-run there and fail.

**A durable guard**, which is the part I most want you to attack. I propose adding to
`scripts/db-migrate.ts`, *after* `migrate()` returns: read `__drizzle_migrations`,
compare against the journal, and **fail loudly if any journal entry is unapplied**.
Rationale: the class of bug is "reported success, did nothing", so the check must
assert on the end state rather than on the command's exit.

## Questions I want answered

1. **Is the bookkeeping insert in step 2 correct, or does it paper over a real
   divergence?** Specifically: is there any way the laptop's schema could differ from
   what those four migrations would have produced, such that recording them as applied
   makes a future migration fail in a way that is harder to diagnose than the current
   state? What would you check before inserting each row?
2. **`0036` narrows a CHECK constraint** (`revision_step_runs_step`, dropping
   `'summary'`) and drops a column. Postgres validates a re-added CHECK against
   existing rows, so the migration does a DELETE first. What is the failure mode if
   the laptop has `revision_step_runs` rows this DELETE does not cover, and how should
   I detect that *before* running it rather than after?
3. **Ordering:** applying `0036` by hand after `0037` (our renumbered local migration,
   already generated, `when` = 1788206280872) means the live schema reaches a state the
   journal never describes at any single point. Does that matter for any future
   `drizzle-kit generate` diff, which works from `meta/*_snapshot.json` rather than
   from the database? Is there a snapshot-vs-database divergence I am about to create?
4. **The guard:** is "every journal entry must be applied" the right invariant, or is
   it too strict — is there a legitimate state where a journal entry is deliberately
   unapplied? Would you assert something else instead, or as well?
5. **Production:** I cannot reach it tonight. Given `0036` is probably skipped there
   by the same mechanism, what is the safest instruction to leave for the human, and
   what should the guard do the first time it runs against production and finds a
   gap — refuse to migrate, or report and continue?
6. Anything else here that is wrong, or that I have not thought to ask.
